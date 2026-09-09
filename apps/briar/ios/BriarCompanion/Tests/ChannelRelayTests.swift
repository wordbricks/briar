import BriarContracts
import BriarContractsMocks
import Foundation
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

/// The Agent-to-Agent round trip as the companion reads it: the two relay ends
/// in a person's own conversation, and the read-only conversation they link to,
/// which is deliberately absent from the catalog.
@MainActor
final class ChannelRelayTests: XCTestCase {
    private let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private let originChannelID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    private let peerChannelID = UUID(uuidString: "12341234-1234-4234-8234-123412341234")!
    private let messageID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
    private let peerMessageID = UUID(uuidString: "66666666-6666-4666-8666-666666666666")!
    private let agentID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
    private let peerAgentID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!

    func testOutboundRelayMapsEveryRoundTripStatus() throws {
        for (wire, expected) in [
            (BriarAPI_ChannelMessageRelay.Status.pending, ChannelMessage.Relay.Status.pending),
            (.completed, .completed),
            (.failed, .failed),
        ] {
            let mapped = try ChannelMessage(
                connectMessage: wireMessage(
                    body: "지금 확인해줘",
                    relay: wireRelay(direction: .outbound, status: wire)
                )
            )
            let relay = try XCTUnwrap(mapped.relay)
            XCTAssertEqual(relay.direction, .outbound)
            XCTAssertEqual(relay.status, expected)
            XCTAssertEqual(relay.peerChannelId, peerChannelID)
            XCTAssertEqual(relay.peerMessageId, peerMessageID)
            XCTAssertEqual(relay.peerAgentId, peerAgentID.uuidString.lowercased())
            XCTAssertEqual(relay.peerAgentName, "Bosco")
            XCTAssertEqual(relay.peerAgentImage, "https://briar.example/bosco.png")
        }
    }

    func testInboundRelayKeepsItsAgentAuthorAndCompletedStatus() throws {
        let mapped = try ChannelMessage(
            connectMessage: wireMessage(
                body: "확인 끝. 새 알림 없음",
                relay: wireRelay(direction: .inbound, status: .completed)
            )
        )
        XCTAssertEqual(mapped.author.type, .agent)
        XCTAssertEqual(mapped.relay?.direction, .inbound)
        XCTAssertEqual(mapped.relay?.status, .completed)
    }

    func testMessageWithoutRelayMapsToNil() throws {
        var message = wireMessage(body: "그냥 답글", relay: nil)
        message.clearRelay()
        XCTAssertNil(try ChannelMessage(connectMessage: message).relay)
    }

    func testUnspecifiedRelayEnumsAndBlankPeerAgentFailClosed() {
        var unspecifiedDirection = wireRelay(direction: .outbound, status: .pending)
        unspecifiedDirection.direction = .unspecified
        XCTAssertThrowsError(
            try ChannelMessage.Relay(connectMessage: unspecifiedDirection)
        ) { error in
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }

        var unspecifiedStatus = wireRelay(direction: .outbound, status: .pending)
        unspecifiedStatus.status = .unspecified
        XCTAssertThrowsError(
            try ChannelMessage.Relay(connectMessage: unspecifiedStatus)
        ) { error in
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }

        var blankAgent = wireRelay(direction: .inbound, status: .completed)
        blankAgent.peerAgentName = ""
        XCTAssertThrowsError(try ChannelMessage.Relay(connectMessage: blankAgent)) { error in
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }

        var malformedPeerChannel = wireRelay(direction: .inbound, status: .completed)
        malformedPeerChannel.peerChannelID = "not-a-uuid"
        XCTAssertThrowsError(
            try ChannelMessage.Relay(connectMessage: malformedPeerChannel)
        ) { error in
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }
    }

    func testChannelSummaryCarriesTheReadOnlyMark() throws {
        XCTAssertTrue(
            try ChannelSummary(connectMessage: wireAgentConversation()).readOnly
        )
        var ordinary = wireAgentConversation()
        ordinary.readOnly = false
        XCTAssertFalse(try ChannelSummary(connectMessage: ordinary).readOnly)
    }

