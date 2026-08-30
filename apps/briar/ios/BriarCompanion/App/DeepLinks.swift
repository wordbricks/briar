import Foundation

enum BriarLinkTarget: Equatable, Sendable {
    case issue(projectID: UUID, runID: UUID)
    case session(projectID: UUID, sessionID: String)
    case channel(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        rootMessageID: UUID
    )

    var projectID: UUID? {
        switch self {
        case let .issue(projectID, _): projectID
        case let .session(projectID, _): projectID
        case .channel: nil
        }
    }
}

enum BriarLinkParser {
    static func parse(
        _ value: String,
        trustedOrigin: URL = BriarShareLinks.defaultOrigin
    ) -> BriarLinkTarget? {
        guard let url = URL(string: value) else { return nil }
        return parse(url, trustedOrigin: trustedOrigin)
    }

    static func parse(
        _ url: URL,
        trustedOrigin: URL = BriarShareLinks.defaultOrigin
    ) -> BriarLinkTarget? {
        if url.scheme == "briar-companion" {
            let host = url.host?.lowercased() ?? ""
            let parts = url.path.split(separator: "/").map(String.init)
            if host == "issues", parts.count == 2,
               let projectID = UUID(uuidString: parts[0]),
               let runID = UUID(uuidString: parts[1]) {
                return .issue(projectID: projectID, runID: runID)
            }
            if host == "sessions", parts.count == 2,
               let projectID = UUID(uuidString: parts[0]) {
                return .session(projectID: projectID, sessionID: parts[1])
            }
            if host == "channels", parts.count == 3,
               let organizationID = UUID(uuidString: parts[0]),
               let channelID = UUID(uuidString: parts[1]),
               let messageID = UUID(uuidString: parts[2]) {
                return .channel(
                    organizationID: organizationID,
                    channelID: channelID,
                    messageID: messageID,
                    rootMessageID: channelRootMessageID(from: url) ?? messageID
                )
            }
            // auth-complete and other non-navigation hosts are ignored here.
            return nil
        }

        guard
            url.scheme == "https" || url.scheme == "http",
            hasSameOrigin(url, trustedOrigin)
        else { return nil }
        let segments = url.path.split(separator: "/").map(String.init)
        // /open/issues/{projectId}/{runId}
        if segments.count == 4, segments[0] == "open", segments[1] == "issues",
           let projectID = UUID(uuidString: segments[2]),
           let runID = UUID(uuidString: segments[3]) {
            return .issue(projectID: projectID, runID: runID)
        }
        // /open/sessions/{projectId}/{sessionId}
        if segments.count == 4, segments[0] == "open", segments[1] == "sessions",
           let projectID = UUID(uuidString: segments[2]) {
            return .session(projectID: projectID, sessionID: segments[3])
        }
        // /open/channels/{organizationId}/{channelId}/{messageId}
        if segments.count == 5, segments[0] == "open", segments[1] == "channels",
           let organizationID = UUID(uuidString: segments[2]),
           let channelID = UUID(uuidString: segments[3]),
           let messageID = UUID(uuidString: segments[4]) {
            return .channel(
                organizationID: organizationID,
                channelID: channelID,
                messageID: messageID,
                rootMessageID: channelRootMessageID(from: url) ?? messageID
            )
        }
        return nil
    }

    private static func hasSameOrigin(_ candidate: URL, _ trusted: URL) -> Bool {
        guard
            let candidateScheme = candidate.scheme?.lowercased(),
            let trustedScheme = trusted.scheme?.lowercased(),
            let candidateHost = candidate.host?.lowercased(),
            let trustedHost = trusted.host?.lowercased()
        else { return false }
        return candidateScheme == trustedScheme &&
            candidateHost == trustedHost &&
            effectivePort(candidate) == effectivePort(trusted)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    private static func channelRootMessageID(from url: URL) -> UUID? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "root" })?
            .value
            .flatMap(UUID.init(uuidString:))
    }
}

enum BriarShareLinks {
    static func issueShareURL(projectID: UUID, runID: UUID, origin: URL) -> URL {
        origin
            .appending(path: "open")
            .appending(path: "issues")
            .appending(path: projectID.uuidString.lowercased())
            .appending(path: runID.uuidString.lowercased())
    }

    static func issueDeepLinkURL(projectID: UUID, runID: UUID) -> URL {
        URL(string: "briar-companion://issues/\(projectID.uuidString.lowercased())/\(runID.uuidString.lowercased())")!
    }

    static func sessionShareURL(projectID: UUID, sessionID: String, origin: URL) -> URL {
        origin
            .appending(path: "open")
            .appending(path: "sessions")
            .appending(path: projectID.uuidString.lowercased())
            .appending(path: sessionID)
    }

    static func sessionDeepLinkURL(projectID: UUID, sessionID: String) -> URL {
        URL(string: "briar-companion://sessions/\(projectID.uuidString.lowercased())/\(sessionID)")!
    }

