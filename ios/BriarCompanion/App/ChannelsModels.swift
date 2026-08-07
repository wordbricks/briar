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

struct ChannelMessage: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let channelId: UUID
    let parentMessageId: UUID?
    let body: String
    let author: Author
    let replyCount: Int
    let lastReplyAt: Date?
    let document: Document?
    let createdAt: Date

    struct Author: Codable, Hashable, Sendable {
        let type: Kind
        let name: String
        let image: String?
        let provider: String?

        enum Kind: String, Codable, Hashable, Sendable {
            case user
            case agent
        }
    }

    struct Document: Codable, Hashable, Sendable {
        let messageId: UUID
        let title: String
        let projectId: UUID?
    }
}

struct ChannelsResponse: Codable, Sendable {
    let channels: [ChannelSummary]
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
                detail: member.userId == currentUserId ? "나 · \(member.email)" : member.email,
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

    private static func normalizedHandle(_ value: String) -> String {
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
