import Foundation

struct ChannelSummary: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let organizationId: UUID
    let slug: String
    let name: String
    let topic: String?
    let visibility: Visibility
    /// Project the channel belongs to. Null marks an organization-wide channel.
    let defaultProjectId: UUID?
    let archivedAt: Date?
    let memberCount: Int
    let agentCount: Int
    let createdAt: Date
    let updatedAt: Date
    /// Older channel snapshots predate direct messages, so a missing value is
    /// treated as a regular channel by the presentation helpers below.
    var kind: Kind? = nil
    var lastMessageAt: Date? = nil
    var lastMessagePreview: String? = nil
    var lastReadAt: Date? = nil
    var hasUnread: Bool? = nil
    var dmParticipants: [DirectMessageParticipant]? = nil

    enum Kind: String, Codable, Hashable, Sendable {
        case channel
        case directMessage = "dm"
    }

    enum Visibility: String, Codable, Hashable, Sendable {
        case org = "public"
        case restricted = "private"
    }

    var isDirectMessage: Bool { kind == .directMessage }

    func directMessageParticipants(excluding currentUserID: String?) -> [DirectMessageParticipant] {
        (dmParticipants ?? []).filter { participant in
            participant.type != .user || participant.id != currentUserID
        }
    }

    func directMessageDisplayName(currentUserID: String?) -> String {
        let names = directMessageParticipants(excluding: currentUserID).map(\.name)
        return names.isEmpty ? name : names.joined(separator: ", ")
    }
}

struct DirectMessageParticipant: Codable, Hashable, Identifiable, Sendable {
    enum Kind: String, Codable, Hashable, Sendable {
        case user
        case agent
    }

    let type: Kind
    let id: String
    let name: String
    let image: String?

    var profileKey: String { "\(type.rawValue):\(id)" }
}

/// Profile presented from a DM header. Roster details are preferred when the
/// open conversation has already loaded members and agents; otherwise the
/// catalog participant fields are enough to open a readable sheet.
enum ConversationProfileTarget: Hashable, Identifiable, Sendable {
    struct User: Hashable, Sendable {
        let id: String
        let name: String
        let email: String?
        let image: String?
        let role: String?
        let createdAt: Date?
    }

    struct Agent: Hashable, Sendable {
        let id: String
        let name: String
        let image: String?
        let provider: String?
        let model: String?
        let description: String?
        let responsibility: String?
        let projectId: UUID?
        let createdAt: Date?
    }

    case user(User)
    case agent(Agent)

    var id: String {
        switch self {
        case let .user(user): "user:\(user.id)"
        case let .agent(agent): "agent:\(agent.id)"
        }
    }

    var name: String {
        switch self {
        case let .user(user): user.name
        case let .agent(agent): agent.name
        }
    }

    var image: String? {
        switch self {
        case let .user(user): user.image
        case let .agent(agent): agent.image
        }
    }

    var isAgent: Bool {
        if case .agent = self { return true }
        return false
    }

    static func resolve(
        participant: DirectMessageParticipant,
        members: [ChannelMember],
        agents: [ChannelAgentSummary]
    ) -> ConversationProfileTarget {
        switch participant.type {
        case .agent:
            if let agent = agents.first(where: {
                $0.agentId.uuidString.lowercased() == participant.id.lowercased()
            }) {
                return .agent(
                    Agent(
                        id: agent.agentId.uuidString.lowercased(),
                        name: agent.name,
                        image: agent.avatar ?? participant.image,
                        provider: agent.provider,
                        model: agent.model,
                        description: agent.description,
                        responsibility: agent.responsibility,
                        projectId: agent.projectId,
                        createdAt: agent.createdAt
                    )
                )
            }
            return .agent(
                Agent(
                    id: participant.id,
                    name: participant.name,
                    image: participant.image,
                    provider: nil,
                    model: nil,
                    description: nil,
                    responsibility: nil,
                    projectId: nil,
                    createdAt: nil
                )
            )
        case .user:
            if let member = members.first(where: { $0.userId == participant.id }) {
                return .user(
                    User(
                        id: member.userId,
                        name: member.name,
                        email: member.email,
                        image: member.image ?? participant.image,
                        role: member.role,
                        createdAt: member.createdAt
                    )
                )
            }
            return .user(
                User(
                    id: participant.id,
                    name: participant.name,
                    email: nil,
                    image: participant.image,
                    role: nil,
                    createdAt: nil
                )
            )
        }
    }
}

