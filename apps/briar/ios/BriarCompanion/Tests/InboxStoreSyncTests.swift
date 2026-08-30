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
        let message = inboxMessage(id: "issue:1", version: "message-v1")
        let api = FeedConnectStub(responses: [
            InboxFeedUpdate(
                messages: [message],
                subscribedIssueIDs: [],
                generatedAt: Date(timeIntervalSince1970: 1_700_000_000),
                version: "feed-v1",
                unchanged: false
            ),
            InboxFeedUpdate(
                messages: [],
                subscribedIssueIDs: [],
                generatedAt: Date(timeIntervalSince1970: 1_700_000_001),
                version: "feed-v1",
                unchanged: true
            ),
        ])
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api, pollInterval: .seconds(3_600))

        store.configure(
            token: "token",
            userID: "user-1",
            organizationID: organizationID
        )
        await store.refreshFeed()
        await store.refreshFeed()

        XCTAssertEqual(store.messages.map(\.id), [message.id])
        let versions = await api.knownVersions()
        XCTAssertEqual(versions.count, 2)
        XCTAssertNil(versions[0])
        XCTAssertEqual(versions[1], "feed-v1")
        store.applicationDidEnterBackground()
    }

    func testOlderReadStateFetchCannotUndoCompletedMutation() async throws {
        let api = ReadStateConnectStub()
        let (defaults, suiteName) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = InboxStore(defaults: defaults, api: api)
        let project = makeProject()

        store.configure(token: "token", userID: "user-1")
        store.update(snapshot: makeSnapshot(project: project), sessions: [], project: project)
        try await waitForRequestCount(1, method: "GET", api: api)
        let message = try XCTUnwrap(store.messages.first)

        store.markAllRead()
        try await waitForRequestCount(1, method: "PUT", api: api)
        try await api.resolveNext(method: "PUT", values: [message.id: message.version])
        try await Task.sleep(for: .milliseconds(20))
        try await api.resolveNext(method: "GET", values: [message.id: "stale"])
        try await Task.sleep(for: .milliseconds(20))

        XCTAssertEqual(store.messages.first?.isUnread, false)
        let lastPut = await api.lastPut()
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

    private func inboxMessage(id: String, version: String) -> InboxMessage {
        InboxMessage(
            id: id,
            kind: .issue,
            projectId: projectID,
            projectName: "Briar",
            targetId: "88888888-8888-4888-8888-888888888888",
            title: "Review",
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000),
            version: version,
            body: nil,
            authorName: nil,
            statusLabel: "Blocked",
            requiresAttention: true,
            priority: 1,
            structuredResult: nil,
            rootMessageId: nil
        )
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
        api: ReadStateConnectStub
    ) async throws {
        for _ in 0..<200 {
            if await api.requestCount(method: method) >= count { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for \(method) request \(count)")
    }
}

private actor FeedConnectStub: MobileAPIClientProtocol {
    private var responses: [InboxFeedUpdate]
    private var requestedVersions: [String?] = []

    init(responses: [InboxFeedUpdate]) {
        self.responses = responses
    }

    func getInboxFeed(
        organizationID: UUID,
        knownVersion: String?,
        token: String
    ) async throws -> InboxFeedUpdate {
        requestedVersions.append(knownVersion)
        guard !responses.isEmpty else { throw MobileAPIError.invalidResponse }
        return responses.removeFirst()
    }

    func getInboxReadStates(token: String) async throws -> [String: String] { [:] }

    func knownVersions() -> [String?] { requestedVersions }
}

private actor ReadStateConnectStub: MobileAPIClientProtocol {
    private struct Pending {
        let method: String
        let continuation: CheckedContinuation<[String: String], any Error>
    }

    private var requests: [String] = []
    private var pending: [Pending] = []
    private var putPayloads: [[String: String]] = []

    func getInboxReadStates(token: String) async throws -> [String: String] {
        requests.append("GET")
        return try await withCheckedThrowingContinuation { continuation in
            pending.append(Pending(method: "GET", continuation: continuation))
        }
    }

    func putInboxReadStates(
        _ readVersions: [String: String],
        token: String
    ) async throws -> [String: String] {
        requests.append("PUT")
        putPayloads.append(readVersions)
        return try await withCheckedThrowingContinuation { continuation in
            pending.append(Pending(method: "PUT", continuation: continuation))
        }
    }

    func requestCount(method: String) -> Int {
        requests.filter { $0 == method }.count
    }

    func lastPut() -> [String: String]? { putPayloads.last }

    func resolveNext(method: String, values: [String: String]) throws {
        guard let index = pending.firstIndex(where: { $0.method == method }) else {
            throw MobileAPIError.invalidRequest
        }
        pending.remove(at: index).continuation.resume(returning: values)
    }
}
