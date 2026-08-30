import BriarContracts
import Connect
import Foundation
import SwiftProtobuf

extension MobileAPIClient {
    func listChannels(
        organizationID: UUID,
        token: String
    ) async throws -> ChannelsResponse {
        var request = BriarAPI_ListChannelsRequest()
        request.organizationID = channelUUIDString(organizationID)
        let message = try channelConnectMessage(await channelService.listChannels(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try ChannelsResponse(connectMessage: message)
    }

    func syncChannels(
        organizationID: UUID,
        cursor: Int,
        token: String
    ) async throws -> ChannelDeltaResponse {
        guard let cursor = UInt64(exactly: cursor) else {
            throw MobileAPIError.invalidRequest
        }
        var request = BriarAPI_SyncChannelsRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.cursor = cursor
        let message = try channelConnectMessage(await channelService.syncChannels(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try ChannelDeltaResponse(connectMessage: message)
    }

    func listDirectMessageRecipients(
        organizationID: UUID,
        token: String
    ) async throws -> DirectMessageRecipients {
        var request = BriarAPI_ListDirectMessageRecipientsRequest()
        request.organizationID = channelUUIDString(organizationID)
        let message = try channelConnectMessage(
            await channelService.listDirectMessageRecipients(
                request: request,
                headers: channelAuthorizationHeaders(token)
            )
        )
        return DirectMessageRecipients(
            members: try message.members.map { try OrganizationMember(connectMessage: $0) },
            agents: try message.agents.map { try ChannelAgentSummary(connectMessage: $0) }
        )
    }

    func createDirectMessage(
        organizationID: UUID,
        memberIDs: [String],
        agentIDs: [UUID],
        token: String
    ) async throws -> ChannelSummary {
        var request = BriarAPI_CreateDirectMessageRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.memberIds = memberIDs
        request.agentIds = agentIDs.map(channelUUIDString)
        let message = try channelConnectMessage(await channelService.createDirectMessage(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        guard message.hasChannel else { throw MobileAPIError.invalidResponse }
        return try ChannelSummary(connectMessage: message.channel)
    }

    func getChannel(
        organizationID: UUID,
        channelID: UUID,
        messageLimit: Int?,
        token: String
    ) async throws -> ChannelDetailResponse {
        var request = BriarAPI_GetChannelRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        if let messageLimit {
            guard let messageLimit = UInt32(exactly: messageLimit) else {
                throw MobileAPIError.invalidRequest
            }
            request.messageLimit = messageLimit
        }
        let message = try channelConnectMessage(await channelService.getChannel(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try ChannelDetailResponse(connectMessage: message)
    }

    func markChannelRead(
        organizationID: UUID,
        channelID: UUID,
        lastReadAt: Date?,
        token: String
    ) async throws -> ChannelSummary {
        var request = BriarAPI_MarkChannelReadRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        if let lastReadAt {
            request.lastReadAt = try channelTimestamp(lastReadAt)
        }
        let message = try channelConnectMessage(await channelService.markChannelRead(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        guard message.hasChannel else { throw MobileAPIError.invalidResponse }
        return try ChannelSummary(connectMessage: message.channel)
    }

    func listChannelMessages(
        organizationID: UUID,
        channelID: UUID,
        parentMessageID: UUID?,
        cursor: UUID?,
        limit: Int?,
        token: String
    ) async throws -> ChannelMessagesResponse {
        var request = BriarAPI_ListChannelMessagesRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        if let parentMessageID { request.parentMessageID = channelUUIDString(parentMessageID) }
        if let cursor { request.cursor = channelUUIDString(cursor) }
        if let limit {
            guard let limit = UInt32(exactly: limit) else {
                throw MobileAPIError.invalidRequest
            }
            request.limit = limit
        }
        let message = try channelConnectMessage(await channelService.listChannelMessages(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try ChannelMessagesResponse(connectMessage: message)
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
        var request = BriarAPI_CreateChannelMessageRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.clientMessageID = channelUUIDString(clientMessageID)
        request.body = body
        if let parentMessageID { request.parentMessageID = channelUUIDString(parentMessageID) }
        request.mentionedUserIds = mentionedUserIDs
        request.mentionedAgentIds = mentionedAgentIDs.map(channelUUIDString)
        request.attachmentReferences = attachmentReferences
        let message = try channelConnectMessage(await channelService.createChannelMessage(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try CreateChannelMessageResponse(connectMessage: message)
    }

    func deleteChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        token: String
    ) async throws -> DeleteChannelMessageResponse {
        var request = BriarAPI_DeleteChannelMessageRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.messageID = channelUUIDString(messageID)
        let message = try channelConnectMessage(await channelService.deleteChannelMessage(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try DeleteChannelMessageResponse(connectMessage: message)
    }

    func toggleChannelMessageReaction(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        emoji: String,
        token: String
    ) async throws -> ToggleChannelMessageReactionResponse {
        var request = BriarAPI_ToggleChannelMessageReactionRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.messageID = channelUUIDString(messageID)
        request.emoji = emoji
        let message = try channelConnectMessage(
            await channelService.toggleChannelMessageReaction(
                request: request,
                headers: channelAuthorizationHeaders(token)
            )
        )
        guard message.hasMessage else { throw MobileAPIError.invalidResponse }
        return ToggleChannelMessageReactionResponse(
            message: try ChannelMessage(connectMessage: message.message)
        )
    }

    func setChannelThreadSubscription(
        organizationID: UUID,
        channelID: UUID,
        rootMessageID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> ChannelThreadSubscriptionResponse {
        var request = BriarAPI_SetChannelThreadSubscriptionRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.rootMessageID = channelUUIDString(rootMessageID)
        request.subscribed = subscribed
        let message = try channelConnectMessage(
            await channelService.setChannelThreadSubscription(
                request: request,
                headers: channelAuthorizationHeaders(token)
            )
        )
        guard let rootMessageID = UUID(uuidString: message.rootMessageID) else {
            throw MobileAPIError.invalidResponse
        }
        return ChannelThreadSubscriptionResponse(
            rootMessageId: rootMessageID,
            subscribers: try message.subscribers.map { try IssueSubscriber(connectMessage: $0) }
        )
    }

    func acceptChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        projectID: UUID?,
        execution: AcceptIssueExecutionProposalRequest?,
        token: String
    ) async throws -> AcceptChannelProposalResponse {
        var request = BriarAPI_AcceptChannelProposalRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.proposalID = channelUUIDString(proposalID)
        if let projectID { request.projectID = channelUUIDString(projectID) }
        if let execution { request.execution = try execution.channelConnectMessage() }
        let message = try channelConnectMessage(await channelService.acceptChannelProposal(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try AcceptChannelProposalResponse(connectMessage: message)
    }

    func acceptChannelExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptChannelExecutionProposalResponse {
        var request = BriarAPI_AcceptChannelExecutionProposalRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.proposalID = channelUUIDString(proposalID)
        request.approval = try approval.channelConnectMessage()
        let message = try channelConnectMessage(
            await channelService.acceptChannelExecutionProposal(
                request: request,
                headers: channelAuthorizationHeaders(token)
            )
        )
        return try AcceptChannelExecutionProposalResponse(connectMessage: message)
    }

    func declineChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> DeclineChannelProposalResponse {
        var request = BriarAPI_DeclineChannelProposalRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.proposalID = channelUUIDString(proposalID)
        let message = try channelConnectMessage(await channelService.declineChannelProposal(
            request: request,
            headers: channelAuthorizationHeaders(token)
        ))
        return try DeclineChannelProposalResponse(connectMessage: message)
    }

    func acceptChannelSkillExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        var request = BriarAPI_AcceptChannelSkillExecutionProposalRequest()
        request.organizationID = channelUUIDString(organizationID)
        request.channelID = channelUUIDString(channelID)
        request.proposalID = channelUUIDString(proposalID)
        if let workerID { request.workerID = workerID }
        let message = try channelConnectMessage(
            await channelService.acceptChannelSkillExecutionProposal(
                request: request,
                headers: channelAuthorizationHeaders(token)
            )
        )
        return try AcceptAgentSkillExecutionProposalResponse(connectMessage: message)
    }
}

extension ChannelsResponse {
    init(connectMessage message: BriarAPI_ListChannelsResponse) throws {
        channels = try message.channels.map { try ChannelSummary(connectMessage: $0) }
        cursor = try channelSafeInt(message.cursor)
    }
}

extension ChannelDeltaResponse {
    init(connectMessage message: BriarAPI_SyncChannelsResponse) throws {
        cursor = try channelSafeInt(message.cursor)
        hasMore = message.hasMore_p
        reset = message.reset
        channels = try message.channels.map { try ChannelSummary(connectMessage: $0) }
        removedChannelIds = try message.removedChannelIds.map(channelUUID)
        messages = try message.messages.map { try ChannelMessage(connectMessage: $0) }
        removedMessageIds = try message.removedMessageIds.map(channelUUID)
        agentReplies = try message.agentReplies.map { try ChannelAgentReply(connectMessage: $0) }
    }
}

extension ChannelDetailResponse {
    init(connectMessage message: BriarAPI_GetChannelResponse) throws {
        guard message.hasChannel else { throw MobileAPIError.invalidResponse }
        channel = try ChannelSummary(connectMessage: message.channel)
        members = try message.members.map { try ChannelMember(connectMessage: $0) }
        agents = try message.agents.map { try ChannelAgentSummary(connectMessage: $0) }
        messages = try message.messages.map { try ChannelMessage(connectMessage: $0) }
        agentReplies = try message.agentReplies.map { try ChannelAgentReply(connectMessage: $0) }
        nextCursor = try channelOptionalUUID(message.nextCursor, present: message.hasNextCursor)
    }
}

extension ChannelMessagesResponse {
    init(connectMessage message: BriarAPI_ListChannelMessagesResponse) throws {
        messages = try message.messages.map { try ChannelMessage(connectMessage: $0) }
        nextCursor = try channelOptionalUUID(message.nextCursor, present: message.hasNextCursor)
    }
}

extension CreateChannelMessageResponse {
    init(connectMessage message: BriarAPI_CreateChannelMessageResponse) throws {
        guard message.hasMessage else { throw MobileAPIError.invalidResponse }
        self.init(
            message: try ChannelMessage(connectMessage: message.message),
            agentReplies: try message.agentReplies.map { try ChannelAgentReply(connectMessage: $0) }
        )
    }
}

extension DeleteChannelMessageResponse {
    init(connectMessage message: BriarAPI_DeleteChannelMessageResponse) throws {
        deleted = message.deleted
        self.message = message.hasMessage
            ? try ChannelMessage(connectMessage: message.message)
            : nil
        parentMessage = message.hasParentMessage
            ? try ChannelMessage(connectMessage: message.parentMessage)
            : nil
    }
}

extension AcceptChannelProposalResponse {
    init(connectMessage message: BriarAPI_AcceptChannelProposalResponse) throws {
        outcome = try AcceptChannelProposalResponse.Outcome(connectValue: message.outcome)
        projectId = try channelUUID(message.projectID)
        resultRunId = try channelUUID(message.resultRunID)
        resultItems = try message.resultItems.map { try ChannelMessage.Proposal.ResultItem(
            localKey: $0.localKey,
            runId: channelUUID($0.runID)
        ) }
        executionProposal = message.hasExecutionProposal
            ? try IssueExecutionProposal(connectMessage: message.executionProposal)
            : nil
        dispatch = message.hasDispatch
            ? try DispatchRunResponse(connectMessage: message.dispatch)
            : nil
    }
}

extension AcceptChannelExecutionProposalResponse {
    init(connectMessage message: BriarAPI_AcceptChannelExecutionProposalResponse) throws {
        guard message.hasProposal, message.hasDispatch else {
            throw MobileAPIError.invalidResponse
        }
        proposal = try IssueExecutionProposal(connectMessage: message.proposal)
        outcome = try Outcome(connectValue: message.outcome)
        projectId = try channelUUID(message.projectID)
        runId = try channelUUID(message.runID)
        dispatch = try DispatchRunResponse(connectMessage: message.dispatch)
    }
}

extension DeclineChannelProposalResponse {
    init(connectMessage message: BriarAPI_DeclineChannelProposalResponse) throws {
        switch message.outcome {
        case .declined: outcome = .declined
        case .alreadyDeclined: outcome = .alreadyDeclined
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

extension AcceptAgentSkillExecutionProposalResponse {
    init(connectMessage message: BriarAPI_AcceptChannelSkillExecutionProposalResponse) throws {
        guard message.hasProposal else { throw MobileAPIError.invalidResponse }
        outcome = try Outcome(connectValue: message.outcome)
        proposal = try AgentSkillExecutionProposal(connectMessage: message.proposal)
        projectId = try channelUUID(message.projectID)
        session = message.hasSession
            ? try ProjectAgentSession(connectMessage: message.session)
            : nil
    }
}

extension ChannelSummary {
    init(connectMessage message: BriarAPI_ChannelSummary) throws {
        let visibility: Visibility
        switch message.visibility {
        case .public: visibility = .org
        case .private: visibility = .restricted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let kind: Kind
        switch message.kind {
        case .channel: kind = .channel
        case .directMessage: kind = .directMessage
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard message.hasCreatedAt, message.hasUpdatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try channelUUID(message.id),
            organizationId: try channelUUID(message.organizationID),
            slug: message.slug,
            name: message.name,
            topic: message.hasTopic ? message.topic : nil,
            visibility: visibility,
            defaultProjectId: try channelOptionalUUID(
                message.defaultProjectID,
                present: message.hasDefaultProjectID
            ),
            archivedAt: try channelOptionalDate(message.archivedAt, present: message.hasArchivedAt),
            memberCount: try channelSafeInt(message.memberCount),
            agentCount: try channelSafeInt(message.agentCount),
            createdAt: try channelDate(message.createdAt),
            updatedAt: try channelDate(message.updatedAt),
            kind: kind,
            lastMessageAt: try channelOptionalDate(
                message.lastMessageAt,
                present: message.hasLastMessageAt
            ),
            lastMessagePreview: message.hasLastMessagePreview ? message.lastMessagePreview : nil,
            lastReadAt: try channelOptionalDate(message.lastReadAt, present: message.hasLastReadAt),
            hasUnread: message.hasUnread_p,
            dmParticipants: try message.directMessageParticipants.map {
                try DirectMessageParticipant(connectMessage: $0)
            }
        )
    }
}

extension DirectMessageParticipant {
    init(connectMessage message: BriarAPI_DirectMessageParticipant) throws {
        let type: Kind
        switch message.kind {
        case .user: type = .user
        case .agent: type = .agent
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard !message.id.isEmpty, !message.name.isEmpty else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            type: type,
            id: message.id,
            name: message.name,
            image: message.hasImage ? message.image : nil
        )
    }
}

extension OrganizationMember {
    init(connectMessage message: BriarAPI_OrganizationMember) throws {
        guard !message.userID.isEmpty, message.hasCreatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            userId: message.userID,
            name: message.name,
            email: message.email,
            image: message.hasImage ? message.image : nil,
            role: try channelRole(message.role),
            createdAt: try channelDate(message.createdAt)
        )
    }
}

extension ChannelMember {
    init(connectMessage message: BriarAPI_ChannelMember) throws {
        guard !message.userID.isEmpty, message.hasCreatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            userId: message.userID,
            name: message.name,
            email: message.email,
            image: message.hasImage ? message.image : nil,
            role: message.role,
            createdAt: try channelDate(message.createdAt)
        )
    }
}

extension ChannelAgentReply {
    init(connectMessage message: BriarAPI_ChannelAgentReply) throws {
        let status: Status
        switch message.status {
        case .queued: status = .queued
        case .running: status = .running
        case .completed: status = .completed
        case .failed: status = .failed
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard message.hasCreatedAt, message.hasUpdatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try channelUUID(message.id),
            agentId: try channelUUID(message.agentID),
            channelId: try channelUUID(message.channelID),
            triggerMessageId: try channelUUID(message.triggerMessageID),
            parentMessageId: try channelUUID(message.parentMessageID),
            replyMessageId: try channelUUID(message.replyMessageID),
            status: status,
            attempts: try channelSafeInt(message.attempts),
            error: message.hasError ? message.error : nil,
            createdAt: try channelDate(message.createdAt),
            updatedAt: try channelDate(message.updatedAt)
        )
    }
}

extension ChannelMessage {
    init(connectMessage message: BriarAPI_ChannelMessage) throws {
        guard message.hasAuthor, message.hasCreatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try channelUUID(message.id),
            channelId: try channelUUID(message.channelID),
            parentMessageId: try channelOptionalUUID(
                message.parentMessageID,
                present: message.hasParentMessageID
            ),
            body: message.body,
            blocks: message.blocks.isEmpty
                ? nil
                : try message.blocks.map { try ChannelMessageBlock(connectMessage: $0) },
            author: try Author(connectMessage: message.author),
            mentionedUserIds: message.mentionedUserIds,
            mentionedAgentIds: try message.mentionedAgentIds.map(channelUUID),
            attachments: try message.attachments.map {
                try ChannelMessageAttachment(connectMessage: $0)
            },
            reactions: try message.reactions.map { try ChannelMessageReaction(connectMessage: $0) },
            replyCount: try channelSafeInt(message.replyCount),
            lastReplyAt: try channelOptionalDate(message.lastReplyAt, present: message.hasLastReplyAt),
            replyAuthors: try message.replyAuthors.map { try Author(connectMessage: $0) },
            document: message.hasDocument ? try Document(connectMessage: message.document) : nil,
            proposal: message.hasProposal ? try Proposal(connectMessage: message.proposal) : nil,
            executionProposal: message.hasExecutionProposal
                ? try IssueExecutionProposal(connectMessage: message.executionProposal)
                : nil,
            skillExecutionProposal: message.hasSkillExecutionProposal
                ? try AgentSkillExecutionProposal(connectMessage: message.skillExecutionProposal)
                : nil,
            subscribers: try message.subscribers.map { try IssueSubscriber(connectMessage: $0) },
            createdAt: try channelDate(message.createdAt),
            deletedAt: try channelOptionalDate(message.deletedAt, present: message.hasDeletedAt)
        )
    }
}

extension ChannelMessage.Author {
    init(connectMessage message: BriarAPI_ChannelMessageAuthor) throws {
        let type: Kind
        switch message.kind {
        case .user: type = .user
        case .agent: type = .agent
        case .webhook: type = .webhook
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            type: type,
            name: message.name,
            image: message.hasImage ? message.image : nil,
            provider: message.hasProvider
                ? try channelProvider(message.provider).rawValue
                : nil,
            id: message.hasID ? message.id : nil
        )
    }
}

extension ChannelMessage.Document {
    init(connectMessage message: BriarAPI_ChannelDocument) throws {
        self.init(
            messageId: try channelUUID(message.messageID),
            title: message.title,
            projectId: try channelOptionalUUID(message.projectID, present: message.hasProjectID)
        )
    }
}

extension ChannelMessage.Proposal {
    init(connectMessage message: BriarAPI_ChannelProposal) throws {
        let status: Status
        switch message.status {
        case .pending: status = .pending
        case .accepted: status = .accepted
        case .declined: status = .declined
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let payload: Payload
        switch message.payload {
        case .issue(let issue):
            guard issue.hasIssue else { throw MobileAPIError.invalidResponse }
            payload = Payload(
                issue: try Payload.Issue(connectMessage: issue.issue),
                executeAfterCreate: issue.executeAfterCreate
            )
        case .batch(let batch):
            payload = Payload(batch: try Payload.Batch(connectMessage: batch))
        case nil:
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try channelUUID(message.id),
            actionType: .createIssue,
            status: status,
            projectId: try channelOptionalUUID(message.projectID, present: message.hasProjectID),
            payload: payload,
            resultRunId: try channelOptionalUUID(message.resultRunID, present: message.hasResultRunID),
            resultItems: try message.resultItems.map { try ResultItem(
                localKey: $0.localKey,
                runId: channelUUID($0.runID)
            ) }
        )
    }
}

extension ChannelMessage.Proposal.Payload.Issue {
    init(connectMessage message: BriarAPI_ChannelIssueProposal) throws {
        let title = message.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 300 else {
            throw MobileAPIError.invalidResponse
        }
        let description = message.hasDescription_p
            ? message.description_p.trimmingCharacters(in: .whitespacesAndNewlines)
            : nil
        guard description?.count ?? 0 <= 100_000 else {
            throw MobileAPIError.invalidResponse
        }
        let priority = message.hasPriority ? try channelSafeInt(message.priority) : nil
        guard priority.map({ (1 ... 4).contains($0) }) ?? true else {
            throw MobileAPIError.invalidResponse
        }
        let status: IssueStatus
        switch message.status {
        case .backlog: status = .backlog
        case .queued: status = .queued
        case .unspecified, .running, .paused, .blocked, .failed, .completed, .cancelled,
             .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        self.init(title: title, description: description, priority: priority, status: status)
    }
}

extension ChannelMessage.Proposal.Payload.Batch {
    init(connectMessage message: BriarAPI_ChannelIssueBatchProposalPayload) throws {
        items = try message.items.map {
            guard $0.hasIssue, !$0.key.isEmpty else { throw MobileAPIError.invalidResponse }
            return Item(key: $0.key, issue: try .init(connectMessage: $0.issue))
        }
        dependencies = try message.dependencies.map {
            guard !$0.prerequisiteKey.isEmpty, !$0.dependentKey.isEmpty else {
                throw MobileAPIError.invalidResponse
            }
            return Dependency(
                prerequisiteKey: $0.prerequisiteKey,
                dependentKey: $0.dependentKey
            )
        }
    }
}

extension ChannelMessageAttachment {
    init(connectMessage message: BriarAPI_IssueAttachment) throws {
        self.init(
            id: try channelUUID(message.id),
            filename: message.filename,
            contentType: message.contentType,
            byteSize: try channelSafeInt(message.byteSize),
            url: message.url
        )
    }
}

extension ChannelMessageReaction {
    init(connectMessage message: BriarAPI_ChannelMessageReaction) throws {
        self.init(
            emoji: message.emoji,
            count: try channelSafeInt(message.count),
            userIds: message.userIds
        )
    }
}

extension IssueSubscriber {
    init(connectMessage message: BriarAPI_IssueSubscriber) throws {
        guard !message.userID.isEmpty, message.hasSubscribedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(userId: message.userID, subscribedAt: try channelDate(message.subscribedAt))
    }
}

extension ChannelMessageBlock {
    init(connectMessage message: BriarAPI_MessageBlock) throws {
        switch message.value {
        case .header(let header):
            guard header.hasText else { throw MobileAPIError.invalidResponse }
            self.init(
                type: .header,
                textObject: try .init(connectMessage: header.text),
                markdownText: nil,
                contextElements: nil,
                richTextElements: nil
            )
        case .section(let section):
            guard section.hasText else { throw MobileAPIError.invalidResponse }
            self.init(
                type: .section,
                textObject: try .init(connectMessage: section.text),
                markdownText: nil,
                contextElements: nil,
                richTextElements: nil
            )
        case .markdown(let markdown):
            self.init(
                type: .markdown,
                textObject: nil,
                markdownText: markdown.text,
                contextElements: nil,
                richTextElements: nil
            )
        case .divider:
            self.init(
                type: .divider,
                textObject: nil,
                markdownText: nil,
                contextElements: nil,
                richTextElements: nil
            )
        case .context(let context):
            self.init(
                type: .context,
                textObject: nil,
                markdownText: nil,
                contextElements: try context.elements.map { try .init(connectMessage: $0) },
                richTextElements: nil
            )
        case .richText(let richText):
            self.init(
                type: .richText,
                textObject: nil,
                markdownText: nil,
                contextElements: nil,
                richTextElements: try richText.elements.map { try .init(connectMessage: $0) }
            )
        case nil:
            throw MobileAPIError.invalidResponse
        }
    }
}

extension ChannelBlockText {
    init(connectMessage message: BriarAPI_BlockText) throws {
        let type: Kind
        switch message.kind {
        case .plainText: type = .plainText
        case .markdown: type = .markdown
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(type: type, text: message.text)
    }
}

extension ChannelRichTextStyle {
    init(connectMessage message: BriarAPI_RichTextStyle) {
        self.init(
            bold: message.hasBold ? message.bold : nil,
            italic: message.hasItalic ? message.italic : nil,
            strike: message.hasStrike ? message.strike : nil,
            code: message.hasCode ? message.code : nil
        )
    }
}

extension ChannelRichTextInline {
    init(connectMessage message: BriarAPI_RichTextInline) throws {
        switch message.value {
        case .text(let text):
            self.init(
                type: .text,
                text: text.text,
                url: nil,
                name: nil,
                style: text.hasStyle ? .init(connectMessage: text.style) : nil
            )
        case .link(let link):
            self.init(
                type: .link,
                text: link.hasText ? link.text : nil,
                url: link.url,
                name: nil,
                style: link.hasStyle ? .init(connectMessage: link.style) : nil
            )
        case .emoji(let emoji):
            self.init(type: .emoji, text: nil, url: nil, name: emoji.name, style: nil)
        case nil:
            throw MobileAPIError.invalidResponse
        }
    }
}

extension ChannelRichTextSection {
    init(connectMessage message: BriarAPI_RichTextSection) throws {
        self.init(
            type: "rich_text_section",
            elements: try message.elements.map { try .init(connectMessage: $0) }
        )
    }
}

extension ChannelRichTextElement {
    init(connectMessage message: BriarAPI_RichTextElement) throws {
        switch message.value {
        case .section(let section):
            self.init(
                type: .section,
                elements: try section.elements.map { try .init(connectMessage: $0) },
                sections: nil,
                style: nil,
                indent: nil,
                offset: nil
            )
        case .list(let list):
            let style: String
            switch list.style {
            case .bullet: style = "bullet"
            case .ordered: style = "ordered"
            case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
            }
            self.init(
                type: .list,
                elements: nil,
                sections: try list.elements.map { try .init(connectMessage: $0) },
                style: style,
                indent: list.hasIndent ? try channelSafeInt(list.indent) : nil,
                offset: list.hasOffset ? try channelSafeInt(list.offset) : nil
            )
        case .quote(let quote):
            self.init(
                type: .quote,
                elements: try quote.elements.map { try .init(connectMessage: $0) },
                sections: nil,
                style: nil,
                indent: nil,
                offset: nil
            )
        case .preformatted(let preformatted):
            self.init(
                type: .preformatted,
                elements: try preformatted.elements.map { try .init(connectMessage: $0) },
                sections: nil,
                style: nil,
                indent: nil,
                offset: nil
            )
        case nil:
            throw MobileAPIError.invalidResponse
        }
    }
}

extension IssueExecutionProposal {
    init(connectMessage message: BriarAPI_IssueExecutionProposal) throws {
        let status: Status
        switch message.status {
        case .pending: status = .pending
        case .accepted: status = .accepted
        case .unspecified, .declined, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard message.hasCreatedAt else { throw MobileAPIError.invalidResponse }
        self.init(
            id: try channelUUID(message.id),
            status: status,
            projectId: try channelUUID(message.projectID),
            runId: try channelUUID(message.runID),
            title: message.title,
            createdAt: try channelDate(message.createdAt),
            acceptedAt: try channelOptionalDate(message.acceptedAt, present: message.hasAcceptedAt),
            requestedProvider: message.hasRequestedProvider
                ? try channelProvider(message.requestedProvider)
                : nil,
            requestedModel: message.hasRequestedModel ? message.requestedModel : nil,
            requestedEffort: message.hasRequestedEffort
                ? ModelEffort(rawValue: message.requestedEffort)
                : nil,
            requestedWorkerId: message.hasRequestedWorkerID ? message.requestedWorkerID : nil,
            delegatedByAgentId: try channelOptionalUUID(
                message.delegatedByAgentID,
                present: message.hasDelegatedByAgentID
            ),
            delegatedByAgentName: message.hasDelegatedByAgentName
                ? message.delegatedByAgentName
                : nil
        )
    }
}

extension DispatchRunResponse {
    init(connectMessage message: BriarAPI_IssueExecutionDispatch) throws {
        let dispatchMode: String
        switch message.dispatchMode {
        case .any: dispatchMode = "any"
        case .specific: dispatchMode = "specific"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let outcome: String
        switch message.outcome {
        case .dispatched: outcome = "dispatched"
        case .alreadyDispatched: outcome = "already_dispatched"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard message.hasDispatchedAt else { throw MobileAPIError.invalidResponse }
        self.init(
            runId: try channelUUID(message.runID),
            agentId: try channelOptionalUUID(message.agentID, present: message.hasAgentID),
            provider: try channelProvider(message.provider),
            model: message.hasModel ? message.model : nil,
            effort: message.hasEffort ? ModelEffort(rawValue: message.effort) : nil,
            requestedWorkerId: message.hasRequestedWorkerID ? message.requestedWorkerID : nil,
            requestedByUserId: message.requestedByUserID,
            dispatchMode: dispatchMode,
            dispatchedAt: try channelDate(message.dispatchedAt),
            outcome: outcome
        )
    }
}

extension AgentSkillExecutionProposal {
    init(connectMessage message: BriarAPI_AgentSkillExecutionProposal) throws {
        let status: Status
        switch message.status {
        case .pending: status = .pending
        case .accepted: status = .accepted
        case .unspecified, .declined, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let executionMode: ExecutionMode
        switch message.executionMode {
        case .conversation: executionMode = .conversation
        case .task: executionMode = .task
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let approvalPolicy: ApprovalPolicy
        switch message.approvalPolicy {
        case .invokeIsConsent: approvalPolicy = .invokeIsConsent
        case .explicit: approvalPolicy = .explicit
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let executionStatus: ExecutionStatus
        switch message.executionStatus {
        case .waiting: executionStatus = .waiting
        case .running: executionStatus = .running
        case .completed: executionStatus = .completed
        case .failed: executionStatus = .failed
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        guard message.hasCreatedAt else { throw MobileAPIError.invalidResponse }
        self.init(
            id: try channelUUID(message.id),
            status: status,
            projectId: try channelUUID(message.projectID),
            agentId: try channelUUID(message.agentID),
            agentName: message.agentName,
            skillId: try channelUUID(message.skillID),
            skillName: message.skillName,
            request: message.request,
            provider: try channelProvider(message.provider),
            model: message.hasModel ? message.model : nil,
            effort: message.hasEffort ? ModelEffort(rawValue: message.effort) : nil,
            executionMode: executionMode,
            approvalPolicy: approvalPolicy,
            executionStatus: executionStatus,
            createdAt: try channelDate(message.createdAt),
            acceptedAt: try channelOptionalDate(message.acceptedAt, present: message.hasAcceptedAt),
            requestedWorkerId: message.hasRequestedWorkerID ? message.requestedWorkerID : nil,
            requestedWorkerLabel: message.hasRequestedWorkerLabel
                ? message.requestedWorkerLabel
                : nil,
            resultSessionId: message.hasResultSessionID ? message.resultSessionID : nil,
            resultMessageId: try channelOptionalUUID(
                message.resultMessageID,
                present: message.hasResultMessageID
            ),
            error: message.hasError ? message.error : nil,
            delegatedByAgentId: try channelOptionalUUID(
                message.delegatedByAgentID,
                present: message.hasDelegatedByAgentID
            ),
            delegatedByAgentName: message.hasDelegatedByAgentName
                ? message.delegatedByAgentName
                : nil
        )
    }
}

extension AcceptIssueExecutionProposalRequest {
    func channelConnectMessage() throws -> BriarAPI_IssueExecutionApproval {
        var message = BriarAPI_IssueExecutionApproval()
        message.provider = channelProviderMessage(provider)
        if let model { message.model = model }
        if let effort { message.effort = effort.rawValue }
        if let workerId { message.workerID = workerId }
        return message
    }
}

private extension AcceptChannelProposalResponse.Outcome {
    init(connectValue value: BriarAPI_ApprovalOutcome) throws {
        switch value {
        case .accepted: self = .accepted
        case .alreadyAccepted: self = .alreadyAccepted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

private extension AcceptChannelExecutionProposalResponse.Outcome {
    init(connectValue value: BriarAPI_ApprovalOutcome) throws {
        switch value {
        case .accepted: self = .accepted
        case .alreadyAccepted: self = .alreadyAccepted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

private extension AcceptAgentSkillExecutionProposalResponse.Outcome {
    init(connectValue value: BriarAPI_ApprovalOutcome) throws {
        switch value {
        case .accepted: self = .accepted
        case .alreadyAccepted: self = .alreadyAccepted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

private func channelConnectMessage<Message: Sendable>(
    _ response: ResponseMessage<Message>
) throws -> Message {
    do {
        return try response.result.get()
    } catch {
        throw MobileAPIError.connect(error)
    }
}

private func channelAuthorizationHeaders(_ token: String) -> Connect.Headers {
    ["authorization": ["Bearer \(token)"]]
}

private func channelUUIDString(_ value: UUID) -> String {
    value.uuidString.lowercased()
}

private func channelUUID(_ value: String) throws -> UUID {
    guard let value = UUID(uuidString: value) else { throw MobileAPIError.invalidResponse }
    return value
}

private func channelOptionalUUID(_ value: String, present: Bool) throws -> UUID? {
    present ? try channelUUID(value) : nil
}

private func channelSafeInt<T: BinaryInteger>(_ value: T) throws -> Int {
    guard let value = Int(exactly: value) else { throw MobileAPIError.invalidResponse }
    return value
}

private func channelDate(_ value: Google_Protobuf_Timestamp) throws -> Date {
    guard (-62_135_596_800 ... 253_402_300_799).contains(value.seconds),
          (0 ... 999_999_999).contains(value.nanos)
    else { throw MobileAPIError.invalidResponse }
    return value.date
}

private func channelTimestamp(_ value: Date) throws -> Google_Protobuf_Timestamp {
    let interval = value.timeIntervalSince1970
    guard interval.isFinite else { throw MobileAPIError.invalidRequest }

    var secondsValue = floor(interval)
    var nanosValue = ((interval - secondsValue) * 1_000_000_000).rounded()
    if nanosValue == 1_000_000_000 {
        secondsValue += 1
        nanosValue = 0
    }
    guard (-62_135_596_800 ... 253_402_300_799).contains(secondsValue),
          let seconds = Int64(exactly: secondsValue),
          let nanos = Int32(exactly: nanosValue),
          (0 ... 999_999_999).contains(nanos)
    else { throw MobileAPIError.invalidRequest }

    var timestamp = Google_Protobuf_Timestamp()
    timestamp.seconds = seconds
    timestamp.nanos = nanos
    return timestamp
}

private func channelOptionalDate(
    _ value: Google_Protobuf_Timestamp,
    present: Bool
) throws -> Date? {
    present ? try channelDate(value) : nil
}

private func channelProvider(_ value: BriarTypes_AgentProvider) throws -> AgentProvider {
    switch value {
    case .codex: .codex
    case .claude: .claude
    case .cursor: .cursor
    case .grok: .grok
    case .agy: .agy
    case .opencode: .opencode
    case .openrouter: .openrouter
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func channelProviderMessage(_ value: AgentProvider) -> BriarTypes_AgentProvider {
    switch value {
    case .codex: .codex
    case .claude: .claude
    case .cursor: .cursor
    case .grok: .grok
    case .agy: .agy
    case .opencode: .opencode
    case .openrouter: .openrouter
    }
}

private func channelRole(_ value: BriarAPI_ProjectRole) throws -> String {
    switch value {
    case .owner: "owner"
    case .coOwner: "co-owner"
    case .developer: "developer"
    case .editor: "editor"
    case .viewer: "viewer"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}