enum DirectMessageOrdering {
    static func byMostRecent(_ channels: [ChannelSummary]) -> [ChannelSummary] {
        channels
            .filter { $0.isDirectMessage && $0.archivedAt == nil }
            .sorted { left, right in
                let leftActivity = left.lastMessageAt ?? left.createdAt
                let rightActivity = right.lastMessageAt ?? right.createdAt
                if leftActivity == rightActivity {
                    return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
                }
                return leftActivity > rightActivity
            }
    }
}

struct ChannelReadRequest: Encodable, Sendable {
    var lastReadAt: Date?
}

struct ChannelReadResponse: Decodable, Sendable {
    let channel: ChannelSummary
}

struct ChannelMessageAttachment: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let filename: String
    let contentType: String
    let byteSize: Int
    let url: String
}

struct ChannelMessageReaction: Codable, Hashable, Identifiable, Sendable {
    let emoji: String
    let count: Int
    let userIds: [String]

    var id: String { emoji }
}

struct ChannelBlockText: Codable, Hashable, Sendable {
    let type: Kind
    let text: String

    enum Kind: String, Codable, Hashable, Sendable {
        case plainText = "plain_text"
        case markdown = "mrkdwn"
    }
}

struct ChannelRichTextStyle: Codable, Hashable, Sendable {
    let bold: Bool?
    let italic: Bool?
    let strike: Bool?
    let code: Bool?
}

struct ChannelRichTextInline: Codable, Hashable, Sendable {
    let type: Kind
    let text: String?
    let url: String?
    let name: String?
    let style: ChannelRichTextStyle?

    enum Kind: String, Codable, Hashable, Sendable {
        case text
        case link
        case emoji
    }
}

struct ChannelRichTextSection: Codable, Hashable, Sendable {
    let type: String
    let elements: [ChannelRichTextInline]
}

struct ChannelRichTextElement: Codable, Hashable, Sendable {
    let type: Kind
    let elements: [ChannelRichTextInline]?
    let sections: [ChannelRichTextSection]?
    let style: String?
    let indent: Int?
    let offset: Int?

    enum Kind: String, Codable, Hashable, Sendable {
        case section = "rich_text_section"
        case list = "rich_text_list"
        case quote = "rich_text_quote"
        case preformatted = "rich_text_preformatted"
    }

    enum CodingKeys: String, CodingKey {
        case type
        case elements
        case style
        case indent
        case offset
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(Kind.self, forKey: .type)
        style = try container.decodeIfPresent(String.self, forKey: .style)
        indent = try container.decodeIfPresent(Int.self, forKey: .indent)
        offset = try container.decodeIfPresent(Int.self, forKey: .offset)
        if type == .list {
            sections = try container.decode([ChannelRichTextSection].self, forKey: .elements)
            elements = nil
        } else {
            elements = try container.decode([ChannelRichTextInline].self, forKey: .elements)
            sections = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encodeIfPresent(style, forKey: .style)
        try container.encodeIfPresent(indent, forKey: .indent)
        try container.encodeIfPresent(offset, forKey: .offset)
        if type == .list {
            try container.encode(sections ?? [], forKey: .elements)
        } else {
            try container.encode(elements ?? [], forKey: .elements)
        }
    }
}

struct ChannelMessageBlock: Codable, Hashable, Sendable {
    let type: Kind
    let textObject: ChannelBlockText?
    let markdownText: String?
    let contextElements: [ChannelBlockText]?
    let richTextElements: [ChannelRichTextElement]?

    enum Kind: String, Codable, Hashable, Sendable {
        case header
        case section
        case markdown
        case divider
        case context
        case richText = "rich_text"
    }

