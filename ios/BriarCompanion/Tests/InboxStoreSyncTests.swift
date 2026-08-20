import XCTest
@testable import BriarCompanion

@MainActor
final class InboxStoreSyncTests: XCTestCase {
    private let project = ProjectsResponse.Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_800)
    )

    func testOlderGetCannotUndoReadAfterPutCompletes() async throws {
        let api = InboxReadStateAPI()
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api)

        store.configure(token: "token-a", userID: "user-a")
        store.update(snapshot: snapshot(revision: 1), sessions: [], project: project)
        try await waitForRequestCount(1, method: "GET", token: "token-a", api: api)
        let message = try XCTUnwrap(store.messages.first)

        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", token: "token-a", api: api)
        try await api.resolveNext(
            method: "PUT",
            token: "token-a",
            readVersions: [message.id: message.version]
        )
        try await settle()
        try await api.resolveNext(
            method: "GET",
            token: "token-a",
            readVersions: [message.id: "stale-server-version"]
        )
        try await settle()

        XCTAssertEqual(store.messages.first?.isUnread, false)
    }

    func testAccountSwitchIsolatesOldPutFromNewAccount() async throws {
        let api = InboxReadStateAPI()
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api)

        store.configure(token: "token-a", userID: "user-a")
        store.update(snapshot: snapshot(revision: 1), sessions: [], project: project)
        try await waitForRequestCount(1, method: "GET", token: "token-a", api: api)
        try await api.resolveNext(method: "GET", token: "token-a", readVersions: [:])
        try await settle()
        let accountAMessage = try XCTUnwrap(store.messages.first)
        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", token: "token-a", api: api)

        store.configure(token: "token-b", userID: "user-b")
        store.update(snapshot: snapshot(revision: 2), sessions: [], project: project)
        try await waitForRequestCount(1, method: "GET", token: "token-b", api: api)
        try await api.resolveNext(method: "GET", token: "token-b", readVersions: [:])
        try await settle()
        let accountBMessage = try XCTUnwrap(store.messages.first)
        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", token: "token-b", api: api)

        try await api.resolveNext(
            method: "PUT",
            token: "token-b",
            readVersions: [accountBMessage.id: accountBMessage.version]
        )
        try await settle()
        try await api.resolveNext(
            method: "PUT",
            token: "token-a",
            readVersions: [accountAMessage.id: accountAMessage.version]
        )
        try await settle()

        XCTAssertEqual(store.messages.first?.version, accountBMessage.version)
        XCTAssertEqual(store.messages.first?.isUnread, false)
        let accountBPutCount = await api.requestCount(method: "PUT", token: "token-b")
        XCTAssertEqual(accountBPutCount, 1)
    }

    func testPushesAreSerialAndNewerReadSurvivesFirstResponse() async throws {
        let api = InboxReadStateAPI()
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api)

        store.configure(token: "token-a", userID: "user-a")
        try await waitForRequestCount(1, method: "GET", token: "token-a", api: api)
        try await api.resolveNext(method: "GET", token: "token-a", readVersions: [:])
        try await settle()

        store.update(snapshot: snapshot(revision: 1), sessions: [], project: project)
        let firstVersion = try XCTUnwrap(store.messages.first)
        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", token: "token-a", api: api)

        store.update(snapshot: snapshot(revision: 2), sessions: [], project: project)
        let secondVersion = try XCTUnwrap(store.messages.first)
        XCTAssertTrue(secondVersion.isUnread)
        store.markAllRead()
        try await settle()

        let firstPutCount = await api.requestCount(method: "PUT", token: "token-a")
        let firstMaximumConcurrentPuts = await api.maximumConcurrentPuts()
        XCTAssertEqual(firstPutCount, 1)
        XCTAssertEqual(firstMaximumConcurrentPuts, 1)

        try await api.resolveNext(
            method: "PUT",
            token: "token-a",
            readVersions: [firstVersion.id: firstVersion.version]
        )
        try await waitForRequestCount(2, method: "PUT", token: "token-a", api: api)

        XCTAssertEqual(store.messages.first?.isUnread, false)
        let requests = await api.requests(method: "PUT", token: "token-a")
        let finalMaximumConcurrentPuts = await api.maximumConcurrentPuts()
        XCTAssertEqual(requests[1].readVersions, [secondVersion.id: secondVersion.version])
        XCTAssertEqual(finalMaximumConcurrentPuts, 1)

        try await api.resolveNext(
            method: "PUT",
            token: "token-a",
            readVersions: [secondVersion.id: secondVersion.version]
        )
        try await settle()
    }

    func testForegroundStartsANewReadStateSync() async throws {
        let api = InboxReadStateAPI()
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api)

        store.configure(token: "token-a", userID: "user-a")
        try await waitForRequestCount(1, method: "GET", token: "token-a", api: api)
        try await api.resolveNext(method: "GET", token: "token-a", readVersions: [:])
        try await settle()

        store.applicationDidBecomeActive()
        try await waitForRequestCount(2, method: "GET", token: "token-a", api: api)
        try await api.resolveNext(method: "GET", token: "token-a", readVersions: [:])
        try await settle()

        let getCount = await api.requestCount(method: "GET", token: "token-a")
        XCTAssertEqual(getCount, 2)
    }

    func testRoutineActivityDoesNotIncreaseVisibleUnreadCount() {
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults)
        let activityRun = DashboardRun(
            id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            title: "Routine completion",
            status: .completed,
            priority: 3,
            updatedAt: Date(timeIntervalSince1970: 1_775_260_900)
        )
        let activitySnapshot = DashboardSnapshot(
            project: project,
            runs: [activityRun],
            cursor: 1,
            generatedAt: Date(timeIntervalSince1970: 1_775_260_901)
        )

        store.configure(token: nil, userID: "user-a")
        store.update(snapshot: activitySnapshot, sessions: [], project: project)

        // Activity remains internally unread so enabled routine system
        // notifications still work, but it has no Inbox dot or badge count.
        XCTAssertEqual(store.messages.first?.isUnread, true)
        XCTAssertEqual(store.unreadCount, 0)
    }

    func testOrganizationFeedKeepsUnselectedProjectMessages() async throws {
        let secondProject = ProjectsResponse.Project(
            id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
            name: "Second project",
            icon: nil,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: .member,
            createdAt: project.createdAt
        )
        let secondRunID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        let response = InboxFeedResponse(
            messages: [
                InboxFeedMessage(
                    id: "issue:\(secondRunID.uuidString.lowercased())",
                    kind: .issue,
                    projectId: secondProject.id,
                    projectName: secondProject.name,
                    targetId: secondRunID.uuidString.lowercased(),
                    title: "Second project needs attention",
                    occurredAt: Date(timeIntervalSince1970: 1_775_260_950),
                    version: "1:1:blocked:implementing:2026-04-03T00:02:30.000Z:2",
                    status: "blocked",
                    priority: 1,
                    requiresAttention: true
                )
            ],
            subscribedIssueIds: [secondRunID],
            generatedAt: Date(timeIntervalSince1970: 1_775_260_951)
        )
        let api = SelectionIndependentInboxAPI(response: response)
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(
            defaults: defaults,
            api: api,
            pollInterval: .seconds(60)
        )

        store.configure(
            token: "token-a",
            userID: "user-a",
            organizationID: project.organizationId
        )
        store.update(snapshot: snapshot(revision: 1), sessions: [], project: project)
        await store.refreshFeed()
        // A later selected-project refresh must merge into the organization
        // feed instead of replacing the unselected project's message.
        store.update(
            snapshot: snapshot(revision: 2, subscribers: []),
            sessions: [],
            project: project
        )

        let secondMessage = try XCTUnwrap(
            store.messages.first(where: { $0.projectId == secondProject.id })
        )
        XCTAssertEqual(secondMessage.targetId, secondRunID.uuidString.lowercased())
        XCTAssertEqual(secondMessage.statusLabel, DashboardRun.Status.blocked.displayName)
        XCTAssertTrue(secondMessage.isUnread)
        XCTAssertFalse(store.messages.contains {
            $0.targetId == Self.selectedRunID.uuidString.lowercased()
        })
        XCTAssertTrue(store.feedReady)
        XCTAssertEqual(
            store.notificationBaselineID,
            "user-a:\(project.organizationId.uuidString.lowercased()):feed"
        )
    }

    func testRealtimeInboxVersionsCoalesceIntoOneConditionalRefresh() async throws {
        let response = InboxFeedResponse(
            messages: [],
            subscribedIssueIds: [],
            generatedAt: Date(timeIntervalSince1970: 1_775_260_951)
        )
        let api = SelectionIndependentInboxAPI(response: response)
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(
            defaults: defaults,
            api: api,
            pollInterval: .seconds(3_600)
        )

        store.configure(
            token: "token-a",
            userID: "user-a",
            organizationID: project.organizationId
        )
        for _ in 0..<100 {
            if await api.inboxRequestCount() >= 1 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let initialRequestCount = await api.inboxRequestCount()
        XCTAssertEqual(initialRequestCount, 1)

        store.receiveRealtimeNotification(
            ChannelRealtimeNotification(topic: "inbox", version: 4)
        )
        store.receiveRealtimeNotification(
            ChannelRealtimeNotification(topic: "inbox", version: 5)
        )
        try await Task.sleep(for: .milliseconds(400))

        let refreshedRequestCount = await api.inboxRequestCount()
        XCTAssertEqual(refreshedRequestCount, 2)
        store.applicationDidEnterBackground()
    }

    func testAuthoritativeFeedRemovesCachedSessionForAnotherMember() async throws {
        let response = InboxFeedResponse(
            messages: [],
            subscribedIssueIds: [],
            generatedAt: Date(timeIntervalSince1970: 1_775_260_951)
        )
        let api = SelectionIndependentInboxAPI(response: response)
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(
            defaults: defaults,
            api: api,
            pollInterval: .seconds(3_600)
        )
        let completedAt = Date(timeIntervalSince1970: 1_775_260_900)
        let cachedSession = ProjectAgentSession(
            id: "cached-private-session",
            projectId: project.id,
            dispatchGroupId: "cached-private-session",
            agentId: nil,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "Private execution result",
            status: .failed,
            issues: [],
            startedAt: completedAt.addingTimeInterval(-60),
            completedAt: completedAt,
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: "Runner stopped",
            events: [.init(id: "failed-event", type: .failed, occurredAt: completedAt)],
            updatedAt: completedAt,
            requestedByUserId: "user-a"
        )

        store.configure(
            token: "token-a",
            userID: "user-a",
            organizationID: project.organizationId
        )
        store.update(snapshot: nil, sessions: [cachedSession], project: project)
        XCTAssertEqual(store.messages.map(\.id), ["session:cached-private-session"])

        await store.refreshFeed()

        XCTAssertFalse(store.messages.contains { $0.kind == .session })
        XCTAssertEqual(store.unreadCount, 0)
        store.applicationDidEnterBackground()
    }

    private func snapshot(
        revision: Int,
        subscribers: [IssueSubscriber]? = nil
    ) -> DashboardSnapshot {
        let occurredAt = Date(timeIntervalSince1970: 1_775_260_800 + Double(revision))
        let run = DashboardRun(
            id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            runNumber: 1,
            currentAttempt: 1,
            currentRevision: revision,
            title: "Needs attention",
            status: .blocked,
            workflowStage: "implementing",
            priority: 1,
            subscribers: subscribers,
            updatedAt: occurredAt,
            lastEventAt: ISO8601DateFormatter().string(from: occurredAt),
            eventCount: revision
        )
        return DashboardSnapshot(
            project: project,
            runs: [run],
            cursor: revision,
            generatedAt: occurredAt
        )
    }

    private static let selectedRunID =
        UUID(uuidString: "33333333-3333-4333-8333-333333333333")!

    private func isolatedDefaults() -> (UserDefaults, String) {
        let suiteName = "InboxStoreSyncTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suiteName)!, suiteName)
    }

    private func waitForRequestCount(
        _ count: Int,
        method: String,
        token: String,
        api: InboxReadStateAPI
    ) async throws {
        for _ in 0..<200 {
            if await api.requestCount(method: method, token: token) >= count {
                return
            }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for \(method) request \(count) for \(token)")
    }

    private func settle() async throws {
        try await Task.sleep(for: .milliseconds(20))
    }
}

private actor SelectionIndependentInboxAPI: MobileAPIClientProtocol {
    let response: InboxFeedResponse
    private var inboxRequests = 0

    init(response: InboxFeedResponse) {
        self.response = response
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let data: Data
        if path == MobileAPIContract.Endpoint.inboxReadStates {
            data = try JSONEncoder.mobileContract.encode(
                InboxReadStatesResponse(readVersions: [:])
            )
        } else if path.hasSuffix("/inbox"), method == "GET" {
            inboxRequests += 1
            data = try JSONEncoder.mobileContract.encode(response)
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }

    func inboxRequestCount() -> Int { inboxRequests }
}

private actor InboxReadStateAPI: MobileAPIClientProtocol {
    struct Request: Sendable {
        let id: Int
        let method: String
        let token: String?
        let readVersions: [String: String]
    }

    private struct PendingRequest {
        let request: Request
        let continuation: CheckedContinuation<Data, any Error>
    }

    private var recorded: [Request] = []
    private var pending: [PendingRequest] = []
    private var nextID = 1
    private var activePuts = 0
    private var maxActivePuts = 0

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        guard path == MobileAPIContract.Endpoint.inboxReadStates else {
            throw MobileAPIError.invalidRequest
        }
        let readVersions: [String: String]
        if let body {
            let data = try JSONEncoder.mobileContract.encode(InboxSyncAnyEncodable(body))
            readVersions = try JSONDecoder.mobileContract.decode(
                InboxReadStatesRequest.self,
                from: data
            ).readVersions
        } else {
            readVersions = [:]
        }

        let request = Request(
            id: nextID,
            method: method,
            token: token,
            readVersions: readVersions
        )
        nextID += 1
        recorded.append(request)
        if method == "PUT" {
            activePuts += 1
            maxActivePuts = max(maxActivePuts, activePuts)
        }

        let data = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Data, any Error>) in
            pending.append(PendingRequest(request: request, continuation: continuation))
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }

    func requestCount(method: String, token: String) -> Int {
        recorded.filter { $0.method == method && $0.token == token }.count
    }

    func requests(method: String, token: String) -> [Request] {
        recorded.filter { $0.method == method && $0.token == token }
    }

    func maximumConcurrentPuts() -> Int { maxActivePuts }

    func resolveNext(
        method: String,
        token: String,
        readVersions: [String: String]
    ) throws {
        guard let index = pending.firstIndex(where: {
            $0.request.method == method && $0.request.token == token
        }) else {
            throw MobileAPIError.invalidRequest
        }
        let request = pending.remove(at: index)
        if method == "PUT" {
            activePuts -= 1
        }
        let response = InboxReadStatesResponse(readVersions: readVersions)
        let data = try JSONEncoder.mobileContract.encode(response)
        request.continuation.resume(returning: data)
    }
}

private struct InboxSyncAnyEncodable: Encodable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