    static func channelShareURL(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        rootMessageID: UUID? = nil,
        origin: URL
    ) -> URL {
        var url = origin
            .appending(path: "open")
            .appending(path: "channels")
            .appending(path: organizationID.uuidString.lowercased())
            .appending(path: channelID.uuidString.lowercased())
            .appending(path: messageID.uuidString.lowercased())
        if let rootMessageID, rootMessageID != messageID {
            url.append(queryItems: [
                URLQueryItem(name: "root", value: rootMessageID.uuidString.lowercased()),
            ])
        }
        return url
    }

    static var defaultOrigin: URL {
        let configured = ProcessInfo.processInfo.environment["BRIAR_API_URL"] ??
            "https://briar-api.wbai.workers.dev"
        return URL(string: configured) ?? URL(string: "https://briar-api.wbai.workers.dev")!
    }
}

struct CompanionIssueNavigationRoute: Hashable {
    let runID: UUID
    let initialTab: RunDetailTab?
}

/// Pushes a channel thread without putting the full `ChannelMessage` snapshot
/// on the `NavigationPath`. Inbox and in-channel opens share this identity so
/// reply-count updates cannot pop the destination.
struct ChannelThreadRoute: Hashable, Identifiable {
    let channelID: UUID
    let parentMessageID: UUID
    let highlightMessageID: UUID?

    var id: String {
        "\(parentMessageID.uuidString.lowercased()):\(highlightMessageID?.uuidString.lowercased() ?? "")"
    }
}

enum ChannelInboxNavigation {
    /// Thread replies open the parent thread and scroll to the reply. Root
    /// mentions and DM conversations stay on the channel timeline.
    static func threadRoute(
        isDirectMessage: Bool,
        channelID: UUID,
        messageID: UUID,
        rootMessageID: UUID
    ) -> ChannelThreadRoute? {
        guard !isDirectMessage, messageID != rootMessageID else { return nil }
        return ChannelThreadRoute(
            channelID: channelID,
            parentMessageID: rootMessageID,
            highlightMessageID: messageID
        )
    }
}

@MainActor
final class CompanionNavigationModel: ObservableObject {
    enum Tab: Hashable {
        case home
        case tasks
        case directMessages
        case inbox
    }

    @Published var selectedTab: Tab = .tasks
    @Published var pendingIssueID: UUID?
    @Published var pendingIssueDetailTab: RunDetailTab?
    @Published var pendingSessionID: String?
    @Published var pendingProjectID: UUID?
    @Published var pathIssueToken = 0
    @Published var pathSessionToken = 0
    @Published var pendingChannelID: UUID?
    @Published var pendingChannelMessageID: UUID?
    @Published var pendingChannelRootMessageID: UUID?
    @Published var pendingChannelThread: ChannelThreadRoute?
    @Published var pathChannelToken = 0
    @Published private(set) var preparingIssue = false
    @Published var linkErrorMessage: String?
    private var issuePreparationRevision = 0

    func open(_ target: BriarLinkTarget) {
        issuePreparationRevision &+= 1
        preparingIssue = false
        linkErrorMessage = nil
        stage(target)
    }

    @discardableResult
    func open(
        _ url: URL,
        trustedOrigin: URL = BriarShareLinks.defaultOrigin
    ) -> BriarLinkTarget? {
        guard let target = BriarLinkParser.parse(
            url,
            trustedOrigin: trustedOrigin
        ) else { return nil }
        open(target)
        return target
    }

    func failPendingNavigation(_ message: String) {
        issuePreparationRevision &+= 1
        preparingIssue = false
        pendingIssueID = nil
        pendingIssueDetailTab = nil
        pendingSessionID = nil
        pendingProjectID = nil
        pendingChannelID = nil
        pendingChannelMessageID = nil
        pendingChannelRootMessageID = nil
        pendingChannelThread = nil
        linkErrorMessage = message
    }

    private func stage(
        _ target: BriarLinkTarget,
        issueDetailTab: RunDetailTab? = nil
    ) {
        pendingProjectID = target.projectID
        pendingIssueDetailTab = issueDetailTab
        switch target {
        case let .issue(_, runID):
            pendingIssueID = runID
            pendingSessionID = nil
            pendingChannelID = nil
            pendingChannelMessageID = nil
            pendingChannelRootMessageID = nil
            pendingChannelThread = nil
            selectedTab = .tasks
            pathIssueToken &+= 1
        case let .session(_, sessionID):
            pendingSessionID = sessionID
            pendingIssueID = nil
            pendingChannelID = nil
            pendingChannelMessageID = nil
            pendingChannelRootMessageID = nil
            pendingChannelThread = nil
            selectedTab = .directMessages
            pathSessionToken &+= 1
        case let .channel(_, channelID, messageID, rootMessageID):
            pendingIssueID = nil
            pendingSessionID = nil
            pendingChannelID = channelID
            pendingChannelMessageID = messageID
            pendingChannelRootMessageID = rootMessageID
            pendingChannelThread = nil
            selectedTab = .home
            pathChannelToken &+= 1
        }
    }

