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

    private static func selectedProjectKey(for userID: String) -> String {
        "companion.selectedProjectID.\(userID)"
    }

    init(api: any MobileAPIClientProtocol, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
    }

    func load(token: String) async throws {
        loading = true
        defer { loading = false }
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
            user = loadedUser.user
            projects = loadedProjects.projects
            organizations = Dictionary(
                grouping: projects,
                by: \.organizationId
            ).compactMap { id, projects in
                projects.first.map { OrganizationSummary(id: id, name: $0.organizationName) }
            }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            let storedProjectID = Self.storedProjectID(
                for: loadedUser.user.id,
                in: loadedProjects.projects,
                defaults: defaults
            )
            selectedProjectID = storedProjectID ?? Self.defaultProjectID(for: loadedProjects.projects)
            errorMessage = nil
        } catch {
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    func clear() {
        user = nil
        organizations = []
        projects = []
        selectedProjectID = nil
        errorMessage = nil
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
    private var refreshTask: Task<Void, Never>?
    private var pollingTask: Task<Void, Never>?

    init(api: any MobileAPIClientProtocol, pollInterval: Duration = .seconds(15)) {
        self.api = api
        self.pollInterval = pollInterval
    }

    func select(projectID: UUID?, token: String?) {
        guard self.projectID != projectID || self.token != token else { return }
        generation += 1
        refreshTask?.cancel()
        refreshTask = nil
        pollingTask?.cancel()
        pollingTask = nil
        self.projectID = projectID
        self.token = token
        snapshot = nil
        errorMessage = nil
        guard projectID != nil, token != nil else { return }
        startPolling()
    }

    func refresh(forceSnapshot: Bool = false) async {
        guard let projectID, let token else { return }
        if let refreshTask {
            await refreshTask.value
            return
        }
        let expectedGeneration = generation
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
                guard !Task.isCancelled, expectedGeneration == self.generation else { return }
                self.snapshot = loaded
                self.errorMessage = nil
            } catch is CancellationError {
                return
            } catch {
                guard expectedGeneration == self.generation else { return }
                self.errorMessage = CompanionStore.message(for: error)
            }
        }
        refreshTask = task
        isRefreshing = true
        await task.value
        if expectedGeneration == generation {
            refreshTask = nil
            isRefreshing = false
        }
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
    @Published private(set) var events: [RunEvent] = []
    @Published private(set) var messages: [IssueMessage] = []
    @Published private(set) var evidence: [RunEvidence] = []
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let projectID: UUID
    private let runID: UUID
    private let token: String

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

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
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
            events = loaded.0.events
            messages = loaded.1.messages
            evidence = loaded.2.evidence
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func appendMessages(_ newMessages: [IssueMessage]) {
        let existing = Set(messages.map(\.id))
        messages.append(contentsOf: newMessages.filter { !existing.contains($0.id) })
        messages.sort { $0.createdAt < $1.createdAt }
    }

    func updateIssueProposal(_ proposal: IssueProposedAction) {
        messages = messages.map { message in
            guard message.proposedAction?.id == proposal.id else { return message }
            var updated = message
            updated.proposedAction = proposal
            return updated
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
