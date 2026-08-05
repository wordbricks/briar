import Foundation

struct DashboardRun: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runNumber: Int?
    let currentAttempt: Int?
    let currentRevision: Int?
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
    let requestedProvider: AgentProvider?
    let requestedModel: String?
    let requestedEffort: ModelEffort?
    let requestedWorkerId: String?
    let workerId: String?
    let updatedAt: Date
    let completedAt: Date?
    let lastEventAt: String?
    let eventCount: Int?

    init(
        id: UUID,
        runNumber: Int? = nil,
        currentAttempt: Int? = nil,
        currentRevision: Int? = nil,
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
        requestedProvider: AgentProvider? = nil,
        requestedModel: String? = nil,
        requestedEffort: ModelEffort? = nil,
        requestedWorkerId: String? = nil,
        workerId: String? = nil,
        updatedAt: Date,
        completedAt: Date? = nil,
        lastEventAt: String? = nil,
        eventCount: Int? = nil
    ) {
        self.id = id
        self.runNumber = runNumber
        self.currentAttempt = currentAttempt
        self.currentRevision = currentRevision
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
        self.requestedProvider = requestedProvider
        self.requestedModel = requestedModel
        self.requestedEffort = requestedEffort
        self.requestedWorkerId = requestedWorkerId
        self.workerId = workerId
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

        var displayName: String {
            switch self {
            case .backlog: "대기"
            case .queued: "실행 대기"
            case .running: "진행 중"
            case .paused: "검토 대기"
            case .blocked: "확인 필요"
            case .failed: "실패"
            case .completed: "완료"
            case .cancelled: "취소"
            }
        }

        var needsAttention: Bool { self == .paused || self == .blocked || self == .failed }
        var isActive: Bool { self != .completed && self != .cancelled }
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
    let id: String
    let label: String
    let agentProvider: AgentProvider?
    let providers: [AgentProvider]?
    let readiness: String
    let readinessDetail: String?
    let activeSessions: Int
    let availableSessions: Int

    init(
        id: String,
        label: String,
        agentProvider: AgentProvider? = nil,
        providers: [AgentProvider]? = nil,
        readiness: String,
        readinessDetail: String?,
        activeSessions: Int,
        availableSessions: Int
    ) {
        self.id = id
        self.label = label
        self.agentProvider = agentProvider
        self.providers = providers
        self.readiness = readiness
        self.readinessDetail = readinessDetail
        self.activeSessions = activeSessions
        self.availableSessions = availableSessions
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
    var members: [OrganizationMember]?
    var conversationNotifications: [ConversationNotification]?
    var cursor: Int?
    var generatedAt: Date

    init(
        project: ProjectsResponse.Project,
        runs: [DashboardRun],
        workers: [DashboardWorker]? = nil,
        organizationProviders: [AgentProvider]? = nil,
        members: [OrganizationMember]? = nil,
        conversationNotifications: [ConversationNotification]? = nil,
        cursor: Int?,
        generatedAt: Date
    ) {
        self.project = project
        self.runs = runs
        self.workers = workers
        self.organizationProviders = organizationProviders
        self.members = members
        self.conversationNotifications = conversationNotifications
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
    let members: [OrganizationMember]?
    let conversationNotifications: [ConversationNotification]?
    let generatedAt: Date

    init(
        cursor: Int,
        hasMore: Bool,
        runs: [DashboardRun],
        deletedRunIds: [UUID],
        project: ProjectsResponse.Project?,
        workers: [DashboardWorker]? = nil,
        organizationProviders: [AgentProvider]? = nil,
        members: [OrganizationMember]? = nil,
        conversationNotifications: [ConversationNotification]? = nil,
        generatedAt: Date
    ) {
        self.cursor = cursor
        self.hasMore = hasMore
        self.runs = runs
        self.deletedRunIds = deletedRunIds
        self.project = project
        self.workers = workers
        self.organizationProviders = organizationProviders
        self.members = members
        self.conversationNotifications = conversationNotifications
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
    let replyCount: Int
    let createdAt: Date
    let updatedAt: Date

    struct Author: Codable, Equatable, Sendable {
        let id: String?
        let name: String
        let image: String?
        let provider: String?
    }
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
    static func results(in runs: [DashboardRun], query: String) -> [DashboardRun] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return TaskOrdering.byMostRecentlyUpdated(runs) }
        return TaskOrdering.byMostRecentlyUpdated(
            runs.filter { run in
                [run.title, run.detail, run.issueDescription, run.resultSummary]
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
            members: delta.members ?? snapshot.members,
            conversationNotifications: delta.conversationNotifications ?? snapshot.conversationNotifications,
            cursor: delta.cursor,
            generatedAt: delta.generatedAt
        )
    }
}
