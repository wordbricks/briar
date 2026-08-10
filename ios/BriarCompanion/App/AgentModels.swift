import Foundation

struct ProjectAgent: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let projectId: UUID
    let name: String
    let avatar: String?
    let codexPet: CodexPet?
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let responsibility: String
    let skill: String
    let skills: [Skill]
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

    struct Skill: Codable, Equatable, Identifiable, Sendable {
        let id: UUID
        let agentId: UUID
        let name: String
        let instructions: String
        let provider: AgentProvider
        let model: String?
        let effort: ModelEffort?
        let kind: Kind
        let position: Int
        let createdAt: Date
        let updatedAt: Date

        enum Kind: String, Codable, Sendable {
            case issueProcessing = "issue_processing"
            case custom
        }
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
    let skillId: UUID?
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
    let requestedWorkerId: String?
    let workerId: String?
    let summary: String?
    let error: String?
    let events: [Event]?
    let updatedAt: Date?

    init(
        id: String,
        projectId: UUID,
        dispatchGroupId: String?,
        agentId: UUID?,
        skillId: UUID? = nil,
        sessionType: SessionType?,
        trigger: Trigger?,
        scheduleId: String?,
        scheduleRunId: String?,
        parentSessionId: String?,
        request: String?,
        status: Status,
        issues: [Issue],
        startedAt: Date,
        completedAt: Date?,
        conversationId: String?,
        workspaceRoot: String?,
        requestedWorkerId: String? = nil,
        workerId: String? = nil,
        summary: String?,
        error: String?,
        events: [Event]?,
        updatedAt: Date?
    ) {
        self.id = id
        self.projectId = projectId
        self.dispatchGroupId = dispatchGroupId
        self.agentId = agentId
        self.skillId = skillId
        self.sessionType = sessionType
        self.trigger = trigger
        self.scheduleId = scheduleId
        self.scheduleRunId = scheduleRunId
        self.parentSessionId = parentSessionId
        self.request = request
        self.status = status
        self.issues = issues
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.conversationId = conversationId
        self.workspaceRoot = workspaceRoot
        self.requestedWorkerId = requestedWorkerId
        self.workerId = workerId
        self.summary = summary
        self.error = error
        self.events = events
        self.updatedAt = updatedAt
    }

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

struct ProjectAgentTaskRequest: Codable, Equatable, Sendable {
    let agentId: UUID
    let skillId: UUID
    let request: String
    let workerId: String
    let requestId: UUID

    private enum CodingKeys: String, CodingKey {
        case agentId
        case skillId
        case request
        case workerId
        case requestId
    }

    /// Agent and Skill IDs are stored as lowercase strings and compared
    /// case-sensitively. Foundation's synthesized UUID encoding uses uppercase
    /// characters, so keep every UUID request field in the API's canonical form.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentId.uuidString.lowercased(), forKey: .agentId)
        try container.encode(skillId.uuidString.lowercased(), forKey: .skillId)
        try container.encode(request, forKey: .request)
        try container.encode(workerId, forKey: .workerId)
        try container.encode(requestId.uuidString.lowercased(), forKey: .requestId)
    }
}

struct ProjectAgentTaskResponse: Codable, Equatable, Sendable {
    let session: ProjectAgentSession
}

struct ProjectAgentSessionsResponse: Codable, Equatable, Sendable {
    let sessions: [ProjectAgentSession]
}

struct ProjectAgentSessionResponse: Codable, Equatable, Sendable {
    let session: ProjectAgentSession
}

struct ProjectAgentSessionSyncRequest: Codable, Sendable {
    let dispatchGroupId: String
    let agentId: UUID?
    let skillId: UUID?
    let sessionType: ProjectAgentSession.SessionType
    let trigger: ProjectAgentSession.Trigger?
    let scheduleId: String?
    let scheduleRunId: String?
    let parentSessionId: String?
    let request: String?
    let status: ProjectAgentSession.Status
    let issues: [ProjectAgentSession.Issue]
    let startedAt: Date
    let completedAt: Date?
    let conversationId: String?
    let summary: String?
    let error: String?
    let events: [ProjectAgentSession.Event]
    let updatedAt: Date

    init(session: ProjectAgentSession) {
        dispatchGroupId = session.dispatchGroupId ?? session.id
        agentId = session.agentId
        skillId = session.skillId
        sessionType = session.sessionType ?? .dispatch
        trigger = session.trigger
        scheduleId = session.scheduleId
        scheduleRunId = session.scheduleRunId
        parentSessionId = session.parentSessionId
        request = session.request
        status = session.status
        issues = session.issues
        startedAt = session.startedAt
        completedAt = session.completedAt
        conversationId = session.conversationId
        summary = session.summary
        error = session.error
        events = session.events ?? []
        updatedAt = session.updatedAt ?? session.completedAt ?? session.startedAt
    }

    private enum CodingKeys: String, CodingKey {
        case dispatchGroupId
        case agentId
        case skillId
        case sessionType
        case trigger
        case scheduleId
        case scheduleRunId
        case parentSessionId
        case request
        case status
        case issues
        case startedAt
        case completedAt
        case conversationId
        case summary
        case error
        case events
        case updatedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dispatchGroupId, forKey: .dispatchGroupId)
        try encode(agentId, forKey: .agentId, into: &container)
        try encode(skillId, forKey: .skillId, into: &container)
        try container.encode(sessionType, forKey: .sessionType)
        try encode(trigger, forKey: .trigger, into: &container)
        try encode(scheduleId, forKey: .scheduleId, into: &container)
        try encode(scheduleRunId, forKey: .scheduleRunId, into: &container)
        try encode(parentSessionId, forKey: .parentSessionId, into: &container)
        try encode(request, forKey: .request, into: &container)
        try container.encode(status, forKey: .status)
        try container.encode(issues, forKey: .issues)
        try container.encode(startedAt, forKey: .startedAt)
        try encode(completedAt, forKey: .completedAt, into: &container)
        try encode(conversationId, forKey: .conversationId, into: &container)
        try encode(summary, forKey: .summary, into: &container)
        try encode(error, forKey: .error, into: &container)
        try container.encode(events, forKey: .events)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    private func encode<Value: Encodable, Key: CodingKey>(
        _ value: Value?,
        forKey key: Key,
        into container: inout KeyedEncodingContainer<Key>
    ) throws {
        if let value {
            try container.encode(value, forKey: key)
        } else {
            try container.encodeNil(forKey: key)
        }
    }
}
