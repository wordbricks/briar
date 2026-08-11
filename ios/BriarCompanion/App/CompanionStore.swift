import Foundation
import SwiftUI

struct OrganizationSummary: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
}

@MainActor
final class CompanionStore: ObservableObject {
    @Published private(set) var user: CurrentUserResponse.User?
    @Published private(set) var organizations: [OrganizationSummary] = []
    @Published private(set) var projects: [ProjectsResponse.Project] = []
    @Published var selectedProjectID: UUID? {
        didSet {
            persistSelectedProjectID()
        }
    }
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let defaults: UserDefaults
    private var activeToken: String?
    private var sessionGeneration = 0
    private var loadRevision = 0
    private var projectCatalogRevision = 0

    private static func selectedProjectKey(for userID: String) -> String {
        "companion.selectedProjectID.\(userID)"
    }

    init(api: any MobileAPIClientProtocol, defaults: UserDefaults = .standard) {
        self.api = api
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
            async let userResponse: CurrentUserResponse = api.send(
                MobileAPIContract.Endpoint.currentUser,
                method: "GET",
                token: token,
                body: nil,
                as: CurrentUserResponse.self
            )
            async let projectResponse: ProjectsResponse = api.send(
                MobileAPIContract.Endpoint.projects,
                method: "GET",
                token: token,
                body: nil,
                as: ProjectsResponse.self
            )
            let (loadedUser, loadedProjects) = try await (userResponse, projectResponse)
            guard
                activeToken == token,
                expectedGeneration == sessionGeneration,
                expectedLoadRevision == loadRevision
            else { throw CancellationError() }
            user = loadedUser.user
            if expectedCatalogRevision == projectCatalogRevision {
                applyProjectCatalog(loadedProjects.projects)
            }
            let currentProjects = expectedCatalogRevision == projectCatalogRevision
                ? loadedProjects.projects
                : projects
            let storedProjectID = Self.storedProjectID(
                for: loadedUser.user.id,
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
            let response: ProjectsResponse = try await api.send(
                MobileAPIContract.Endpoint.projects,
                method: "GET",
                token: token,
                body: nil,
                as: ProjectsResponse.self
            )
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

    private func applyProjectCatalog(_ nextProjects: [ProjectsResponse.Project]) {
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
        in projects: [ProjectsResponse.Project],
        defaults: UserDefaults
    ) -> UUID? {
        guard let raw = defaults.string(forKey: selectedProjectKey(for: userID)),
              let stored = UUID(uuidString: raw),
              projects.contains(where: { $0.id == stored }) else {
            return nil
        }
        return stored
    }

    static func defaultProjectID(for projects: [ProjectsResponse.Project]) -> UUID? {
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
    private let pollInterval: Duration
    private var projectID: UUID?
    private var token: String?
    private var generation = 0
    private var refreshRevision = 0
    private var refreshTask: Task<Void, Never>?
    private var refreshTaskForcesSnapshot = false
    private var pollingTask: Task<Void, Never>?

    init(api: any MobileAPIClientProtocol, pollInterval: Duration = .seconds(15)) {
        self.api = api
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
                let loaded = try await Self.load(
                    api: api,
                    projectID: projectID,
                    token: token,
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
        api: any MobileAPIClientProtocol,
        projectID: UUID,
        token: String,
        current: DashboardSnapshot?,
        forceSnapshot: Bool
    ) async throws -> DashboardSnapshot {
        guard !forceSnapshot, var merged = current, var cursor = current?.cursor else {
            return try await api.send(
                MobileAPIContract.Endpoint.dashboard(projectID: projectID),
                method: "GET",
                token: token,
                body: nil,
                as: DashboardSnapshot.self
            )
        }
        for _ in 0..<20 {
            do {
                let delta: DashboardDelta = try await api.send(
                    MobileAPIContract.Endpoint.dashboardDelta(projectID: projectID, cursor: cursor),
                    method: "GET",
                    token: token,
                    body: nil,
                    as: DashboardDelta.self
                )
                merged = DashboardMerge.apply(delta, to: merged)
                cursor = delta.cursor
                if !delta.hasMore { return merged }
            } catch let MobileAPIError.httpStatus(status, _) where status == 410 {
                return try await api.send(
                    MobileAPIContract.Endpoint.dashboard(projectID: projectID),
                    method: "GET",
                    token: token,
                    body: nil,
                    as: DashboardSnapshot.self
                )
            }
        }
        return try await api.send(
            MobileAPIContract.Endpoint.dashboard(projectID: projectID),
            method: "GET",
            token: token,
            body: nil,
            as: DashboardSnapshot.self
        )
    }
}

@MainActor
final class RunDetailStore: ObservableObject {
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
    @Published private(set) var evidence: [RunEvidence] = []
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let projectID: UUID
    private let runID: UUID
    private let token: String
    private var lifecycleRevision = 0
    private var executionProposalRevisions: [UUID: Int] = [:]
    private var executionProposalIDsByMessage: [UUID: UUID] = [:]
    private var skillExecutionProposalRevisions: [UUID: Int] = [:]
    private var skillExecutionProposalIDsByMessage: [UUID: UUID] = [:]
    private var authoritativeReloadPending = false

    init(
        api: any MobileAPIClientProtocol,
        projectID: UUID,
        runID: UUID,
        token: String
    ) {
        self.api = api
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
                async let eventResponse: RunEventsResponse = api.send(
                    MobileAPIContract.Endpoint.runEvents(projectID: projectID, runID: runID),
                    method: "GET",
                    token: token,
                    body: nil,
                    as: RunEventsResponse.self
                )
                async let messageResponse: IssueMessagesResponse = api.send(
                    MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID),
                    method: "GET",
                    token: token,
                    body: nil,
                    as: IssueMessagesResponse.self
                )
                async let evidenceResponse: RunEvidenceResponse = api.send(
                    MobileAPIContract.Endpoint.runEvidence(projectID: projectID, runID: runID),
                    method: "GET",
                    token: token,
                    body: nil,
                    as: RunEvidenceResponse.self
                )
                let loaded = try await (eventResponse, messageResponse, evidenceResponse)
                guard expectedLifecycleRevision == lifecycleRevision else { return }
                events = loaded.0.events
                let stabilizedMessages = preservingLocallyAcceptedSkillExecutionProposals(
                    in: loaded.1.messages
                )
                reconcileExecutionProposals(stabilizedMessages, authoritative: true)
                messages = stabilizedMessages
                evidence = loaded.2.evidence
                errorMessage = nil
            } catch {
                guard expectedLifecycleRevision == lifecycleRevision else { return }
                errorMessage = CompanionStore.message(for: error)
            }
        } while authoritativeReloadPending &&
            expectedLifecycleRevision == lifecycleRevision
    }

    func appendMessages(_ newMessages: [IssueMessage]) {
        let stabilizedMessages = preservingLocallyAcceptedSkillExecutionProposals(
            in: newMessages
        )
        reconcileExecutionProposals(stabilizedMessages, authoritative: false)
        let replacements = Dictionary(
            uniqueKeysWithValues: stabilizedMessages.map { ($0.id, $0) }
        )
        let existing = Set(messages.map(\.id))
        messages = messages.map { replacements[$0.id] ?? $0 }
        messages.append(contentsOf: stabilizedMessages.filter { !existing.contains($0.id) })
        messages.sort { $0.createdAt < $1.createdAt }
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
        authoritativeReloadPending = false
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
        let acceptedByID = Dictionary(
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
