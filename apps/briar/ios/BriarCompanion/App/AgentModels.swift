import BriarContracts
import Foundation
import SwiftProtobuf

struct ProjectAgent: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let projectId: UUID
    let name: String
    let avatar: String?
    let codexPet: CodexPet?
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let designatedWorkerId: String?
    let designatedWorkerLabel: String?
    let description: String?
    let responsibility: String
    let skill: String
    let skills: [Skill]
    let calendarColor: String
    let createdAt: Date
    let updatedAt: Date

    init(
        id: UUID,
        projectId: UUID,
        name: String,
        avatar: String?,
        codexPet: CodexPet?,
        provider: AgentProvider,
        model: String?,
        effort: ModelEffort?,
        designatedWorkerId: String? = nil,
        designatedWorkerLabel: String? = nil,
        description: String?,
        responsibility: String,
        skill: String,
        skills: [Skill],
        calendarColor: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.projectId = projectId
        self.name = name
        self.avatar = avatar
        self.codexPet = codexPet
        self.provider = provider
        self.model = model
        self.effort = effort
        self.designatedWorkerId = designatedWorkerId
        self.designatedWorkerLabel = designatedWorkerLabel
        self.description = description
        self.responsibility = responsibility
        self.skill = skill
        self.skills = skills
        self.calendarColor = calendarColor
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

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
        let description: String?
        let executionMode: ExecutionMode
        let approvalPolicy: ApprovalPolicy
        let position: Int
        let createdAt: Date
        let updatedAt: Date

        init(
            id: UUID,
            agentId: UUID,
            name: String,
            instructions: String,
            provider: AgentProvider,
            model: String?,
            effort: ModelEffort?,
            kind: Kind,
            description: String? = nil,
            executionMode: ExecutionMode = .task,
            approvalPolicy: ApprovalPolicy = .explicit,
            position: Int,
            createdAt: Date,
            updatedAt: Date
        ) {
            self.id = id
            self.agentId = agentId
            self.name = name
            self.instructions = instructions
            self.provider = provider
            self.model = model
            self.effort = effort
            self.kind = kind
            self.description = description
            self.executionMode = executionMode
            self.approvalPolicy = approvalPolicy
            self.position = position
            self.createdAt = createdAt
            self.updatedAt = updatedAt
        }

        enum Kind: String, Codable, Sendable {
            case issueProcessing = "issue_processing"
            case custom
        }

        enum ExecutionMode: String, Codable, Sendable {
            case conversation
            case task
        }

        enum ApprovalPolicy: String, Codable, Sendable {
            case invokeIsConsent = "invoke_is_consent"
            case explicit
        }
    }
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
    let executionMode: ExecutionMode
    let approvalPolicy: ApprovalPolicy
    let executionStatus: ExecutionStatus
    let createdAt: Date
    let acceptedAt: Date?
    let requestedWorkerId: String?
    let requestedWorkerLabel: String?
    let resultSessionId: String?
    let resultMessageId: UUID?
    let error: String?
    let delegatedByAgentId: UUID?
    let delegatedByAgentName: String?

    enum Kind: String, Codable, Hashable, Sendable {
        case executeAgentSkill = "request_agent_skill_execute"
    }

    enum Status: String, Codable, Hashable, Sendable {
        case pending
        case accepted
    }

    enum ExecutionMode: String, Codable, Hashable, Sendable {
        case conversation
        case task
    }

    enum ApprovalPolicy: String, Codable, Hashable, Sendable {
        case invokeIsConsent = "invoke_is_consent"
        case explicit
    }

    enum ExecutionStatus: String, Codable, Hashable, Sendable {
        case waiting
        case running
        case completed
        case failed
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, status, projectId, agentId, agentName, skillId, skillName
        case request, provider, model, effort, createdAt, acceptedAt
        case executionMode, approvalPolicy, executionStatus
        case requestedWorkerId, requestedWorkerLabel, resultSessionId
        case resultMessageId, error
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
        executionMode: ExecutionMode = .task,
        approvalPolicy: ApprovalPolicy = .explicit,
        executionStatus: ExecutionStatus? = nil,
        createdAt: Date,
        acceptedAt: Date? = nil,
        requestedWorkerId: String? = nil,
        requestedWorkerLabel: String? = nil,
        resultSessionId: String? = nil,
        resultMessageId: UUID? = nil,
        error: String? = nil,
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
        self.executionMode = executionMode
        self.approvalPolicy = approvalPolicy
        self.executionStatus = executionStatus ?? (
            status == .pending ? .waiting : .running
        )
        self.createdAt = createdAt
        self.acceptedAt = acceptedAt
        self.requestedWorkerId = requestedWorkerId
        self.requestedWorkerLabel = requestedWorkerLabel
        self.resultSessionId = resultSessionId
        self.resultMessageId = resultMessageId
        self.error = error
        self.delegatedByAgentId = delegatedByAgentId
        self.delegatedByAgentName = delegatedByAgentName
    }

    init(from decoder: Swift.Decoder) throws {
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
        executionMode = try container.decodeIfPresent(
            ExecutionMode.self,
            forKey: .executionMode
        ) ?? .task
        approvalPolicy = try container.decodeIfPresent(
            ApprovalPolicy.self,
            forKey: .approvalPolicy
        ) ?? .explicit
        executionStatus = try container.decodeIfPresent(
            ExecutionStatus.self,
            forKey: .executionStatus
        ) ?? (status == .pending ? .waiting : .running)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        acceptedAt = try container.decode(Date?.self, forKey: .acceptedAt)
        requestedWorkerId = try container.decode(String?.self, forKey: .requestedWorkerId)
        requestedWorkerLabel = try container.decode(
            String?.self,
            forKey: .requestedWorkerLabel
        )
        resultSessionId = try container.decode(String?.self, forKey: .resultSessionId)
        resultMessageId = try container.decodeIfPresent(UUID.self, forKey: .resultMessageId)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        delegatedByAgentId = try container.decode(UUID?.self, forKey: .delegatedByAgentId)
        delegatedByAgentName = try container.decode(
            String?.self,
            forKey: .delegatedByAgentName
        )
    }

    func encode(to encoder: Swift.Encoder) throws {
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
        try container.encode(executionMode, forKey: .executionMode)
        try container.encode(approvalPolicy, forKey: .approvalPolicy)
        try container.encode(executionStatus, forKey: .executionStatus)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(acceptedAt, forKey: .acceptedAt)
        try container.encode(requestedWorkerId, forKey: .requestedWorkerId)
        try container.encode(requestedWorkerLabel, forKey: .requestedWorkerLabel)
        try container.encode(resultSessionId, forKey: .resultSessionId)
        try container.encode(resultMessageId, forKey: .resultMessageId)
        try container.encode(error, forKey: .error)
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
    let followUps: [FollowUp]?
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
    let archived: Bool?

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
        followUps: [FollowUp]? = nil,
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
        requestedByUserId: String? = nil,
        archived: Bool? = nil
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
        self.followUps = followUps
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
        self.archived = archived
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

    struct FollowUp: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let message: String
        let sentAt: Date
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

struct AcceptAgentSkillExecutionProposalRequest: Codable, Equatable, Sendable {
    let workerId: String?
}

struct AcceptAgentSkillExecutionProposalResponse: Codable, Equatable, Sendable {
    let outcome: Outcome
    let proposal: AgentSkillExecutionProposal
    let projectId: UUID
    let session: ProjectAgentSession?

    enum Outcome: String, Codable, Equatable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
}

extension ProjectAgent {
    init(connectMessage message: BriarAPI_ProjectAgent) throws {
        guard
            let id = UUID(uuidString: message.id),
            let projectID = UUID(uuidString: message.projectID),
            message.hasCreatedAt,
            message.hasUpdatedAt
        else {
            throw MobileAPIError.invalidResponse
        }

        self.init(
            id: id,
            projectId: projectID,
            name: message.name,
            avatar: message.hasAvatar ? message.avatar : nil,
            codexPet: message.hasCodexPet
                ? try CodexPet(connectMessage: message.codexPet)
                : nil,
            provider: try AgentProvider(connectMessage: message.provider),
            model: message.hasModel ? message.model : nil,
            effort: message.hasEffort ? ModelEffort(rawValue: message.effort) : nil,
            designatedWorkerId: message.hasDesignatedWorkerID
                ? message.designatedWorkerID
                : nil,
            designatedWorkerLabel: message.hasDesignatedWorkerLabel
                ? message.designatedWorkerLabel
                : nil,
            description: message.hasDescription_p ? message.description_p : nil,
            responsibility: message.responsibility,
            skill: message.skill,
            skills: try message.skills.map { try Skill(connectMessage: $0) },
            calendarColor: message.calendarColor,
            createdAt: try agentDate(message.createdAt),
            updatedAt: try agentDate(message.updatedAt)
        )
    }
}

private extension ProjectAgent.CodexPet {
    init(connectMessage message: BriarAPI_CodexPet) throws {
        self.init(
            slug: message.slug,
            name: message.name,
            author: message.hasAuthor ? message.author : nil,
            license: message.hasLicense ? message.license : nil,
            spriteVersion: message.hasSpriteVersion
                ? try agentSafeInt(message.spriteVersion)
                : nil,
            spriteSheetUrl: message.hasSpriteSheetURL ? message.spriteSheetURL : nil
        )
    }
}

private extension ProjectAgent.Skill {
    init(connectMessage message: BriarAPI_ProjectAgentSkill) throws {
        guard
            let id = UUID(uuidString: message.id),
            let agentID = UUID(uuidString: message.agentID),
            message.hasCreatedAt,
            message.hasUpdatedAt
        else {
            throw MobileAPIError.invalidResponse
        }
        let kind: Kind
        switch message.kind {
        case .issueProcessing:
            kind = .issueProcessing
        case .custom:
            kind = .custom
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        let executionMode: ExecutionMode
        switch message.executionMode {
        case .conversation:
            executionMode = .conversation
        case .task:
            executionMode = .task
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        let approvalPolicy: ApprovalPolicy
        switch message.approvalPolicy {
        case .invokeIsConsent:
            approvalPolicy = .invokeIsConsent
        case .explicit:
            approvalPolicy = .explicit
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: id,
            agentId: agentID,
            name: message.name,
            instructions: message.body,
            provider: try AgentProvider(connectMessage: message.provider),
            model: message.hasModel ? message.model : nil,
            effort: message.hasEffort ? ModelEffort(rawValue: message.effort) : nil,
            kind: kind,
            description: message.description_p.isEmpty ? nil : message.description_p,
            executionMode: executionMode,
            approvalPolicy: approvalPolicy,
            position: try agentSafeInt(message.position),
            createdAt: try agentDate(message.createdAt),
            updatedAt: try agentDate(message.updatedAt)
        )
    }
}

extension ProjectAgentSession {
    init(connectMessage message: BriarAPI_ProjectAgentSession) throws {
        guard
            !message.id.isEmpty,
            let projectID = UUID(uuidString: message.projectID),
            message.hasStartedAt
        else {
            throw MobileAPIError.invalidResponse
        }

        let sessionType: SessionType?
        if message.hasSessionType {
            switch message.sessionType {
            case .task:
                sessionType = .task
            case .dispatch:
                sessionType = .dispatch
            case .unspecified, .UNRECOGNIZED:
                throw MobileAPIError.invalidResponse
            }
        } else {
            sessionType = nil
        }

        let trigger: Trigger?
        if message.hasTrigger {
            switch message.trigger {
            case .manual:
                trigger = .manual
            case .scheduled:
                trigger = .scheduled
            case .unspecified, .UNRECOGNIZED:
                throw MobileAPIError.invalidResponse
            }
        } else {
            trigger = nil
        }

        let status: Status
        switch message.status {
        case .running:
            status = .running
        case .completed:
            status = .completed
        case .failed:
            status = .failed
        case .skipped:
            status = .skipped
        case .interrupted:
            status = .interrupted
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }

        self.init(
            id: message.id,
            projectId: projectID,
            dispatchGroupId: message.hasDispatchGroupID ? message.dispatchGroupID : nil,
            agentId: try agentOptionalUUID(message.agentID, isPresent: message.hasAgentID),
            agentName: message.hasAgentName ? message.agentName : nil,
            skillId: try agentOptionalUUID(message.skillID, isPresent: message.hasSkillID),
            sessionType: sessionType,
            trigger: trigger,
            scheduleId: message.hasScheduleID ? message.scheduleID : nil,
            scheduleRunId: message.hasScheduleRunID ? message.scheduleRunID : nil,
            parentSessionId: message.hasParentSessionID ? message.parentSessionID : nil,
            request: message.hasRequest ? message.request : nil,
            followUps: try message.followUps.map { try FollowUp(connectMessage: $0) },
            status: status,
            issues: try message.issues.map { try Issue(connectMessage: $0) },
            startedAt: try agentDate(message.startedAt),
            completedAt: message.hasCompletedAt ? try agentDate(message.completedAt) : nil,
            conversationId: message.hasConversationID ? message.conversationID : nil,
            workspaceRoot: nil,
            requestedWorkerId: message.hasRequestedWorkerID ? message.requestedWorkerID : nil,
            workerId: message.hasWorkerID ? message.workerID : nil,
            summary: message.hasSummary ? message.summary : nil,
            error: message.hasError ? message.error : nil,
            events: try message.events.map { try Event(connectMessage: $0) },
            updatedAt: message.hasUpdatedAt ? try agentDate(message.updatedAt) : nil,
            requestedByUserId: message.hasRequestedByUserID ? message.requestedByUserID : nil,
            archived: message.archived
        )
    }

    func putConnectRequest(projectID: UUID) throws -> BriarAPI_PutProjectAgentSessionRequest {
        var request = BriarAPI_PutProjectAgentSessionRequest()
        request.projectID = projectID.uuidString.lowercased()
        request.sessionID = id
        request.dispatchGroupID = dispatchGroupId ?? id
        if let agentId { request.agentID = agentId.uuidString.lowercased() }
        if let agentName { request.agentName = agentName }
        if let skillId { request.skillID = skillId.uuidString.lowercased() }
        request.sessionType = switch sessionType ?? .dispatch {
        case .task: .task
        case .dispatch: .dispatch
        }
        if let trigger {
            request.trigger = switch trigger {
            case .manual: .manual
            case .scheduled: .scheduled
            }
        }
        if let scheduleId { request.scheduleID = scheduleId }
        if let scheduleRunId { request.scheduleRunID = scheduleRunId }
        if let parentSessionId { request.parentSessionID = parentSessionId }
        if let requestText = self.request { request.request = requestText }
        request.followUps = try (followUps ?? []).map { try $0.connectMessage() }
        request.status = switch status {
        case .running: .running
        case .completed: .completed
        case .failed: .failed
        case .skipped: .skipped
        case .interrupted: .interrupted
        }
        request.issues = try issues.map { try $0.connectMessage() }
        request.startedAt = .init(date: startedAt)
        if let completedAt { request.completedAt = .init(date: completedAt) }
        if let conversationId { request.conversationID = conversationId }
        if let summary { request.summary = summary }
        if let error { request.error = error }
        if let requestedWorkerId { request.requestedWorkerID = requestedWorkerId }
        if let workerId { request.workerID = workerId }
        request.events = (events ?? []).map(\.connectMessage)
        request.updatedAt = .init(date: updatedAt ?? completedAt ?? startedAt)
        return request
    }

    func preservingLocalFields(from local: ProjectAgentSession) -> ProjectAgentSession {
        guard workspaceRoot == nil, local.workspaceRoot != nil else { return self }
        return ProjectAgentSession(
            id: id,
            projectId: projectId,
            dispatchGroupId: dispatchGroupId,
            agentId: agentId,
            agentName: agentName,
            skillId: skillId,
            sessionType: sessionType,
            trigger: trigger,
            scheduleId: scheduleId,
            scheduleRunId: scheduleRunId,
            parentSessionId: parentSessionId,
            request: request,
            followUps: followUps,
            status: status,
            issues: issues,
            startedAt: startedAt,
            completedAt: completedAt,
            conversationId: conversationId,
            workspaceRoot: local.workspaceRoot,
            requestedWorkerId: requestedWorkerId,
            workerId: workerId,
            summary: summary,
            error: error,
            events: events,
            updatedAt: updatedAt,
            requestedByUserId: requestedByUserId,
            archived: archived
        )
    }
}

private extension ProjectAgentSession.FollowUp {
    init(connectMessage message: BriarAPI_ProjectAgentSessionFollowUp) throws {
        guard message.hasSentAt else { throw MobileAPIError.invalidResponse }
        self.init(id: message.id, message: message.message, sentAt: try agentDate(message.sentAt))
    }

    func connectMessage() throws -> BriarAPI_ProjectAgentSessionFollowUp {
        guard !id.isEmpty, !message.isEmpty else { throw MobileAPIError.invalidRequest }
        var result = BriarAPI_ProjectAgentSessionFollowUp()
        result.id = id
        result.message = message
        result.sentAt = .init(date: sentAt)
        return result
    }
}

private extension ProjectAgentSession.Issue {
    init(connectMessage message: BriarAPI_ProjectAgentSessionIssue) throws {
        let outcome: Outcome
        switch message.outcome {
        case .pending:
            outcome = .pending
        case .completed:
            outcome = .completed
        case .blocked:
            outcome = .blocked
        case .failed:
            outcome = .failed
        case .skipped:
            outcome = .skipped
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        self.init(
            runId: message.runID,
            runNumber: try agentSafeInt(message.runNumber),
            sourceKey: message.sourceKey,
            title: message.title,
            outcome: outcome,
            summary: message.hasSummary ? message.summary : nil
        )
    }

    func connectMessage() throws -> BriarAPI_ProjectAgentSessionIssue {
        var message = BriarAPI_ProjectAgentSessionIssue()
        message.runID = runId
        guard let runNumber = UInt32(exactly: runNumber) else {
            throw MobileAPIError.invalidRequest
        }
        message.runNumber = runNumber
        message.sourceKey = sourceKey
        message.title = title
        message.outcome = switch outcome {
        case .pending: .pending
        case .completed: .completed
        case .blocked: .blocked
        case .failed: .failed
        case .skipped: .skipped
        }
        if let summary { message.summary = summary }
        return message
    }
}

private extension ProjectAgentSession.Event {
    init(connectMessage message: BriarAPI_ProjectAgentSessionEvent) throws {
        guard message.hasOccurredAt else { throw MobileAPIError.invalidResponse }
        let type: EventType
        switch message.type {
        case .started:
            type = .started
        case .completed:
            type = .completed
        case .failed:
            type = .failed
        case .skipped:
            type = .skipped
        case .interrupted:
            type = .interrupted
        case .stopped:
            type = .stopped
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        self.init(id: message.id, type: type, occurredAt: try agentDate(message.occurredAt))
    }

    var connectMessage: BriarAPI_ProjectAgentSessionEvent {
        var message = BriarAPI_ProjectAgentSessionEvent()
        message.id = id
        message.type = switch type {
        case .started: .started
        case .completed: .completed
        case .failed: .failed
        case .skipped: .skipped
        case .interrupted: .interrupted
        case .stopped: .stopped
        }
        message.occurredAt = .init(date: occurredAt)
        return message
    }
}

extension ChannelAgentSummary {
    init(connectMessage message: BriarAPI_OrganizationAgent) throws {
        guard
            let agentID = UUID(uuidString: message.agentID),
            message.hasCreatedAt
        else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            agentId: agentID,
            name: message.name,
            avatar: message.hasAvatar ? message.avatar : nil,
            provider: try AgentProvider(connectMessage: message.provider).rawValue,
            model: message.hasModel ? message.model : nil,
            projectId: try agentOptionalUUID(message.projectID, isPresent: message.hasProjectID),
            description: message.hasDescription_p ? message.description_p : nil,
            responsibility: message.responsibility,
            createdAt: try agentDate(message.createdAt)
        )
    }
}

private extension AgentProvider {
    init(connectMessage provider: BriarTypes_AgentProvider) throws {
        switch provider {
        case .codex: self = .codex
        case .claude: self = .claude
        case .cursor: self = .cursor
        case .grok: self = .grok
        case .agy: self = .agy
        case .opencode: self = .opencode
        case .openrouter: self = .openrouter
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
    }
}

private func agentSafeInt<T: BinaryInteger>(_ value: T) throws -> Int {
    guard let result = Int(exactly: value) else { throw MobileAPIError.invalidResponse }
    return result
}

private func agentDate(_ value: Google_Protobuf_Timestamp) throws -> Date {
    guard (-62_135_596_800 ... 253_402_300_799).contains(value.seconds),
          (0 ... 999_999_999).contains(value.nanos)
    else { throw MobileAPIError.invalidResponse }
    return value.date
}

private func agentOptionalUUID(_ value: String, isPresent: Bool) throws -> UUID? {
    guard isPresent else { return nil }
    guard let id = UUID(uuidString: value) else { throw MobileAPIError.invalidResponse }
    return id
}