    enum CodingKeys: String, CodingKey {
        case type
        case text
        case elements
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(Kind.self, forKey: .type)
        switch type {
        case .header, .section:
            textObject = try container.decode(ChannelBlockText.self, forKey: .text)
            markdownText = nil
            contextElements = nil
            richTextElements = nil
        case .markdown:
            textObject = nil
            markdownText = try container.decode(String.self, forKey: .text)
            contextElements = nil
            richTextElements = nil
        case .context:
            textObject = nil
            markdownText = nil
            contextElements = try container.decode([ChannelBlockText].self, forKey: .elements)
            richTextElements = nil
        case .richText:
            textObject = nil
            markdownText = nil
            contextElements = nil
            richTextElements = try container.decode([ChannelRichTextElement].self, forKey: .elements)
        case .divider:
            textObject = nil
            markdownText = nil
            contextElements = nil
            richTextElements = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        switch type {
        case .header, .section:
            try container.encodeIfPresent(textObject, forKey: .text)
        case .markdown:
            try container.encodeIfPresent(markdownText, forKey: .text)
        case .context:
            try container.encode(contextElements ?? [], forKey: .elements)
        case .richText:
            try container.encode(richTextElements ?? [], forKey: .elements)
        case .divider:
            break
        }
    }
}

struct ChannelMessage: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let channelId: UUID
    let parentMessageId: UUID?
    let body: String
    let blocks: [ChannelMessageBlock]?
    let author: Author
    let mentionedUserIds: [String]
    let mentionedAgentIds: [UUID]
    let attachments: [ChannelMessageAttachment]
    let reactions: [ChannelMessageReaction]
    let replyCount: Int
    let lastReplyAt: Date?
    let document: Document?
    var proposal: Proposal?
    /// A generated follow-up may coexist with the accepted create proposal so
    /// the UI can show creation evidence and a distinct second approval.
    var executionProposal: IssueExecutionProposal?
    /// Mutually exclusive with issue creation/execution on the same reply. Its
    /// immutable snapshot and monotonic merge lifecycle are tracked separately.
    var skillExecutionProposal: AgentSkillExecutionProposal?
    var subscribers: [IssueSubscriber]
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case channelId
        case parentMessageId
        case body
        case blocks
        case author
        case mentionedUserIds
        case mentionedAgentIds
        case attachments
        case reactions
        case replyCount
        case lastReplyAt
        case document
        case proposal
        case executionProposal
        case skillExecutionProposal
        case subscribers
        case createdAt
    }

    init(
        id: UUID,
        channelId: UUID,
        parentMessageId: UUID?,
        body: String,
        blocks: [ChannelMessageBlock]? = nil,
        author: Author,
        mentionedUserIds: [String] = [],
        mentionedAgentIds: [UUID] = [],
        attachments: [ChannelMessageAttachment] = [],
        reactions: [ChannelMessageReaction] = [],
        replyCount: Int,
        lastReplyAt: Date?,
        document: Document?,
        proposal: Proposal?,
        executionProposal: IssueExecutionProposal? = nil,
        skillExecutionProposal: AgentSkillExecutionProposal? = nil,
        subscribers: [IssueSubscriber] = [],
        createdAt: Date
    ) {
        self.id = id
        self.channelId = channelId
        self.parentMessageId = parentMessageId
        self.body = body
        self.blocks = blocks
        self.author = author
        self.mentionedUserIds = mentionedUserIds
        self.mentionedAgentIds = mentionedAgentIds
        self.attachments = attachments
        self.reactions = reactions
        self.replyCount = replyCount
        self.lastReplyAt = lastReplyAt
        self.document = document
        self.proposal = proposal
        self.executionProposal = executionProposal
        self.skillExecutionProposal = skillExecutionProposal
        self.subscribers = subscribers
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        channelId = try container.decode(UUID.self, forKey: .channelId)
        parentMessageId = try container.decodeIfPresent(UUID.self, forKey: .parentMessageId)
        body = try container.decode(String.self, forKey: .body)
        blocks = try container.decodeIfPresent([ChannelMessageBlock].self, forKey: .blocks)
        author = try container.decode(Author.self, forKey: .author)
        mentionedUserIds = try container.decodeIfPresent([String].self, forKey: .mentionedUserIds) ?? []
        mentionedAgentIds = try container.decodeIfPresent([UUID].self, forKey: .mentionedAgentIds) ?? []
        attachments = try container.decodeIfPresent([ChannelMessageAttachment].self, forKey: .attachments) ?? []
        reactions = try container.decodeIfPresent([ChannelMessageReaction].self, forKey: .reactions) ?? []
        replyCount = try container.decode(Int.self, forKey: .replyCount)
        lastReplyAt = try container.decodeIfPresent(Date.self, forKey: .lastReplyAt)
        document = try container.decodeIfPresent(Document.self, forKey: .document)
        proposal = try container.decodeIfPresent(Proposal.self, forKey: .proposal)
        executionProposal = try container.decodeIfPresent(
            IssueExecutionProposal.self,
            forKey: .executionProposal
        )
        skillExecutionProposal = try container.decodeIfPresent(
            AgentSkillExecutionProposal.self,
            forKey: .skillExecutionProposal
        )
        subscribers = try container.decodeIfPresent(
            [IssueSubscriber].self,
            forKey: .subscribers
        ) ?? []
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }

