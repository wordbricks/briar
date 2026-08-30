import BriarContracts
import BriarContractsMocks
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
        let api = ChannelHTTPRecorder(channel: channel)
        let scenario = ChannelConnectScenario(
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
        let channelService = scenario.service()
        let store = ChannelsStore(
            api: api,
            channelService: channelService,
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
        let api = ChannelHTTPRecorder(channel: channel)
        let scenario = ChannelConnectScenario(channel: channel, initialMessages: [])
        let store = ChannelsStore(
            api: api,
            channelService: scenario.service(),
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
        let connectCalls = scenario.connectMessageCalls
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
        let finalConnectCalls = scenario.connectMessageCalls
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

private actor ChannelHTTPRecorder: MobileHTTPClientProtocol {
    private let channel: ChannelSummary
    private var uploadCount = 0
    private var uploadReferences: [[String]] = []

    init(channel: ChannelSummary) {
        self.channel = channel
    }

    func multipartUploadCount() -> Int { uploadCount }
    func multipartAttachmentReferences() -> [[String]] { uploadReferences }

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

private final class ChannelConnectScenario: @unchecked Sendable {
    struct ConnectMessageCall: Sendable {
        let attachmentReferences: [String]
    }

    private let lock = NSLock()
    private let channel: ChannelSummary
    private let initialMessages: [ChannelMessage]
    private var queuedSyncResponses: [ChannelDeltaResponse]
    private var recordedConnectCalls: [ConnectMessageCall] = []

    init(
        channel: ChannelSummary,
        initialMessages: [ChannelMessage],
        syncResponses: [ChannelDeltaResponse] = []
    ) {
        self.channel = channel
        self.initialMessages = initialMessages
        queuedSyncResponses = syncResponses
    }

    var connectMessageCalls: [ConnectMessageCall] {
        lock.lock()
        defer { lock.unlock() }
        return recordedConnectCalls
    }

    func service() -> BriarAPI_ChannelServiceClientMock {
        let service = BriarAPI_ChannelServiceClientMock()
        service.mockAsyncListChannels = { [self] request in
            .init(result: .success(listChannels(request)))
        }
        service.mockAsyncSyncChannels = { [self] request in
            .init(result: .success(syncChannels(request)))
        }
        service.mockAsyncGetChannel = { [self] request in
            .init(result: .success(getChannel(request)))
        }
        service.mockAsyncMarkChannelRead = { [self] request in
            .init(result: .success(markChannelRead(request)))
        }
        service.mockAsyncCreateChannelMessage = { [self] request in
            .init(result: .success(createMessage(request)))
        }
        return service
    }

    private func listChannels(
        _ request: BriarAPI_ListChannelsRequest
    ) -> BriarAPI_ListChannelsResponse {
        precondition(request.organizationID == channel.organizationId.uuidString.lowercased())
        var response = BriarAPI_ListChannelsResponse()
        response.channels = [wireSummary(channel)]
        response.cursor = 10
        return response
    }

    private func syncChannels(
        _ request: BriarAPI_SyncChannelsRequest
    ) -> BriarAPI_SyncChannelsResponse {
        lock.lock()
        defer { lock.unlock() }
        precondition(request.organizationID == channel.organizationId.uuidString.lowercased())
        precondition(!queuedSyncResponses.isEmpty)
        return wireDelta(queuedSyncResponses.removeFirst())
    }

    private func getChannel(
        _ request: BriarAPI_GetChannelRequest
    ) -> BriarAPI_GetChannelResponse {
        precondition(request.channelID == channel.id.uuidString.lowercased())
        var response = BriarAPI_GetChannelResponse()
        response.channel = wireSummary(channel)
        response.messages = initialMessages.map(wireMessage)
        return response
    }

    private func markChannelRead(
        _ request: BriarAPI_MarkChannelReadRequest
    ) -> BriarAPI_MarkChannelReadResponse {
        precondition(request.channelID == channel.id.uuidString.lowercased())
        var response = BriarAPI_MarkChannelReadResponse()
        response.channel = wireSummary(channel)
        return response
    }

    private func createMessage(
        _ request: BriarAPI_CreateChannelMessageRequest
    ) -> BriarAPI_CreateChannelMessageResponse {
        lock.lock()
        defer { lock.unlock() }
        recordedConnectCalls.append(.init(
            attachmentReferences: request.attachmentReferences
        ))
        let message = ChannelMessage(
            id: UUID(uuidString: request.clientMessageID)!,
            channelId: UUID(uuidString: request.channelID)!,
            parentMessageId: request.hasParentMessageID
                ? UUID(uuidString: request.parentMessageID)
                : nil,
            body: request.body,
            author: .init(type: .user, name: "Briar User", image: nil, provider: nil),
            mentionedUserIds: request.mentionedUserIds,
            mentionedAgentIds: request.mentionedAgentIds.compactMap(UUID.init(uuidString:)),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800)
        )
        var response = BriarAPI_CreateChannelMessageResponse()
        response.message = wireMessage(message)
        return response
    }

    private func wireDelta(_ value: ChannelDeltaResponse) -> BriarAPI_SyncChannelsResponse {
        var response = BriarAPI_SyncChannelsResponse()
        response.cursor = UInt64(value.cursor)
        response.hasMore_p = value.hasMore
        response.reset = value.reset
        response.channels = value.channels.map(wireSummary)
        response.removedChannelIds = value.removedChannelIds.map { $0.uuidString.lowercased() }
        response.messages = value.messages.map(wireMessage)
        response.removedMessageIds = value.removedMessageIds.map { $0.uuidString.lowercased() }
        response.agentReplies = (value.agentReplies ?? []).map(wireReply)
        return response
    }

    private func wireSummary(_ value: ChannelSummary) -> BriarAPI_ChannelSummary {
        var message = BriarAPI_ChannelSummary()
        message.id = value.id.uuidString.lowercased()
        message.organizationID = value.organizationId.uuidString.lowercased()
        message.slug = value.slug
        message.name = value.name
        message.visibility = value.visibility == .org ? .public : .private
        message.memberCount = UInt32(value.memberCount)
        message.agentCount = UInt32(value.agentCount)
        message.createdAt = Google_Protobuf_Timestamp(date: value.createdAt)
        message.updatedAt = Google_Protobuf_Timestamp(date: value.updatedAt)
        message.kind = value.kind == .channel ? .channel : .directMessage
        if let hasUnread = value.hasUnread { message.hasUnread_p = hasUnread }
        return message
    }

    private func wireMessage(_ value: ChannelMessage) -> BriarAPI_ChannelMessage {
        var author = BriarAPI_ChannelMessageAuthor()
        author.kind = value.author.type == .user ? .user : .agent
        author.name = value.author.name
        var message = BriarAPI_ChannelMessage()
        message.id = value.id.uuidString.lowercased()
        message.channelID = value.channelId.uuidString.lowercased()
        if let parentMessageID = value.parentMessageId {
            message.parentMessageID = parentMessageID.uuidString.lowercased()
        }
        message.body = value.body
        message.author = author
        message.mentionedUserIds = value.mentionedUserIds
        message.mentionedAgentIds = value.mentionedAgentIds.map { $0.uuidString.lowercased() }
        message.replyCount = UInt32(value.replyCount)
        message.createdAt = Google_Protobuf_Timestamp(date: value.createdAt)
        return message
    }

    private func wireReply(_ value: ChannelAgentReply) -> BriarAPI_ChannelAgentReply {
        var message = BriarAPI_ChannelAgentReply()
        message.id = value.id.uuidString.lowercased()
        message.agentID = value.agentId.uuidString.lowercased()
        message.channelID = value.channelId.uuidString.lowercased()
        message.triggerMessageID = value.triggerMessageId.uuidString.lowercased()
        message.parentMessageID = value.parentMessageId.uuidString.lowercased()
        message.replyMessageID = value.replyMessageId.uuidString.lowercased()
        switch value.status {
        case .queued: message.status = .queued
        case .running: message.status = .running
        case .completed: message.status = .completed
        case .failed: message.status = .failed
        }
        message.attempts = UInt32(value.attempts)
        message.createdAt = Google_Protobuf_Timestamp(date: value.createdAt)
        message.updatedAt = Google_Protobuf_Timestamp(date: value.updatedAt)
        return message
    }
}
