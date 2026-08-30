import BriarContracts
import BriarContractsMocks
import Connect
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

@MainActor
final class InboxStoreSyncTests: XCTestCase {
    private let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!

    func testGeneratedFeedMapsEveryOneofAndRejectsMissingContent() throws {
        let occurredAt = Date(timeIntervalSince1970: 1_700_000_000.125)

        var issue = BriarAPI_InboxIssueMessage()
        issue.runNumber = 7
        issue.status = .blocked
        var result = BriarAPI_StructuredRunResult()
        result.summary = "Needs a human"
        result.outcome = .blocked
        result.importance = .critical
        result.urgency = .immediate
        result.impact = .project
        result.humanActionRequired = true
        issue.structuredResult = result
        var issueWire = wireMessage(id: "issue:1", occurredAt: occurredAt)
        issueWire.issue = issue

        var conversation = BriarAPI_InboxConversationMessage()
        conversation.messageID = "33333333-3333-4333-8333-333333333333"
        conversation.rootMessageID = "44444444-4444-4444-8444-444444444444"
        conversation.body = "Please review"
        conversation.authorName = "Honey"
        conversation.reason = .mention
        var conversationWire = wireMessage(id: "conversation:1", occurredAt: occurredAt)
        conversationWire.conversation = conversation

        var channel = BriarAPI_InboxChannelMessage()
        channel.channelID = "55555555-5555-4555-8555-555555555555"
        channel.channelName = "launch"
        channel.messageID = "66666666-6666-4666-8666-666666666666"
        channel.rootMessageID = "77777777-7777-4777-8777-777777777777"
        channel.body = "Ship it"
        channel.authorName = "Briar"
        channel.reason = .threadReply
        var channelWire = wireMessage(id: "channel:1", occurredAt: occurredAt)
        channelWire.channel = channel

        var session = BriarAPI_InboxSessionMessage()
        session.status = .failed
        session.issueCount = 2
        session.error = "Worker disconnected"
        session.requiresAttention = true
        var sessionWire = wireMessage(id: "session:1", occurredAt: occurredAt)
        sessionWire.session = session

        var response = BriarAPI_GetInboxFeedResponse()
        response.messages = [issueWire, conversationWire, channelWire, sessionWire]
        response.subscribedIssueIds = [projectID.uuidString.lowercased()]
        response.generatedAt = Google_Protobuf_Timestamp(date: occurredAt)
        response.version = "feed-v7"

        let mapped = try InboxFeedUpdate(connectMessage: response)

        XCTAssertEqual(mapped.version, "feed-v7")
        XCTAssertEqual(mapped.subscribedIssueIDs, [projectID])
        XCTAssertEqual(mapped.messages.map(\.kind), [.issue, .conversation, .channel, .session])
        XCTAssertEqual(mapped.messages[0].structuredResult?.summary, "Needs a human")
        XCTAssertEqual(mapped.messages[1].reason, "mention")
        XCTAssertEqual(mapped.messages[2].title, "#launch")
        XCTAssertEqual(mapped.messages[3].body, "Worker disconnected")
        XCTAssertEqual(mapped.messages[0].occurredAt.timeIntervalSince1970, 1_700_000_000.125, accuracy: 0.000_001)

        let missingContent = wireMessage(id: "invalid", occurredAt: occurredAt)
        XCTAssertThrowsError(try InboxMessage(connectMessage: missingContent)) {
            XCTAssertEqual($0 as? MobileAPIError, .invalidResponse)
        }
    }