    struct Author: Codable, Hashable, Sendable {
        let type: Kind
        let name: String
        let image: String?
        let provider: String?

        enum Kind: String, Codable, Hashable, Sendable {
            case user
            case agent
            case webhook
        }
    }

    struct Document: Codable, Hashable, Sendable {
        let messageId: UUID
        let title: String
        let projectId: UUID?
    }

    struct Proposal: Codable, Hashable, Identifiable, Sendable {
        let id: UUID
        let actionType: ActionType
        let status: Status
        let projectId: UUID?
        let payload: Payload?
        let resultRunId: UUID?

        init(
            id: UUID,
            actionType: ActionType,
            status: Status,
            projectId: UUID?,
            payload: Payload? = nil,
            resultRunId: UUID?
        ) {
            self.id = id
            self.actionType = actionType
            self.status = status
            self.projectId = projectId
            self.payload = payload
            self.resultRunId = resultRunId
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(UUID.self, forKey: .id)
            actionType = try container.decode(ActionType.self, forKey: .actionType)
            status = try container.decode(Status.self, forKey: .status)
            projectId = try container.decodeIfPresent(UUID.self, forKey: .projectId)
            // Older responses omitted payload, while future action types may use
            // a different shape. Neither should make the channel unreadable.
            payload = try? container.decodeIfPresent(Payload.self, forKey: .payload)
            resultRunId = try container.decodeIfPresent(UUID.self, forKey: .resultRunId)
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case actionType
            case status
            case projectId
            case payload
            case resultRunId
        }

        struct Payload: Codable, Hashable, Sendable {
            /// Present only for `request_issue_create` proposals.
            let issue: Issue?
            /// Compatibility for Agent payloads that place the follow-up intent
            /// next to the issue. It never contains execution preferences.
            let executeAfterCreate: Bool?

            init(
                issue: Issue? = nil,
                executeAfterCreate: Bool? = nil
            ) {
                self.issue = issue
                self.executeAfterCreate = executeAfterCreate
            }

            struct Issue: Codable, Hashable, Sendable {
                let title: String
                let description: String?
                let priority: Int?
                let status: IssueStatus

                init(
                    title: String,
                    description: String?,
                    priority: Int?,
                    status: IssueStatus
                ) {
                    self.title = title
                    self.description = description
                    self.priority = priority
                    self.status = status
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    let decodedTitle = try container.decode(String.self, forKey: .title)
                    let normalizedTitle = decodedTitle.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    guard !normalizedTitle.isEmpty, normalizedTitle.count <= 300 else {
                        throw DecodingError.dataCorruptedError(
                            forKey: .title,
                            in: container,
                            debugDescription: "Issue title must contain 1...300 characters"
                        )
                    }
                    guard container.contains(.description) else {
                        throw DecodingError.keyNotFound(
                            CodingKeys.description,
                            .init(
                                codingPath: decoder.codingPath,
                                debugDescription: "Issue description is required, and may be null"
                            )
                        )
                    }
                    let decodedDescription = try container.decodeIfPresent(
                        String.self,
                        forKey: .description
                    )
                    if let decodedDescription,
                       decodedDescription.trimmingCharacters(
                           in: .whitespacesAndNewlines
                       ).count > 100_000 {
                        throw DecodingError.dataCorruptedError(
                            forKey: .description,
                            in: container,
                            debugDescription: "Issue description is too long"
                        )
                    }
                    guard container.contains(.priority) else {
                        throw DecodingError.keyNotFound(
                            CodingKeys.priority,
                            .init(
                                codingPath: decoder.codingPath,
                                debugDescription: "Issue priority is required, and may be null"
                            )
                        )
                    }
                    let decodedPriority = try container.decodeIfPresent(Int.self, forKey: .priority)
                    if let decodedPriority, !(1 ... 4).contains(decodedPriority) {
                        throw DecodingError.dataCorruptedError(
                            forKey: .priority,
                            in: container,
                            debugDescription: "Issue priority must be between 1 and 4"
                        )
                    }

                    title = normalizedTitle
                    description = decodedDescription?.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    priority = decodedPriority
                    status = try container.decode(IssueStatus.self, forKey: .status)
                }

