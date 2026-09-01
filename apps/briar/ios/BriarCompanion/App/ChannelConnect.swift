import BriarContracts
import Foundation
import SwiftProtobuf

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
        let role: String
        switch message.role {
        case .owner: role = "owner"
        case .member: role = "member"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            userId: message.userID,
            name: message.name,
            email: message.email,
            image: message.hasImage ? message.image : nil,
            role: role,
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
            memoryCitations: try message.memoryCitations.map { reference in
                guard let documentId = UUID(uuidString: reference.documentID),
                      reference.version > 0 else {
                    throw MobileAPIError.invalidResponse
                }
                return ChannelMemoryCitation(
                    documentId: documentId,
                    version: Int(reference.version)
                )
            },
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
        guard let author = message.author else {
            throw MobileAPIError.invalidResponse
        }
        switch author {
        case .user(let user):
            guard !user.id.isEmpty, !user.name.isEmpty, !user.email.isEmpty else {
                throw MobileAPIError.invalidResponse
            }
            self.init(
                type: .user,
                name: user.name,
                image: user.hasImage ? user.image : nil,
                provider: nil,
                id: user.id
            )
        case .agent(let agent):
            guard !agent.name.isEmpty, !agent.hasID || !agent.id.isEmpty else {
                throw MobileAPIError.invalidResponse
            }
            self.init(
                type: .agent,
                name: agent.name,
                image: agent.hasImage ? agent.image : nil,
                provider: agent.hasProvider
                    ? try channelProvider(agent.provider).rawValue
                    : nil,
                id: agent.hasID ? agent.id : nil
            )
        case .webhook(let webhook):
            guard !webhook.name.isEmpty, !webhook.hasID || !webhook.id.isEmpty else {
                throw MobileAPIError.invalidResponse
            }
            self.init(
                type: .webhook,
                name: webhook.name,
                image: nil,
                provider: nil,
                id: webhook.hasID ? webhook.id : nil
            )
        }
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
            payload = .issue(
                try Payload.Issue(connectMessage: issue.issue),
                executeAfterCreate: issue.executeAfterCreate
            )
        case .batch(let batch):
            payload = .batch(try Payload.Batch(connectMessage: batch))
        case nil:
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try channelUUID(message.id),
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
        self.init(title: title, description: description, priority: priority)
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
    func channelApprovalMessage() throws -> BriarAPI_IssueExecutionApproval {
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

private func channelUUID(_ value: String) throws -> UUID {
    guard let value = UUID(uuidString: value) else { throw MobileAPIError.invalidResponse }
    return value
}

func channelOptionalUUID(_ value: String, present: Bool) throws -> UUID? {
    present ? try channelUUID(value) : nil
}

func channelSafeInt<T: BinaryInteger>(_ value: T) throws -> Int {
    guard let value = Int(exactly: value) else { throw MobileAPIError.invalidResponse }
    return value
}

private func channelDate(_ value: Google_Protobuf_Timestamp) throws -> Date {
    guard (-62_135_596_800 ... 253_402_300_799).contains(value.seconds),
          (0 ... 999_999_999).contains(value.nanos)
    else { throw MobileAPIError.invalidResponse }
    return value.date
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
