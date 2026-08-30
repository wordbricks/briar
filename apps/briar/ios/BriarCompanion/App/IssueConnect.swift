import BriarContracts
import Foundation
import SwiftProtobuf

enum IssueAssigneeUpdate: Equatable, Sendable {
    case unchanged
    case assign(String)
    case clear
}

func issueCreateRequest(
    projectID: UUID,
    draft: IssueDraft,
    attachmentReferences: [String]
) throws -> BriarAPI_CreateIssueRequest {
    var request = BriarAPI_CreateIssueRequest()
    request.projectID = issueUUIDString(projectID)
    request.title = draft.title
    if !draft.description.isEmpty { request.description_p = draft.description }
    if let priority = draft.priority {
        guard let priority = UInt32(exactly: priority) else {
            throw MobileAPIError.invalidRequest
        }
        request.priority = priority
    }
    if let difficulty = draft.difficulty { request.difficulty = issueDifficultyMessage(difficulty) }
    if let assigneeUserID = draft.assigneeUserId { request.assigneeUserID = assigneeUserID }
    request.status = issueRunStatusMessage(draft.status)
    if let provider = draft.preferredProvider {
        request.preferredProvider = issueProviderMessage(provider)
    }
    if let model = draft.preferredModel { request.preferredModel = model }
    if let effort = draft.preferredEffort { request.preferredEffort = effort.rawValue }
    request.fullAuto = draft.fullAuto
    request.attachmentReferences = attachmentReferences
    return request
}

func issueUpdateRequest(
    projectID: UUID,
    runID: UUID,
    draft: IssueDraft,
    assigneeUpdate: IssueAssigneeUpdate,
    attachmentReferences: [String],
    keptAttachmentIDs: [UUID]?
) throws -> BriarAPI_UpdateIssueRequest {
    var request = BriarAPI_UpdateIssueRequest()
    request.projectID = issueUUIDString(projectID)
    request.runID = issueUUIDString(runID)
    request.title = draft.title
    if !draft.description.isEmpty { request.description_p = draft.description }
    if let priority = draft.priority {
        guard let priority = UInt32(exactly: priority) else {
            throw MobileAPIError.invalidRequest
        }
        request.priority = priority
    }
    if let difficulty = draft.difficulty { request.difficulty = issueDifficultyMessage(difficulty) }
    switch assigneeUpdate {
    case .unchanged:
        break
    case .assign(let userID):
        request.assigneeUserID = userID
    case .clear:
        request.clearAssignee_p = BriarAPI_UpdateIssueRequest.ClearAssignee()
    }
    request.attachmentReferences = attachmentReferences
    if let keptAttachmentIDs {
        var patch = BriarAPI_UpdateIssueRequest.KeptAttachmentIdsPatch()
        patch.values = keptAttachmentIDs.map(issueUUIDString)
        request.keptAttachmentIds = patch
    }
    return request
}

extension CreateIssueResponse {
    init(connectMessage message: BriarAPI_CreateIssueResponse) throws {
        self.init(
            runId: try issueUUID(message.runID),
            sourceKey: message.sourceKey,
            stage: message.stage,
            status: try issueRunStatus(message.status),
            attachments: try message.attachments.map { try .init(connectMessage: $0) },
            assigneeUserId: message.hasAssigneeUserID ? message.assigneeUserID : nil,
            createdByUserId: message.createdByUserID,
            difficulty: message.hasDifficulty ? try issueDifficulty(message.difficulty) : nil
        )
    }
}

extension IssueSubscriptionResponse {
    init(connectMessage message: BriarAPI_SetIssueSubscriptionResponse) throws {
        self.init(
            runId: try issueUUID(message.runID),
            subscribers: try message.subscribers.map { try .init(connectMessage: $0) }
        )
    }
}

