import Foundation

enum BriarLinkTarget: Equatable, Sendable {
    case issue(projectID: UUID, runID: UUID)
    case session(projectID: UUID, sessionID: String)

    var projectID: UUID {
        switch self {
        case let .issue(projectID, _): projectID
        case let .session(projectID, _): projectID
        }
    }
}

enum BriarLinkParser {
    static func parse(_ value: String) -> BriarLinkTarget? {
        guard let url = URL(string: value) else { return nil }
        return parse(url)
    }

    static func parse(_ url: URL) -> BriarLinkTarget? {
        if url.scheme == "briar-companion" {
            let host = url.host?.lowercased() ?? ""
            let parts = url.path.split(separator: "/").map(String.init)
            if host == "issues", parts.count >= 2,
               let projectID = UUID(uuidString: parts[0]),
               let runID = UUID(uuidString: parts[1]) {
                return .issue(projectID: projectID, runID: runID)
            }
            if host == "sessions", parts.count >= 2,
               let projectID = UUID(uuidString: parts[0]) {
                return .session(projectID: projectID, sessionID: parts[1])
            }
            // auth-complete and other non-navigation hosts are ignored here.
            return nil
        }

        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        let segments = url.path.split(separator: "/").map(String.init)
        // /open/issues/{projectId}/{runId}
        if segments.count >= 4, segments[0] == "open", segments[1] == "issues",
           let projectID = UUID(uuidString: segments[2]),
           let runID = UUID(uuidString: segments[3]) {
            return .issue(projectID: projectID, runID: runID)
        }
        // /open/sessions/{projectId}/{sessionId}
        if segments.count >= 4, segments[0] == "open", segments[1] == "sessions",
           let projectID = UUID(uuidString: segments[2]) {
            return .session(projectID: projectID, sessionID: segments[3])
        }
        return nil
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

    static var defaultOrigin: URL {
        let configured = ProcessInfo.processInfo.environment["BRIAR_API_URL"] ??
            "https://briar-api.wbai.workers.dev"
        return URL(string: configured) ?? URL(string: "https://briar-api.wbai.workers.dev")!
    }
}

@MainActor
final class CompanionNavigationModel: ObservableObject {
    enum Tab: Hashable {
        case home
        case tasks
        case agents
        case inbox
    }

    @Published var selectedTab: Tab = .tasks
    @Published var pendingIssueID: UUID?
    @Published var pendingSessionID: String?
    @Published var pendingProjectID: UUID?
    @Published var pathIssueToken = 0
    @Published var pathSessionToken = 0

    func open(_ target: BriarLinkTarget) {
        pendingProjectID = target.projectID
        switch target {
        case let .issue(_, runID):
            pendingIssueID = runID
            pendingSessionID = nil
            selectedTab = .tasks
            pathIssueToken &+= 1
        case let .session(_, sessionID):
            pendingSessionID = sessionID
            pendingIssueID = nil
            selectedTab = .agents
            pathSessionToken &+= 1
        }
    }

    func openInboxMessage(_ message: InboxMessage) {
        switch message.kind {
        case .issue, .conversation:
            if let runID = UUID(uuidString: message.targetId) {
                open(.issue(projectID: message.projectId, runID: runID))
            }
        case .session:
            open(.session(projectID: message.projectId, sessionID: message.targetId))
        }
    }

    func consumePendingIssue() -> UUID? {
        defer { pendingIssueID = nil }
        return pendingIssueID
    }

    func consumePendingSession() -> String? {
        defer { pendingSessionID = nil }
        return pendingSessionID
    }
}
