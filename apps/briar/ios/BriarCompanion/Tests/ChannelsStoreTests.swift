import BriarContracts
import Foundation
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

@MainActor
final class ChannelsStoreTests: XCTestCase {
    private let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private let channelID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    private let agentID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!

    func testComplexBatchProposalMapsFromGeneratedOneof() throws {
        let messageID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        let proposalID = UUID(uuidString: "66666666-6666-4666-8666-666666666666")!
        let resultRunID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!

        var issue = BriarAPI_ChannelIssueProposal()
        issue.title = "Ship native Connect"
        issue.description_p = "Use the generated descriptor contract."
        issue.priority = 1
        issue.status = .backlog

        var item = BriarAPI_ChannelIssueBatchProposalItem()
        item.key = "ios"
        item.issue = issue

        var dependency = BriarAPI_ChannelIssueBatchProposalDependency()
        dependency.prerequisiteKey = "contract"
        dependency.dependentKey = "ios"

        var batch = BriarAPI_ChannelIssueBatchProposalPayload()
        batch.items = [item]
        batch.dependencies = [dependency]

        var result = BriarAPI_ChannelIssueBatchResultItem()
        result.localKey = "ios"
        result.runID = resultRunID.uuidString.lowercased()

        var proposal = BriarAPI_ChannelProposal()
        proposal.id = proposalID.uuidString.lowercased()
        proposal.status = .accepted
        proposal.payload = .batch(batch)
        proposal.resultItems = [result]

        var author = BriarAPI_ChannelMessageAuthor()
        author.kind = .agent
        author.id = agentID.uuidString.lowercased()
        author.name = "Honey"
        author.provider = .codex

        var wireMessage = BriarAPI_ChannelMessage()
        wireMessage.id = messageID.uuidString.lowercased()
        wireMessage.channelID = channelID.uuidString.lowercased()
        wireMessage.body = "I prepared a batch."
        wireMessage.author = author
        wireMessage.proposal = proposal
        wireMessage.createdAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_775_260_800)
        )

        let mapped = try ChannelMessage(connectMessage: wireMessage)

        XCTAssertEqual(mapped.id, messageID)
        XCTAssertEqual(mapped.author.type, .agent)
        XCTAssertEqual(mapped.author.provider, "codex")
        XCTAssertEqual(mapped.proposal?.actionType, .createIssue)
        XCTAssertEqual(mapped.proposal?.status, .accepted)
        XCTAssertEqual(mapped.proposal?.payload?.batch?.items.first?.key, "ios")
        XCTAssertEqual(mapped.proposal?.payload?.batch?.items.first?.issue.priority, 1)
        XCTAssertEqual(
            mapped.proposal?.payload?.batch?.dependencies.first?.prerequisiteKey,
            "contract"
        )
        XCTAssertEqual(mapped.proposal?.resultItems.first?.runId, resultRunID)
    }

    func testResetReplacesStateAndKeepsTerminalReplyTombstone() async throws {
        let oldMessageID = UUID(uuidString: "88888888-8888-4888-8888-888888888888")!
        let replacementMessageID = UUID(
            uuidString: "99999999-9999-4999-8999-999999999999"
        )!
        let replyID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let rootID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let channel = summary()
        let completed = agentReply(
            id: replyID,
            rootID: rootID,
            status: .completed,
            attempts: 2
        )
        let staleRunning = agentReply(
            id: replyID,
            rootID: rootID,
            status: .running,
            attempts: 1
        )
        let api = ChannelStoreAPI(
            channel: channel,
            initialMessages: [message(id: oldMessageID, body: "stale")],
            syncResponses: [
                ChannelDeltaResponse(
                    cursor: 1,
                    hasMore: false,
                    reset: true,
                    channels: [channel],
                    removedChannelIds: [],
                    messages: [message(id: replacementMessageID, body: "authoritative")],
                    removedMessageIds: [],
                    agentReplies: [completed]
                ),
                ChannelDeltaResponse(
                    cursor: 2,
                    hasMore: false,
                    channels: [],
                    removedChannelIds: [],
                    messages: [],
                    removedMessageIds: [],
                    agentReplies: [staleRunning]
                ),
            ]
        )
        let store = ChannelsStore(
            api: api,
            managesRealtime: false,
            pollInterval: .seconds(3_600)
        )

        store.select(organizationID: organizationID, token: "token")
        await waitUntil { !store.channels.isEmpty }
        await store.openChannel(channelID)
        XCTAssertEqual(store.messages.map(\.id), [oldMessageID])

        await store.refreshChanges()
        XCTAssertEqual(store.messages.map(\.id), [replacementMessageID])
        XCTAssertEqual(store.messages.first?.body, "authoritative")
        XCTAssertEqual(store.agentReplies, [completed])

        await store.refreshChanges()
        XCTAssertEqual(store.agentReplies, [completed])
        store.applicationDidEnterBackground()
    }

    func testMessageSendUsesConnectWithoutBytesAndMultipartWithBytes() async throws {
        let channel = summary()
        let api = ChannelStoreAPI(channel: channel, initialMessages: [])
        let store = ChannelsStore(
            api: api,
            managesRealtime: false,
            pollInterval: .seconds(3_600),
            attachmentReference: { "new-upload-ref" }
        )

        store.select(organizationID: organizationID, token: "token")
        await waitUntil { !store.channels.isEmpty }
        await store.openChannel(channelID)

        await store.send(
            channelID: channelID,
            parentMessageID: nil,
            body: "reuse attachment",
            mentions: [],
            attachmentReferences: ["existing-ref"]
        )
        let connectCalls = await api.connectMessageCalls()
        let uploadCountAfterConnect = await api.multipartUploadCount()
        XCTAssertEqual(connectCalls.count, 1)
        XCTAssertEqual(connectCalls.first?.attachmentReferences, ["existing-ref"])
        XCTAssertEqual(uploadCountAfterConnect, 0)

        await store.send(
            channelID: channelID,
            parentMessageID: nil,
            body: "upload image",
            mentions: [],
            attachments: [PendingIssueAttachment(
                filename: "pixel.png",
                contentType: "image/png",
                data: Data([0x89, 0x50, 0x4e, 0x47])
            )],
            attachmentReferences: ["existing-upload-ref"]
        )
        let finalConnectCalls = await api.connectMessageCalls()
        let finalUploadCount = await api.multipartUploadCount()
        let uploadReferences = await api.multipartAttachmentReferences()
        XCTAssertEqual(finalConnectCalls.count, 1)
        XCTAssertEqual(finalUploadCount, 1)
        XCTAssertEqual(uploadReferences, [["new-upload-ref"]])
        store.applicationDidEnterBackground()
    }

    private func summary() -> ChannelSummary {
        ChannelSummary(
            id: channelID,
            organizationId: organizationID,
            slug: "native",
            name: "native",
            topic: nil,
            visibility: .org,
            defaultProjectId: nil,
            archivedAt: nil,
            memberCount: 1,
            agentCount: 1,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800),
            updatedAt: Date(timeIntervalSince1970: 1_775_260_800),
            kind: .channel,
            hasUnread: false
        )
    }

    private func message(id: UUID, body: String) -> ChannelMessage {
        ChannelMessage(
            id: id,
            channelId: channelID,
            parentMessageId: nil,
            body: body,
            author: .init(type: .user, name: "Briar User", image: nil, provider: nil),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800)
        )
    }

    private func agentReply(
        id: UUID,
        rootID: UUID,
        status: ChannelAgentReply.Status,
        attempts: Int
    ) -> ChannelAgentReply {
        ChannelAgentReply(
            id: id,
            agentId: agentID,
            channelId: channelID,
            triggerMessageId: rootID,
            parentMessageId: rootID,
            replyMessageId: rootID,
            status: status,
            attempts: attempts,
            error: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800),
            updatedAt: Date(timeIntervalSince1970: 1_775_260_900)
        )
    }

    private func waitUntil(
        _ predicate: @escaping @MainActor () -> Bool
    ) async {
        for _ in 0 ..< 100 where !predicate() {
            await Task.yield()
        }
        XCTAssertTrue(predicate())
    }
}