extension ResultReview {
    init(connectMessage message: BriarAPI_ResultReview) throws {
        guard message.hasCompletedAt else { throw MobileAPIError.invalidResponse }
        self.init(
            userId: message.userID,
            name: message.name,
            username: message.hasUsername ? message.username : nil,
            image: message.hasImage ? message.image : nil,
            completedAt: try issueDate(message.completedAt)
        )
    }
}

extension IssueMessagesResponse {
    init(connectMessage message: BriarAPI_ListIssueMessagesResponse) throws {
        self.init(
            messages: try message.messages.map { try .init(connectMessage: $0) },
            agentReplies: try message.agentReplies.map { try .init(connectMessage: $0) },
            cursor: try issueSafeInt(message.cursor)
        )
    }
}

extension IssueMessagesDeltaResponse {
    init(connectMessage message: BriarAPI_SyncIssueMessagesResponse) throws {
        self.init(
            cursor: try issueSafeInt(message.cursor),
            hasMore: message.hasMore_p,
            changed: message.changed,
            reset: message.reset,
            messages: message.changed || message.reset
                ? try message.messages.map { try .init(connectMessage: $0) }
                : nil,
            agentReplies: message.changed || message.reset
                ? try message.agentReplies.map { try .init(connectMessage: $0) }
                : nil
        )
    }
}

extension CreateIssueMessageResponse {
    init(connectMessage message: BriarAPI_CreateIssueMessageResponse) throws {
        guard message.hasMessage else { throw MobileAPIError.invalidResponse }
        self.init(
            message: try .init(connectMessage: message.message),
            agentReply: message.hasAgentReply ? try .init(connectMessage: message.agentReply) : nil,
            agentReplies: try message.agentReplies.map { try .init(connectMessage: $0) }
        )
    }
}

extension IssueAgentReplyResponse {
    init(connectMessage message: BriarAPI_GetIssueAgentReplyResponse) throws {
        guard message.hasAgentReply else { throw MobileAPIError.invalidResponse }
        self.init(
            agentReply: try .init(connectMessage: message.agentReply),
            message: message.hasMessage ? try .init(connectMessage: message.message) : nil,
            agentReplies: try message.agentReplies.map { try .init(connectMessage: $0) },
            messages: try message.messages.map { try .init(connectMessage: $0) }
        )
    }
}

extension IssueMessage {
    init(connectMessage message: BriarAPI_IssueMessage) throws {
        guard message.hasAuthor, message.hasCreatedAt, message.hasUpdatedAt else {
            throw MobileAPIError.invalidResponse
        }
        let proposedAction: IssueProposedAction?
        switch message.proposedAction {
        case .reworkProposal(let proposal):
            proposedAction = try .init(connectMessage: proposal)
        case .updateProposal(let proposal):
            proposedAction = try .init(connectMessage: proposal)
        case .createProposal(let proposal):
            proposedAction = try .init(connectMessage: proposal)
        case nil:
            proposedAction = nil
        }
        self.init(
            id: try issueUUID(message.id),
            runId: try issueUUID(message.runID),
            parentMessageId: message.hasParentMessageID
                ? try issueUUID(message.parentMessageID)
                : nil,
            body: message.body,
            attachments: try message.attachments.map { try .init(connectMessage: $0) },
            author: try .init(connectMessage: message.author),
            replyCount: try issueSafeInt(message.replyCount),
            proposedAction: proposedAction,
            executionProposal: message.hasExecutionProposal
                ? try .init(connectMessage: message.executionProposal)
                : nil,
            skillExecutionProposal: message.hasSkillExecutionProposal
                ? try .init(connectMessage: message.skillExecutionProposal)
                : nil,
            createdAt: try issueDate(message.createdAt),
            updatedAt: try issueDate(message.updatedAt)
        )
    }
}

extension IssueMessage.Author {
    init(connectMessage message: BriarAPI_MessageAuthor) throws {
        self.init(
            id: message.hasID ? message.id : nil,
            agentId: message.hasAgentID ? try issueUUID(message.agentID) : nil,
            name: message.name,
            image: message.hasImage ? message.image : nil,
            provider: message.hasProvider ? try issueProvider(message.provider).rawValue : nil
        )
    }
}