    /// Keeps channel approval on its current surface while a canonical
    /// dashboard is loaded. A newer request or a departed source surface makes
    /// the delayed completion a no-op.
    func openIssueWhenAvailable(
        projectID: UUID,
        runID: UUID,
        ensureAvailable: @escaping @MainActor (UUID, UUID) async -> Bool,
        sourceIsCurrent: @escaping @MainActor () -> Bool
    ) async -> Bool {
        issuePreparationRevision &+= 1
        let expectedRevision = issuePreparationRevision
        preparingIssue = true
        defer {
            if expectedRevision == issuePreparationRevision {
                preparingIssue = false
            }
        }
        guard sourceIsCurrent() else { return false }
        guard await ensureAvailable(projectID, runID) else { return false }
        guard
            expectedRevision == issuePreparationRevision,
            sourceIsCurrent()
        else { return false }
        stage(.issue(projectID: projectID, runID: runID))
        return true
    }

    func openInboxMessage(_ message: InboxMessage) {
        switch message.kind {
        case .issue:
            if let runID = UUID(uuidString: message.targetId) {
                open(.issue(projectID: message.projectId, runID: runID))
            }
        case .conversation:
            if let runID = UUID(uuidString: message.targetId) {
                issuePreparationRevision &+= 1
                preparingIssue = false
                stage(
                    .issue(projectID: message.projectId, runID: runID),
                    issueDetailTab: .conversation
                )
            }
        case .session:
            open(.session(projectID: message.projectId, sessionID: message.targetId))
        case .channel:
            guard let channelID = UUID(uuidString: message.targetId),
                  let messageID = message.channelMessageId,
                  let rootMessageID = message.rootMessageId else { return }
            issuePreparationRevision &+= 1
            preparingIssue = false
            pendingIssueID = nil
            pendingIssueDetailTab = nil
            pendingSessionID = nil
            pendingProjectID = message.projectId
            pendingChannelID = channelID
            pendingChannelMessageID = messageID
            pendingChannelRootMessageID = rootMessageID
            pendingChannelThread = nil
            selectedTab = .home
            pathChannelToken &+= 1
        }
    }

    func openRemoteNotification(_ target: RemotePushNotificationTarget) {
        switch target.kind {
        case .issue:
            guard let runID = UUID(uuidString: target.targetId) else { return }
            open(.issue(projectID: target.projectId, runID: runID))
        case .conversation:
            guard let runID = UUID(uuidString: target.targetId) else { return }
            issuePreparationRevision &+= 1
            preparingIssue = false
            stage(
                .issue(projectID: target.projectId, runID: runID),
                issueDetailTab: .conversation
            )
        case .session:
            open(.session(projectID: target.projectId, sessionID: target.targetId))
        case .channel:
            guard let channelID = UUID(uuidString: target.targetId),
                  let messageID = target.channelMessageId,
                  let rootMessageID = target.rootMessageId else { return }
            issuePreparationRevision &+= 1
            preparingIssue = false
            pendingIssueID = nil
            pendingIssueDetailTab = nil
            pendingSessionID = nil
            pendingProjectID = target.projectId
            pendingChannelID = channelID
            pendingChannelMessageID = messageID
            pendingChannelRootMessageID = rootMessageID
            pendingChannelThread = nil
            selectedTab = .home
            pathChannelToken &+= 1
        }
    }

    func consumePendingIssue() -> UUID? {
        defer {
            pendingIssueID = nil
            pendingIssueDetailTab = nil
            pendingProjectID = nil
        }
        return pendingIssueID
    }

    func consumePendingIssueNavigation(
        projectID: UUID,
        runID: UUID,
        pathToken: Int
    ) -> CompanionIssueNavigationRoute? {
        guard
            pendingProjectID == projectID,
            pendingIssueID == runID,
            pathIssueToken == pathToken,
            selectedTab == .tasks
        else { return nil }
        let route = CompanionIssueNavigationRoute(
            runID: runID,
            initialTab: pendingIssueDetailTab
        )
        _ = consumePendingIssue()
        return route
    }

    func consumePendingIssue(
        projectID: UUID,
        runID: UUID,
        pathToken: Int
    ) -> UUID? {
        guard
            pendingProjectID == projectID,
            pendingIssueID == runID,
            pathIssueToken == pathToken,
            selectedTab == .tasks
        else { return nil }
        return consumePendingIssue()
    }

    func cancelPendingIssue() {
        issuePreparationRevision &+= 1
        preparingIssue = false
        guard pendingIssueID != nil else { return }
        pendingIssueID = nil
        pendingIssueDetailTab = nil
        pendingProjectID = nil
    }

    func consumePendingSession() -> String? {
        defer {
            pendingSessionID = nil
            pendingProjectID = nil
        }
        return pendingSessionID
    }

    func consumePendingChannel() -> (channelID: UUID, messageID: UUID, rootMessageID: UUID)? {
        guard let channelID = pendingChannelID,
              let messageID = pendingChannelMessageID,
              let rootMessageID = pendingChannelRootMessageID else { return nil }
        pendingChannelID = nil
        pendingChannelMessageID = nil
        pendingChannelRootMessageID = nil
        pendingProjectID = nil
        return (channelID, messageID, rootMessageID)
    }
}
