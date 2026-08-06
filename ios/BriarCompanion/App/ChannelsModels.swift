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
        let ideaId: UUID
        let title: String
        let projectId: UUID?
    }
}

struct ChannelsResponse: Codable, Sendable {
    let channels: [ChannelSummary]
}

struct ChannelDetailResponse: Codable, Sendable {
    let channel: ChannelSummary
    let messages: [ChannelMessage]
}

struct ChannelMessagesResponse: Codable, Sendable {
    let messages: [ChannelMessage]
}

struct CreateChannelMessageRequest: Codable, Sendable {
    let body: String
    let parentMessageId: UUID?
}

struct CreateChannelMessageResponse: Codable, Sendable {
    let message: ChannelMessage
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