    func testRelayRowLabelsMatchTheDesktopWording() {
        XCTAssertEqual(
            ChannelRelayPresentation.sentTo("Bosco", locale: .ko),
            "메시지 보냄 → Bosco"
        )
        XCTAssertEqual(
            ChannelRelayPresentation.pending("Bosco", locale: .ko),
            "Bosco가 확인 중"
        )
        XCTAssertEqual(
            ChannelRelayPresentation.failed("Bosco", locale: .ko),
            "Bosco에게 메시지를 전달하지 못했습니다."
        )
        XCTAssertEqual(
            ChannelRelayPresentation.from("Bosco", locale: .ko),
            "보낸 사람 Bosco"
        )
        XCTAssertEqual(
            ChannelRelayPresentation.open("Bosco", locale: .en),
            "Open the agent conversation with Bosco"
        )
        XCTAssertEqual(
            L10n.text(.dmAgentConversationReadOnly, locale: .ko),
            "에이전트 간 대화 · 읽기 전용"
        )
        XCTAssertEqual(
            L10n.text(.dmAgentConversationBack, locale: .ko),
            "돌아가기"
        )
        XCTAssertEqual(
            L10n.text(.agentConversationsEmpty, locale: .ko),
            "아직 다른 에이전트와 나눈 대화가 없습니다."
        )
    }

    func testRelayRowIdentifiersNameTheirDirectionAndMessage() {
        XCTAssertEqual(
            ChannelRelayPresentation.identifier(direction: .outbound, messageID: messageID),
            "dm-relay-outbound-\(messageID.uuidString.lowercased())"
        )
        XCTAssertEqual(
            ChannelRelayPresentation.identifier(direction: .inbound, messageID: messageID),
            "dm-relay-inbound-\(messageID.uuidString.lowercased())"
        )
    }

    func testOpeningAgentConversationKeepsItOutOfTheCatalogAndUnread() async throws {
        let scenario = AgentConversationScenario(
            organizationID: organizationID,
            conversation: wireAgentConversation(),
            messages: [wireMessage(body: "확인 끝", relay: nil)]
        )
        let store = makeStore(scenario: scenario)
        store.select(organizationID: organizationID, token: "token")
        await waitUntil { scenario.listChannelsCalls > 0 }

        let conversation = await store.loadAgentConversation(peerChannelID)
        XCTAssertEqual(conversation?.id, peerChannelID)
        XCTAssertEqual(conversation?.readOnly, true)
        XCTAssertEqual(store.openAgentConversation?.id, peerChannelID)

        await store.openChannel(peerChannelID)
        XCTAssertEqual(store.messages.map(\.id), [messageID])
        // The catalog never learns about it, so the direct message list and its
        // unread badge stay exactly as they were.
        XCTAssertTrue(store.channels.isEmpty)
        XCTAssertEqual(store.openAgentConversation?.id, peerChannelID)
        XCTAssertEqual(scenario.markReadCalls, 0)

        store.closeChannelFocus(channelID: peerChannelID)
        XCTAssertNil(store.openAgentConversation)
        store.applicationDidEnterBackground()
    }

    func testOrdinaryChannelsStillJoinTheCatalogAndAreMarkedRead() async throws {
        var ordinary = wireAgentConversation()
        ordinary.id = originChannelID.uuidString.lowercased()
        ordinary.readOnly = false
        ordinary.hasUnread_p = true
        let scenario = AgentConversationScenario(
            organizationID: organizationID,
            conversation: ordinary,
            messages: []
        )
        let store = makeStore(scenario: scenario)
        store.select(organizationID: organizationID, token: "token")
        await waitUntil { scenario.listChannelsCalls > 0 }

        let adopted = await store.loadAgentConversation(originChannelID)
        XCTAssertNil(adopted)
        XCTAssertNil(store.openAgentConversation)

        await store.openChannel(originChannelID)
        XCTAssertEqual(store.channels.map(\.id), [originChannelID])
        XCTAssertEqual(scenario.markReadCalls, 1)
        store.applicationDidEnterBackground()
    }