extension IssueAttachment {
    init(connectMessage message: BriarAPI_IssueAttachment) throws {
        self.init(
            id: try issueUUID(message.id),
            filename: message.filename,
            contentType: message.contentType,
            byteSize: try issueSafeInt(message.byteSize),
            url: message.url
        )
    }
}

extension IssueAgentReplyJob {
    init(connectMessage message: BriarAPI_IssueAgentReply) throws {
        guard message.hasUpdatedAt else { throw MobileAPIError.invalidResponse }
        let status: Status
        switch message.status {
        case .queued: status = .queued
        case .running: status = .running
        case .completed: status = .completed
        case .failed: status = .failed
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try issueUUID(message.id),
            triggerMessageId: try issueUUID(message.triggerMessageID),
            parentMessageId: try issueUUID(message.parentMessageID),
            agentId: message.hasAgentID ? try issueUUID(message.agentID) : nil,
            agentName: message.hasAgentName ? message.agentName : nil,
            status: status,
            attempts: try issueSafeInt(message.attempts),
            error: message.hasError ? message.error : nil
        )
    }
}

extension IssueProposedAction {
    init(connectMessage message: BriarAPI_IssueReworkProposal) throws {
        self.init(
            id: try issueUUID(message.id),
            type: .rework,
            workflowStage: message.workflowStage,
            reason: message.reason,
            status: try issueProposalStatus(message.status),
            acceptedAt: message.hasAcceptedAt ? try issueDate(message.acceptedAt) : nil,
            appliedRevision: message.hasAppliedRevision
                ? try issueSafeInt(message.appliedRevision)
                : nil
        )
    }

    init(connectMessage message: BriarAPI_IssueUpdateProposal) throws {
        guard message.hasChanges else { throw MobileAPIError.invalidResponse }
        self.init(
            id: try issueUUID(message.id),
            type: .update,
            changes: .init(
                title: message.changes.hasTitle ? message.changes.title : nil,
                description: message.changes.hasDescription_p
                    ? message.changes.description_p
                    : nil,
                priority: message.changes.hasPriority
                    ? try issueSafeInt(message.changes.priority)
                    : nil
            ),
            changedFields: try message.changedFields.map(issueChangedField),
            status: try issueProposalStatus(message.status),
            acceptedAt: message.hasAcceptedAt ? try issueDate(message.acceptedAt) : nil,
            resultRunId: message.hasResultRunID ? try issueUUID(message.resultRunID) : nil
        )
    }

    init(connectMessage message: BriarAPI_IssueCreateProposal) throws {
        guard message.hasIssue else { throw MobileAPIError.invalidResponse }
        self.init(
            id: try issueUUID(message.id),
            type: .create,
            issue: .init(
                title: message.issue.title,
                description: message.issue.hasDescription_p
                    ? message.issue.description_p
                    : nil,
                priority: message.issue.hasPriority
                    ? try issueSafeInt(message.issue.priority)
                    : nil,
                status: try issueRunStatus(message.issue.status).rawValue
            ),
            status: try issueProposalStatus(message.status),
            acceptedAt: message.hasAcceptedAt ? try issueDate(message.acceptedAt) : nil,
            resultRunId: message.hasResultRunID ? try issueUUID(message.resultRunID) : nil,
            executeAfterCreate: message.executeAfterCreate
        )
    }
}

extension RunEvidenceResponse {
    init(connectMessage message: BriarAPI_ListRunEvidenceResponse) throws {
        _ = try issueUUID(message.runID)
        _ = try issueSafeInt(message.attempt)
        _ = try issueSafeInt(message.revision)
        self.init(evidence: try message.evidence.map { try .init(connectMessage: $0) })
    }
}

