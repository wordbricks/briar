import Foundation

struct IssueSubscriber: Codable, Equatable, Sendable {
    let userId: String
    let subscribedAt: Date
}

struct DashboardRun: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runNumber: Int?
    let currentAttempt: Int?
    let currentRevision: Int?
    let sourceKey: String?
    let sourceCreatedAt: Date?
    let title: String
    let status: Status
    let workflowStage: String?
    let workflow: AutoHuntWorkflow?
    let pausedAt: Date?
    let resumeRequestedAt: Date?
    let checkpoint: WorkflowCheckpoint?
    let progress: Double?
    let detail: String?
    let priority: Int?
    let assigneeUserId: String?
    let createdByUserId: String?
    let subscribers: [IssueSubscriber]?
    let issueDescription: String?
    let attachments: [IssueAttachment]?
    let prerequisites: [IssueDependencyReference]?
    let dependents: [IssueDependencyReference]?
    let executionReadiness: String?
    let waitingOnPrerequisiteCount: Int?
    let resultSummary: String?
    let structuredResult: StructuredRunResult?
    let resultReviews: [ResultReview]?
    let pullRequestUrls: [URL]?
    let branch: String?
    let commitSha: String?
    let preferredProvider: AgentProvider?
    let preferredModel: String?
    let preferredEffort: ModelEffort?
    let fullAuto: Bool?
    let dispatchedAt: Date?
    let requestedProvider: AgentProvider?
    let requestedModel: String?
    let requestedEffort: ModelEffort?
    let requestedWorkerId: String?
    let requestedByUserId: String?
    let dispatchMode: String?
    let claimedBy: String?
    let claimedAt: Date?
    let workerId: String?
    let startedAt: Date?
    let updatedAt: Date
    let completedAt: Date?
    let lastEventAt: String?
    let eventCount: Int?

    init(
        id: UUID,
        runNumber: Int? = nil,
        currentAttempt: Int? = nil,
        currentRevision: Int? = nil,
        sourceKey: String? = nil,
        sourceCreatedAt: Date? = nil,
        title: String,
        status: Status,
        workflowStage: String? = nil,
        workflow: AutoHuntWorkflow? = nil,
        pausedAt: Date? = nil,
        resumeRequestedAt: Date? = nil,
        checkpoint: WorkflowCheckpoint? = nil,
        progress: Double? = nil,
        detail: String? = nil,
        priority: Int? = nil,
        assigneeUserId: String? = nil,
        createdByUserId: String? = nil,
        subscribers: [IssueSubscriber]? = nil,
        issueDescription: String? = nil,
        attachments: [IssueAttachment]? = nil,
        prerequisites: [IssueDependencyReference]? = nil,
        dependents: [IssueDependencyReference]? = nil,
        executionReadiness: String? = nil,
        waitingOnPrerequisiteCount: Int? = nil,
        resultSummary: String? = nil,
        structuredResult: StructuredRunResult? = nil,
        resultReviews: [ResultReview]? = nil,
        pullRequestUrls: [URL]? = nil,
        branch: String? = nil,
        commitSha: String? = nil,
        preferredProvider: AgentProvider? = nil,
        preferredModel: String? = nil,
        preferredEffort: ModelEffort? = nil,
        fullAuto: Bool? = nil,
        dispatchedAt: Date? = nil,
        requestedProvider: AgentProvider? = nil,
        requestedModel: String? = nil,
        requestedEffort: ModelEffort? = nil,
        requestedWorkerId: String? = nil,
        requestedByUserId: String? = nil,
        dispatchMode: String? = nil,
        claimedBy: String? = nil,
        claimedAt: Date? = nil,
        workerId: String? = nil,
        startedAt: Date? = nil,
        updatedAt: Date,
        completedAt: Date? = nil,
        lastEventAt: String? = nil,
        eventCount: Int? = nil
    ) {
        self.id = id
        self.runNumber = runNumber
        self.currentAttempt = currentAttempt
        self.currentRevision = currentRevision
        self.sourceKey = sourceKey
        self.sourceCreatedAt = sourceCreatedAt
        self.title = title
        self.status = status
        self.workflowStage = workflowStage
        self.workflow = workflow
        self.pausedAt = pausedAt
        self.resumeRequestedAt = resumeRequestedAt
        self.checkpoint = checkpoint
        self.progress = progress
        self.detail = detail
        self.priority = priority
        self.assigneeUserId = assigneeUserId
        self.createdByUserId = createdByUserId
        self.subscribers = subscribers
        self.issueDescription = issueDescription
        self.attachments = attachments
        self.prerequisites = prerequisites
        self.dependents = dependents
        self.executionReadiness = executionReadiness
        self.waitingOnPrerequisiteCount = waitingOnPrerequisiteCount
        self.resultSummary = resultSummary
        self.structuredResult = structuredResult
        self.resultReviews = resultReviews
        self.pullRequestUrls = pullRequestUrls
        self.branch = branch
        self.commitSha = commitSha
        self.preferredProvider = preferredProvider
        self.preferredModel = preferredModel
        self.preferredEffort = preferredEffort
        self.fullAuto = fullAuto
        self.dispatchedAt = dispatchedAt
        self.requestedProvider = requestedProvider
        self.requestedModel = requestedModel
        self.requestedEffort = requestedEffort
        self.requestedWorkerId = requestedWorkerId
        self.requestedByUserId = requestedByUserId
        self.dispatchMode = dispatchMode
        self.claimedBy = claimedBy
        self.claimedAt = claimedAt
        self.workerId = workerId
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
        self.lastEventAt = lastEventAt
        self.eventCount = eventCount
    }

    enum Status: String, Codable, CaseIterable, Sendable {
        case backlog
        case queued
        case running
        case paused
        case blocked
        case failed
        case completed
        case cancelled

        var displayName: String { displayName(locale: .current) }

        func displayName(locale: CompanionLocale) -> String {
            switch self {
            case .backlog: L10n.text("대기", locale: locale)
            case .queued: L10n.text("실행 대기", locale: locale)
            case .running: L10n.text("진행 중", locale: locale)
            case .paused: L10n.text("검토 대기", locale: locale)
            case .blocked: L10n.text("차단", locale: locale)
            case .failed: L10n.text("실패", locale: locale)
            case .completed: L10n.text("완료", locale: locale)
            case .cancelled: L10n.text("취소", locale: locale)
            }
        }

        var needsAttention: Bool { self == .paused || self == .blocked || self == .failed }
        var isActive: Bool { self != .completed && self != .cancelled }

        /// States that surface a message in the Inbox; other transitions are too noisy.
        var showsInInbox: Bool { self == .paused || self == .completed || self == .failed || self == .blocked }

        /// Matches shared React RunPage: completed and paused issues open on the Result tab.
        var prefersResultDetailTab: Bool { self == .completed || self == .paused }
    }
}