                private enum CodingKeys: String, CodingKey {
                    case title
                    case description
                    case priority
                    case status
                }

                enum IssueStatus: String, Codable, Hashable, Sendable {
                    case backlog
                    /// Read compatibility only. Approval always creates backlog.
                    case queued
                }
            }
        }

        enum ActionType: String, Codable, Hashable, Sendable {
            case createIssue = "request_issue_create"
            case createPlanDocument = "request_plan_document"
        }

        enum Status: String, Codable, Hashable, Sendable {
            case pending
            case accepted
        }
    }
}

struct ChannelsResponse: Codable, Sendable {
    let channels: [ChannelSummary]
    /// Organization-wide change cursor returned with the channel snapshot.
    /// Optional decoding keeps older development fixtures readable.
    let cursor: Int?
}

struct DirectMessageRecipientsResponse: Codable, Sendable {
    let members: [OrganizationMember]
}

struct OrganizationAgentsResponse: Codable, Sendable {
    let agents: [ChannelAgentSummary]
}

struct CreateDirectMessageRequest: Encodable, Sendable {
    let memberIds: [String]
    let agentIds: [String]
}

struct CreateDirectMessageResponse: Codable, Sendable {
    let channel: ChannelSummary
}

struct ChannelAgentReply: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let agentId: UUID
    let channelId: UUID
    let triggerMessageId: UUID
    let parentMessageId: UUID
    let replyMessageId: UUID
    let status: Status
    let attempts: Int
    let error: String?
    let createdAt: Date
    let updatedAt: Date

    enum Status: String, Codable, Sendable {
        case queued
        case running
        case completed
        case failed
    }
}

struct ChannelAgentActivity: Codable, Equatable, Sendable {
    let id: String
    let kind: Kind
    let headline: String

    enum Kind: String, Codable, Sendable {
        case message
        case command
        case fileChange
        case webSearch
        case tool
    }

    var displayHeadline: String {
        kind == .message ? Self.naturalLanguage(from: headline) : headline
    }

    static func naturalLanguage(from text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return text }

        let withoutPhase = trimmed.replacingOccurrences(
            of: #"^\[(?:commentary|final_answer|final|analysis)\]\s*"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        let jsonText = unwrapFencedJSON(withoutPhase)

        if let data = jsonText.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["message", "summary", "body"] {
                if let value = (object[key] as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                   !value.isEmpty {
                    return value
                }
            }
            return withoutPhase
        }
        return stringBody(fromPartialJSON: jsonText) ?? withoutPhase
    }

    private static func unwrapFencedJSON(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(
            pattern: #"^```(?:json)?\s*([\s\S]*?)\s*```$"#,
            options: [.caseInsensitive]
        ) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              let inner = Range(match.range(at: 1), in: text)
        else { return text }
        return String(text[inner])
    }

