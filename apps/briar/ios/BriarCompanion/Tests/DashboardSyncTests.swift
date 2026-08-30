import Foundation
import XCTest
@testable import BriarCompanion

final class DashboardSyncTests: XCTestCase {
    private let project = Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        issueKeyPrefix: "AH",
        scheduleTabEnabled: true,
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_700_000_000)
    )

    func testMergeUpdatesRunsAndAppliesDeletionTombstones() {
        let removed = run(id: "33333333-3333-4333-8333-333333333333", title: "Remove")
        let changed = run(id: "44444444-4444-4444-8444-444444444444", title: "Before")
        let snapshot = DashboardSnapshot(
            project: project,
            runs: [removed, changed],
            cursor: 10,
            generatedAt: .distantPast
        )
        let replacement = run(
            id: "44444444-4444-4444-8444-444444444444",
            title: "After",
            status: .completed
        )
        let delta = DashboardDelta(
            cursor: 11,
            hasMore: false,
            runs: [replacement],
            deletedRunIds: [removed.id],
            project: nil,
            generatedAt: .now
        )

        let merged = DashboardMerge.apply(delta, to: snapshot)

        XCTAssertEqual(merged.cursor, 11)
        XCTAssertEqual(merged.runs, [replacement])
    }

    @MainActor
    func testConcurrentRefreshIsDeduplicatedAndExpiredCursorReloadsSnapshot() async {
        let first = snapshot(cursor: 10, title: "Initial")
        let recovered = snapshot(cursor: 50, title: "Recovered")
        let api = StubAPIClient(stubs: [
            .response(first, delay: .milliseconds(50)),
            .failure(MobileAPIError.httpStatus(410, "dashboard_cursor_expired")),
            .response(recovered),
        ])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: project.id, token: "token")
        async let one: Void = store.refresh(forceSnapshot: true)
        async let two: Void = store.refresh(forceSnapshot: true)
        _ = await (one, two)

        let deduplicatedRequestCount = await api.requestCount()
        XCTAssertEqual(deduplicatedRequestCount, 1)
        await store.refresh()
        XCTAssertEqual(store.snapshot?.cursor, 50)
        XCTAssertEqual(store.snapshot?.runs.first?.title, "Recovered")
        let recoveredRequestCount = await api.requestCount()
        XCTAssertEqual(recoveredRequestCount, 3)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testEnsureRunAvailableSupersedesIncrementalRefreshWithCanonicalSnapshot() async {
        let initial = snapshot(cursor: 10, title: "Before approval")
        let createdRun = run(
            id: "77777777-7777-4777-8777-777777777777",
            title: "Created from channel",
            status: .backlog
        )
        let canonical = DashboardSnapshot(
            project: project,
            runs: initial.runs + [createdRun],
            cursor: 12,
            generatedAt: .now
        )
        let delayedDelta = DashboardDelta(
            cursor: 11,
            hasMore: false,
            runs: [],
            deletedRunIds: [],
            project: nil,
            generatedAt: .now
        )
        let api = StubAPIClient(stubs: [
            .response(initial),
            .response(delayedDelta, delay: .milliseconds(250)),
            .response(canonical),
        ])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: project.id, token: "token")
        await store.refresh(forceSnapshot: true)
        let incremental = Task { await store.refresh() }
        await waitForRequests(api, count: 2)

        let available = await store.ensureRunAvailable(
            projectID: project.id,
            runID: createdRun.id,
            token: "token"
        )
        await incremental.value

        XCTAssertTrue(available)
        XCTAssertEqual(store.snapshot?.cursor, 12)
        XCTAssertTrue(store.snapshot?.runs.contains(where: { $0.id == createdRun.id }) == true)
        let requestCount = await api.requestCount()
        XCTAssertEqual(requestCount, 3)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testEnsureRunAvailableFailureNeverClaimsTheMissingRun() async {
        let initial = snapshot(cursor: 10, title: "Before approval")
        let missingRunID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
        let api = StubAPIClient(stubs: [
            .response(initial),
            .failure(URLError(.notConnectedToInternet)),
        ])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: project.id, token: "token")
        await store.refresh(forceSnapshot: true)

        let available = await store.ensureRunAvailable(
            projectID: project.id,
            runID: missingRunID,
            token: "token"
        )

        XCTAssertFalse(available)
        XCTAssertFalse(store.snapshot?.runs.contains(where: { $0.id == missingRunID }) == true)
        XCTAssertNotNil(store.errorMessage)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testEnsureRunAvailableSelectsAndLoadsTheTargetProject() async {
        let targetProject = Project(
            id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            name: "Target",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .developer,
            createdAt: project.createdAt
        )
        let targetRun = run(
            id: "66666666-6666-4666-8666-666666666666",
            title: "Cross-project issue",
            status: .backlog
        )
        let targetSnapshot = DashboardSnapshot(
            project: targetProject,
            runs: [targetRun],
            cursor: 1,
            generatedAt: .now
        )
        let api = StubAPIClient(stubs: [
            .response(snapshot(cursor: 10, title: "Current project")),
            .response(targetSnapshot),
        ])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: project.id, token: "token")
        await store.refresh(forceSnapshot: true)

        let available = await store.ensureRunAvailable(
            projectID: targetProject.id,
            runID: targetRun.id,
            token: "token"
        )

        XCTAssertTrue(available)
        XCTAssertEqual(store.snapshot?.project.id, targetProject.id)
        XCTAssertEqual(store.snapshot?.runs.map(\.id), [targetRun.id])
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testDeviceLoginLoadsAccountProjectsAndDashboard() async throws {
        let deviceCode = DeviceCodeResponse(
            deviceCode: "device-code",
            userCode: "BRIAR123",
            verificationURI: URL(string: "https://briar-api.example/device")!,
            verificationURIComplete: URL(
                string: "https://briar-api.example/device?user_code=BRIAR123"
            ),
            expiresIn: 600,
            interval: 1
        )
        let user = CurrentUserResponse(user: .init(
            id: "user-1",
            username: "briar",
            name: "Briar User",
            email: "user@example.com",
            image: nil
        ))
        let api = RoutingAPIClient(routes: [
            MobileAPIContract.Endpoint.deviceCode: [deviceCode],
            MobileAPIContract.Endpoint.deviceToken: [DeviceTokenResponse(
                accessToken: "access-token",
                tokenType: "Bearer",
                expiresIn: 3_600
            )],
            MobileAPIContract.Endpoint.currentUser: [user],
            MobileAPIOperations.listProjects.path: [ProjectsResponse(projects: [project])],
            MobileAPIContract.Endpoint.dashboard(projectID: project.id): [
                snapshot(cursor: 7, title: "Loaded after login"),
            ],
        ])
        let presenter = MockAuthenticationPresenter()
        let token = try await DeviceAuthorizationService(api: api)
            .authorize(using: presenter)
        let secureStore = IntegrationTokenStore()
        let migrationDirectory = FileManager.default.temporaryDirectory
            .appending(path: "briar-integration-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: migrationDirectory) }
        let session = SessionStore(
            secureStore: secureStore,
            migrator: LegacyTauriSessionMigrator(applicationSupportURL: migrationDirectory)
        )
        try session.signIn(token: token)
        let companion = CompanionStore(api: api, defaults: isolatedDefaults())
        try await companion.load(token: token)
        let dashboard = DashboardStore(api: api, pollInterval: .seconds(3_600))
        dashboard.select(projectID: companion.selectedProjectID, token: session.token)
        await dashboard.refresh()

        XCTAssertEqual(session.token, "access-token")
        XCTAssertEqual(companion.user?.email, "user@example.com")
        XCTAssertEqual(companion.organizations.map(\.name), ["Wordbricks"])
        XCTAssertEqual(companion.selectedProjectID, project.id)
        XCTAssertEqual(dashboard.snapshot?.runs.first?.title, "Loaded after login")
        XCTAssertEqual(
            presenter.presentedURL?.absoluteString,
            "https://briar-api.example/device?user_code=BRIAR123&client=mobile"
        )
        dashboard.applicationDidEnterBackground()
    }

    @MainActor
    func testProjectSwitchDiscardsThePreviousProjectsSlowResponse() async {
        let otherProject = Project(
            id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            name: "Other",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .developer,
            createdAt: project.createdAt
        )
        let first = snapshot(cursor: 1, title: "Stale project")
        let second = DashboardSnapshot(
            project: otherProject,
            runs: [run(
                id: "66666666-6666-4666-8666-666666666666",
                title: "Selected project"
            )],
            cursor: 2,
            generatedAt: .now
        )
        let firstPath = MobileAPIContract.Endpoint.dashboard(projectID: project.id)
        let secondPath = MobileAPIContract.Endpoint.dashboard(projectID: otherProject.id)
        let api = RoutingAPIClient(
            routes: [firstPath: [first], secondPath: [second]],
            delays: [firstPath: .milliseconds(200)]
        )
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))

        store.select(projectID: project.id, token: "token")
        try? await Task.sleep(for: .milliseconds(20))
        store.select(projectID: otherProject.id, token: "token")
        await store.refresh()

        XCTAssertEqual(store.snapshot?.project.id, otherProject.id)
        XCTAssertEqual(store.snapshot?.runs.first?.title, "Selected project")
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testOfflineFailureRecoversOnTheNextRefresh() async {
        let api = StubAPIClient(stubs: [
            .failure(URLError(.notConnectedToInternet)),
            .response(snapshot(cursor: 12, title: "Back online")),
        ])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: project.id, token: "token")
        await store.refresh()
        XCTAssertNotNil(store.errorMessage)

        await store.refresh()
        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(store.snapshot?.runs.first?.title, "Back online")
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testFirstLoadFallsBackToFirstProjectWhenNothingPersisted() async throws {
        let otherProject = Project(
            id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
            name: "Briar Mobile",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .owner,
            createdAt: project.createdAt
        )
        let user = CurrentUserResponse(user: .init(
            id: "user-persist",
            username: "briar",
            name: "Briar User",
            email: "user@example.com",
            image: nil
        ))
        let api = RoutingAPIClient(routes: [
            MobileAPIContract.Endpoint.currentUser: [user],
            MobileAPIOperations.listProjects.path: [
                ProjectsResponse(projects: [project, otherProject]),
            ],
        ])
        let store = CompanionStore(api: api, defaults: isolatedDefaults())

        try await store.load(token: "token")

        XCTAssertEqual(store.selectedProjectID, project.id)
    }

    @MainActor
    func testLoadRestoresLastSelectedProject() async throws {
        let otherProject = Project(
            id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
            name: "Briar Mobile",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .owner,
            createdAt: project.createdAt
        )
        let user = CurrentUserResponse(user: .init(
            id: "user-persist",
            username: "briar",
            name: "Briar User",
            email: "user@example.com",
            image: nil
        ))
        let api = RoutingAPIClient(routes: [
            MobileAPIContract.Endpoint.currentUser: [user],
            MobileAPIOperations.listProjects.path: [
                ProjectsResponse(projects: [project, otherProject]),
            ],
        ])
        let defaults = isolatedDefaults()
        defaults.set(
            otherProject.id.uuidString,
            forKey: "companion.selectedProjectID.user-persist"
        )
        let store = CompanionStore(api: api, defaults: defaults)

        try await store.load(token: "token")

        XCTAssertEqual(store.selectedProjectID, otherProject.id)
    }

    @MainActor
    func testLoadFallsBackWhenPersistedProjectIsGone() async throws {
        let user = CurrentUserResponse(user: .init(
            id: "user-persist",
            username: "briar",
            name: "Briar User",
            email: "user@example.com",
            image: nil
        ))
        let api = RoutingAPIClient(routes: [
            MobileAPIContract.Endpoint.currentUser: [user],
            MobileAPIOperations.listProjects.path: [
                ProjectsResponse(projects: [project]),
            ],
        ])
        let defaults = isolatedDefaults()
        defaults.set(
            UUID().uuidString,
            forKey: "companion.selectedProjectID.user-persist"
        )
        let store = CompanionStore(api: api, defaults: defaults)

        try await store.load(token: "token")

        XCTAssertEqual(store.selectedProjectID, project.id)
    }

    @MainActor
    func testProjectCatalogRefreshFindsProjectsCreatedAfterLogin() async throws {
        let newProject = Project(
            id: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
            name: "Created by teammate",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .developer,
            createdAt: project.createdAt
        )
        let user = CurrentUserResponse(user: .init(
            id: "user-refresh",
            username: "briar",
            name: "Briar User",
            email: "user@example.com",
            image: nil
        ))
        let api = RoutingAPIClient(routes: [
            MobileAPIContract.Endpoint.currentUser: [user],
            MobileAPIOperations.listProjects.path: [
                ProjectsResponse(projects: [project]),
                ProjectsResponse(projects: [project, newProject]),
            ],
        ])
        let store = CompanionStore(api: api, defaults: isolatedDefaults())
        try await store.load(token: "token")

        try await store.refreshProjects(token: "token")

        XCTAssertTrue(store.projects.contains(where: { $0.id == newProject.id }))
        XCTAssertEqual(store.selectedProjectID, project.id)
    }

    @MainActor
    func testPreviousAccountProjectRefreshCannotOverwriteANewLogin() async throws {
        let previousProject = project
        let nextProject = Project(
            id: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Next account project",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            organizationName: "Next organization",
            role: .owner,
            createdAt: project.createdAt
        )
        let previousUser = CurrentUserResponse(user: .init(
            id: "previous-user",
            username: "previous",
            name: "Previous User",
            email: "previous@example.com",
            image: nil
        ))
        let nextUser = CurrentUserResponse(user: .init(
            id: "next-user",
            username: "next",
            name: "Next User",
            email: "next@example.com",
            image: nil
        ))
        let api = TokenRoutingAPIClient(
            routes: [
                "previous:\(MobileAPIContract.Endpoint.currentUser)": previousUser,
                "previous:\(MobileAPIOperations.listProjects.path)": ProjectsResponse(
                    projects: [previousProject]
                ),
                "next:\(MobileAPIContract.Endpoint.currentUser)": nextUser,
                "next:\(MobileAPIOperations.listProjects.path)": ProjectsResponse(
                    projects: [nextProject]
                ),
            ],
            delays: ["previous": .milliseconds(150), "next": .milliseconds(10)]
        )
        let store = CompanionStore(api: api, defaults: isolatedDefaults())
        let previousLoad = Task { try? await store.load(token: "previous") }
        for _ in 0..<100 {
            if await api.requestCount(token: "previous") >= 2 { break }
            try await Task.sleep(for: .milliseconds(5))
        }

        store.clear()
        try await store.load(token: "next")
        _ = await previousLoad.value

        XCTAssertEqual(store.user?.id, "next-user")
        XCTAssertEqual(store.projects.map(\.id), [nextProject.id])
        XCTAssertEqual(store.organizations.map(\.name), ["Next organization"])
        XCTAssertEqual(store.selectedProjectID, nextProject.id)
    }

    private func isolatedDefaults() -> UserDefaults {
        let suiteName = "companion-store-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        addTeardownBlock {
            UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        }
        return defaults
    }

    private func snapshot(cursor: Int, title: String) -> DashboardSnapshot {
        DashboardSnapshot(
            project: project,
            runs: [run(id: "33333333-3333-4333-8333-333333333333", title: title)],
            cursor: cursor,
            generatedAt: .now
        )
    }

    private func run(
        id: String,
        title: String,
        status: DashboardRun.Status = .running
    ) -> DashboardRun {
        DashboardRun(
            id: UUID(uuidString: id)!,
            title: title,
            status: status,
            detail: nil,
            updatedAt: .now
        )
    }

    @MainActor
    private func waitForRequests(
        _ api: StubAPIClient,
        count: Int,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<100 {
            if await api.requestCount() >= count { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for \(count) dashboard request(s)", file: file, line: line)
    }
}

@MainActor
private final class MockAuthenticationPresenter: WebAuthenticationPresenting {
    private(set) var presentedURL: URL?

    func authenticate(at url: URL, callbackScheme: String) async throws {
        presentedURL = url
        XCTAssertEqual(callbackScheme, "briar-companion")
    }
}

private final class IntegrationTokenStore: SessionTokenStoring, @unchecked Sendable {
    private var token: String?
    func read() throws -> String? { token }
    func write(_ token: String) throws { self.token = token }
    func clear() throws { token = nil }
}

private actor RoutingAPIClient: MobileAPIClientProtocol {
    private var routes: [String: [Data]]
    private let delays: [String: Duration]

    init(
        routes: [String: [any Encodable & Sendable]],
        delays: [String: Duration] = [:]
    ) {
        self.routes = routes.mapValues { values in
            values.map { value in
                try! JSONEncoder.mobileContract.encode(TestAnyEncodable(value))
            }
        }
        self.delays = delays
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        guard var values = routes[path], !values.isEmpty else {
            throw MobileAPIError.httpStatus(404, "Missing test route: \(path)")
        }
        if let delay = delays[path] { try await Task.sleep(for: delay) }
        let data = values.removeFirst()
        routes[path] = values
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

private actor TokenRoutingAPIClient: MobileAPIClientProtocol {
    private let routes: [String: Data]
    private let delays: [String: Duration]
    private var requests: [String] = []

    init(
        routes: [String: any Encodable & Sendable],
        delays: [String: Duration]
    ) {
        self.routes = routes.mapValues { value in
            try! JSONEncoder.mobileContract.encode(TestAnyEncodable(value))
        }
        self.delays = delays
    }

    func requestCount(token: String) -> Int {
        requests.filter { $0 == token }.count
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let token = token ?? ""
        requests.append(token)
        guard let data = routes["\(token):\(path)"] else {
            throw MobileAPIError.httpStatus(404, "Missing token route")
        }
        if let delay = delays[token] { try await Task.sleep(for: delay) }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

private actor StubAPIClient: MobileAPIClientProtocol {
    enum Stub: @unchecked Sendable {
        case response(any Encodable & Sendable, delay: Duration = .zero)
        case failure(any Error)
    }

    private var stubs: [Stub]
    private var paths: [String] = []

    init(stubs: [Stub]) { self.stubs = stubs }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        paths.append(path)
        let stub = stubs.removeFirst()
        switch stub {
        case let .failure(error): throw error
        case let .response(value, delay):
            if delay > .zero { try await Task.sleep(for: delay) }
            let data = try JSONEncoder.mobileContract.encode(TestAnyEncodable(value))
            return try JSONDecoder.mobileContract.decode(responseType, from: data)
        }
    }

    func requestCount() -> Int { paths.count }
}

private struct TestAnyEncodable: Encodable {
    let encodeValue: (Encoder) throws -> Void
    init(_ value: any Encodable) {
        encodeValue = { encoder in try value.encode(to: encoder) }
    }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}
