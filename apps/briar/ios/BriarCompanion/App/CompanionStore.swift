import BriarContracts
import Foundation
import SwiftUI

struct OrganizationSummary: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
}

@MainActor
final class CompanionStore: ObservableObject {
    @Published private(set) var user: CurrentUser?
    @Published private(set) var organizations: [OrganizationSummary] = []
    @Published private(set) var projects: [Project] = []
    @Published var selectedProjectID: UUID? {
        didSet {
            persistSelectedProjectID()
        }
    }
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let accountService: (any BriarAPI_AccountServiceClientInterface)?
    private let defaults: UserDefaults
    private var activeToken: String?
    private var sessionGeneration = 0
    private var loadRevision = 0
    private var projectCatalogRevision = 0

    private static func selectedProjectKey(for userID: String) -> String {
        "companion.selectedProjectID.\(userID)"
    }

    init(
        api: any MobileAPIClientProtocol,
        accountService: (any BriarAPI_AccountServiceClientInterface)? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        self.accountService = accountService
        self.defaults = defaults
    }

    func load(token: String) async throws {
        sessionGeneration &+= 1
        loadRevision &+= 1
        projectCatalogRevision &+= 1
        activeToken = token
        let expectedGeneration = sessionGeneration
        let expectedLoadRevision = loadRevision
        let expectedCatalogRevision = projectCatalogRevision
        loading = true
        defer {
            if activeToken == token,
               expectedGeneration == sessionGeneration,
               expectedLoadRevision == loadRevision {
                loading = false
            }
        }
        do {
            let account = try accountService ?? authenticatedMobileServices(
                for: api,
                token: token
            ).account
            async let userResponse = account.getCurrentUser(
                request: BriarAPI_GetCurrentUserRequest(),
                headers: [:]
            )
            async let projectResponse = api.listProjects(token: token)
            let (accountResponse, loadedProjects) = try await (userResponse, projectResponse)
            let loadedUser = try CurrentUser(connectMessage: accountResponse.briarValue())
            guard
                activeToken == token,
                expectedGeneration == sessionGeneration,
                expectedLoadRevision == loadRevision
            else { throw CancellationError() }
            user = loadedUser
            if expectedCatalogRevision == projectCatalogRevision {
                applyProjectCatalog(loadedProjects.projects)
            }
            let currentProjects = expectedCatalogRevision == projectCatalogRevision
                ? loadedProjects.projects
                : projects
            let storedProjectID = Self.storedProjectID(
                for: loadedUser.id,
                in: currentProjects,
                defaults: defaults
            )
            selectedProjectID = storedProjectID ?? Self.defaultProjectID(for: currentProjects)
            errorMessage = nil
        } catch {
            if activeToken == token,
               expectedGeneration == sessionGeneration,
               expectedLoadRevision == loadRevision {
                errorMessage = Self.message(for: error)
            }
            throw error
        }
    }

    /// Refreshes the project catalog without discarding a still-valid active
    /// selection. Channel approvals can target a project created by another
    /// member after this device's initial account snapshot.
    func refreshProjects(token: String) async throws {
        if activeToken == nil {
            sessionGeneration &+= 1
            activeToken = token
        }
        guard activeToken == token else { throw CancellationError() }
        let expectedGeneration = sessionGeneration
        projectCatalogRevision &+= 1
        let expectedCatalogRevision = projectCatalogRevision
        do {
            let response = try await api.listProjects(token: token)
            guard
                activeToken == token,
                expectedGeneration == sessionGeneration,
                expectedCatalogRevision == projectCatalogRevision
            else { throw CancellationError() }
            applyProjectCatalog(response.projects)
            if let selectedProjectID,
               !projects.contains(where: { $0.id == selectedProjectID }) {
                self.selectedProjectID = Self.defaultProjectID(for: projects)
            } else if selectedProjectID == nil {
                selectedProjectID = Self.defaultProjectID(for: projects)
            }
            errorMessage = nil
        } catch {
            if activeToken == token,
               expectedGeneration == sessionGeneration,
               expectedCatalogRevision == projectCatalogRevision {
                errorMessage = Self.message(for: error)
            }
            throw error
        }
    }

