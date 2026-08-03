import Foundation

struct ProjectAgent: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let projectId: UUID
    let name: String
    let avatar: String?
    let codexPet: CodexPet?
    let provider: AgentProvider
    let model: String?
    let responsibility: String
    let skill: String
    let calendarColor: String
    let createdAt: Date
    let updatedAt: Date

    struct CodexPet: Codable, Equatable, Sendable {
        let slug: String
        let name: String
        let author: String?
        let license: String?
        let spriteVersion: Int?
        let spriteSheetUrl: String?
    }
}

struct ProjectAgentsResponse: Codable, Equatable, Sendable {
    let agents: [ProjectAgent]
}

struct ProjectAgentSession: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let projectId: UUID
    let dispatchGroupId: String?
    let agentId: UUID?
    let sessionType: SessionType?
    let trigger: Trigger?
    let scheduleId: String?
    let scheduleRunId: String?
    let parentSessionId: String?
    let request: String?
    let status: Status
    let issues: [Issue]
    let startedAt: Date
    let completedAt: Date?
    let conversationId: String?
    let workspaceRoot: String?
    let summary: String?
    let error: String?
    let events: [Event]?
    let updatedAt: Date?

    enum SessionType: String, Codable, Sendable {
        case task
        case dispatch
    }

    enum Trigger: String, Codable, Sendable {
        case manual
        case scheduled
    }

    enum Status: String, Codable, Sendable, CaseIterable {
        case running
        case completed
        case failed
        case skipped
        case interrupted

        var displayName: String {
            switch self {
            case .running: "실행 중"
            case .completed: "완료"
            case .failed: "실패"
            case .skipped: "건너뜀"
            case .interrupted: "중단"
            }
        }
    }

    struct Issue: Codable, Equatable, Identifiable, Sendable {
        let runId: String
        let runNumber: Int
        let sourceKey: String
        let title: String
        let outcome: Outcome
        let summary: String?

        var id: String { runId }

        enum Outcome: String, Codable, Sendable {
            case pending
            case completed
            case blocked
            case failed
            case skipped

            var displayName: String {
                switch self {
                case .pending: "대기"
                case .completed: "완료"
                case .blocked: "확인 필요"
                case .failed: "실패"
                case .skipped: "건너뜀"
                }
            }
        }
    }

    struct Event: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let type: EventType
        let occurredAt: Date

        enum EventType: String, Codable, Sendable {
            case started
            case completed
            case failed
            case skipped
            case interrupted
            case stopped
        }
    }

    var title: String {
        if let request, !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return request
        }
        let issueTitles = issues.map(\.title).filter { !$0.isEmpty }
        if !issueTitles.isEmpty {
            return issueTitles.joined(separator: " · ")
        }
        return id
    }

    var requiresAttention: Bool {
        status == .failed ||
            issues.contains { $0.outcome == .blocked || $0.outcome == .failed }
    }

    var displayTimestamp: Date {
        completedAt ?? updatedAt ?? startedAt
    }
}

struct ProjectAgentSessionsResponse: Codable, Equatable, Sendable {
    let sessions: [ProjectAgentSession]
}

enum ProjectAgentLocale: String, CaseIterable, Identifiable, Sendable {
    case ko
    case en
    case zh

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ko: "한국어"
        case .en: "English"
        case .zh: "中文"
        }
    }
}