struct WorkflowCheckpoint: Codable, Equatable, Sendable {
    let key: String
    let stage: String
    let stageLabel: String
    let position: Position
    let attempt: Int
    let revision: Int
    let reachedAt: Date?
    let nextStage: String?
    let nextStageLabel: String?
    let terminalReviewOnly: Bool

    enum Position: String, Codable, Sendable { case before, after }
}

struct AutoHuntWorkflow: Codable, Equatable, Sendable {
    let version: Int
    let stages: [Stage]

    struct Stage: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let label: String
        let required: Bool
    }
}

struct IssueAttachment: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let filename: String
    let contentType: String
    let byteSize: Int
    let url: String
}

struct StructuredRunResult: Codable, Equatable, Sendable {
    let summary: String
    let outcome: String
    let importance: String?
    let urgency: String?
    let impact: String?
    let humanActionRequired: Bool?
    let nextAction: String?
    let dueAt: Date?
}

struct ResultReview: Codable, Equatable, Identifiable, Sendable {
    let userId: String
    let name: String
    let username: String?
    let image: String?
    let completedAt: Date

    var id: String { userId }
}

struct DashboardWorker: Codable, Equatable, Identifiable, Sendable {
    struct Capabilities: Codable, Equatable, Sendable {
        let providerCapabilities: [String: AgentProviderCapability]?
    }
    struct Icon: Codable, Equatable, Sendable {
        enum Kind: String, Codable, Sendable {
            case emoji
            case image
        }

