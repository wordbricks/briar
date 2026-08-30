import Foundation

enum InboxCategory: String, CaseIterable, Identifiable, Sendable {
    case urgent
    case actionRequired = "action_required"
    case important
    case activity

    var id: String { rawValue }

    var title: String { title(locale: .current) }

    func title(locale: CompanionLocale) -> String {
        switch self {
        case .urgent: L10n.text("긴급", locale: locale)
        case .actionRequired: L10n.text("확인 필요", locale: locale)
        case .important: L10n.text("중요 변경", locale: locale)
        case .activity: L10n.text("최근 활동", locale: locale)
        }
    }
}

enum InboxMessageKind: String, Codable, Sendable {
    case issue
    case conversation
    case channel
    case session
}

struct InboxMessage: Identifiable, Equatable, Sendable {
    let id: String
    let kind: InboxMessageKind
    let projectId: UUID
    let projectName: String
    let targetId: String
    let title: String
    var occurredAt: Date
    var version: String
    let body: String?
    let authorName: String?
    let statusLabel: String?
    let requiresAttention: Bool
    let priority: Int?
    let structuredResult: StructuredRunResult?
    var reason: String? = nil
    let rootMessageId: UUID?
    var conversationMessageId: UUID? = nil
    var channelMessageId: UUID? = nil
    var channelName: String? = nil
    var issueKey: String? = nil
    var authorImage: String? = nil
    var notificationGroupId: String? = nil
    var groupedReadVersions: [String: String] = [:]
    var threadMessageCount = 1
    var threadUnreadCount = 0
    var threadRequiresAction = false

    var isUnread: Bool = true
}

struct InboxFeedUpdate: Equatable, Sendable {
    let messages: [InboxMessage]
    let subscribedIssueIDs: [UUID]
    let generatedAt: Date
    let version: String
    let unchanged: Bool
}

enum InboxMessageBuilder {
    static func build(
        snapshot: DashboardSnapshot?,
        sessions: [ProjectAgentSession],
        project: Project,
        currentUserID: String? = nil
    ) -> [InboxMessage] {
        var messages: [InboxMessage] = []

        if let snapshot {
            for run in snapshot.runs where run.status.showsInInbox {
                if let currentUserID, let subscribers = run.subscribers {
                    guard let subscription = subscribers.first(where: {
                        $0.userId == currentUserID
                    }) else { continue }
                    let lastEvent = run.lastEventAt.flatMap {
                        ISO8601DateFormatter.mobileContract.date(from: $0)
                    } ?? run.updatedAt
                    guard lastEvent >= subscription.subscribedAt else { continue }
                }
                let stage = run.workflowStage ?? "none"
                // Keep this formula aligned with desktop/web `useInbox` so
                // account-synced read versions match across clients.
                let lastEventAt = run.lastEventAt ?? ISO8601DateFormatter.mobileContract.string(from: run.updatedAt)
                let version = "\(run.currentAttempt ?? 1):\(run.currentRevision ?? 1):\(run.status.rawValue):\(stage):\(lastEventAt):\(run.eventCount ?? 0)"
                messages.append(InboxMessage(
                    id: "issue:\(run.id.uuidString.lowercased())",
                    kind: .issue,
                    projectId: project.id,
                    projectName: project.name,
                    targetId: run.id.uuidString.lowercased(),
                    title: run.title,
                    occurredAt: run.updatedAt,
                    version: version,
                    body: run.detail ?? run.resultSummary,
                    authorName: nil,
                    statusLabel: run.status.displayName,
                    requiresAttention: run.status.needsAttention,
                    priority: run.priority,
                    structuredResult: run.structuredResult,
                    reason: nil,
                    rootMessageId: nil
                ))
            }

            for notification in snapshot.conversationNotifications ?? [] {
                let notificationRun = snapshot.runs.first { $0.id == notification.runId }
                if let currentUserID, let subscribers = notificationRun?.subscribers {
                    guard let subscription = subscribers.first(where: {
                        $0.userId == currentUserID
                    }), notification.createdAt >= subscription.subscribedAt else { continue }
                }
                let issueKey = notificationRun?.runNumber.map {
                    project.issueKey(runNumber: $0)
                }
                messages.append(InboxMessage(
                    id: "conversation:\(notification.id.uuidString.lowercased())",
                    kind: .conversation,
                    projectId: project.id,
                    projectName: project.name,
                    targetId: notification.runId.uuidString.lowercased(),
                    title: notification.runTitle,
                    occurredAt: notification.createdAt,
                    version: notification.id.uuidString.lowercased(),
                    body: notification.body,
                    authorName: notification.author.name,
                    statusLabel: notification.reason == "mention"
                        ? L10n.text("멘션")
                        : notification.reason == "subscription"
                            ? L10n.text("구독 대화")
                            : L10n.text("답글"),
                    requiresAttention: notification.reason != "subscription",
                    priority: nil,
                    structuredResult: nil,
                    reason: notification.reason,
                    rootMessageId: notification.rootMessageId,
                    conversationMessageId: notification.id,
                    issueKey: issueKey,
                    authorImage: notification.author.image
                ))
            }

            for notification in snapshot.channelNotifications ?? [] {
                messages.append(InboxMessage(
                    id: "channel:\(notification.id.uuidString.lowercased())",
                    kind: .channel,
                    projectId: project.id,
                    projectName: project.name,
                    targetId: notification.channelId.uuidString.lowercased(),
                    title: "#\(notification.channelName)",
                    occurredAt: notification.createdAt,
                    version: notification.id.uuidString.lowercased(),
                    body: notification.body,
                    authorName: notification.author.name,
                    statusLabel: notification.reason == "mention"
                        ? L10n.text("멘션")
                        : notification.reason == "subscription"
                            ? L10n.text("구독한 스레드")
                            : L10n.text("답글"),
                    requiresAttention: true,
                    priority: nil,
                    structuredResult: nil,
                    reason: notification.reason,
                    rootMessageId: notification.rootMessageId,
                    channelMessageId: notification.id,
                    channelName: notification.channelName,
                    authorImage: notification.author.image
                ))
            }
        }

        for session in sessions where session.status == .completed || session.status == .failed {
            guard let currentUserID, session.requestedByUserId == currentUserID else {
                continue
            }
            let finalEvent = (session.events ?? []).reversed().first {
                $0.type.rawValue == session.status.rawValue
            }
            let fallbackTimestamp = session.completedAt ?? session.startedAt
            let version = finalEvent?.id ??
                "\(session.status.rawValue):\(ISO8601DateFormatter.mobileContract.string(from: fallbackTimestamp))"
            messages.append(InboxMessage(
                id: "session:\(session.id)",
                kind: .session,
                projectId: project.id,
                projectName: project.name,
                targetId: session.id,
                title: session.title,
                occurredAt: finalEvent?.occurredAt ?? session.displayTimestamp,
                version: version,
                body: session.summary ?? session.error,
                authorName: session.agentName,
                statusLabel: session.status.displayName,
                requiresAttention: session.requiresAttention,
                priority: nil,
                structuredResult: nil,
                reason: nil,
                rootMessageId: nil
            ))
        }

        return messages.sorted { $0.occurredAt > $1.occurredAt }
    }