    func clear() {
        sessionGeneration &+= 1
        loadRevision &+= 1
        projectCatalogRevision &+= 1
        activeToken = nil
        user = nil
        organizations = []
        projects = []
        selectedProjectID = nil
        loading = false
        errorMessage = nil
    }

    private func applyProjectCatalog(_ nextProjects: [Project]) {
        projects = nextProjects
        organizations = Dictionary(
            grouping: nextProjects,
            by: \.organizationId
        ).compactMap { id, projects in
            projects.first.map { OrganizationSummary(id: id, name: $0.organizationName) }
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func storedProjectID(
        for userID: String,
        in projects: [Project],
        defaults: UserDefaults
    ) -> UUID? {
        guard let raw = defaults.string(forKey: selectedProjectKey(for: userID)),
              let stored = UUID(uuidString: raw),
              projects.contains(where: { $0.id == stored }) else {
            return nil
        }
        return stored
    }

    static func defaultProjectID(for projects: [Project]) -> UUID? {
        // The API returns projects grouped by organization; the first project is
        // the first project of the first organization, matching the web client.
        projects.first?.id
    }

    private func persistSelectedProjectID() {
        guard let userID = user?.id else { return }
        if let selectedProjectID {
            defaults.set(selectedProjectID.uuidString, forKey: Self.selectedProjectKey(for: userID))
        } else {
            defaults.removeObject(forKey: Self.selectedProjectKey(for: userID))
        }
    }

    static func message(for error: Error) -> String {
        if let apiError = error as? MobileAPIError {
            return apiError.localizedDescription
        }
        if error is CancellationError { return "" }
        if let localized = error as? LocalizedError, let description = localized.errorDescription,
           !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return description
        }
        return L10n.text("네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.")
    }
}

@MainActor
final class DashboardStore: ObservableObject {
    @Published private(set) var snapshot: DashboardSnapshot?
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let dashboardService: (any BriarAPI_DashboardServiceClientInterface)?
    private let pollInterval: Duration
    private var projectID: UUID?
    private var token: String?
    private var generation = 0
    private var refreshRevision = 0
    private var refreshTask: Task<Void, Never>?
    private var refreshTaskForcesSnapshot = false
    private var pollingTask: Task<Void, Never>?

    init(
        api: any MobileAPIClientProtocol,
        dashboardService: (any BriarAPI_DashboardServiceClientInterface)? = nil,
        pollInterval: Duration = .seconds(15)
    ) {
        self.api = api
        self.dashboardService = dashboardService
        self.pollInterval = pollInterval
    }

    func select(projectID: UUID?, token: String?) {
        guard self.projectID != projectID || self.token != token else { return }
        generation += 1
        refreshRevision &+= 1
        refreshTask?.cancel()
        refreshTask = nil
        refreshTaskForcesSnapshot = false
        pollingTask?.cancel()
        pollingTask = nil
        self.projectID = projectID
        self.token = token
        snapshot = nil
        isRefreshing = false
        errorMessage = nil
        guard projectID != nil, token != nil else { return }
        startPolling()
    }