    private static func stringBody(fromPartialJSON text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{") else { return nil }
        guard let regex = try? NSRegularExpression(
            pattern: #""body"\s*:\s*("(?:\\.|[^"\\])*")"#,
            options: []
        ) else { return nil }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        guard let match = regex.firstMatch(in: trimmed, range: range),
              let quotedRange = Range(match.range(at: 1), in: trimmed)
        else { return nil }
        let quoted = String(trimmed[quotedRange])
        guard let data = quoted.data(using: .utf8),
              let value = try? JSONDecoder().decode(String.self, from: data)
        else { return nil }
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }
}

struct ChannelAgentActivityFrame: Codable, Equatable, Sendable {
    let version: Int
    let replyJobId: UUID
    let attempt: Int
    let sequence: Int
    let agentId: UUID
    let channelId: UUID
    let triggerMessageId: UUID
    let parentMessageId: UUID
    let activity: ChannelAgentActivity?
    let sentAt: Date
    let expiresAt: Date
}

struct IssueAgentActivityFrame: Codable, Equatable, Sendable {
    let version: Int
    let replyJobId: UUID
    let attempt: Int
    let sequence: Int
    let projectId: UUID
    let runId: UUID
    let triggerMessageId: UUID
    let parentMessageId: UUID
    let activity: ChannelAgentActivity?
    let sentAt: Date
    let expiresAt: Date
}

struct ChannelDeltaResponse: Codable, Equatable, Sendable {
    let cursor: Int
    let hasMore: Bool
    let channels: [ChannelSummary]
    let removedChannelIds: [UUID]
    let messages: [ChannelMessage]
    let removedMessageIds: [UUID]
    var agentReplies: [ChannelAgentReply]? = nil
}

struct ChannelDetailResponse: Codable, Sendable {
    let channel: ChannelSummary
    let members: [ChannelMember]
    let agents: [ChannelAgentSummary]
    let messages: [ChannelMessage]
    var agentReplies: [ChannelAgentReply]? = nil
    var nextCursor: UUID? = nil
}

struct ChannelMessagesResponse: Codable, Sendable {
    let messages: [ChannelMessage]
    var nextCursor: UUID? = nil
}

struct CreateChannelMessageRequest: Codable, Sendable {
    let body: String
    let clientMessageId: UUID?
    let parentMessageId: UUID?
    let mentionedUserIds: [String]
    let mentionedAgentIds: [UUID]

    enum CodingKeys: String, CodingKey {
        case body
        case clientMessageId
        case parentMessageId
        case mentionedUserIds
        case mentionedAgentIds
    }

    init(
        body: String,
        clientMessageId: UUID? = nil,
        parentMessageId: UUID?,
        mentionedUserIds: [String],
        mentionedAgentIds: [UUID]
    ) {
        self.body = body
        self.clientMessageId = clientMessageId
        self.parentMessageId = parentMessageId
        self.mentionedUserIds = mentionedUserIds
        self.mentionedAgentIds = mentionedAgentIds
    }

    /// Channel and Agent IDs are stored as lowercase strings and compared
    /// case-sensitively. Foundation's synthesized UUID encoding uses uppercase
    /// characters, so keep every UUID request field in the API's canonical form.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(body, forKey: .body)
        try container.encodeIfPresent(
            clientMessageId?.uuidString.lowercased(),
            forKey: .clientMessageId
        )
        try container.encodeIfPresent(
            parentMessageId?.uuidString.lowercased(),
            forKey: .parentMessageId
        )
        try container.encode(mentionedUserIds, forKey: .mentionedUserIds)
        try container.encode(
            mentionedAgentIds.map { $0.uuidString.lowercased() },
            forKey: .mentionedAgentIds
        )
    }
}

struct CreateChannelMessageResponse: Codable, Sendable {
    let message: ChannelMessage
}

struct ToggleChannelMessageReactionRequest: Codable, Sendable {
    let emoji: String
}

struct ToggleChannelMessageReactionResponse: Codable, Sendable {
    let message: ChannelMessage
}

struct AcceptChannelProposalRequest: Codable, Equatable, Sendable {
    let projectId: UUID?
    let execution: AcceptIssueExecutionProposalRequest?

    init(
        projectId: UUID?,
        execution: AcceptIssueExecutionProposalRequest? = nil
    ) {
        self.projectId = projectId
        self.execution = execution
    }

    /// Approval compares project IDs as lowercase strings. Foundation's
    /// synthesized UUID encoding uses uppercase characters, which the worker
    /// used to reject as a different project.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let projectId {
            try container.encode(projectId.uuidString.lowercased(), forKey: .projectId)
        } else {
            try container.encodeNil(forKey: .projectId)
        }
        try container.encodeIfPresent(execution, forKey: .execution)
    }

    private enum CodingKeys: String, CodingKey {
        case projectId, execution
    }
}