        let type: Kind
        let value: String
    }

    let id: String
    let label: String
    let icon: Icon?
    let agentProvider: AgentProvider?
    let providers: [AgentProvider]?
    let capabilities: Capabilities?
    let readiness: String
    let acceptingWork: Bool
    let readinessDetail: String?
    let activeSessions: Int
    let availableSessions: Int

    init(
        id: String,
        label: String,
        icon: Icon? = nil,
        agentProvider: AgentProvider? = nil,
        providers: [AgentProvider]? = nil,
        capabilities: Capabilities? = nil,
        readiness: String,
        acceptingWork: Bool,
        readinessDetail: String?,
        activeSessions: Int,
        availableSessions: Int
    ) {
        self.id = id
        self.label = label
        self.icon = icon
        self.agentProvider = agentProvider
        self.providers = providers
        self.capabilities = capabilities
        self.readiness = readiness
        self.acceptingWork = acceptingWork
        self.readinessDetail = readinessDetail
        self.activeSessions = activeSessions
        self.availableSessions = availableSessions
    }
}

struct ProjectExecutionWorkerPolicy: Codable, Equatable, Sendable {
    enum SelectionMode: String, Codable, Sendable {
        case any
        case allowlist
    }

    let selectionMode: SelectionMode
    let defaultWorkerId: String?
    let allowedWorkerIds: [String]
    let updatedAt: Date?

    func allows(workerID: String) -> Bool {
        selectionMode == .any || allowedWorkerIds.contains(workerID)
    }
}

struct ConversationNotification: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runId: UUID
    let runTitle: String
    let rootMessageId: UUID
    let body: String
    let author: IssueMessage.Author
    let reason: String
    let createdAt: Date
}

struct ChannelNotification: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let channelId: UUID
    let channelName: String
    let rootMessageId: UUID
    let body: String
    let author: IssueMessage.Author
    let reason: String
    let createdAt: Date
}

struct OrganizationMember: Codable, Equatable, Identifiable, Sendable {
    let userId: String
    let name: String
    let email: String
    let image: String?
    let role: String
    let createdAt: Date

    var id: String { userId }
}

struct DashboardSnapshot: Codable, Equatable, Sendable {
    var project: ProjectsResponse.Project
    var runs: [DashboardRun]
    var workers: [DashboardWorker]?
    var organizationProviders: [AgentProvider]?
    var executionPolicy: ProjectExecutionWorkerPolicy?
    var members: [OrganizationMember]?
    var conversationNotifications: [ConversationNotification]?
    var channelNotifications: [ChannelNotification]?
    var cursor: Int?
    var generatedAt: Date

    init(
        project: ProjectsResponse.Project,
        runs: [DashboardRun],
        workers: [DashboardWorker]? = nil,
        organizationProviders: [AgentProvider]? = nil,
        executionPolicy: ProjectExecutionWorkerPolicy? = nil,
        members: [OrganizationMember]? = nil,
        conversationNotifications: [ConversationNotification]? = nil,
        channelNotifications: [ChannelNotification]? = nil,
        cursor: Int?,
        generatedAt: Date
    ) {
        self.project = project
        self.runs = runs
        self.workers = workers
        self.organizationProviders = organizationProviders
        self.executionPolicy = executionPolicy
        self.members = members
        self.conversationNotifications = conversationNotifications
        self.channelNotifications = channelNotifications
        self.cursor = cursor
        self.generatedAt = generatedAt
    }
}

struct DashboardDelta: Codable, Equatable, Sendable {
    let cursor: Int
    let hasMore: Bool
    let runs: [DashboardRun]
    let deletedRunIds: [UUID]
    let project: ProjectsResponse.Project?
    let workers: [DashboardWorker]?
    let organizationProviders: [AgentProvider]?
    let executionPolicy: ProjectExecutionWorkerPolicy?
    let members: [OrganizationMember]?
    let conversationNotifications: [ConversationNotification]?
    let channelNotifications: [ChannelNotification]?
    let generatedAt: Date