    func refresh(
        forceSnapshot: Bool = false,
        supersedeInFlight: Bool = false
    ) async {
        guard let projectID, let token else { return }
        if let refreshTask {
            if !supersedeInFlight,
               !forceSnapshot || refreshTaskForcesSnapshot {
                await refreshTask.value
                return
            }
            // A navigation gate needs a canonical snapshot. Supersede an
            // incremental refresh so its older result cannot win afterward.
            refreshRevision &+= 1
            refreshTask.cancel()
        }
        let expectedGeneration = generation
        refreshRevision &+= 1
        let expectedRefreshRevision = refreshRevision
        let current = snapshot
        let task = Task { [api] in
            do {
                let dashboard = try dashboardService ?? authenticatedMobileServices(
                    for: api,
                    token: token
                ).dashboard
                let loaded = try await Self.load(
                    dashboard: dashboard,
                    projectID: projectID,
                    current: current,
                    forceSnapshot: forceSnapshot
                )
                guard
                    !Task.isCancelled,
                    expectedGeneration == self.generation,
                    expectedRefreshRevision == self.refreshRevision
                else { return }
                self.snapshot = loaded
                self.errorMessage = nil
            } catch is CancellationError {
                return
            } catch {
                guard
                    expectedGeneration == self.generation,
                    expectedRefreshRevision == self.refreshRevision
                else { return }
                self.errorMessage = CompanionStore.message(for: error)
            }
        }
        refreshTask = task
        // A first load is canonical even when the caller did not explicitly
        // request `forceSnapshot`, so a concurrent gate can safely join it.
        refreshTaskForcesSnapshot = forceSnapshot || current == nil
        isRefreshing = true
        await task.value
        if expectedGeneration == generation,
           expectedRefreshRevision == refreshRevision {
            refreshTask = nil
            refreshTaskForcesSnapshot = false
            isRefreshing = false
        }
    }

    /// Loads a canonical dashboard for `projectID` and only returns true once
    /// the requested run is present in the store's current authoritative state.
    func ensureRunAvailable(projectID: UUID, runID: UUID, token: String) async -> Bool {
        if self.projectID != projectID || self.token != token {
            select(projectID: projectID, token: token)
        }
        let expectedGeneration = generation
        await refresh(forceSnapshot: true, supersedeInFlight: true)
        guard
            expectedGeneration == generation,
            self.projectID == projectID,
            self.token == token
        else { return false }
        return snapshot?.project.id == projectID &&
            snapshot?.runs.contains(where: { $0.id == runID }) == true
    }

    func applicationDidBecomeActive() {
        guard projectID != nil else { return }
        startPolling()
        Task { await refresh() }
    }

    func applicationDidEnterBackground() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task { [pollInterval] in
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: pollInterval)
                guard !Task.isCancelled else { return }
                await refresh()
            }
        }
    }

    private static func load(
        dashboard: any BriarAPI_DashboardServiceClientInterface,
        projectID: UUID,
        current: DashboardSnapshot?,
        forceSnapshot: Bool
    ) async throws -> DashboardSnapshot {
        guard !forceSnapshot, var merged = current, var cursor = current?.cursor else {
            var request = BriarAPI_GetDashboardRequest()
            request.projectID = coreUUIDString(projectID)
            let response = await dashboard.getDashboard(request: request, headers: [:])
            return try DashboardSnapshot(connectMessage: response.briarValue())
        }
        for _ in 0..<20 {
            guard let wireCursor = UInt64(exactly: cursor),
                  wireCursor <= 9_007_199_254_740_991
            else { throw MobileAPIError.invalidRequest }
            var request = BriarAPI_SyncDashboardRequest()
            request.projectID = coreUUIDString(projectID)
            request.cursor = wireCursor
            let response = await dashboard.syncDashboard(request: request, headers: [:])
            let delta = try DashboardDelta(connectMessage: response.briarValue())
            if delta.reset {
                var replacementRequest = BriarAPI_GetDashboardRequest()
                replacementRequest.projectID = coreUUIDString(projectID)
                let replacement = await dashboard.getDashboard(
                    request: replacementRequest,
                    headers: [:]
                )
                return try DashboardSnapshot(connectMessage: replacement.briarValue())
            }
            merged = DashboardMerge.apply(delta, to: merged)
            cursor = delta.cursor
            if !delta.hasMore { return merged }
        }
        var request = BriarAPI_GetDashboardRequest()
        request.projectID = coreUUIDString(projectID)
        let response = await dashboard.getDashboard(request: request, headers: [:])
        return try DashboardSnapshot(connectMessage: response.briarValue())
    }
}

@MainActor
final class RunDetailStore: ObservableObject {
    struct AgentTypingStatus: Identifiable, Equatable, Sendable {
        let id: UUID
        let activity: ChannelAgentActivity?
    }

