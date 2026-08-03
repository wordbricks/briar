import Foundation

@MainActor
final class IdeasStore: ObservableObject {
    @Published private(set) var ideas: [IdeaSummary] = []
    @Published private(set) var selected: IdeaDetail?
    @Published private(set) var loading = false
    @Published private(set) var working = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private var projectID: UUID?
    private var token: String?
    private var pollingTask: Task<Void, Never>?

    init(api: any MobileAPIClientProtocol) { self.api = api }

    func select(projectID: UUID?, token: String?) {
        guard self.projectID != projectID || self.token != token else { return }
        pollingTask?.cancel()
        self.projectID = projectID
        self.token = token
        ideas = []
        selected = nil
        guard projectID != nil, token != nil else { return }
        Task { await refresh() }
    }

    func refresh() async {
        guard let projectID, let token else { return }
        loading = ideas.isEmpty
        defer { loading = false }
        do {
            let response: IdeasResponse = try await api.send(
                MobileAPIContract.Endpoint.ideas(projectID: projectID),
                method: "GET", token: token, body: nil, as: IdeasResponse.self
            )
            ideas = response.ideas
            if let selected {
                try await load(id: selected.id)
            }
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func create() async {
        guard let projectID, let token else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.ideas(projectID: projectID),
                method: "POST", token: token,
                body: CreateIdeaRequest(provider: .codex, model: nil),
                as: IdeaResponse.self
            )
            selected = response.idea
            await refreshList(projectID: projectID, token: token)
        }
    }

    func load(id: UUID) async throws {
        guard let projectID, let token else { return }
        let response: IdeaResponse = try await api.send(
            MobileAPIContract.Endpoint.idea(projectID: projectID, ideaID: id),
            method: "GET", token: token, body: nil, as: IdeaResponse.self
        )
        selected = response.idea
        updatePolling()
    }

    func close() { selected = nil; pollingTask?.cancel(); pollingTask = nil }

    func send(_ body: String) async {
        guard let projectID, let token, let selected else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.ideaMessages(projectID: projectID, ideaID: selected.id),
                method: "POST", token: token, body: IdeaMessageRequest(body: body),
                as: IdeaResponse.self
            )
            self.selected = response.idea
            updatePolling()
        }
    }

    func update(
        title: String? = nil,
        document: String? = nil,
        status: IdeaStatus? = nil,
        provider: IdeaProvider? = nil,
        model: String? = nil
    ) async {
        guard let projectID, let token, let selected else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.idea(projectID: projectID, ideaID: selected.id),
                method: "PATCH", token: token,
                body: UpdateIdeaRequest(
                    expectedVersion: selected.version,
                    title: title, documentMarkdown: document, status: status,
                    provider: provider, model: model
                ),
                as: IdeaResponse.self
            )
            self.selected = response.idea
            await refreshList(projectID: projectID, token: token)
        }
    }

    func updateModel(_ model: String?) async {
        guard let projectID, let token, let selected else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.idea(projectID: projectID, ideaID: selected.id),
                method: "PATCH", token: token,
                body: UpdateIdeaModelRequest(expectedVersion: selected.version, model: model),
                as: IdeaResponse.self
            )
            self.selected = response.idea
            await refreshList(projectID: projectID, token: token)
        }
    }

    func retryFailedJob() async {
        guard let projectID, let token, let selected,
              let job = selected.activeJob, job.status == .failed else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.ideaJobRetry(
                    projectID: projectID, ideaID: selected.id, jobID: job.id
                ),
                method: "POST", token: token, body: EmptyRequest(), as: IdeaResponse.self
            )
            self.selected = response.idea
            updatePolling()
        }
    }

    func generatePlan() async {
        guard let projectID, let token, let selected else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.ideaPlan(projectID: projectID, ideaID: selected.id),
                method: "POST", token: token, body: EmptyRequest(), as: IdeaResponse.self
            )
            self.selected = response.idea
            updatePolling()
        }
    }

    func convert() async -> [UUID] {
        guard let projectID, let token, let selected, let plan = selected.plan else { return [] }
        var result: [UUID] = []
        await perform {
            let response: IdeaConversionResponse = try await api.send(
                MobileAPIContract.Endpoint.ideaConvert(projectID: projectID, ideaID: selected.id),
                method: "POST", token: token,
                body: IdeaConversionRequest(planVersion: plan.version),
                as: IdeaConversionResponse.self
            )
            result = response.runIds
            try await load(id: selected.id)
        }
        return result
    }

    func savePlan(_ items: [IdeaPlanItem]) async {
        guard let projectID, let token, let selected, let plan = selected.plan else { return }
        await perform {
            let response: IdeaResponse = try await api.send(
                MobileAPIContract.Endpoint.ideaPlan(projectID: projectID, ideaID: selected.id),
                method: "PATCH", token: token,
                body: IdeaPlanUpdateRequest(expectedVersion: plan.version, items: items),
                as: IdeaResponse.self
            )
            self.selected = response.idea
        }
    }

    func delete() async {
        guard let projectID, let token, let selected else { return }
        await perform {
            let _: IdeaDeleteResponse = try await api.send(
                MobileAPIContract.Endpoint.idea(projectID: projectID, ideaID: selected.id),
                method: "DELETE", token: token, body: nil, as: IdeaDeleteResponse.self
            )
            self.selected = nil
            await refreshList(projectID: projectID, token: token)
        }
    }

    private func refreshList(projectID: UUID, token: String) async {
        do {
            let response: IdeasResponse = try await api.send(
                MobileAPIContract.Endpoint.ideas(projectID: projectID),
                method: "GET", token: token, body: nil, as: IdeasResponse.self
            )
            ideas = response.ideas
        } catch { errorMessage = CompanionStore.message(for: error) }
    }

    private func perform(_ operation: () async throws -> Void) async {
        working = true
        errorMessage = nil
        defer { working = false }
        do { try await operation() }
        catch { errorMessage = CompanionStore.message(for: error) }
    }

    private func updatePolling() {
        pollingTask?.cancel()
        guard let job = selected?.activeJob,
              job.status == .queued || job.status == .running,
              let id = selected?.id else { return }
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled else { return }
                do { try await load(id: id) } catch {
                    errorMessage = CompanionStore.message(for: error)
                }
                guard let job = selected?.activeJob,
                      job.status == .queued || job.status == .running else { return }
            }
        }
    }
}
