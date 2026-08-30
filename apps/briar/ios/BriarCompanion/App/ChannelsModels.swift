import BriarContracts
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

    init(
        type: Kind,
        elements: [ChannelRichTextInline]?,
        sections: [ChannelRichTextSection]?,
        style: String?,
        indent: Int?,
        offset: Int?
    ) {
        self.type = type
        self.elements = elements
        self.sections = sections
        self.style = style
        self.indent = indent
        self.offset = offset
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

    init(
        type: Kind,
        textObject: ChannelBlockText?,
        markdownText: String?,
        contextElements: [ChannelBlockText]?,
        richTextElements: [ChannelRichTextElement]?
    ) {
        self.type = type
        self.textObject = textObject
        self.markdownText = markdownText
        self.contextElements = contextElements
        self.richTextElements = richTextElements
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
    /// Up to three unique reply authors, newest first. Older payloads omit it.
    let replyAuthors: [Author]
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
    let deletedAt: Date?

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
        case replyAuthors
        case document
        case proposal
        case executionProposal
        case skillExecutionProposal
        case subscribers
        case createdAt
        case deletedAt
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
        replyAuthors: [Author] = [],
        document: Document?,
        proposal: Proposal?,
        executionProposal: IssueExecutionProposal? = nil,
        skillExecutionProposal: AgentSkillExecutionProposal? = nil,
        subscribers: [IssueSubscriber] = [],
        createdAt: Date,
        deletedAt: Date? = nil
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
        self.replyAuthors = replyAuthors
        self.document = document
        self.proposal = proposal
        self.executionProposal = executionProposal
        self.skillExecutionProposal = skillExecutionProposal
        self.subscribers = subscribers
        self.createdAt = createdAt
        self.deletedAt = deletedAt
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
        replyAuthors = try container.decodeIfPresent([Author].self, forKey: .replyAuthors) ?? []
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
        deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    struct Author: Codable, Hashable, Sendable {
        let type: Kind
        let name: String
        let image: String?
        let provider: String?
        let id: String?

        init(
            type: Kind,
            name: String,
            image: String?,
            provider: String?,
            id: String? = nil
        ) {
            self.type = type
            self.name = name
            self.image = image
            self.provider = provider
            self.id = id
        }

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
        let resultItems: [ResultItem]

        init(
            id: UUID,
            actionType: ActionType,
            status: Status,
            projectId: UUID?,
            payload: Payload? = nil,
            resultRunId: UUID?,
            resultItems: [ResultItem] = []
        ) {
            self.id = id
            self.actionType = actionType
            self.status = status
            self.projectId = projectId
            self.payload = payload
            self.resultRunId = resultRunId
            self.resultItems = resultItems
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
            resultItems = try container.decodeIfPresent(
                [ResultItem].self,
                forKey: .resultItems
            ) ?? []
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case actionType
            case status
            case projectId
            case payload
            case resultRunId
            case resultItems
        }

        struct ResultItem: Codable, Hashable, Sendable {
            let localKey: String
            let runId: UUID
        }

        struct Payload: Codable, Hashable, Sendable {
            /// Present only for `request_issue_create` proposals.
            let issue: Issue?
            /// Present only for an atomic multi-issue backlog proposal.
            let batch: Batch?
            /// Compatibility for Agent payloads that place the follow-up intent
            /// next to the issue. It never contains execution preferences.
            let executeAfterCreate: Bool?

            init(
                issue: Issue? = nil,
                batch: Batch? = nil,
                executeAfterCreate: Bool? = nil
            ) {
                self.issue = issue
                self.batch = batch
                self.executeAfterCreate = executeAfterCreate
            }

            struct Batch: Codable, Hashable, Sendable {
                let items: [Item]
                let dependencies: [Dependency]

                struct Item: Codable, Hashable, Sendable {
                    let key: String
                    let issue: Issue
                }

                struct Dependency: Codable, Hashable, Sendable {
                    let prerequisiteKey: String
                    let dependentKey: String
                }
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
            case declined
        }
    }
}

struct ChannelsResponse: Sendable {
    let channels: [ChannelSummary]
    let cursor: Int?
}

struct DirectMessageRecipients: Sendable {
    let members: [OrganizationMember]
    let agents: [ChannelAgentSummary]
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

struct ChannelAgentActivityFrame: Equatable, Sendable {
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

struct IssueAgentActivityFrame: Equatable, Sendable {
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

enum AgentReplyActivityFrame: Equatable, Sendable {
    case channel(ChannelAgentActivityFrame)
    case issue(IssueAgentActivityFrame)

    init(protobuf message: BriarRealtime_AgentReplyActivityFrame) throws {
        let fields = try CommonFields(protobuf: message)
        guard let scope = message.scope else { throw MobileAPIError.invalidResponse }
        switch scope {
        case .channel(let channel):
            guard let agentID = UUID(uuidString: channel.agentID),
                  let channelID = UUID(uuidString: channel.channelID)
            else { throw MobileAPIError.invalidResponse }
            self = .channel(ChannelAgentActivityFrame(
                replyJobId: fields.replyJobID,
                attempt: fields.attempt,
                sequence: fields.sequence,
                agentId: agentID,
                channelId: channelID,
                triggerMessageId: fields.triggerMessageID,
                parentMessageId: fields.parentMessageID,
                activity: fields.activity,
                sentAt: fields.sentAt,
                expiresAt: fields.expiresAt
            ))
        case .issue(let issue):
            guard let projectID = UUID(uuidString: issue.projectID),
                  let runID = UUID(uuidString: issue.runID)
            else { throw MobileAPIError.invalidResponse }
            self = .issue(IssueAgentActivityFrame(
                replyJobId: fields.replyJobID,
                attempt: fields.attempt,
                sequence: fields.sequence,
                projectId: projectID,
                runId: runID,
                triggerMessageId: fields.triggerMessageID,
                parentMessageId: fields.parentMessageID,
                activity: fields.activity,
                sentAt: fields.sentAt,
                expiresAt: fields.expiresAt
            ))
        }
    }

    private struct CommonFields {
        let replyJobID: UUID
        let attempt: Int
        let sequence: Int
        let triggerMessageID: UUID
        let parentMessageID: UUID
        let activity: ChannelAgentActivity?
        let sentAt: Date
        let expiresAt: Date

        init(protobuf message: BriarRealtime_AgentReplyActivityFrame) throws {
            guard let replyJobID = UUID(uuidString: message.replyJobID),
                  message.attempt > 0,
                  message.sequence > 0,
                  message.sequence <= UInt64(Int.max),
                  let triggerMessageID = UUID(uuidString: message.triggerMessageID),
                  let parentMessageID = UUID(uuidString: message.parentMessageID),
                  message.hasSentAt,
                  message.hasExpiresAt
            else { throw MobileAPIError.invalidResponse }
            self.replyJobID = replyJobID
            self.attempt = Int(message.attempt)
            self.sequence = Int(message.sequence)
            self.triggerMessageID = triggerMessageID
            self.parentMessageID = parentMessageID
            self.sentAt = message.sentAt.date
            self.expiresAt = message.expiresAt.date
            self.activity = try Self.activity(protobuf: message)
        }

        private static func activity(
            protobuf message: BriarRealtime_AgentReplyActivityFrame
        ) throws -> ChannelAgentActivity? {
            guard message.hasActivity else { return nil }
            let kind: ChannelAgentActivity.Kind
            switch message.activity.kind {
            case .message:
                kind = .message
            case .command:
                kind = .command
            case .fileChange:
                kind = .fileChange
            case .webSearch:
                kind = .webSearch
            case .tool:
                kind = .tool
            case .unspecified, .UNRECOGNIZED:
                throw MobileAPIError.invalidResponse
            }
            guard !message.activity.id.isEmpty,
                  !message.activity.headline.isEmpty
            else { throw MobileAPIError.invalidResponse }
            return ChannelAgentActivity(
                id: message.activity.id,
                kind: kind,
                headline: message.activity.headline
            )
        }
    }
}

struct ChannelDeltaResponse: Equatable, Sendable {
    let cursor: Int
    let hasMore: Bool
    var reset = false
    let channels: [ChannelSummary]
    let removedChannelIds: [UUID]
    let messages: [ChannelMessage]
    let removedMessageIds: [UUID]
    var agentReplies: [ChannelAgentReply]? = nil
}

struct ChannelDetailResponse: Sendable {
    let channel: ChannelSummary
    let members: [ChannelMember]
    let agents: [ChannelAgentSummary]
    let messages: [ChannelMessage]
    var agentReplies: [ChannelAgentReply]? = nil
    var nextCursor: UUID? = nil
}

struct ChannelMessagesResponse: Sendable {
    let messages: [ChannelMessage]
    var nextCursor: UUID? = nil
}

struct CreateChannelMessageResponse: Codable, Sendable {
    let message: ChannelMessage
    let agentReplies: [ChannelAgentReply]

    init(message: ChannelMessage, agentReplies: [ChannelAgentReply] = []) {
        self.message = message
        self.agentReplies = agentReplies
    }

    private enum CodingKeys: String, CodingKey {
        case message
        case agentReplies
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try container.decode(ChannelMessage.self, forKey: .message)
        agentReplies = try container.decodeIfPresent(
            [ChannelAgentReply].self,
            forKey: .agentReplies
        ) ?? []
    }
}

struct ToggleChannelMessageReactionResponse: Sendable {
    let message: ChannelMessage
}

struct DeleteChannelMessageResponse: Sendable {
    let deleted: Bool
    let message: ChannelMessage?
    let parentMessage: ChannelMessage?
}

struct AcceptChannelProposalResponse: Equatable, Sendable {
    let outcome: Outcome
    let projectId: UUID
    let resultRunId: UUID
    let resultItems: [ChannelMessage.Proposal.ResultItem]?
    /// Combined approval returns the materialized execution record. Older
    /// servers and create-only responses may omit this field.
    let executionProposal: IssueExecutionProposal?
    let dispatch: DispatchRunResponse?

    init(
        outcome: Outcome,
        projectId: UUID,
        resultRunId: UUID,
        resultItems: [ChannelMessage.Proposal.ResultItem]? = nil,
        executionProposal: IssueExecutionProposal? = nil,
        dispatch: DispatchRunResponse? = nil
    ) {
        self.outcome = outcome
        self.projectId = projectId
        self.resultRunId = resultRunId
        self.resultItems = resultItems
        self.executionProposal = executionProposal
        self.dispatch = dispatch
    }

    enum Outcome: String, Codable, Equatable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
}

struct DeclineChannelProposalResponse: Equatable, Sendable {
    let outcome: Outcome

    enum Outcome: String, Codable, Equatable, Sendable {
        case declined
        case alreadyDeclined = "already_declined"
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

struct AcceptChannelExecutionProposalResponse: Sendable {
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