    func testAgentDirectMessagesListReturnsTheReadOnlyConversations() async throws {
        let scenario = AgentConversationScenario(
            organizationID: organizationID,
            conversation: wireAgentConversation(),
            messages: []
        )
        let store = makeStore(scenario: scenario)
        store.select(organizationID: organizationID, token: "token")
        await waitUntil { scenario.listChannelsCalls > 0 }

        let conversations = try await store.listAgentDirectMessages(agentID: agentID)
        XCTAssertEqual(conversations.map(\.id), [peerChannelID])
        XCTAssertEqual(conversations.first?.readOnly, true)
        XCTAssertEqual(scenario.listAgentDirectMessagesAgentIDs, [
            agentID.uuidString.lowercased(),
        ])
        // Reading the list must not smuggle the conversation into the catalog.
        XCTAssertTrue(store.channels.isEmpty)
        store.applicationDidEnterBackground()
    }

    func testAgentConversationPollsWhileItIsTheOpenConversation() {
        XCTAssertEqual(ChannelsStore.agentConversationPollInterval, .seconds(3))
    }

    private func makeStore(scenario: AgentConversationScenario) -> ChannelsStore {
        ChannelsStore(
            api: AgentConversationHTTPStub(),
            preparedUploadClient: AgentConversationHTTPStub(),
            channelService: scenario.service(),
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            dmMemoryService: BriarAPI_DmMemoryServiceClientMock(),
            managesRealtime: false,
            pollInterval: .seconds(3_600)
        )
    }

    private func wireAgentConversation() -> BriarAPI_ChannelSummary {
        var author = BriarAPI_DirectMessageParticipant()
        author.kind = .agent
        author.id = agentID.uuidString.lowercased()
        author.name = "Honey"
        var peer = BriarAPI_DirectMessageParticipant()
        peer.kind = .agent
        peer.id = peerAgentID.uuidString.lowercased()
        peer.name = "Bosco"

        var summary = BriarAPI_ChannelSummary()
        summary.id = peerChannelID.uuidString.lowercased()
        summary.workspaceID = organizationID.uuidString.lowercased()
        summary.slug = "agents-honey-bosco"
        summary.name = "Honey · Bosco"
        summary.visibility = .private
        summary.memberCount = 0
        summary.agentCount = 2
        summary.kind = .directMessage
        summary.hasUnread_p = false
        summary.readOnly = true
        summary.lastMessagePreview = "확인 끝. 새 알림 없음"
        summary.directMessageParticipants = [author, peer]
        summary.createdAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_775_260_800)
        )
        summary.updatedAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_775_260_800)
        )
        return summary
    }

    private func wireRelay(
        direction: BriarAPI_ChannelMessageRelay.Direction,
        status: BriarAPI_ChannelMessageRelay.Status
    ) -> BriarAPI_ChannelMessageRelay {
        var relay = BriarAPI_ChannelMessageRelay()
        relay.direction = direction
        relay.status = status
        relay.peerChannelID = peerChannelID.uuidString.lowercased()
        relay.peerMessageID = peerMessageID.uuidString.lowercased()
        relay.peerAgentID = peerAgentID.uuidString.lowercased()
        relay.peerAgentName = "Bosco"
        relay.peerAgentImage = "https://briar.example/bosco.png"
        return relay
    }

    private func wireMessage(
        body: String,
        relay: BriarAPI_ChannelMessageRelay?
    ) -> BriarAPI_ChannelMessage {
        var agentAuthor = BriarAPI_ChannelMessageAgentAuthor()
        agentAuthor.id = peerAgentID.uuidString.lowercased()
        agentAuthor.name = "Bosco"
        agentAuthor.provider = .codex
        var author = BriarAPI_ChannelMessageAuthor()
        author.agent = agentAuthor

        var message = BriarAPI_ChannelMessage()
        message.id = messageID.uuidString.lowercased()
        message.channelID = peerChannelID.uuidString.lowercased()
        message.body = body
        message.author = author
        if let relay { message.relay = relay }
        message.createdAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_775_260_800)
        )
        return message
    }

    private func waitUntil(
        _ predicate: @escaping @MainActor () -> Bool
    ) async {
        for _ in 0 ..< 200 where !predicate() {
            await Task.yield()
        }
        XCTAssertTrue(predicate())
    }
}