    init(
        cursor: Int,
        hasMore: Bool,
        runs: [DashboardRun],
        deletedRunIds: [UUID],
        project: ProjectsResponse.Project?,
        workers: [DashboardWorker]? = nil,
        organizationProviders: [AgentProvider]? = nil,
        executionPolicy: ProjectExecutionWorkerPolicy? = nil,
        members: [OrganizationMember]? = nil,
        conversationNotifications: [ConversationNotification]? = nil,
        channelNotifications: [ChannelNotification]? = nil,
        generatedAt: Date
    ) {
        self.cursor = cursor
        self.hasMore = hasMore
        self.runs = runs
        self.deletedRunIds = deletedRunIds
        self.project = project
        self.workers = workers
        self.organizationProviders = organizationProviders
        self.executionPolicy = executionPolicy
        self.members = members
        self.conversationNotifications = conversationNotifications
        self.channelNotifications = channelNotifications
        self.generatedAt = generatedAt
    }
}

struct RunEventsResponse: Codable, Equatable, Sendable {
    let events: [RunEvent]
}

struct RunEvent: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let status: DashboardRun.Status
    let workflowStage: String?
    let detail: String?
    let actor: String
    let occurredAt: Date
}

struct IssueMessagesResponse: Codable, Equatable, Sendable {
    let messages: [IssueMessage]
}

struct IssueMessage: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runId: UUID
    let parentMessageId: UUID?
    let body: String
    let attachments: [IssueAttachment]?
    let author: Author
    var replyCount: Int
    var proposedAction: IssueProposedAction? = nil
    /// Kept separate so an accepted create proposal and its pending execution
    /// follow-up can be rendered together without collapsing either approval.
    var executionProposal: IssueExecutionProposal? = nil
    /// Saved-Skill execution is a separate, mutually exclusive reply action.
    /// It remains independent from historical issue proposal messages.
    var skillExecutionProposal: AgentSkillExecutionProposal? = nil
    let createdAt: Date
    let updatedAt: Date

    struct Author: Codable, Equatable, Sendable {
        let id: String?
        let name: String
        let image: String?
        let provider: String?
    }
}

struct IssueProposedAction: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let type: ActionType
    let workflowStage: String?
    let reason: String?
    let changes: Changes?
    let changedFields: [String]?
    let issue: NewIssue?
    let status: Status
    let acceptedAt: Date?
    let appliedRevision: Int?
    let resultRunId: UUID?
    /// An Agent may request a follow-up execution after creation, but accepting
    /// this proposal still creates a backlog issue only. The server then
    /// materializes a separate `executionProposal` for a second approval.
    let executeAfterCreate: Bool?

    init(
        id: UUID,
        type: ActionType,
        workflowStage: String? = nil,
        reason: String? = nil,
        changes: Changes? = nil,
        changedFields: [String]? = nil,
        issue: NewIssue? = nil,
        status: Status,
        acceptedAt: Date? = nil,
        appliedRevision: Int? = nil,
        resultRunId: UUID? = nil,
        executeAfterCreate: Bool? = nil
    ) {
        self.id = id
        self.type = type
        self.workflowStage = workflowStage
        self.reason = reason
        self.changes = changes
        self.changedFields = changedFields
        self.issue = issue
        self.status = status
        self.acceptedAt = acceptedAt
        self.appliedRevision = appliedRevision
        self.resultRunId = resultRunId
        self.executeAfterCreate = executeAfterCreate
    }

    enum ActionType: String, Codable, Sendable {
        case rework = "request_issue_rework"
        case update = "request_issue_update"
        case create = "request_issue_create"
    }

    struct Changes: Codable, Equatable, Sendable {
        let title: String?
        let description: String?
        let priority: Int?
    }

    struct NewIssue: Codable, Equatable, Sendable {
        let title: String
        let description: String?
        let priority: Int?
        let status: String
    }

    enum Status: String, Codable, Sendable {
        case pending
        case accepted
    }
}

