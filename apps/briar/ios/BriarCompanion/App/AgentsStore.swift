import BriarContracts
import Foundation

enum AgentsStoreError: LocalizedError, Equatable {
    case notConfigured
    case noQueuedIssues

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            L10n.text("프로젝트와 로그인 정보가 준비되지 않았습니다.")
        case .noQueuedIssues:
            L10n.text("실행할 준비가 된 queued 이슈가 없습니다.")
        }
    }
}

@MainActor
final class AgentsStore: ObservableObject {
    private struct Services: Sendable {
        let agent: any BriarAPI_AgentServiceClientInterface
        let issue: any BriarAPI_IssueServiceClientInterface
    }

    @Published private(set) var agents: [ProjectAgent] = []
    @Published private(set) var sessions: [ProjectAgentSession] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var executionError: String?
    @Published private var executingAgentCounts: [UUID: Int] = [:]

    var executingAgentIDs: Set<UUID> {
        Set(executingAgentCounts.keys)
    }

    private let servicesForToken: @Sendable (String) -> Services
    private var agentService: (any BriarAPI_AgentServiceClientInterface)?
    private var issueService: (any BriarAPI_IssueServiceClientInterface)?
    private let pollInterval: Duration
    private var projectID: UUID?
    private var token: String?
    private var locale: String = CompanionLocale.ko.rawValue
    private var generation = 0
    /// Local session writes can race a list request that started before the
    /// write. A matching revision may replace authoritatively; otherwise the
    /// delayed response is merged monotonically with the newer local state.
    private var sessionMutationRevision = 0
    private var pollingTask: Task<Void, Never>?

    init(
        servicesFactory: any AuthenticatedMobileServicesFactory,
        pollInterval: Duration = .seconds(15)
    ) {
        servicesForToken = { token in
            let services = servicesFactory.authenticatedServices(token: token)
            return Services(agent: services.agent, issue: services.issue)
        }
        self.pollInterval = pollInterval
    }

    init(
        agentService: any BriarAPI_AgentServiceClientInterface,
        issueService: any BriarAPI_IssueServiceClientInterface,
        pollInterval: Duration = .seconds(15)
    ) {
        servicesForToken = { _ in Services(agent: agentService, issue: issueService) }
        self.pollInterval = pollInterval
    }

    func select(projectID: UUID?, token: String?, locale: String) {
        let localeChanged = self.locale != locale
        guard self.projectID != projectID || self.token != token || localeChanged else { return }
        self.projectID = projectID
        self.token = token
        self.locale = locale
        let services = token.map(servicesForToken)
        agentService = services?.agent
        issueService = services?.issue
        generation += 1
        sessionMutationRevision &+= 1
        pollingTask?.cancel()
        agents = []
        sessions = []
        errorMessage = nil
        executionError = nil
        executingAgentCounts = [:]
        guard projectID != nil, token != nil else { return }
        Task { await refresh() }
        startPolling()
    }