    struct ExecutionProposalContext: Equatable, Sendable {
        let lifecycleRevision: Int
        let proposalRevision: Int
        let proposalID: UUID
    }

    struct SkillExecutionProposalContext: Equatable, Sendable {
        let lifecycleRevision: Int
        let proposalRevision: Int
        let proposalID: UUID
    }

    @Published private(set) var events: [RunEvent] = []
    @Published private(set) var messages: [IssueMessage] = []
    @Published private(set) var optimisticMessageIDs: Set<UUID> = []
    @Published private(set) var agentReplies: [IssueAgentReplyJob] = []
    @Published private(set) var activityFrames: [UUID: IssueAgentActivityFrame] = [:]
    @Published private(set) var evidence: [RunEvidence] = []
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let dashboardService: (any BriarAPI_DashboardServiceClientInterface)?
    private let realtime: (any MobileRealtimeClientProtocol)?
    private let projectID: UUID
    private let runID: UUID
    private let token: String
    private var lifecycleRevision = 0
    private var executionProposalRevisions: [UUID: Int] = [:]
    private var executionProposalIDsByMessage: [UUID: UUID] = [:]
    private var skillExecutionProposalRevisions: [UUID: Int] = [:]
    private var skillExecutionProposalIDsByMessage: [UUID: UUID] = [:]
    private var authoritativeReloadPending = false
    private var conversationCursor: Int?
    private var conversationSyncInFlight = false
    private var conversationSyncPending = false
    private var activityTask: Task<Void, Never>?
    private var activityExpiryTask: Task<Void, Never>?
    private var activityGeneration = 0

    private static let maxConversationDeltaPagesPerSync = 20

    init(
        api: any MobileAPIClientProtocol,
        projectID: UUID,
        runID: UUID,
        token: String,
        dashboardService: (any BriarAPI_DashboardServiceClientInterface)? = nil
    ) {
        self.api = api
        self.dashboardService = dashboardService
        self.realtime = api as? any MobileRealtimeClientProtocol
        self.projectID = projectID
        self.runID = runID
        self.token = token
    }

    func load(queueIfLoading: Bool = false) async {
        if loading {
            if queueIfLoading { authoritativeReloadPending = true }
            return
        }
        let expectedLifecycleRevision = lifecycleRevision
        loading = true
        defer {
            if expectedLifecycleRevision == lifecycleRevision {
                loading = false
            }
        }
        repeat {
            authoritativeReloadPending = false
            do {
                let dashboard = try dashboardService ?? authenticatedMobileServices(
                    for: api,
                    token: token
                ).dashboard
                var eventRequest = BriarAPI_ListRunEventsRequest()
                eventRequest.projectID = coreUUIDString(projectID)
                eventRequest.runID = coreUUIDString(runID)
                async let eventResponse = dashboard.listRunEvents(
                    request: eventRequest,
                    headers: [:]
                )
                async let messageResponse = api.listIssueMessages(
                    projectID: projectID,
                    runID: runID,
                    token: token
                )
                async let evidenceResponse = api.listRunEvidence(
                    projectID: projectID,
                    runID: runID,
                    token: token
                )
                let loaded = try await (eventResponse, messageResponse, evidenceResponse)
                guard expectedLifecycleRevision == lifecycleRevision else { return }
                events = try loaded.0.briarValue().events.map(RunEvent.init(connectMessage:))
                let stabilizedMessages = preservingLocallyAcceptedSkillExecutionProposals(
                    in: loaded.1.messages
                )
                conversationCursor = loaded.1.cursor
                reconcileExecutionProposals(stabilizedMessages, authoritative: true)
                let incomingIDs = Set(stabilizedMessages.map(\.id))
                let pending = messages.filter {
                    optimisticMessageIDs.contains($0.id) &&
                        !incomingIDs.contains($0.id)
                }
                optimisticMessageIDs.subtract(incomingIDs)
                messages = (stabilizedMessages + pending).sorted {
                    if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
                    return $0.id.uuidString < $1.id.uuidString
                }
                agentReplies = loaded.1.agentReplies
                evidence = loaded.2.evidence
                errorMessage = nil
            } catch {
                guard expectedLifecycleRevision == lifecycleRevision else { return }
                errorMessage = CompanionStore.message(for: error)
            }
        } while authoritativeReloadPending &&
            expectedLifecycleRevision == lifecycleRevision
    }

