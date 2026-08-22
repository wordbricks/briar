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
    let description: String?
    let responsibility: String
    let skill: String
    let skills: [Skill]
    let calendarColor: String
    let createdAt: Date
    let updatedAt: Date

    var displayDescription: String? {
        guard let description = description?.trimmingCharacters(in: .whitespacesAndNewlines),
              !description.isEmpty else {
            return nil
        }
        return description
    }

    var summary: String { displayDescription ?? responsibility }

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

/// An Agent-authored request to run one immutable saved Skill. The Agent,
/// Skill, natural-language request, and runtime are server snapshots; native
/// clients only choose the exact Worker at the separate approval boundary.
struct AgentSkillExecutionProposal: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: UUID
    let type: Kind
    let status: Status
    let projectId: UUID
    let agentId: UUID
    let agentName: String
    let skillId: UUID
    let skillName: String
    let request: String
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let createdAt: Date
    let acceptedAt: Date?
    let requestedWorkerId: String?
    let requestedWorkerLabel: String?
    let resultSessionId: String?
    let delegatedByAgentId: UUID?
    let delegatedByAgentName: String?

    enum Kind: String, Codable, Hashable, Sendable {
        case executeAgentSkill = "request_agent_skill_execute"
    }

    enum Status: String, Codable, Hashable, Sendable {
        case pending
        case accepted
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, status, projectId, agentId, agentName, skillId, skillName
        case request, provider, model, effort, createdAt, acceptedAt
        case requestedWorkerId, requestedWorkerLabel, resultSessionId
        case delegatedByAgentId, delegatedByAgentName
    }

    init(
        id: UUID,
        type: Kind = .executeAgentSkill,
        status: Status,
        projectId: UUID,
        agentId: UUID,
        agentName: String,
        skillId: UUID,
        skillName: String,
        request: String,
        provider: AgentProvider,
        model: String? = nil,
        effort: ModelEffort? = nil,
        createdAt: Date,
        acceptedAt: Date? = nil,
        requestedWorkerId: String? = nil,
        requestedWorkerLabel: String? = nil,
        resultSessionId: String? = nil,
        delegatedByAgentId: UUID? = nil,
        delegatedByAgentName: String? = nil
    ) {
        self.id = id
        self.type = type
        self.status = status
        self.projectId = projectId
        self.agentId = agentId
        self.agentName = agentName
        self.skillId = skillId
        self.skillName = skillName
        self.request = request
        self.provider = provider
        self.model = model
        self.effort = effort
        self.createdAt = createdAt
        self.acceptedAt = acceptedAt
        self.requestedWorkerId = requestedWorkerId
        self.requestedWorkerLabel = requestedWorkerLabel
        self.resultSessionId = resultSessionId
        self.delegatedByAgentId = delegatedByAgentId
        self.delegatedByAgentName = delegatedByAgentName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(Kind.self, forKey: .type)
        status = try container.decode(Status.self, forKey: .status)
        projectId = try container.decode(UUID.self, forKey: .projectId)
        agentId = try container.decode(UUID.self, forKey: .agentId)
        agentName = try container.decode(String.self, forKey: .agentName)
        skillId = try container.decode(UUID.self, forKey: .skillId)
        skillName = try container.decode(String.self, forKey: .skillName)
        request = try container.decode(String.self, forKey: .request)
        provider = try container.decode(AgentProvider.self, forKey: .provider)
        // Canonical nullable fields must be present. This rejects a partial
        // proposal instead of silently inventing mutable runtime metadata.
        model = try container.decode(String?.self, forKey: .model)
        effort = try container.decode(ModelEffort?.self, forKey: .effort)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        acceptedAt = try container.decode(Date?.self, forKey: .acceptedAt)
        requestedWorkerId = try container.decode(String?.self, forKey: .requestedWorkerId)
        requestedWorkerLabel = try container.decode(
            String?.self,
            forKey: .requestedWorkerLabel
        )
        resultSessionId = try container.decode(String?.self, forKey: .resultSessionId)
        delegatedByAgentId = try container.decode(UUID?.self, forKey: .delegatedByAgentId)
        delegatedByAgentName = try container.decode(
            String?.self,
            forKey: .delegatedByAgentName
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(status, forKey: .status)
        try container.encode(projectId, forKey: .projectId)
        try container.encode(agentId, forKey: .agentId)
        try container.encode(agentName, forKey: .agentName)
        try container.encode(skillId, forKey: .skillId)
        try container.encode(skillName, forKey: .skillName)
        try container.encode(request, forKey: .request)
        try container.encode(provider, forKey: .provider)
        try container.encode(model, forKey: .model)
        try container.encode(effort, forKey: .effort)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(acceptedAt, forKey: .acceptedAt)
        try container.encode(requestedWorkerId, forKey: .requestedWorkerId)
        try container.encode(requestedWorkerLabel, forKey: .requestedWorkerLabel)
        try container.encode(resultSessionId, forKey: .resultSessionId)
        try container.encode(delegatedByAgentId, forKey: .delegatedByAgentId)
        try container.encode(delegatedByAgentName, forKey: .delegatedByAgentName)
    }
}

struct ProjectAgentSession: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let projectId: UUID
    let dispatchGroupId: String?
    let agentId: UUID?
    let agentName: String?
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
    let requestedByUserId: String?
    let summary: String?
    let error: String?
    let events: [Event]?
    let updatedAt: Date?

    init(
        id: String,
        projectId: UUID,
        dispatchGroupId: String?,
        agentId: UUID?,
        agentName: String? = nil,
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
        updatedAt: Date?,
        requestedByUserId: String? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.dispatchGroupId = dispatchGroupId
        self.agentId = agentId
        self.agentName = agentName
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
        self.requestedByUserId = requestedByUserId
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

        var displayName: String { displayName(locale: .current) }

        func displayName(locale: CompanionLocale) -> String {
            switch self {
            case .running: L10n.text("실행 중", locale: locale)
            case .completed: L10n.text("완료", locale: locale)
            case .failed: L10n.text("실패", locale: locale)
            case .skipped: L10n.text("건너뜀", locale: locale)
            case .interrupted: L10n.text("중단", locale: locale)
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

            var displayName: String { displayName(locale: .current) }

            func displayName(locale: CompanionLocale) -> String {
                switch self {
                case .pending: L10n.text("대기", locale: locale)
                case .completed: L10n.text("완료", locale: locale)
                case .blocked: L10n.text("확인 필요", locale: locale)
                case .failed: L10n.text("실패", locale: locale)
                case .skipped: L10n.text("건너뜀", locale: locale)
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

struct AcceptAgentSkillExecutionProposalRequest: Codable, Equatable, Sendable {
    let workerId: String
}

struct AcceptAgentSkillExecutionProposalResponse: Codable, Equatable, Sendable {
    let outcome: Outcome
    let proposal: AgentSkillExecutionProposal
    let projectId: UUID
    let session: ProjectAgentSession

    enum Outcome: String, Codable, Equatable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
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
    let agentName: String?
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
        agentName = session.agentName
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
        case agentName
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
        try encode(agentName, forKey: .agentName, into: &container)
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
