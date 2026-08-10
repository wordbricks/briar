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
    let occurredAt: Date
    let version: String
    let body: String?
    let authorName: String?
    let statusLabel: String?
    let requiresAttention: Bool
    let priority: Int?
    let structuredResult: StructuredRunResult?
    let rootMessageId: UUID?
    var conversationMessageId: UUID? = nil
    var channelMessageId: UUID? = nil
    var channelName: String? = nil
    var issueKey: String? = nil

    var isUnread: Bool = true
}

enum InboxMessageBuilder {
    static func build(
        snapshot: DashboardSnapshot?,
        sessions: [ProjectAgentSession],
        project: ProjectsResponse.Project
    ) -> [InboxMessage] {
        var messages: [InboxMessage] = []

        if let snapshot {
            for run in snapshot.runs where run.status.showsInInbox {
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
                    rootMessageId: nil
                ))
            }

            for notification in snapshot.conversationNotifications ?? [] {
                let issueKey = snapshot.runs
                    .first { $0.id == notification.runId }?
                    .runNumber
                    .map { project.issueKey(runNumber: $0) }
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
                        : L10n.text("답글"),
                    requiresAttention: true,
                    priority: nil,
                    structuredResult: nil,
                    rootMessageId: notification.rootMessageId,
                    conversationMessageId: notification.id,
                    issueKey: issueKey
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
                        : L10n.text("답글"),
                    requiresAttention: true,
                    priority: nil,
                    structuredResult: nil,
                    rootMessageId: notification.rootMessageId,
                    channelMessageId: notification.id,
                    channelName: notification.channelName
                ))
            }
        }

        for session in sessions where session.status == .completed || session.status == .failed {
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
                rootMessageId: nil
            ))
        }

        return messages.sorted { $0.occurredAt > $1.occurredAt }
    }

    static func classify(_ message: InboxMessage) -> InboxCategory {
        if message.kind == .conversation || message.kind == .channel {
            return .actionRequired
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