/// Separate from issue create/update/rework proposals so creation evidence and
/// execution approval may coexist on one message.
struct IssueExecutionProposal: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: UUID
    let type: Kind
    let status: Status
    let projectId: UUID
    let runId: UUID
    let title: String
    let createdAt: Date
    let acceptedAt: Date?
    let requestedProvider: AgentProvider?
    let requestedModel: String?
    let requestedEffort: ModelEffort?
    let requestedWorkerId: String?
    let delegatedByAgentId: UUID?
    let delegatedByAgentName: String?

    enum Kind: String, Codable, Hashable, Sendable {
        case executeIssue = "request_issue_execute"
    }

    enum Status: String, Codable, Sendable {
        case pending
        case accepted
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, status, projectId, runId, title, createdAt, acceptedAt
        case requestedProvider, requestedModel, requestedEffort, requestedWorkerId
        case delegatedByAgentId, delegatedByAgentName
    }

    init(
        id: UUID,
        type: Kind = .executeIssue,
        status: Status,
        projectId: UUID,
        runId: UUID,
        title: String,
        createdAt: Date,
        acceptedAt: Date? = nil,
        requestedProvider: AgentProvider? = nil,
        requestedModel: String? = nil,
        requestedEffort: ModelEffort? = nil,
        requestedWorkerId: String? = nil,
        delegatedByAgentId: UUID? = nil,
        delegatedByAgentName: String? = nil
    ) {
        self.id = id
        self.type = type
        self.status = status
        self.projectId = projectId
        self.runId = runId
        self.title = title
        self.createdAt = createdAt
        self.acceptedAt = acceptedAt
        self.requestedProvider = requestedProvider
        self.requestedModel = requestedModel
        self.requestedEffort = requestedEffort
        self.requestedWorkerId = requestedWorkerId
        self.delegatedByAgentId = delegatedByAgentId
        self.delegatedByAgentName = delegatedByAgentName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(Kind.self, forKey: .type)
        status = try container.decode(Status.self, forKey: .status)
        projectId = try container.decode(UUID.self, forKey: .projectId)
        runId = try container.decode(UUID.self, forKey: .runId)
        title = try container.decode(String.self, forKey: .title)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        // These nullable fields are nevertheless required by the canonical
        // server snapshot. `decode(Optional.self)` accepts JSON null but rejects
        // a missing key, matching the strict mobile Zod/OpenAPI contract.
        acceptedAt = try container.decode(Date?.self, forKey: .acceptedAt)
        requestedProvider = try container.decode(
            AgentProvider?.self,
            forKey: .requestedProvider
        )
        requestedModel = try container.decode(String?.self, forKey: .requestedModel)
        requestedEffort = try container.decode(ModelEffort?.self, forKey: .requestedEffort)
        requestedWorkerId = try container.decode(String?.self, forKey: .requestedWorkerId)
        delegatedByAgentId = try container.decode(UUID?.self, forKey: .delegatedByAgentId)
        delegatedByAgentName = try container.decode(String?.self, forKey: .delegatedByAgentName)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(status, forKey: .status)
        try container.encode(projectId, forKey: .projectId)
        try container.encode(runId, forKey: .runId)
        try container.encode(title, forKey: .title)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(acceptedAt, forKey: .acceptedAt)
        try container.encode(requestedProvider, forKey: .requestedProvider)
        try container.encode(requestedModel, forKey: .requestedModel)
        try container.encode(requestedEffort, forKey: .requestedEffort)
        try container.encode(requestedWorkerId, forKey: .requestedWorkerId)
        try container.encode(delegatedByAgentId, forKey: .delegatedByAgentId)
        try container.encode(delegatedByAgentName, forKey: .delegatedByAgentName)
    }
}

struct AcceptIssueExecutionProposalResponse: Codable, Sendable {
    let proposal: IssueExecutionProposal
    let outcome: Outcome
    let projectId: UUID
    let runId: UUID
    let dispatch: DispatchRunResponse

    enum Outcome: String, Codable, Sendable {
        case accepted
        case alreadyAccepted = "already_accepted"
    }
}