private struct AgentConversationHTTPStub:
    AuthenticatedDownloadClientProtocol,
    PreparedUploadClientProtocol,
    Sendable {
    func putPreparedUpload(
        _: URL,
        capability _: String,
        contentType _: String,
        data _: Data
    ) async throws {
        throw MobileAPIError.invalidRequest
    }

    func download(_: String, token _: String, to _: URL) async throws -> URL {
        throw MobileAPIError.invalidDownload
    }
}

private final class AgentConversationScenario: @unchecked Sendable {
    private let lock = NSLock()
    private let organizationID: UUID
    private let conversation: BriarAPI_ChannelSummary
    private let messages: [BriarAPI_ChannelMessage]
    private var recordedListChannelsCalls = 0
    private var recordedMarkReadCalls = 0
    private var recordedListAgentDirectMessagesAgentIDs: [String] = []

    init(
        organizationID: UUID,
        conversation: BriarAPI_ChannelSummary,
        messages: [BriarAPI_ChannelMessage]
    ) {
        self.organizationID = organizationID
        self.conversation = conversation
        self.messages = messages
    }

    var listChannelsCalls: Int {
        lock.lock()
        defer { lock.unlock() }
        return recordedListChannelsCalls
    }

    var markReadCalls: Int {
        lock.lock()
        defer { lock.unlock() }
        return recordedMarkReadCalls
    }

    var listAgentDirectMessagesAgentIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedListAgentDirectMessagesAgentIDs
    }

    func service() -> BriarAPI_ChannelServiceClientMock {
        let service = BriarAPI_ChannelServiceClientMock()
        service.mockAsyncListChannels = { [self] _ in
            lock.lock()
            recordedListChannelsCalls += 1
            lock.unlock()
            // The catalog never lists an Agent-to-Agent conversation.
            var response = BriarAPI_ListChannelsResponse()
            response.cursor = 10
            return .init(result: .success(response))
        }
        service.mockAsyncSyncChannels = { _ in
            var response = BriarAPI_SyncChannelsResponse()
            response.cursor = 10
            return .init(result: .success(response))
        }
        service.mockAsyncGetChannel = { [self] request in
            precondition(request.channelID == conversation.id)
            var response = BriarAPI_GetChannelResponse()
            response.channel = conversation
            response.messages = messages
            return .init(result: .success(response))
        }
        service.mockAsyncListChannelMessages = { [self] _ in
            var response = BriarAPI_ListChannelMessagesResponse()
            response.messages = messages
            return .init(result: .success(response))
        }
        service.mockAsyncMarkChannelRead = { [self] _ in
            lock.lock()
            recordedMarkReadCalls += 1
            lock.unlock()
            var response = BriarAPI_MarkChannelReadResponse()
            var read = conversation
            read.hasUnread_p = false
            response.channel = read
            return .init(result: .success(response))
        }
        service.mockAsyncListAgentDirectMessages = { [self] request in
            lock.lock()
            recordedListAgentDirectMessagesAgentIDs.append(request.agentID)
            lock.unlock()
            var response = BriarAPI_ListAgentDirectMessagesResponse()
            response.channels = [conversation]
            return .init(result: .success(response))
        }
        return service
    }
}
