import Foundation

enum AgentsStoreError: LocalizedError, Equatable {
    case notConfigured
    case noQueuedIssues
    case duplicateExecution

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "프로젝트와 로그인 정보가 준비되지 않았습니다."
        case .noQueuedIssues:
            "실행할 준비가 된 queued 이슈가 없습니다."
        case .duplicateExecution:
            "이 Agent는 이미 실행 중입니다."
        }
    }
}

@MainActor
final class AgentsStore: ObservableObject {
    @Published private(set) var agents: [ProjectAgent] = []
    @Published private(set) var sessions: [ProjectAgentSession] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var executionError: String?
    @Published private(set) var executingAgentIDs: Set<UUID> = []

    private let api: any MobileAPIClientProtocol
    private let pollInterval: Duration
    private var projectID: UUID?
    private var token: String?
    private var locale: String = ProjectAgentLocale.ko.rawValue
    private var generation = 0
    private var pollingTask: Task<Void, Never>?

    init(api: any MobileAPIClientProtocol, pollInterval: Duration = .seconds(15)) {
        self.api = api
        self.pollInterval = pollInterval
    }

    func select(projectID: UUID?, token: String?, locale: String) {
        let localeChanged = self.locale != locale
        guard self.projectID != projectID || self.token != token || localeChanged else { return }
        self.projectID = projectID
        self.token = token
        self.locale = locale
        generation += 1
        pollingTask?.cancel()
        agents = []
        sessions = []
        errorMessage = nil
        executionError = nil
        executingAgentIDs = []
        guard projectID != nil, token != nil else { return }
        Task { await refresh() }
        startPolling()
    }

    func refresh() async {
        guard let projectID, let token else { return }
        let generation = self.generation
        isRefreshing = true
        defer {
            if generation == self.generation {
                isRefreshing = false
            }
        }
        do {
            async let agentsResponse: ProjectAgentsResponse = api.send(
                MobileAPIContract.Endpoint.projectAgents(projectID: projectID, locale: locale),
                method: "GET",
                token: token,
                body: nil,
                as: ProjectAgentsResponse.self
            )
            async let sessionsResponse: ProjectAgentSessionsResponse = api.send(
                MobileAPIContract.Endpoint.projectAgentSessions(projectID: projectID),
                method: "GET",
                token: token,
                body: nil,
                as: ProjectAgentSessionsResponse.self
            )
            let (loadedAgents, loadedSessions) = try await (agentsResponse, sessionsResponse)
            guard generation == self.generation else { return }
            agents = loadedAgents.agents.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            sessions = Self.collapseLinked(loadedSessions.sessions).sorted {
                $0.displayTimestamp > $1.displayTimestamp
            }
            errorMessage = nil
        } catch {
            guard generation == self.generation else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func run(
        agent: ProjectAgent,
        runs: [DashboardRun],
        maxIssues: Int = 3
    ) async throws -> String {
        guard let projectID, let token else {
            executionError = AgentsStoreError.notConfigured.localizedDescription
            throw AgentsStoreError.notConfigured
        }
        guard agent.projectId == projectID else {
            executionError = AgentsStoreError.notConfigured.localizedDescription
            throw AgentsStoreError.notConfigured
        }
        guard executingAgentIDs.insert(agent.id).inserted else {
            executionError = AgentsStoreError.duplicateExecution.localizedDescription
            throw AgentsStoreError.duplicateExecution
        }
        defer { executingAgentIDs.remove(agent.id) }

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
            _ = try await syncSession(pendingSession, projectID: projectID, token: token)
            for run in candidates {
                let provider = run.preferredProvider ?? agent.provider
                let model = run.preferredModel ?? (run.preferredProvider == nil ? agent.model : nil)
                let effort = run.preferredModel != nil
                    ? run.preferredEffort
                    : (run.preferredProvider == nil ? agent.effort : nil)
                _ = try await api.send(
                    MobileAPIContract.Endpoint.runDispatch(
                        projectID: projectID,
                        runID: run.id,
                        reassign: run.dispatchedAt != nil || run.workerId != nil
                    ),
                    method: "POST",
                    token: token,
                    body: DispatchRunRequest(
                        agentId: agent.id,
                        provider: provider,
                        model: model,
                        effort: effort,
                        persistPreferences: true,
                        workerId: nil,
                        requestId: UUID()
                    ),
                    as: DispatchRunResponse.self
                )
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
            _ = try? await syncSession(failedSession, projectID: projectID, token: token)
            executionError = CompanionStore.message(for: error)
            throw error
        }
    }

    func reconcile(runs: [DashboardRun]) async {
        guard let projectID, let token else { return }
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
            _ = try? await syncSession(next, projectID: projectID, token: token)
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

    func agent(id: UUID) -> ProjectAgent? {
        agents.first { $0.id == id }
    }

    func isExecuting(_ agentID: UUID) -> Bool {
        executingAgentIDs.contains(agentID)
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
        summary: String? = nil,
        error: String? = nil,
        events: [ProjectAgentSession.Event]? = nil,
        updatedAt: Date? = nil
    ) -> ProjectAgentSession {
        ProjectAgentSession(
            id: session.id,
            projectId: session.projectId,
            dispatchGroupId: session.dispatchGroupId,
            agentId: session.agentId,
            sessionType: session.sessionType,
            trigger: session.trigger,
            scheduleId: session.scheduleId,
            scheduleRunId: session.scheduleRunId,
            parentSessionId: session.parentSessionId,
            request: session.request,
            status: status ?? session.status,
            issues: issues ?? session.issues,
            startedAt: session.startedAt,
            completedAt: completedAt,
            conversationId: session.conversationId,
            workspaceRoot: session.workspaceRoot,
            summary: summary,
            error: error,
            events: events ?? session.events,
            updatedAt: updatedAt ?? session.updatedAt
        )
    }

    private func insertOrReplace(_ session: ProjectAgentSession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
        sessions.sort { $0.displayTimestamp > $1.displayTimestamp }
    }

    private func syncSession(
        _ session: ProjectAgentSession,
        projectID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        let response: ProjectAgentSessionResponse = try await api.send(
            MobileAPIContract.Endpoint.projectAgentSession(
                projectID: projectID,
                sessionID: session.id
            ),
            method: "PUT",
            token: token,
            body: ProjectAgentSessionSyncRequest(session: session),
            as: ProjectAgentSessionResponse.self
        )
        return response.session
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