    /// One Slack-style Inbox alert per issue/channel thread. The row retains
    /// the oldest unread reply as its navigation target and the newest reply as
    /// its sort timestamp/version.
    static func collapseThreads(_ messages: [InboxMessage]) -> [InboxMessage] {
        var standalone: [InboxMessage] = []
        var threads: [String: [InboxMessage]] = [:]

        for message in messages {
            guard let groupID = threadGroupID(message) else {
                standalone.append(message)
                continue
            }
            threads[groupID, default: []].append(message)
        }

        let collapsed = threads.map { groupID, group -> InboxMessage in
            let chronological = group.sorted {
                $0.occurredAt == $1.occurredAt
                    ? $0.id < $1.id
                    : $0.occurredAt < $1.occurredAt
            }
            let latest = chronological.last!
            let unread = chronological.filter(\.isUnread)
            var representative = unread.first ?? latest
            let relevant = unread.isEmpty ? chronological : unread

            representative.occurredAt = latest.occurredAt
            representative.version = latest.version
            representative.isUnread = !unread.isEmpty
            representative.notificationGroupId = groupID
            representative.groupedReadVersions = Dictionary(
                uniqueKeysWithValues: chronological.map { ($0.id, $0.version) }
            )
            representative.threadMessageCount = chronological.count
            representative.threadUnreadCount = unread.count
            representative.threadRequiresAction = relevant.contains {
                $0.reason != "subscription"
            }
            return representative
        }

        return (standalone + collapsed).sorted {
            $0.occurredAt == $1.occurredAt
                ? $0.id < $1.id
                : $0.occurredAt > $1.occurredAt
        }
    }

    private static func threadGroupID(_ message: InboxMessage) -> String? {
        guard let rootMessageID = message.rootMessageId else { return nil }
        let root = rootMessageID.uuidString.lowercased()
        switch message.kind {
        case .conversation:
            return "conversation-thread:\(message.projectId.uuidString.lowercased()):\(message.targetId):\(root)"
        case .channel:
            return "channel-thread:\(message.targetId):\(root)"
        case .issue, .session:
            return nil
        }
    }

    static func classify(_ message: InboxMessage) -> InboxCategory {
        if message.kind == .channel {
            return .actionRequired
        }
        if message.kind == .conversation {
            return message.threadRequiresAction || message.reason != "subscription"
                ? .actionRequired
                : .activity
        }
        if message.kind == .session {
            return message.requiresAttention ? .actionRequired : .activity
        }

        let result = message.structuredResult
        if result?.urgency == "immediate" ||
            result?.importance == "critical" ||
            (message.priority == 1 && message.requiresAttention) {
            return .urgent
        }
        if result?.humanActionRequired == true || message.requiresAttention {
            return .actionRequired
        }
        if result?.importance == "important" ||
            result?.impact == "project" ||
            result?.impact == "organization" ||
            (message.statusLabel == DashboardRun.Status.completed.displayName &&
                (message.priority ?? 4) <= 2) {
            return .important
        }
        return .activity
    }

    static func filter(
        _ messages: [InboxMessage],
        to categories: Set<InboxCategory>
    ) -> [InboxMessage] {
        messages.filter { categories.contains(classify($0)) }
    }
}