struct AcceptChannelProposalResponse: Codable, Equatable, Sendable {
    let outcome: Outcome
    let projectId: UUID
    let resultRunId: UUID
    /// Combined approval returns the materialized execution record. Older
    /// servers and create-only responses may omit this field.
    let executionProposal: IssueExecutionProposal?
    let dispatch: DispatchRunResponse?

    init(
        outcome: Outcome,
        projectId: UUID,
        resultRunId: UUID,
        executionProposal: IssueExecutionProposal? = nil,
        dispatch: DispatchRunResponse? = nil
    ) {
        self.outcome = outcome
        self.projectId = projectId
        self.resultRunId = resultRunId
        self.executionProposal = executionProposal
        self.dispatch = dispatch
    }

    enum Outcome: String, Codable, Equatable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
}

/// Values selected by the user at the moment an Agent-authored execution
/// proposal is approved. Every nullable key is encoded explicitly because the
/// API is strict and distinguishes a deliberate automatic/default selection
/// from an omitted field.
struct AcceptIssueExecutionProposalRequest: Codable, Equatable, Sendable {
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let workerId: String?

    private enum CodingKeys: String, CodingKey {
        case provider, model, effort, workerId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(provider, forKey: .provider)
        try container.encode(model, forKey: .model)
        try container.encode(effort, forKey: .effort)
        try container.encode(workerId, forKey: .workerId)
    }
}

struct AcceptChannelExecutionProposalResponse: Codable, Sendable {
    let proposal: IssueExecutionProposal
    let outcome: Outcome
    let projectId: UUID
    let runId: UUID
    let dispatch: DispatchRunResponse

    enum Outcome: String, Codable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
}

struct ChannelMember: Codable, Equatable, Identifiable, Sendable {
    let userId: String
    let name: String
    let email: String
    let image: String?
    let role: String
    let createdAt: Date

    var id: String { userId }
}

struct ChannelAgentSummary: Codable, Equatable, Identifiable, Sendable {
    let agentId: UUID
    let name: String
    let avatar: String?
    let provider: String
    let model: String?
    let projectId: UUID?
    let description: String?
    let responsibility: String
    let createdAt: Date

    var id: UUID { agentId }
}

struct ChannelMentionTarget: Equatable, Identifiable, Sendable {
    enum Kind: Sendable {
        case user
        case agent
    }

    let kind: Kind
    let recipientId: String
    let handle: String
    let label: String
    let detail: String
    let image: String?

    var id: String { "\(kind == .user ? "user" : "agent"):\(recipientId)" }
}

enum ChannelMentions {
    static func candidates(
        members: [ChannelMember],
        agents: [ChannelAgentSummary],
        currentUserId: String?
    ) -> [ChannelMentionTarget] {
        let agentTargets = agents.map { agent in
            return ChannelMentionTarget(
                kind: .agent,
                recipientId: agent.agentId.uuidString,
                handle: agent.name,
                label: agent.name,
                detail: "Agent",
                image: agent.avatar
            )
        }
        let memberTargets = members.map { member in
            ChannelMentionTarget(
                kind: .user,
                recipientId: member.userId,
                handle: normalizedHandle(member.email.split(separator: "@").first.map(String.init) ?? member.userId),
                label: member.name,
                detail: member.userId == currentUserId
                    ? L10n.format("나 · %@", member.email)
                    : member.email,
                image: member.image
            )
        }
        return agentTargets + memberTargets
    }

    static func suggestions(
        in body: String,
        candidates: [ChannelMentionTarget]
    ) -> [ChannelMentionTarget] {
        guard let query = query(in: body) else { return [] }
        let needle = query.text.lowercased()
        if needle.isEmpty { return candidates }
        return candidates.filter {
            "\($0.handle) \($0.label)".lowercased().contains(needle)
        }
    }

    static func insert(
        _ target: ChannelMentionTarget,
        into body: String
    ) -> String {
        guard let query = query(in: body) else { return body }
        return body.replacingCharacters(in: query.range, with: "@\(target.handle) ")
    }