extension RunEvidence {
    init(connectMessage message: BriarAPI_RunEvidence) throws {
        guard message.hasObservedAt, message.hasRecordedAt else {
            throw MobileAPIError.invalidResponse
        }
        let status: EvidenceStatus
        switch message.status {
        case .pending: status = .pending
        case .passed: status = .passed
        case .failed: status = .failed
        case .skipped: status = .skipped
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            key: message.key,
            attempt: try issueSafeInt(message.attempt),
            revision: try issueSafeInt(message.revision),
            stage: message.stage,
            type: message.type,
            status: status,
            detail: message.hasDetail ? message.detail : nil,
            url: message.hasURL ? URL(string: message.url) : nil,
            actor: message.actor,
            observedAt: try issueDate(message.observedAt),
            images: try message.images.map { try .init(connectMessage: $0) },
            canonical: message.canonical
        )
    }
}

extension EvidenceImage {
    init(connectMessage message: BriarAPI_RunEvidenceImage) throws {
        self.init(
            id: try issueUUID(message.id),
            filename: message.filename,
            contentType: message.contentType,
            byteSize: try issueSafeInt(message.byteSize),
            url: message.url
        )
    }
}

extension AcceptIssueReworkProposalResponse {
    init(connectMessage message: BriarAPI_AcceptIssueReworkProposalResponse) throws {
        guard message.hasProposal else { throw MobileAPIError.invalidResponse }
        self.init(
            proposal: try .init(connectMessage: message.proposal),
            outcome: try issueApprovalOutcome(message.outcome),
            attempt: try issueSafeInt(message.attempt),
            revision: try issueSafeInt(message.revision),
            workflowStage: message.workflowStage
        )
    }
}

extension AcceptIssueActionProposalResponse {
    init(connectMessage message: BriarAPI_AcceptIssueActionProposalResponse) throws {
        let proposal: IssueProposedAction
        switch message.proposal {
        case .update(let value): proposal = try .init(connectMessage: value)
        case .create(let value): proposal = try .init(connectMessage: value)
        case nil: throw MobileAPIError.invalidResponse
        }
        self.init(
            proposal: proposal,
            outcome: try issueApprovalOutcome(message.outcome),
            resultRunId: message.hasResultRunID ? try issueUUID(message.resultRunID) : nil,
            executionProposal: message.hasExecutionProposal
                ? try .init(connectMessage: message.executionProposal)
                : nil
        )
    }
}

extension AcceptIssueExecutionProposalResponse {
    init(connectMessage message: BriarAPI_AcceptIssueExecutionProposalResponse) throws {
        guard message.hasProposal, message.hasDispatch else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            proposal: try .init(connectMessage: message.proposal),
            outcome: try .init(connectValue: message.outcome),
            projectId: try issueUUID(message.projectID),
            runId: try issueUUID(message.runID),
            dispatch: try .init(connectMessage: message.dispatch)
        )
    }
}

extension AcceptAgentSkillExecutionProposalResponse {
    init(connectMessage message: BriarAPI_AcceptIssueSkillExecutionProposalResponse) throws {
        guard message.hasProposal else { throw MobileAPIError.invalidResponse }
        self.init(
            outcome: try .init(connectValue: message.outcome),
            proposal: try .init(connectMessage: message.proposal),
            projectId: try issueUUID(message.projectID),
            session: message.hasSession ? try .init(connectMessage: message.session) : nil
        )
    }
}

