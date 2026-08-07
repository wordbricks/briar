import Foundation

@MainActor
final class AgentsStore: ObservableObject {
    @Published private(set) var agents: [ProjectAgent] = []
    @Published private(set) var sessions: [ProjectAgentSession] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?

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
        request: String,
        workerID: String
    ) async throws -> ProjectAgentSession {
        guard let projectID, let token else {
            throw MobileAPIError.invalidRequest
        }
        let response: ProjectAgentTaskResponse = try await api.send(
            MobileAPIContract.Endpoint.projectAgentTasks(projectID: projectID),
            method: "POST",
            token: token,
            body: ProjectAgentTaskRequest(
                agentId: agent.id,
                request: request,
                workerId: workerID,
                requestId: UUID()
            ),
            as: ProjectAgentTaskResponse.self
        )
        sessions = Self.collapseLinked(
            [response.session] + sessions.filter { $0.id != response.session.id }
        ).sorted { $0.displayTimestamp > $1.displayTimestamp }
        errorMessage = nil
        return response.session
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

    static func collapseLinked(_ sessions: [ProjectAgentSession]) -> [ProjectAgentSession] {
        let parentIDs = Set(sessions.compactMap(\.parentSessionId))
        return sessions.filter { !parentIDs.contains($0.id) }
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