    func testFeedVersionDrivesConditionalRefreshWithoutClearingUnchangedRows() async throws {
        var issue = BriarAPI_InboxIssueMessage()
        issue.status = .blocked
        var message = wireMessage(
            id: "issue:1",
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        message.issue = issue
        let scenario = InboxFeedMockScenario(responses: [
            wireFeed(messages: [message], version: "feed-v1", unchanged: false),
            wireFeed(messages: [], version: "feed-v1", unchanged: true),
        ])
        let inbox = BriarAPI_InboxServiceClientMock()
        inbox.mockAsyncGetInboxFeed = { request in
            .init(result: .success(scenario.next(request: request)))
        }
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(
            defaults: defaults,
            api: InboxHTTPStub(),
            inboxService: inbox,
            pollInterval: .seconds(3_600)
        )

        store.configure(
            token: "token",
            userID: "user-1",
            organizationID: organizationID
        )
        await store.refreshFeed()
        await store.refreshFeed()

        XCTAssertEqual(store.messages.map(\.id), ["issue:1"])
        let versions = scenario.knownVersions
        XCTAssertEqual(versions.count, 2)
        XCTAssertNil(versions[0])
        XCTAssertEqual(versions[1], "feed-v1")
        store.applicationDidEnterBackground()
    }

    func testOlderReadStateFetchCannotUndoCompletedMutation() async throws {
        let scenario = InboxReadStateMockScenario()
        let inbox = ControlledInboxServiceMock(scenario: scenario)
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(
            defaults: defaults,
            api: InboxHTTPStub(),
            inboxService: inbox
        )
        let project = makeProject()

        store.configure(token: "token", userID: "user-1")
        store.update(snapshot: makeSnapshot(project: project), sessions: [], project: project)
        try await waitForRequestCount(1, method: "GET", scenario: scenario)
        let message = try XCTUnwrap(store.messages.first)

        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", scenario: scenario)
        try await scenario.resolveNextPut(values: [message.id: message.version])
        try await Task.sleep(for: .milliseconds(20))
        try await scenario.resolveNextGet(values: [message.id: "stale"])
        try await Task.sleep(for: .milliseconds(20))

        XCTAssertEqual(store.messages.first?.isUnread, false)
        let lastPut = await scenario.lastPut()
        XCTAssertEqual(lastPut, [message.id: message.version])
    }

    private func wireMessage(id: String, occurredAt: Date) -> BriarAPI_InboxFeedMessage {
        var identity = BriarAPI_InboxMessageIdentity()
        identity.id = id
        identity.projectID = projectID.uuidString.lowercased()
        identity.projectName = "Briar"
        identity.targetID = "88888888-8888-4888-8888-888888888888"
        identity.title = "Review"
        identity.occurredAt = Google_Protobuf_Timestamp(date: occurredAt)
        identity.version = "message-v1"
        var message = BriarAPI_InboxFeedMessage()
        message.identity = identity
        return message
    }

    private func wireFeed(
        messages: [BriarAPI_InboxFeedMessage],
        version: String,
        unchanged: Bool
    ) -> BriarAPI_GetInboxFeedResponse {
        var response = BriarAPI_GetInboxFeedResponse()
        response.messages = messages
        response.generatedAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_700_000_000)
        )
        response.version = version
        response.unchanged = unchanged
        return response
    }

    private func makeProject() -> Project {
        Project(
            id: projectID,
            name: "Briar",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: organizationID,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func makeSnapshot(project: Project) -> DashboardSnapshot {
        DashboardSnapshot(
            project: project,
            runs: [DashboardRun(
                id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
                title: "Review",
                status: .blocked,
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )],
            cursor: 1,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func isolatedDefaults() -> (UserDefaults, String) {
        let suiteName = "InboxStoreSyncTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suiteName)!, suiteName)
    }

    private func waitForRequestCount(
        _ count: Int,
        method: String,
        scenario: InboxReadStateMockScenario
    ) async throws {
        for _ in 0..<200 {
            if await scenario.requestCount(method: method) >= count { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for \(method) request \(count)")
    }
}

private struct InboxHTTPStub: MobileHTTPClientProtocol {}

private final class InboxFeedMockScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [BriarAPI_GetInboxFeedResponse]
    private var requestedVersions: [String?] = []

    init(responses: [BriarAPI_GetInboxFeedResponse]) {
        self.responses = responses
    }

    func next(request: BriarAPI_GetInboxFeedRequest) -> BriarAPI_GetInboxFeedResponse {
        lock.lock()
        defer { lock.unlock() }
        precondition(!request.organizationID.isEmpty)
        requestedVersions.append(request.hasKnownVersion ? request.knownVersion : nil)
        precondition(!responses.isEmpty)
        return responses.removeFirst()
    }

    var knownVersions: [String?] {
        lock.lock()
        defer { lock.unlock() }
        return requestedVersions
    }
}

private actor InboxReadStateMockScenario {
    private var requests: [String] = []
    private var pendingGets: [CheckedContinuation<ResponseMessage<BriarAPI_GetInboxReadStatesResponse>, Never>] = []
    private var pendingPuts: [CheckedContinuation<ResponseMessage<BriarAPI_PutInboxReadStatesResponse>, Never>] = []
    private var putPayloads: [[String: String]] = []

    func get(
        _ request: BriarAPI_GetInboxReadStatesRequest
    ) async -> ResponseMessage<BriarAPI_GetInboxReadStatesResponse> {
        requests.append("GET")
        return await withCheckedContinuation { continuation in
            pendingGets.append(continuation)
        }
    }

    func put(
        _ request: BriarAPI_PutInboxReadStatesRequest
    ) async -> ResponseMessage<BriarAPI_PutInboxReadStatesResponse> {
        requests.append("PUT")
        putPayloads.append(request.readVersions)
        return await withCheckedContinuation { continuation in
            pendingPuts.append(continuation)
        }
    }

    func requestCount(method: String) -> Int {
        requests.filter { $0 == method }.count
    }

    func lastPut() -> [String: String]? { putPayloads.last }

    func resolveNextGet(values: [String: String]) throws {
        guard !pendingGets.isEmpty else { throw MobileAPIError.invalidRequest }
        var response = BriarAPI_GetInboxReadStatesResponse()
        response.readVersions = values
        pendingGets.removeFirst().resume(returning: .init(result: .success(response)))
    }

    func resolveNextPut(values: [String: String]) throws {
        guard !pendingPuts.isEmpty else { throw MobileAPIError.invalidRequest }
        var response = BriarAPI_PutInboxReadStatesResponse()
        response.readVersions = values
        pendingPuts.removeFirst().resume(returning: .init(result: .success(response)))
    }
}

private final class ControlledInboxServiceMock: BriarAPI_InboxServiceClientMock,
    @unchecked Sendable
{
    private let scenario: InboxReadStateMockScenario

    init(scenario: InboxReadStateMockScenario) {
        self.scenario = scenario
        super.init()
    }

    override func getInboxReadStates(
        request: BriarAPI_GetInboxReadStatesRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_GetInboxReadStatesResponse> {
        await scenario.get(request)
    }

    override func putInboxReadStates(
        request: BriarAPI_PutInboxReadStatesRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_PutInboxReadStatesResponse> {
        await scenario.put(request)
    }
}