private extension AcceptIssueExecutionProposalResponse.Outcome {
    init(connectValue value: BriarAPI_ApprovalOutcome) throws {
        switch value {
        case .accepted: self = .accepted
        case .alreadyAccepted: self = .alreadyAccepted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

private extension AcceptAgentSkillExecutionProposalResponse.Outcome {
    init(connectValue value: BriarAPI_ApprovalOutcome) throws {
        switch value {
        case .accepted: self = .accepted
        case .alreadyAccepted: self = .alreadyAccepted
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
    }
}

func issueDispatchMessage(_ request: DispatchRunRequest) -> BriarAPI_DispatchRunInput {
    var message = BriarAPI_DispatchRunInput()
    message.requestID = issueUUIDString(request.requestId)
    if let agentID = request.agentId { message.agentID = issueUUIDString(agentID) }
    message.provider = issueProviderMessage(request.provider)
    if let model = request.model { message.model = model }
    if let effort = request.effort { message.effort = effort.rawValue }
    message.persistPreferences = request.persistPreferences
    if let workerID = request.workerId { message.workerID = workerID }
    return message
}

func issueExecutionApprovalMessage(
    _ approval: AcceptIssueExecutionProposalRequest
) -> BriarAPI_IssueExecutionApproval {
    var message = BriarAPI_IssueExecutionApproval()
    message.provider = issueProviderMessage(approval.provider)
    if let model = approval.model { message.model = model }
    if let effort = approval.effort { message.effort = effort.rawValue }
    if let workerID = approval.workerId { message.workerID = workerID }
    return message
}

private func issueUUIDString(_ value: UUID) -> String {
    value.uuidString.lowercased()
}

func issueUUID(_ value: String) throws -> UUID {
    guard let value = UUID(uuidString: value) else { throw MobileAPIError.invalidResponse }
    return value
}

private func issueSafeInt<T: BinaryInteger>(_ value: T) throws -> Int {
    guard let value = Int(exactly: value) else { throw MobileAPIError.invalidResponse }
    return value
}

private func issueDate(_ value: Google_Protobuf_Timestamp) throws -> Date {
    guard (-62_135_596_800 ... 253_402_300_799).contains(value.seconds),
          (0 ... 999_999_999).contains(value.nanos)
    else { throw MobileAPIError.invalidResponse }
    return value.date
}

private func issueProvider(_ value: BriarTypes_AgentProvider) throws -> AgentProvider {
    switch value {
    case .codex: .codex
    case .claude: .claude
    case .cursor: .cursor
    case .grok: .grok
    case .agy: .agy
    case .opencode: .opencode
    case .openrouter: .openrouter
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

func issueProviderMessage(_ value: AgentProvider) -> BriarTypes_AgentProvider {
    switch value {
    case .codex: .codex
    case .claude: .claude
    case .cursor: .cursor
    case .grok: .grok
    case .agy: .agy
    case .opencode: .opencode
    case .openrouter: .openrouter
    }
}

private func issueRunStatus(_ value: BriarAPI_RunStatus) throws -> DashboardRun.Status {
    switch value {
    case .backlog: .backlog
    case .queued: .queued
    case .running: .running
    case .paused: .paused
    case .blocked: .blocked
    case .failed: .failed
    case .completed: .completed
    case .cancelled: .cancelled
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

func issueRunStatusMessage(_ value: DashboardRun.Status) -> BriarAPI_RunStatus {
    switch value {
    case .backlog: .backlog
    case .queued: .queued
    case .running: .running
    case .paused: .paused
    case .blocked: .blocked
    case .failed: .failed
    case .completed: .completed
    case .cancelled: .cancelled
    }
}

private func issueDifficulty(_ value: BriarAPI_IssueDifficulty) throws -> IssueDifficulty {
    switch value {
    case .easy: .easy
    case .normal: .normal
    case .hard: .hard
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func issueDifficultyMessage(_ value: IssueDifficulty) -> BriarAPI_IssueDifficulty {
    switch value {
    case .easy: .easy
    case .normal: .normal
    case .hard: .hard
    }
}

private func issueProposalStatus(
    _ value: BriarAPI_ProposalStatus
) throws -> IssueProposedAction.Status {
    switch value {
    case .pending: .pending
    case .accepted: .accepted
    case .unspecified, .declined, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func issueChangedField(_ value: BriarAPI_IssueChangedField) throws -> String {
    switch value {
    case .title: "title"
    case .description_: "description"
    case .priority: "priority"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func issueApprovalOutcome(_ value: BriarAPI_ApprovalOutcome) throws -> String {
    switch value {
    case .accepted: "accepted"
    case .alreadyAccepted: "already_accepted"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}