private actor ChannelStoreAPI: MobileAPIClientProtocol {
    struct ConnectMessageCall: Sendable {
        let attachmentReferences: [String]
    }

    private let channel: ChannelSummary
    private let initialMessages: [ChannelMessage]
    private var queuedSyncResponses: [ChannelDeltaResponse]
    private var connectCalls: [ConnectMessageCall] = []
    private var uploadCount = 0
    private var uploadReferences: [[String]] = []

    init(
        channel: ChannelSummary,
        initialMessages: [ChannelMessage],
        syncResponses: [ChannelDeltaResponse] = []
    ) {
        self.channel = channel
        self.initialMessages = initialMessages
        queuedSyncResponses = syncResponses
    }

    func connectMessageCalls() -> [ConnectMessageCall] { connectCalls }
    func multipartUploadCount() -> Int { uploadCount }
    func multipartAttachmentReferences() -> [[String]] { uploadReferences }

    func listChannels(
        organizationID: UUID,
        token: String
    ) async throws -> ChannelsResponse {
        ChannelsResponse(channels: [channel], cursor: 10)
    }

    func syncChannels(
        organizationID: UUID,
        cursor: Int,
        token: String
    ) async throws -> ChannelDeltaResponse {
        guard !queuedSyncResponses.isEmpty else { throw MobileAPIError.invalidResponse }
        return queuedSyncResponses.removeFirst()
    }

    func getChannel(
        organizationID: UUID,
        channelID: UUID,
        messageLimit: Int?,
        token: String
    ) async throws -> ChannelDetailResponse {
        ChannelDetailResponse(
            channel: channel,
            members: [],
            agents: [],
            messages: initialMessages
        )
    }

    func markChannelRead(
        organizationID: UUID,
        channelID: UUID,
        lastReadAt: Date?,
        token: String
    ) async throws -> ChannelSummary {
        channel
    }

    func createChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [UUID],
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateChannelMessageResponse {
        connectCalls.append(ConnectMessageCall(
            attachmentReferences: attachmentReferences
        ))
        return CreateChannelMessageResponse(message: ChannelMessage(
            id: clientMessageID,
            channelId: channelID,
            parentMessageId: parentMessageID,
            body: body,
            author: .init(type: .user, name: "Briar User", image: nil, provider: nil),
            mentionedUserIds: mentionedUserIDs,
            mentionedAgentIds: mentionedAgentIDs,
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800)
        ))
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        uploadCount += 1
        uploadReferences.append(try JSONDecoder().decode(
            [String].self,
            from: Data((fields["attachmentReferences"] ?? "[]").utf8)
        ))
        let response = CreateChannelMessageResponse(message: ChannelMessage(
            id: UUID(uuidString: fields["clientMessageId"] ?? "") ?? UUID(),
            channelId: channel.id,
            parentMessageId: nil,
            body: fields["body"] ?? "",
            author: .init(type: .user, name: "Briar User", image: nil, provider: nil),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800)
        ))
        guard let typed = response as? Response else { throw MobileAPIError.invalidResponse }
        return typed
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }
}