    /// Applies issue conversation changes without replacing the whole detail
    /// screen. The organization socket only carries an invalidation, so the
    /// cursor-based endpoint remains the authoritative source for messages
    /// and Agent reply jobs.
    func syncConversationChanges() async {
        if loading {
            // The initial snapshot is already authoritative. Queue one more
            // snapshot behind it so a notification received during navigation
            // cannot be lost before the cursor is established.
            await load(queueIfLoading: true)
            return
        }
        guard conversationCursor != nil else {
            await load()
            return
        }
        if conversationSyncInFlight {
            conversationSyncPending = true
            return
        }

        conversationSyncInFlight = true
        let expectedLifecycleRevision = lifecycleRevision
        var needsContinuation = false
        defer {
            conversationSyncInFlight = false
            if expectedLifecycleRevision != lifecycleRevision {
                conversationSyncPending = false
            } else {
                let shouldContinue = needsContinuation || conversationSyncPending
                conversationSyncPending = false
                if shouldContinue {
                    Task { @MainActor [weak self] in
                        await Task.yield()
                        guard let self else { return }
                        await self.syncConversationChanges()
                    }
                }
            }
        }

        do {
            var hasMore = false
            for _ in 0..<Self.maxConversationDeltaPagesPerSync {
                guard expectedLifecycleRevision == lifecycleRevision,
                      let cursor = conversationCursor
                else { return }
                let delta = try await api.syncIssueMessages(
                    projectID: projectID,
                    runID: runID,
                    cursor: cursor,
                    token: token,
                )
                guard expectedLifecycleRevision == lifecycleRevision else { return }
                conversationCursor = delta.cursor
                if delta.reset {
                    let snapshot = delta.messages ?? []
                    reconcileExecutionProposals(snapshot, authoritative: true)
                    optimisticMessageIDs = []
                    messages = snapshot.sorted {
                        if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
                        return $0.id.uuidString < $1.id.uuidString
                    }
                    agentReplies = delta.agentReplies ?? []
                    activityExpiryTask?.cancel()
                    activityExpiryTask = nil
                    activityFrames = [:]
                } else if delta.changed {
                    if let deltaMessages = delta.messages {
                        appendMessages(deltaMessages)
                    }
                    if let deltaAgentReplies = delta.agentReplies {
                        agentReplies = deltaAgentReplies
                    }
                }
                hasMore = delta.hasMore
                if !hasMore { break }
            }
            needsContinuation = hasMore
        } catch let MobileAPIError.httpStatus(status, _) where status == 410 {
            guard expectedLifecycleRevision == lifecycleRevision else { return }
            // The retention window can expire while the app is backgrounded.
            // Only this recovery path intentionally performs a full load.
            await load()
        } catch {
            // Keep the current conversation visible on transient failures. A
            // later project notification or Inbox fallback will retry the
            // same cursor instead of replacing the screen with an error state.
        }
    }

    func appendMessages(_ newMessages: [IssueMessage]) {
        let stabilizedMessages = preservingLocallyAcceptedSkillExecutionProposals(
            in: newMessages
        )
        reconcileExecutionProposals(stabilizedMessages, authoritative: false)
        let replacements = Dictionary(
            uniqueKeysWithValues: stabilizedMessages.map { ($0.id, $0) }
        )
        optimisticMessageIDs.subtract(stabilizedMessages.map(\.id))
        let existing = Set(messages.map(\.id))
        messages = messages.map { replacements[$0.id] ?? $0 }
        messages.append(contentsOf: stabilizedMessages.filter { !existing.contains($0.id) })
        messages.sort { $0.createdAt < $1.createdAt }
    }