    static func retained(
        in body: String,
        mentions: [ChannelMentionTarget]
    ) -> [ChannelMentionTarget] {
        mentions.filter { target in
            let escaped = NSRegularExpression.escapedPattern(for: target.handle)
            return body.range(
                of: "(^|[^\\p{L}\\p{N}_.-])@\(escaped)(?=$|[^\\p{L}\\p{N}_.-])",
                options: .regularExpression
            ) != nil
        }
    }

    private struct Query {
        let range: Range<String.Index>
        let text: String
    }

    private static func query(in body: String) -> Query? {
        guard let expression = try? NSRegularExpression(
            pattern: "(^|[^\\p{L}\\p{N}_.-])@([^@\\r\\n]*)$"
        ) else { return nil }
        let fullRange = NSRange(body.startIndex..<body.endIndex, in: body)
        guard let match = expression.firstMatch(in: body, range: fullRange),
              let tokenRange = Range(match.range(at: 2), in: body),
              let atIndex = body.index(tokenRange.lowerBound, offsetBy: -1, limitedBy: body.startIndex)
        else { return nil }
        return Query(range: atIndex..<body.endIndex, text: String(body[tokenRange]))
    }

    static func normalizedHandle(_ value: String) -> String {
        let allowed = value.lowercased().map { character -> Character in
            if character.isLetter || character.isNumber || "_.-".contains(character) {
                return character
            }
            return "-"
        }
        let handle = String(allowed).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return handle.isEmpty ? "member" : handle
    }
}

/// One divider plus the channels under it on the Home list.
struct ChannelGroup: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable {
        case common
        case currentProject
        case otherProject
    }

    let id: String
    let kind: Kind
    let label: String
    let channels: [ChannelSummary]
}

enum ChannelGrouping {
    /// Mirrors `src/lib/channel-grouping.ts`: common channels, then the active
    /// project, then every other project by name. Archived channels are hidden,
    /// and a channel whose project is not visible keeps a neutral label.
    static func groups(
        channels: [ChannelSummary],
        activeProjectID: UUID?,
        projectNames: [UUID: String],
        commonLabel: String,
        unknownProjectLabel: String
    ) -> [ChannelGroup] {
        var common: [ChannelSummary] = []
        var byProject: [UUID: [ChannelSummary]] = [:]
        for channel in channels where channel.archivedAt == nil && !channel.isDirectMessage {
            guard let projectID = channel.defaultProjectId else {
                common.append(channel)
                continue
            }
            byProject[projectID, default: []].append(channel)
        }

        var groups: [ChannelGroup] = []
        if !common.isEmpty {
            let group = ChannelGroup(
                id: "common",
                kind: .common,
                label: commonLabel,
                channels: sortedByName(common)
            )
            groups.append(group)
        }
        if let activeProjectID, let active = byProject[activeProjectID] {
            let label: String = projectNames[activeProjectID] ?? unknownProjectLabel
            let group = ChannelGroup(
                id: activeProjectID.uuidString,
                kind: .currentProject,
                label: label,
                channels: sortedByName(active)
            )
            groups.append(group)
        }

        var others: [ChannelGroup] = []
        for (projectID, projectChannels) in byProject {
            if projectID == activeProjectID { continue }
            let label: String = projectNames[projectID] ?? unknownProjectLabel
            let group = ChannelGroup(
                id: projectID.uuidString,
                kind: .otherProject,
                label: label,
                channels: sortedByName(projectChannels)
            )
            others.append(group)
        }
        others.sort { (left: ChannelGroup, right: ChannelGroup) -> Bool in
            if left.label == right.label { return left.id < right.id }
            let order = left.label.localizedCaseInsensitiveCompare(right.label)
            return order == .orderedAscending
        }
        return groups + others
    }

    private static func sortedByName(
        _ channels: [ChannelSummary]
    ) -> [ChannelSummary] {
        channels.sorted { (left: ChannelSummary, right: ChannelSummary) -> Bool in
            if left.name == right.name {
                return left.id.uuidString < right.id.uuidString
            }
            let order = left.name.localizedCaseInsensitiveCompare(right.name)
            return order == .orderedAscending
        }
    }
}