    func refresh() async {
        guard let projectID, token != nil else { return }
        let generation = self.generation
        let expectedSessionMutationRevision = sessionMutationRevision
        isRefreshing = true
        defer {
            if generation == self.generation {
                isRefreshing = false
            }
        }
        do {
            let agent = try agentClient()
            var agentsRequest = BriarAPI_ListProjectAgentsRequest()
            agentsRequest.projectID = projectID.uuidString.lowercased()
            async let agentsResponse = agent.listProjectAgents(
                request: agentsRequest,
                headers: [:]
            )
            var sessionsRequest = BriarAPI_ListProjectAgentSessionsRequest()
            sessionsRequest.projectID = projectID.uuidString.lowercased()
            async let sessionsResponse = agent.listProjectAgentSessions(
                request: sessionsRequest,
                headers: [:]
            )
            let responses = await (agentsResponse, sessionsResponse)
            let loadedAgents = try responses.0.briarValue().agents.map(ProjectAgent.init(connectMessage:))
            let loadedSessions = try responses.1.briarValue().sessions.map(
                ProjectAgentSession.init(connectMessage:)
            )
            guard generation == self.generation else { return }
            agents = loadedAgents.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            let authoritativeSessions = Self.collapseLinked(loadedSessions).map { incoming in
                guard let local = sessions.first(where: { $0.id == incoming.id }) else {
                    return incoming
                }
                return incoming.preservingLocalFields(from: local)
            }
            sessions = if expectedSessionMutationRevision == sessionMutationRevision {
                Self.sortedSessions(authoritativeSessions)
            } else {
                Self.mergeSessions(
                    current: sessions,
                    incoming: authoritativeSessions
                )
            }
            errorMessage = nil
        } catch {
            guard generation == self.generation else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func run(
        agent: ProjectAgent,
        skill: ProjectAgent.Skill,
        request: String,
        workerID: String
    ) async throws -> ProjectAgentSession {
        guard let projectID, token != nil else {
            throw MobileAPIError.invalidRequest
        }
        guard
            agent.projectId == projectID,
            skill.agentId == agent.id,
            agent.skills.contains(where: { $0.id == skill.id })
        else {
            throw MobileAPIError.invalidRequest
        }
        beginExecution(agent.id)
        defer { endExecution(agent.id) }

        executionError = nil
        do {
            var rpcRequest = BriarAPI_RunProjectAgentTaskRequest()
            rpcRequest.projectID = projectID.uuidString.lowercased()
            rpcRequest.agentID = agent.id.uuidString.lowercased()
            rpcRequest.skillID = skill.id.uuidString.lowercased()
            rpcRequest.request = request
            rpcRequest.workerID = workerID
            rpcRequest.requestID = UUID().uuidString.lowercased()
            let response = try await agentClient().runProjectAgentTask(
                request: rpcRequest,
                headers: [:]
            )
            let message = try response.briarValue()
            guard message.hasSession else { throw MobileAPIError.invalidResponse }
            let session = try ProjectAgentSession(connectMessage: message.session)
            insertOrReplace(session)
            errorMessage = nil
            return session
        } catch {
            executionError = CompanionStore.message(for: error)
            throw error
        }
    }

    /// Issue-dispatch entry point. Direct saved-Agent runs use the overload
    /// above and do not require a queued issue.
    func run(
        agent: ProjectAgent,
        runs: [DashboardRun],
        maxIssues: Int = 3
    ) async throws -> String {
        guard let projectID, token != nil else {
            executionError = AgentsStoreError.notConfigured.localizedDescription
            throw AgentsStoreError.notConfigured
        }
        guard agent.projectId == projectID else {
            executionError = AgentsStoreError.notConfigured.localizedDescription
            throw AgentsStoreError.notConfigured
        }
        beginExecution(agent.id)
        defer { endExecution(agent.id) }

        executionError = nil
        let candidates = Self.selectQueuedRuns(runs, maxIssues: maxIssues)
        guard !candidates.isEmpty else {
            executionError = AgentsStoreError.noQueuedIssues.localizedDescription
            throw AgentsStoreError.noQueuedIssues
        }

        let dispatchID = UUID().uuidString.lowercased()
        let startedAt = Date()
        let pendingSession = ProjectAgentSession(
            id: dispatchID,
            projectId: projectID,
            dispatchGroupId: dispatchID,
            agentId: agent.id,
            agentName: agent.name,
            sessionType: .dispatch,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: agent.responsibility,
            status: .running,
            issues: candidates.map(Self.sessionIssue),
            startedAt: startedAt,
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: nil,
            events: [
                .init(
                    id: UUID().uuidString.lowercased(),
                    type: .started,
                    occurredAt: startedAt
                ),
            ],
            updatedAt: startedAt
        )
        insertOrReplace(pendingSession)

        do {
            // Persist the running aggregate before dispatching so the session is
            // still visible if the app is backgrounded during a network request.
            _ = try await syncSession(pendingSession, projectID: projectID)
            for run in candidates {
                let provider = run.preferredProvider ?? agent.provider
                let model = run.preferredModel ?? (run.preferredProvider == nil ? agent.model : nil)
                let effort = run.preferredModel != nil
                    ? run.preferredEffort
                    : (run.preferredProvider == nil ? agent.effort : nil)
                var dispatch = BriarAPI_DispatchRunInput()
                dispatch.requestID = UUID().uuidString.lowercased()
                dispatch.agentID = agent.id.uuidString.lowercased()
                dispatch.provider = issueProviderMessage(provider)
                if let model { dispatch.model = model }
                if let effort { dispatch.effort = effort.rawValue }
                dispatch.persistPreferences = true
                let response: BriarAPI_IssueExecutionDispatch
                if run.dispatchedAt != nil || run.workerId != nil {
                    var request = BriarAPI_ReassignRunRequest()
                    request.projectID = projectID.uuidString.lowercased()
                    request.runID = run.id.uuidString.lowercased()
                    request.dispatch = dispatch
                    let message = try await issueClient().reassignRun(
                        request: request,
                        headers: [:]
                    ).briarValue()
                    guard message.hasDispatch else { throw MobileAPIError.invalidResponse }
                    response = message.dispatch
                } else {
                    var request = BriarAPI_DispatchRunRequest()
                    request.projectID = projectID.uuidString.lowercased()
                    request.runID = run.id.uuidString.lowercased()
                    request.dispatch = dispatch
                    let message = try await issueClient().dispatchRun(
                        request: request,
                        headers: [:]
                    ).briarValue()
                    guard message.hasDispatch else { throw MobileAPIError.invalidResponse }
                    response = message.dispatch
                }
                _ = try DispatchRunResponse(connectMessage: response)
            }
            await refresh()
            return dispatchID
        } catch {
            let failedAt = Date()
            let failedSession = Self.replacing(
                pendingSession,
                status: .failed,
                completedAt: failedAt,
                summary: nil,
                error: CompanionStore.message(for: error),
                events: (pendingSession.events ?? []) + [
                    .init(
                        id: UUID().uuidString.lowercased(),
                        type: .failed,
                        occurredAt: failedAt
                    ),
                ],
                updatedAt: failedAt
            )
            insertOrReplace(failedSession)
            _ = try? await syncSession(failedSession, projectID: projectID)
            executionError = CompanionStore.message(for: error)
            throw error
        }
    }

    func reconcile(runs: [DashboardRun]) async {
        guard let projectID, token != nil else { return }
        let runsByID = Dictionary(uniqueKeysWithValues: runs.map { ($0.id, $0) })
        let now = Date()
        let runningSessions = sessions.filter {
            $0.sessionType == .dispatch && $0.status == .running
        }

        for session in runningSessions {
            guard session.issues.allSatisfy({
                guard let runID = UUID(uuidString: $0.runId) else { return false }
                return runsByID[runID] != nil
            }) else { continue }
            let nextIssues = session.issues.map { issue -> ProjectAgentSession.Issue in
                guard let runID = UUID(uuidString: issue.runId),
                      let run = runsByID[runID]
                else { return issue }
                return .init(
                    runId: issue.runId,
                    runNumber: issue.runNumber,
                    sourceKey: issue.sourceKey,
                    title: issue.title,
                    outcome: Self.outcome(for: run.status),
                    summary: Self.summary(for: run)
                )
            }
            let changed = nextIssues != session.issues
            let isTerminal = nextIssues.allSatisfy { $0.outcome != .pending }
            guard changed || isTerminal else { continue }

            let nextStatus: ProjectAgentSession.Status = isTerminal ? .completed : .running
            let completedAt = isTerminal ? now : nil
            let summary = isTerminal
                ? nextIssues.compactMap { issue in
                    issue.summary.map { "\(issue.sourceKey): \($0)" }
                }.joined(separator: "\n\n")
                : nil
            let next = Self.replacing(
                session,
                status: nextStatus,
                issues: nextIssues,
                completedAt: completedAt,
                summary: summary?.isEmpty == true ? nil : summary,
                error: nil,
                events: isTerminal
                    ? (session.events ?? []) + [
                        .init(
                            id: UUID().uuidString.lowercased(),
                            type: .completed,
                            occurredAt: now
                        ),
                    ]
                    : session.events,
                updatedAt: now
            )
            insertOrReplace(next)
            _ = try? await syncSession(next, projectID: projectID)
        }
    }

    func applicationDidBecomeActive() {
        guard projectID != nil, token != nil else { return }
        Task { await refresh() }
        startPolling()
    }

    func applicationDidEnterBackground() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    func sessions(for agentID: UUID) -> [ProjectAgentSession] {
        sessions.filter { $0.agentId == agentID }
    }

    func session(id: String) -> ProjectAgentSession? {
        sessions.first { $0.id == id }
    }

    /// Approval responses already contain the canonical persisted session.
    /// Insert it immediately when this store owns the same project so Agent
    /// history does not wait for the next polling interval.
    func materialize(_ session: ProjectAgentSession) {
        guard session.projectId == projectID else { return }
        insertOrReplace(session)
    }

    func agent(id: UUID) -> ProjectAgent? {
        agents.first { $0.id == id }
    }

    func isExecuting(_ agentID: UUID) -> Bool {
        executingAgentCounts[agentID, default: 0] > 0
    }

    private func beginExecution(_ agentID: UUID) {
        executingAgentCounts[agentID, default: 0] += 1
    }

    private func endExecution(_ agentID: UUID) {
        let remaining = executingAgentCounts[agentID, default: 0] - 1
        if remaining > 0 {
            executingAgentCounts[agentID] = remaining
        } else {
            executingAgentCounts.removeValue(forKey: agentID)
        }
    }

    func clearExecutionError() {
        executionError = nil
    }

    static func selectQueuedRuns(_ runs: [DashboardRun], maxIssues: Int = 3) -> [DashboardRun] {
        let limit = min(max(maxIssues, 1), 10)
        return runs
            .filter { $0.status == .queued && isExecutionReady($0) }
            .sorted { left, right in
                let leftPriority = left.priority ?? Int.max
                let rightPriority = right.priority ?? Int.max
                if leftPriority != rightPriority { return leftPriority < rightPriority }
                let leftCreatedAt = left.sourceCreatedAt ?? left.startedAt
                let rightCreatedAt = right.sourceCreatedAt ?? right.startedAt
                if let leftCreatedAt, let rightCreatedAt, leftCreatedAt != rightCreatedAt {
                    return leftCreatedAt < rightCreatedAt
                }
                if leftCreatedAt != nil || rightCreatedAt != nil {
                    return leftCreatedAt != nil
                }
                return (left.runNumber ?? Int.max) < (right.runNumber ?? Int.max)
            }
            .prefix(limit)
            .map { $0 }
    }

    static func collapseLinked(_ sessions: [ProjectAgentSession]) -> [ProjectAgentSession] {
        let parentIDs = Set(sessions.compactMap(\.parentSessionId))
        return sessions.filter { !parentIDs.contains($0.id) }
    }

    /// Keeps the newest observation for each session while preserving a local
    /// materialization that an older in-flight list response has not seen yet.
    /// Terminal state wins a timestamp tie so a completed/failed session never
    /// regresses to running merely because two writes share one clock value.
    static func mergeSessions(
        current: [ProjectAgentSession],
        incoming: [ProjectAgentSession]
    ) -> [ProjectAgentSession] {
        var byID: [String: ProjectAgentSession] = [:]
        for candidate in current + incoming {
            if let existing = byID[candidate.id] {
                byID[candidate.id] = newerSession(existing, candidate)
            } else {
                byID[candidate.id] = candidate
            }
        }
        return sortedSessions(collapseLinked(Array(byID.values)))
    }

    private static func newerSession(
        _ current: ProjectAgentSession,
        _ candidate: ProjectAgentSession
    ) -> ProjectAgentSession {
        let currentTimestamp = current.displayTimestamp
        let candidateTimestamp = candidate.displayTimestamp
        let preferred: ProjectAgentSession
        if candidateTimestamp != currentTimestamp {
            preferred = candidateTimestamp > currentTimestamp ? candidate : current
        } else {
            let currentIsTerminal = current.status != .running
            let candidateIsTerminal = candidate.status != .running
            if currentIsTerminal != candidateIsTerminal {
                preferred = candidateIsTerminal ? candidate : current
            } else {
                let currentEvidenceCount = current.events?.count ?? 0
                let candidateEvidenceCount = candidate.events?.count ?? 0
                preferred = if candidateEvidenceCount != currentEvidenceCount {
                    candidateEvidenceCount > currentEvidenceCount ? candidate : current
                } else {
                    candidate
                }
            }
        }
        let local = current.workspaceRoot != nil ? current : candidate
        return preferred.preservingLocalFields(from: local)
    }

    private static func sortedSessions(
        _ sessions: [ProjectAgentSession]
    ) -> [ProjectAgentSession] {
        sessions.sorted {
            if $0.displayTimestamp != $1.displayTimestamp {
                return $0.displayTimestamp > $1.displayTimestamp
            }
            return $0.id < $1.id
        }
    }

    private static func isExecutionReady(_ run: DashboardRun) -> Bool {
        if let executionReadiness = run.executionReadiness {
            return executionReadiness == "ready"
        }
        if run.waitingOnPrerequisiteCount ?? 0 > 0 { return false }
        return (run.prerequisites ?? []).allSatisfy { $0.status == .completed }
    }

    private static func sessionIssue(_ run: DashboardRun) -> ProjectAgentSession.Issue {
        .init(
            runId: run.id.uuidString.lowercased(),
            runNumber: run.runNumber ?? 0,
            sourceKey: run.sourceKey ?? "briar-run:\(run.id.uuidString.lowercased())",
            title: run.title,
            outcome: .pending,
            summary: nil
        )
    }

    private static func outcome(for status: DashboardRun.Status) -> ProjectAgentSession.Issue.Outcome {
        switch status {
        case .completed: .completed
        case .blocked: .blocked
        case .failed: .failed
        case .cancelled: .skipped
        default: .pending
        }
    }

    private static func summary(for run: DashboardRun) -> String? {
        switch run.status {
        case .completed, .blocked, .failed:
            return run.resultSummary ?? run.detail
        default:
            return nil
        }
    }

    private static func replacing(
        _ session: ProjectAgentSession,
        status: ProjectAgentSession.Status? = nil,
        issues: [ProjectAgentSession.Issue]? = nil,
        completedAt: Date? = nil,
        requestedWorkerId: String? = nil,
        workerId: String? = nil,
        summary: String? = nil,
        error: String? = nil,
        events: [ProjectAgentSession.Event]? = nil,
        updatedAt: Date? = nil
    ) -> ProjectAgentSession {
        let replacementStatus: ProjectAgentSession.Status = status ?? session.status
        let replacementIssues: [ProjectAgentSession.Issue] = issues ?? session.issues
        let replacementRequestedWorkerID: String? = requestedWorkerId ?? session.requestedWorkerId
        let replacementWorkerID: String? = workerId ?? session.workerId
        let replacementEvents: [ProjectAgentSession.Event]? = events ?? session.events
        let replacementUpdatedAt = updatedAt ?? session.updatedAt

        return ProjectAgentSession(
            id: session.id,
            projectId: session.projectId,
            dispatchGroupId: session.dispatchGroupId,
            agentId: session.agentId,
            agentName: session.agentName,
            skillId: session.skillId,
            sessionType: session.sessionType,
            trigger: session.trigger,
            scheduleId: session.scheduleId,
            scheduleRunId: session.scheduleRunId,
            parentSessionId: session.parentSessionId,
            request: session.request,
            followUps: session.followUps,
            status: replacementStatus,
            issues: replacementIssues,
            startedAt: session.startedAt,
            completedAt: completedAt,
            conversationId: session.conversationId,
            workspaceRoot: session.workspaceRoot,
            requestedWorkerId: replacementRequestedWorkerID,
            workerId: replacementWorkerID,
            summary: summary,
            error: error,
            events: replacementEvents,
            updatedAt: replacementUpdatedAt,
            requestedByUserId: session.requestedByUserId,
            archived: session.archived
        )
    }

    private func insertOrReplace(_ session: ProjectAgentSession) {
        sessionMutationRevision &+= 1
        sessions = Self.mergeSessions(current: sessions, incoming: [session])
    }

    private func syncSession(
        _ session: ProjectAgentSession,
        projectID: UUID
    ) async throws -> ProjectAgentSession {
        let response = try await agentClient().putProjectAgentSession(
            request: try session.putConnectRequest(projectID: projectID),
            headers: [:]
        )
        let message = try response.briarValue()
        guard message.hasSession else { throw MobileAPIError.invalidResponse }
        return try ProjectAgentSession(connectMessage: message.session)
            .preservingLocalFields(from: session)
    }

    private func agentClient() throws -> any BriarAPI_AgentServiceClientInterface {
        guard let agentService else { throw MobileAPIError.invalidRequest }
        return agentService
    }

    private func issueClient() throws -> any BriarAPI_IssueServiceClientInterface {
        guard let issueService else { throw MobileAPIError.invalidRequest }
        return issueService
    }

    private func startPolling() {
        pollingTask?.cancel()
        let generation = self.generation
        let interval = pollInterval
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self else { return }
                guard generation == self.generation else { return }
                await self.refresh()
            }
        }
    }
}