struct AcceptIssueReworkProposalResponse: Codable, Equatable, Sendable {
    let proposal: IssueProposedAction
    let outcome: String
    let attempt: Int
    let revision: Int
    let workflowStage: String
}

struct AcceptIssueActionProposalResponse: Codable, Equatable, Sendable {
    let proposal: IssueProposedAction
    let outcome: String
    let resultRunId: UUID?
    /// Present when an accepted create proposal requested a separate execution
    /// approval. Optional keeps decoding compatible with older responses.
    let executionProposal: IssueExecutionProposal?
}

struct RunEvidenceResponse: Codable, Equatable, Sendable {
    let evidence: [RunEvidence]
}

struct RunEvidence: Codable, Equatable, Identifiable, Sendable {
    let key: String
    let attempt: Int
    let revision: Int
    let stage: String
    let type: String
    let status: EvidenceStatus
    let detail: String?
    let url: URL?
    let actor: String
    let observedAt: Date
    let images: [EvidenceImage]?
    let canonical: Bool

    var id: String { key }

    enum EvidenceStatus: String, Codable, Sendable {
        case pending
        case passed
        case failed
        case skipped
    }
}

struct EvidenceImage: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let filename: String
    let contentType: String
    let byteSize: Int
    let url: String
}

enum TaskFilter: String, CaseIterable, Identifiable {
    case all
    case active
    case attention
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .active: "Active"
        case .attention: "Attention"
        case .completed: "Completed"
        }
    }

    func includes(_ run: DashboardRun) -> Bool {
        switch self {
        case .all: true
        case .active: run.status.isActive
        case .attention: run.status.needsAttention
        case .completed: run.status == .completed
        }
    }
}

enum TaskOrdering {
    /// Newest-updated first for the mobile Tasks list and search results.
    static func byMostRecentlyUpdated(_ runs: [DashboardRun]) -> [DashboardRun] {
        runs.sorted { $0.updatedAt > $1.updatedAt }
    }
}

enum TaskSearch {
    static func results(
        in runs: [DashboardRun],
        query: String,
        issueKeyPrefix: String = "AH"
    ) -> [DashboardRun] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return TaskOrdering.byMostRecentlyUpdated(runs) }
        return TaskOrdering.byMostRecentlyUpdated(
            runs.filter { run in
                [
                    run.title,
                    run.detail,
                    run.issueDescription,
                    run.resultSummary,
                    run.runNumber.map { "\(issueKeyPrefix)-\($0)" },
                ]
                    .compactMap { $0 }
                    .contains { $0.localizedCaseInsensitiveContains(needle) }
            }
        )
    }
}

enum DashboardMerge {
    static func apply(_ delta: DashboardDelta, to snapshot: DashboardSnapshot) -> DashboardSnapshot {
        let deleted = Set(delta.deletedRunIds)
        let changed = Dictionary(uniqueKeysWithValues: delta.runs.map { ($0.id, $0) })
        var runs: [DashboardRun] = snapshot.runs.compactMap { run -> DashboardRun? in
            guard !deleted.contains(run.id) else { return nil }
            return changed[run.id] ?? run
        }
        let existing = Set(runs.map(\.id))
        runs.append(contentsOf: delta.runs.filter { !existing.contains($0.id) })
        runs.sort {
            if $0.status == .completed && $1.status != .completed { return false }
            if $0.status != .completed && $1.status == .completed { return true }
            return $0.updatedAt > $1.updatedAt
        }
        return DashboardSnapshot(
            project: delta.project ?? snapshot.project,
            runs: Array(runs.prefix(200)),
            workers: delta.workers ?? snapshot.workers,
            organizationProviders: delta.organizationProviders ?? snapshot.organizationProviders,
            executionPolicy: delta.executionPolicy ?? snapshot.executionPolicy,
            members: delta.members ?? snapshot.members,
            conversationNotifications: delta.conversationNotifications ?? snapshot.conversationNotifications,
            channelNotifications: delta.channelNotifications ?? snapshot.channelNotifications,
            cursor: delta.cursor,
            generatedAt: delta.generatedAt
        )
    }
}
