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

    enum Visibility: String, Codable, Hashable, Sendable {
        case org = "public"
        case restricted = "private"
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

struct ChannelMessage: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let channelId: UUID
    let parentMessageId: UUID?
    let body: String
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
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case channelId
        case parentMessageId
        case body
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
        case createdAt
    }

    init(
        id: UUID,
        channelId: UUID,
        parentMessageId: UUID?,
        body: String,
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
        createdAt: Date
    ) {
        self.id = id
        self.channelId = channelId
        self.parentMessageId = parentMessageId
        self.body = body
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
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        channelId = try container.decode(UUID.self, forKey: .channelId)
        parentMessageId = try container.decodeIfPresent(UUID.self, forKey: .parentMessageId)
        body = try container.decode(String.self, forKey: .body)
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

/// Incremental organization channel changes. Reply-job metadata is deliberately
/// omitted: native clients only need the resulting message/channel projections.
struct ChannelDeltaResponse: Codable, Equatable, Sendable {
    let cursor: Int
    let hasMore: Bool
    let channels: [ChannelSummary]
    let removedChannelIds: [UUID]
    let messages: [ChannelMessage]
    let removedMessageIds: [UUID]
}

struct ChannelDetailResponse: Codable, Sendable {
    let channel: ChannelSummary
    let members: [ChannelMember]
    let agents: [ChannelAgentSummary]
    let messages: [ChannelMessage]
}

struct ChannelMessagesResponse: Codable, Sendable {
    let messages: [ChannelMessage]
}

struct CreateChannelMessageRequest: Codable, Sendable {
    let body: String
    let parentMessageId: UUID?
    let mentionedUserIds: [String]
    let mentionedAgentIds: [UUID]
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
}

struct AcceptChannelProposalResponse: Codable, Equatable, Sendable {
    let outcome: Outcome
    let projectId: UUID
    let resultRunId: UUID
    /// A create-and-execute proposal materializes a second, pending approval
    /// boundary in the same response. Older servers may omit this field.
    let executionProposal: IssueExecutionProposal?

    init(
        outcome: Outcome,
        projectId: UUID,
        resultRunId: UUID,
        executionProposal: IssueExecutionProposal? = nil
    ) {
        self.outcome = outcome
        self.projectId = projectId
        self.resultRunId = resultRunId
        self.executionProposal = executionProposal
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
    let handle: String?
    let name: String
    let provider: String
    let model: String?
    let projectId: UUID?
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
            let preferredHandle = agent.handle?.trimmingCharacters(in: .whitespacesAndNewlines)
            let handle = preferredHandle.flatMap { $0.isEmpty ? nil : $0 } ?? agent.name
            return ChannelMentionTarget(
                kind: .agent,
                recipientId: agent.agentId.uuidString,
                handle: normalizedHandle(handle),
                label: agent.name,
                detail: "Agent",
                image: nil
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
            pattern: "(^|[^\\p{L}\\p{N}_.-])@([\\p{L}\\p{N}_.-]*)$"
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
        for channel in channels where channel.archivedAt == nil {
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