    func appendOptimisticMessage(_ message: IssueMessage) {
        optimisticMessageIDs.insert(message.id)
        messages = messages.map { current in
            guard current.id == message.parentMessageId else { return current }
            var updated = current
            updated.replyCount += 1
            return updated
        }
        messages.append(message)
        messages.sort { $0.createdAt < $1.createdAt }
    }

    func removeOptimisticMessage(_ messageID: UUID) {
        guard optimisticMessageIDs.remove(messageID) != nil,
              let pending = messages.first(where: { $0.id == messageID })
        else { return }
        messages.removeAll { $0.id == messageID }
        messages = messages.map { current in
            guard current.id == pending.parentMessageId else { return current }
            var updated = current
            updated.replyCount = max(0, updated.replyCount - 1)
            return updated
        }
    }

    func isMessageOptimistic(_ messageID: UUID) -> Bool {
        optimisticMessageIDs.contains(messageID)
    }

    func updateAgentReply(_ reply: IssueAgentReplyJob) {
        if let index = agentReplies.firstIndex(where: { $0.id == reply.id }) {
            agentReplies[index] = reply
        } else {
            agentReplies.append(reply)
        }
    }

    func typingStatuses(parentMessageID: UUID) -> [AgentTypingStatus] {
        let now = Date()
        return agentReplies.compactMap { reply in
            guard reply.parentMessageId == parentMessageID,
                  reply.status == .queued || reply.status == .running
            else { return nil }
            let frame = activityFrames[reply.id]
            let activity = frame?.attempt == reply.attempts &&
                    (frame?.expiresAt ?? .distantPast) > now
                ? frame?.activity
                : nil
            return AgentTypingStatus(id: reply.id, activity: activity)
        }
    }

