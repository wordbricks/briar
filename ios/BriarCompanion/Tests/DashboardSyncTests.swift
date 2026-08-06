import Foundation
import XCTest
@testable import BriarCompanion

final class DashboardSyncTests: XCTestCase {
    private let project = ProjectsResponse.Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        icon: nil,
        productId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
        productName: "Briar Product",
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
            MobileAPIContract.Endpoint.projects: [ProjectsResponse(projects: [project])],
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
        let companion = CompanionStore(api: api)
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
        let otherProject = ProjectsResponse.Project(
            id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            name: "Other",
            icon: nil,
            productId: project.productId,
            productName: project.productName,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .member,
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