    func startActivitySynchronization() {
        activityGeneration &+= 1
        activityTask?.cancel()
        activityTask = nil
        guard let realtime else { return }
        let expectedGeneration = activityGeneration
        activityTask = Task { [weak self] in
            var reconnectAttempt = 0
            while !Task.isCancelled {
                guard let self, expectedGeneration == self.activityGeneration else { return }
                do {
                    let events = realtime.issueActivityEvents(
                        MobileAPIContract.Endpoint.issueActivityEvents(
                            projectID: self.projectID,
                            runID: self.runID
                        ),
                        token: self.token
                    )
                    for try await frame in events {
                        guard !Task.isCancelled,
                              expectedGeneration == self.activityGeneration,
                              frame.projectId == self.projectID,
                              frame.runId == self.runID
                        else { return }
                        reconnectAttempt = 0
                        self.applyActivityFrame(frame)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    // The durable reply job keeps the generic fallback visible.
                }
                reconnectAttempt = min(reconnectAttempt + 1, 5)
                do {
                    try await Task.sleep(for: .seconds(1 << reconnectAttempt))
                } catch {
                    return
                }
            }
        }
    }

    func applyActivityFrame(_ frame: IssueAgentActivityFrame) {
        if let previous = activityFrames[frame.replyJobId],
           previous.attempt > frame.attempt ||
            (previous.attempt == frame.attempt && previous.sequence >= frame.sequence) {
            return
        }
        if frame.expiresAt > Date() {
            activityFrames[frame.replyJobId] = frame
        } else {
            activityFrames.removeValue(forKey: frame.replyJobId)
        }
        scheduleActivityExpiry()
    }

    private func scheduleActivityExpiry() {
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
        guard let expiresAt = activityFrames.values.map(\.expiresAt).min() else { return }
        let delay = max(0, expiresAt.timeIntervalSinceNow)
        activityExpiryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(Int64(delay * 1_000) + 1))
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            let now = Date()
            self.activityFrames = self.activityFrames.filter { $0.value.expiresAt > now }
            self.scheduleActivityExpiry()
        }
    }

    func updateIssueProposal(
        _ proposal: IssueProposedAction,
        executionProposal: IssueExecutionProposal? = nil
    ) {
        let updatedMessages = messages.map { message in
            var updated = message
            if message.proposedAction?.id == proposal.id {
                updated.proposedAction = proposal
                if let executionProposal {
                    updated.executionProposal = executionProposal
                }
            }
            return updated
        }
        if executionProposal != nil {
            reconcileExecutionProposals(updatedMessages, authoritative: false)
        }
        messages = updatedMessages
    }

    func updateExecutionProposal(_ proposal: IssueExecutionProposal) {
        messages = messages.map { message in
            guard message.executionProposal?.id == proposal.id else { return message }
            var updated = message
            updated.executionProposal = proposal
            return updated
        }
        executionProposalRevisions[proposal.id, default: 0] &+= 1
    }

    func updateSkillExecutionProposal(_ proposal: AgentSkillExecutionProposal) {
        messages = messages.map { message in
            guard message.skillExecutionProposal?.id == proposal.id else { return message }
            var updated = message
            updated.skillExecutionProposal = proposal
            return updated
        }
        skillExecutionProposalRevisions[proposal.id, default: 0] &+= 1
    }

    func captureExecutionProposal(
        proposalID: UUID
    ) -> ExecutionProposalContext? {
        guard messages.contains(where: {
            $0.executionProposal?.id == proposalID &&
                $0.executionProposal?.status == .pending
        }) else { return nil }
        return ExecutionProposalContext(
            lifecycleRevision: lifecycleRevision,
            proposalRevision: executionProposalRevisions[proposalID, default: 0],
            proposalID: proposalID
        )
    }

    func executionProposalIsCurrent(
        _ context: ExecutionProposalContext
    ) -> Bool {
        context.lifecycleRevision == lifecycleRevision &&
            context.proposalRevision == executionProposalRevisions[
                context.proposalID,
                default: 0
            ] &&
            messages.contains(where: {
                $0.executionProposal?.id == context.proposalID &&
                    $0.executionProposal?.status == .pending
            })
    }

    func captureSkillExecutionProposal(
        proposalID: UUID
    ) -> SkillExecutionProposalContext? {
        guard messages.contains(where: {
            $0.skillExecutionProposal?.id == proposalID &&
                $0.skillExecutionProposal?.status == .pending
        }) else { return nil }
        return SkillExecutionProposalContext(
            lifecycleRevision: lifecycleRevision,
            proposalRevision: skillExecutionProposalRevisions[proposalID, default: 0],
            proposalID: proposalID
        )
    }

    func skillExecutionProposalIsCurrent(
        _ context: SkillExecutionProposalContext
    ) -> Bool {
        context.lifecycleRevision == lifecycleRevision &&
            context.proposalRevision == skillExecutionProposalRevisions[
                context.proposalID,
                default: 0
            ] &&
            messages.contains(where: {
                $0.skillExecutionProposal?.id == context.proposalID &&
                    $0.skillExecutionProposal?.status == .pending
            })
    }

    /// Invalidates delayed loads and mutation presentation when navigation
    /// leaves this exact run detail.
    func close() {
        lifecycleRevision &+= 1
        activityGeneration &+= 1
        activityTask?.cancel()
        activityTask = nil
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
        activityFrames = [:]
        authoritativeReloadPending = false
        conversationCursor = nil
        conversationSyncInFlight = false
        conversationSyncPending = false
        loading = false
    }

    private func reconcileExecutionProposals(
        _ incoming: [IssueMessage],
        authoritative: Bool
    ) {
        let previousProposals = Dictionary(
            messages.compactMap { message in
                message.executionProposal.map { ($0.id, $0) }
            },
            uniquingKeysWith: { current, _ in current }
        )
        let previousSkillProposals = Dictionary(
            messages.compactMap { message in
                message.skillExecutionProposal.map { ($0.id, $0) }
            },
            uniquingKeysWith: { current, _ in current }
        )
        let incomingMessageIDs = Set(incoming.map(\.id))
        var invalidatedProposalIDs: Set<UUID> = []
        var invalidatedSkillProposalIDs: Set<UUID> = []

        for message in incoming {
            let previousID = executionProposalIDsByMessage[message.id]
            let incomingID = message.executionProposal?.id
            if previousID != incomingID {
                if let previousID { invalidatedProposalIDs.insert(previousID) }
                if let incomingID { invalidatedProposalIDs.insert(incomingID) }
            } else if let proposal = message.executionProposal,
                      previousProposals[proposal.id] != proposal {
                invalidatedProposalIDs.insert(proposal.id)
            }

            let previousSkillID = skillExecutionProposalIDsByMessage[message.id]
            let incomingSkillID = message.skillExecutionProposal?.id
            if previousSkillID != incomingSkillID {
                if let previousSkillID {
                    invalidatedSkillProposalIDs.insert(previousSkillID)
                }
                if let incomingSkillID {
                    invalidatedSkillProposalIDs.insert(incomingSkillID)
                }
            } else if let proposal = message.skillExecutionProposal,
                      previousSkillProposals[proposal.id] != proposal {
                invalidatedSkillProposalIDs.insert(proposal.id)
            }
        }

        if authoritative {
            for (messageID, proposalID) in executionProposalIDsByMessage
                where !incomingMessageIDs.contains(messageID) {
                invalidatedProposalIDs.insert(proposalID)
            }
            for (messageID, proposalID) in skillExecutionProposalIDsByMessage
                where !incomingMessageIDs.contains(messageID) {
                invalidatedSkillProposalIDs.insert(proposalID)
            }
        }

        for proposalID in invalidatedProposalIDs {
            executionProposalRevisions[proposalID, default: 0] &+= 1
        }
        for proposalID in invalidatedSkillProposalIDs {
            skillExecutionProposalRevisions[proposalID, default: 0] &+= 1
        }

        if authoritative {
            executionProposalIDsByMessage = Dictionary(
                uniqueKeysWithValues: incoming.compactMap { message in
                    message.executionProposal.map { (message.id, $0.id) }
                }
            )
            skillExecutionProposalIDsByMessage = Dictionary(
                uniqueKeysWithValues: incoming.compactMap { message in
                    message.skillExecutionProposal.map { (message.id, $0.id) }
                }
            )
        } else {
            for message in incoming {
                if let proposalID = message.executionProposal?.id {
                    executionProposalIDsByMessage[message.id] = proposalID
                } else {
                    executionProposalIDsByMessage.removeValue(forKey: message.id)
                }
                if let proposalID = message.skillExecutionProposal?.id {
                    skillExecutionProposalIDsByMessage[message.id] = proposalID
                } else {
                    skillExecutionProposalIDsByMessage.removeValue(forKey: message.id)
                }
            }
        }
    }

    /// A just-accepted response can beat a replicated pending message snapshot.
    /// Preserve only the same Skill proposal ID; nulls and replacements remain
    /// authoritative so source moves and tombstones still invalidate the sheet.
    private func preservingLocallyAcceptedSkillExecutionProposals(
        in incoming: [IssueMessage]
    ) -> [IssueMessage] {
        let acceptedByID: [UUID: AgentSkillExecutionProposal] = Dictionary(
            messages.compactMap { message in
                guard let proposal = message.skillExecutionProposal,
                      proposal.status == .accepted
                else { return nil }
                return (proposal.id, proposal)
            },
            uniquingKeysWith: { current, _ in current }
        )
        return incoming.map { message in
            guard let pending = message.skillExecutionProposal,
                  pending.status == .pending,
                  let accepted = acceptedByID[pending.id]
            else { return message }
            var stabilized = message
            stabilized.skillExecutionProposal = accepted
            return stabilized
        }
    }

    func download(path: String, filename: String) async throws -> URL {
        let safeName = filename.replacingOccurrences(of: "/", with: "-")
        let destination = FileManager.default.temporaryDirectory
            .appending(path: "briar-previews", directoryHint: .isDirectory)
            .appending(path: "\(runID.uuidString)-\(safeName)")
        return try await api.download(path, token: token, to: destination)
    }
}
