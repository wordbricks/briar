import Connect
import Foundation
import SwiftProtobuf

enum IssueAssigneeUpdate: Equatable, Sendable {
    case unchanged
    case assign(String)
    case clear
}

protocol MobileIssueAPIClientProtocol: Sendable {
    func createIssue(
        projectID: UUID,
        draft: IssueDraft,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueResponse

    func updateIssue(
        projectID: UUID,
        runID: UUID,
        draft: IssueDraft,
        assigneeUpdate: IssueAssigneeUpdate,
        attachmentReferences: [String],
        keptAttachmentIDs: [UUID]?,
        token: String
    ) async throws -> UpdateIssueResponse

    func deleteIssue(projectID: UUID, runID: UUID, token: String) async throws

    func transferIssue(
        projectID: UUID,
        runID: UUID,
        targetProjectID: UUID,
        token: String
    ) async throws -> TransferIssueResponse

    func setIssueSubscription(
        projectID: UUID,
        runID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> IssueSubscriptionResponse

    func updateIssuePreferences(
        projectID: UUID,
        runID: UUID,
        preferences: IssueExecutionPreferences,
        token: String
    ) async throws -> IssueExecutionPreferencesResponse

    func setIssueDependency(
        projectID: UUID,
        runID: UUID,
        prerequisiteRunID: UUID,
        enabled: Bool,
        token: String
    ) async throws -> DependencyResponse

    func moveRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        status: DashboardRun.Status,
        workflowStage: String?,
        token: String
    ) async throws -> RunStatusResponse

    func recoverRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        action: String,
        reason: String?,
        token: String
    ) async throws -> RunRecoveryResponse

    func resumeRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        checkpoint: WorkflowCheckpoint,
        token: String
    ) async throws -> ResumeRunResponse

    func dispatchRun(
        projectID: UUID,
        runID: UUID,
        request: DispatchRunRequest,
        reassign: Bool,
        token: String
    ) async throws -> DispatchRunResponse

    func completeResultReview(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> ResultReview

    func listIssueMessages(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> IssueMessagesResponse

    func syncIssueMessages(
        projectID: UUID,
        runID: UUID,
        cursor: Int,
        token: String
    ) async throws -> IssueMessagesDeltaResponse

    func createIssueMessage(
        projectID: UUID,
        runID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [String],
        agentConversationID: String?,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueMessageResponse

    func getIssueAgentReply(
        projectID: UUID,
        runID: UUID,
        triggerMessageID: UUID,
        token: String
    ) async throws -> IssueAgentReplyResponse

    func listRunEvidence(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> RunEvidenceResponse

    func acceptIssueReworkProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueReworkProposalResponse

    func acceptIssueActionProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueActionProposalResponse

    func acceptIssueExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptIssueExecutionProposalResponse

    func acceptIssueSkillExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse
}

extension MobileIssueAPIClientProtocol {
    func createIssue(
        projectID: UUID,
        draft: IssueDraft,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueResponse { throw MobileAPIError.invalidRequest }

    func updateIssue(
        projectID: UUID,
        runID: UUID,
        draft: IssueDraft,
        assigneeUpdate: IssueAssigneeUpdate,
        attachmentReferences: [String],
        keptAttachmentIDs: [UUID]?,
        token: String
    ) async throws -> UpdateIssueResponse { throw MobileAPIError.invalidRequest }

    func deleteIssue(projectID: UUID, runID: UUID, token: String) async throws {
        throw MobileAPIError.invalidRequest
    }

    func transferIssue(
        projectID: UUID,
        runID: UUID,
        targetProjectID: UUID,
        token: String
    ) async throws -> TransferIssueResponse { throw MobileAPIError.invalidRequest }

    func setIssueSubscription(
        projectID: UUID,
        runID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> IssueSubscriptionResponse { throw MobileAPIError.invalidRequest }

    func updateIssuePreferences(
        projectID: UUID,
        runID: UUID,
        preferences: IssueExecutionPreferences,
        token: String
    ) async throws -> IssueExecutionPreferencesResponse { throw MobileAPIError.invalidRequest }

    func setIssueDependency(
        projectID: UUID,
        runID: UUID,
        prerequisiteRunID: UUID,
        enabled: Bool,
        token: String
    ) async throws -> DependencyResponse { throw MobileAPIError.invalidRequest }

    func moveRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        status: DashboardRun.Status,
        workflowStage: String?,
        token: String
    ) async throws -> RunStatusResponse { throw MobileAPIError.invalidRequest }

    func recoverRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        action: String,
        reason: String?,
        token: String
    ) async throws -> RunRecoveryResponse { throw MobileAPIError.invalidRequest }

    func resumeRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        checkpoint: WorkflowCheckpoint,
        token: String
    ) async throws -> ResumeRunResponse { throw MobileAPIError.invalidRequest }

    func dispatchRun(
        projectID: UUID,
        runID: UUID,
        request: DispatchRunRequest,
        reassign: Bool,
        token: String
    ) async throws -> DispatchRunResponse { throw MobileAPIError.invalidRequest }

    func completeResultReview(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> ResultReview { throw MobileAPIError.invalidRequest }

    func listIssueMessages(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> IssueMessagesResponse { throw MobileAPIError.invalidRequest }

    func syncIssueMessages(
        projectID: UUID,
        runID: UUID,
        cursor: Int,
        token: String
    ) async throws -> IssueMessagesDeltaResponse { throw MobileAPIError.invalidRequest }

    func createIssueMessage(
        projectID: UUID,
        runID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [String],
        agentConversationID: String?,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueMessageResponse { throw MobileAPIError.invalidRequest }

    func getIssueAgentReply(
        projectID: UUID,
        runID: UUID,
        triggerMessageID: UUID,
        token: String
    ) async throws -> IssueAgentReplyResponse { throw MobileAPIError.invalidRequest }

    func listRunEvidence(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> RunEvidenceResponse { throw MobileAPIError.invalidRequest }

    func acceptIssueReworkProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueReworkProposalResponse { throw MobileAPIError.invalidRequest }

    func acceptIssueActionProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueActionProposalResponse { throw MobileAPIError.invalidRequest }

    func acceptIssueExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptIssueExecutionProposalResponse { throw MobileAPIError.invalidRequest }

    func acceptIssueSkillExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        throw MobileAPIError.invalidRequest
    }
}

extension MobileAPIClient {
    func createIssue(
        projectID: UUID,
        draft: IssueDraft,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueResponse {
        let request = try issueCreateRequest(
            projectID: projectID,
            draft: draft,
            attachmentReferences: attachmentReferences
        )
        let message = try issueConnectMessage(await issueService.createIssue(
            request: request,
            headers: issueAuthorizationHeaders(token)
        ))
        return try CreateIssueResponse(connectMessage: message)
    }

    func updateIssue(
        projectID: UUID,
        runID: UUID,
        draft: IssueDraft,
        assigneeUpdate: IssueAssigneeUpdate,
        attachmentReferences: [String],
        keptAttachmentIDs: [UUID]?,
        token: String
    ) async throws -> UpdateIssueResponse {
        let request = try issueUpdateRequest(
            projectID: projectID,
            runID: runID,
            draft: draft,
            assigneeUpdate: assigneeUpdate,
            attachmentReferences: attachmentReferences,
            keptAttachmentIDs: keptAttachmentIDs
        )
        let message = try issueConnectMessage(await issueService.updateIssue(
            request: request,
            headers: issueAuthorizationHeaders(token)
        ))
        return try UpdateIssueResponse(connectMessage: message)
    }

    func deleteIssue(projectID: UUID, runID: UUID, token: String) async throws {
        var request = BriarAPI_DeleteIssueRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        let message = try issueConnectMessage(await issueService.deleteIssue(
            request: request,
            headers: issueAuthorizationHeaders(token)
        ))
        guard message.deleted else { throw MobileAPIError.invalidResponse }
    }

    func transferIssue(
        projectID: UUID,
        runID: UUID,
        targetProjectID: UUID,
        token: String
    ) async throws -> TransferIssueResponse {
        var request = BriarAPI_TransferIssueRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.targetProjectID = issueUUIDString(targetProjectID)
        return try TransferIssueResponse(connectMessage: issueConnectMessage(
            await issueService.transferIssue(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func setIssueSubscription(
        projectID: UUID,
        runID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> IssueSubscriptionResponse {
        var request = BriarAPI_SetIssueSubscriptionRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.subscribed = subscribed
        return try IssueSubscriptionResponse(connectMessage: issueConnectMessage(
            await issueService.setIssueSubscription(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func updateIssuePreferences(
        projectID: UUID,
        runID: UUID,
        preferences: IssueExecutionPreferences,
        token: String
    ) async throws -> IssueExecutionPreferencesResponse {
        var request = BriarAPI_UpdateIssuePreferencesRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        if let provider = preferences.provider { request.provider = issueProviderMessage(provider) }
        if let model = preferences.model { request.model = model }
        if let effort = preferences.effort { request.effort = effort.rawValue }
        return try IssueExecutionPreferencesResponse(connectMessage: issueConnectMessage(
            await issueService.updateIssuePreferences(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func setIssueDependency(
        projectID: UUID,
        runID: UUID,
        prerequisiteRunID: UUID,
        enabled: Bool,
        token: String
    ) async throws -> DependencyResponse {
        var request = BriarAPI_SetIssueDependencyRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.prerequisiteRunID = issueUUIDString(prerequisiteRunID)
        request.enabled = enabled
        return try DependencyResponse(connectMessage: issueConnectMessage(
            await issueService.setIssueDependency(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func moveRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        status: DashboardRun.Status,
        workflowStage: String?,
        token: String
    ) async throws -> RunStatusResponse {
        var request = BriarAPI_MoveRunRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.requestID = issueUUIDString(requestID)
        request.status = issueRunStatusMessage(status)
        if let workflowStage { request.workflowStage = workflowStage }
        return try RunStatusResponse(connectMessage: issueConnectMessage(
            await issueService.moveRun(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func recoverRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        action: String,
        reason: String?,
        token: String
    ) async throws -> RunRecoveryResponse {
        switch action {
        case "retry":
            var request = BriarAPI_RetryRunRequest()
            request.projectID = issueUUIDString(projectID)
            request.runID = issueUUIDString(runID)
            request.requestID = issueUUIDString(requestID)
            if let reason { request.reason = reason }
            return try RunRecoveryResponse(
                retryMessage: issueConnectMessage(await issueService.retryRun(
                    request: request,
                    headers: issueAuthorizationHeaders(token)
                ))
            )
        case "cancel":
            var request = BriarAPI_CancelRunRequest()
            request.projectID = issueUUIDString(projectID)
            request.runID = issueUUIDString(runID)
            request.requestID = issueUUIDString(requestID)
            if let reason { request.reason = reason }
            return try RunRecoveryResponse(
                cancelMessage: issueConnectMessage(await issueService.cancelRun(
                    request: request,
                    headers: issueAuthorizationHeaders(token)
                ))
            )
        default:
            throw MobileAPIError.invalidRequest
        }
    }

    func resumeRun(
        projectID: UUID,
        runID: UUID,
        requestID: UUID,
        checkpoint: WorkflowCheckpoint,
        token: String
    ) async throws -> ResumeRunResponse {
        guard let attempt = UInt32(exactly: checkpoint.attempt),
              let revision = UInt32(exactly: checkpoint.revision)
        else { throw MobileAPIError.invalidRequest }
        var request = BriarAPI_ResumeRunRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.requestID = issueUUIDString(requestID)
        request.checkpointKey = checkpoint.key
        request.attempt = attempt
        request.revision = revision
        return try ResumeRunResponse(connectMessage: issueConnectMessage(
            await issueService.resumeRun(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func dispatchRun(
        projectID: UUID,
        runID: UUID,
        request: DispatchRunRequest,
        reassign: Bool,
        token: String
    ) async throws -> DispatchRunResponse {
        let dispatch = issueDispatchMessage(request)
        if reassign {
            var message = BriarAPI_ReassignRunRequest()
            message.projectID = issueUUIDString(projectID)
            message.runID = issueUUIDString(runID)
            message.dispatch = dispatch
            let response = try issueConnectMessage(await issueService.reassignRun(
                request: message,
                headers: issueAuthorizationHeaders(token)
            ))
            guard response.hasDispatch else { throw MobileAPIError.invalidResponse }
            return try DispatchRunResponse(connectMessage: response.dispatch)
        }
        var message = BriarAPI_DispatchRunRequest()
        message.projectID = issueUUIDString(projectID)
        message.runID = issueUUIDString(runID)
        message.dispatch = dispatch
        let response = try issueConnectMessage(await issueService.dispatchRun(
            request: message,
            headers: issueAuthorizationHeaders(token)
        ))
        guard response.hasDispatch else { throw MobileAPIError.invalidResponse }
        return try DispatchRunResponse(connectMessage: response.dispatch)
    }

    func completeResultReview(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> ResultReview {
        var request = BriarAPI_CompleteResultReviewRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        let response = try issueConnectMessage(await issueService.completeResultReview(
            request: request,
            headers: issueAuthorizationHeaders(token)
        ))
        guard response.hasReview else { throw MobileAPIError.invalidResponse }
        return try ResultReview(connectMessage: response.review)
    }

    func listIssueMessages(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> IssueMessagesResponse {
        var request = BriarAPI_ListIssueMessagesRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        return try IssueMessagesResponse(connectMessage: issueConnectMessage(
            await issueService.listIssueMessages(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func syncIssueMessages(
        projectID: UUID,
        runID: UUID,
        cursor: Int,
        token: String
    ) async throws -> IssueMessagesDeltaResponse {
        guard let cursor = UInt64(exactly: cursor) else { throw MobileAPIError.invalidRequest }
        var request = BriarAPI_SyncIssueMessagesRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.cursor = cursor
        return try IssueMessagesDeltaResponse(connectMessage: issueConnectMessage(
            await issueService.syncIssueMessages(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func createIssueMessage(
        projectID: UUID,
        runID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [String],
        agentConversationID: String?,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueMessageResponse {
        var request = BriarAPI_CreateIssueMessageRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.clientMessageID = issueUUIDString(clientMessageID)
        request.body = body
        if let parentMessageID { request.parentMessageID = issueUUIDString(parentMessageID) }
        request.mentionedUserIds = mentionedUserIDs
        request.mentionedAgentIds = try mentionedAgentIDs.map(issueCanonicalRequestUUIDString)
        if let agentConversationID { request.agentConversationID = agentConversationID }
        request.attachmentReferences = attachmentReferences
        return try CreateIssueMessageResponse(connectMessage: issueConnectMessage(
            await issueService.createIssueMessage(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func getIssueAgentReply(
        projectID: UUID,
        runID: UUID,
        triggerMessageID: UUID,
        token: String
    ) async throws -> IssueAgentReplyResponse {
        var request = BriarAPI_GetIssueAgentReplyRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.triggerMessageID = issueUUIDString(triggerMessageID)
        return try IssueAgentReplyResponse(connectMessage: issueConnectMessage(
            await issueService.getIssueAgentReply(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func listRunEvidence(
        projectID: UUID,
        runID: UUID,
        token: String
    ) async throws -> RunEvidenceResponse {
        var request = BriarAPI_ListRunEvidenceRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        return try RunEvidenceResponse(connectMessage: issueConnectMessage(
            await issueService.listRunEvidence(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func acceptIssueReworkProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueReworkProposalResponse {
        var request = BriarAPI_AcceptIssueReworkProposalRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.proposalID = issueUUIDString(proposalID)
        return try AcceptIssueReworkProposalResponse(connectMessage: issueConnectMessage(
            await issueService.acceptIssueReworkProposal(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func acceptIssueActionProposal(
        projectID: UUID,
        runID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> AcceptIssueActionProposalResponse {
        var request = BriarAPI_AcceptIssueActionProposalRequest()
        request.projectID = issueUUIDString(projectID)
        request.runID = issueUUIDString(runID)
        request.proposalID = issueUUIDString(proposalID)
        return try AcceptIssueActionProposalResponse(connectMessage: issueConnectMessage(
            await issueService.acceptIssueActionProposal(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func acceptIssueExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptIssueExecutionProposalResponse {
        var request = BriarAPI_AcceptIssueExecutionProposalRequest()
        request.projectID = issueUUIDString(projectID)
        request.conversationRunID = issueUUIDString(conversationRunID)
        request.proposalID = issueUUIDString(proposalID)
        request.approval = issueExecutionApprovalMessage(approval)
        return try AcceptIssueExecutionProposalResponse(connectMessage: issueConnectMessage(
            await issueService.acceptIssueExecutionProposal(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }

    func acceptIssueSkillExecutionProposal(
        projectID: UUID,
        conversationRunID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        var request = BriarAPI_AcceptIssueSkillExecutionProposalRequest()
        request.projectID = issueUUIDString(projectID)
        request.conversationRunID = issueUUIDString(conversationRunID)
        request.proposalID = issueUUIDString(proposalID)
        if let workerID { request.workerID = workerID }
        return try AcceptAgentSkillExecutionProposalResponse(connectMessage: issueConnectMessage(
            await issueService.acceptIssueSkillExecutionProposal(
                request: request,
                headers: issueAuthorizationHeaders(token)
            )
        ))
    }
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

extension UpdateIssueResponse {
    init(connectMessage message: BriarAPI_UpdateIssueResponse) throws {
        self.init(
            runId: try issueUUID(message.runID),
            title: message.title,
            description: message.hasDescription_p ? message.description_p : nil,
            priority: message.hasPriority ? try issueSafeInt(message.priority) : nil,
            difficulty: message.hasDifficulty ? try issueDifficulty(message.difficulty) : nil,
            assigneeUserId: message.hasAssigneeUserID ? message.assigneeUserID : nil,
            attachments: try message.attachments.map { try .init(connectMessage: $0) }
        )
    }
}

extension TransferIssueResponse {
    init(connectMessage message: BriarAPI_TransferIssueResponse) throws {
        let outcome: String
        switch message.outcome {
        case .transferred: outcome = "transferred"
        case .alreadyTransferred: outcome = "already_transferred"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            runId: try issueUUID(message.runID),
            sourceProjectId: try issueUUID(message.sourceProjectID),
            targetProjectId: try issueUUID(message.targetProjectID),
            outcome: outcome
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

extension IssueExecutionPreferencesResponse {
    init(connectMessage message: BriarAPI_UpdateIssuePreferencesResponse) throws {
        self.init(
            runId: try issueUUID(message.runID),
            provider: message.hasProvider ? try issueProvider(message.provider) : nil,
            model: message.hasModel ? message.model : nil,
            effort: message.hasEffort ? ModelEffort(rawValue: message.effort) : nil
        )
    }
}

extension DependencyResponse {
    init(connectMessage message: BriarAPI_SetIssueDependencyResponse) throws {
        let outcome: String
        switch message.outcome {
        case .created: outcome = "created"
        case .alreadyExists: outcome = "already_exists"
        case .removed: outcome = "removed"
        case .alreadyRemoved: outcome = "already_removed"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            prerequisiteRunId: try issueUUID(message.prerequisiteRunID),
            dependentRunId: try issueUUID(message.dependentRunID),
            outcome: outcome
        )
    }
}

extension RunStatusResponse {
    init(connectMessage message: BriarAPI_MoveRunResponse) throws {
        let outcome: String
        switch message.outcome {
        case .moved: outcome = "moved"
        case .unchanged: outcome = "unchanged"
        case .alreadyMoved: outcome = "already_moved"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            runId: try issueUUID(message.runID),
            outcome: outcome,
            status: try issueRunStatus(message.status),
            workflowStage: message.hasWorkflowStage ? message.workflowStage : nil
        )
    }
}

extension RunRecoveryResponse {
    init(retryMessage message: BriarAPI_RetryRunResponse) throws {
        let status = try issueRunStatus(message.status)
        guard status == .queued,
              message.outcome == "retried" || message.outcome == "already_retried"
        else { throw MobileAPIError.invalidResponse }
        self.init(
            runId: try issueUUID(message.runID),
            outcome: message.outcome,
            attempt: try issueSafeInt(message.attempt),
            stage: status.rawValue
        )
    }

    init(cancelMessage message: BriarAPI_CancelRunResponse) throws {
        let status = try issueRunStatus(message.status)
        guard status == .cancelled,
              message.outcome == "cancelled" || message.outcome == "already_cancelled"
        else { throw MobileAPIError.invalidResponse }
        self.init(
            runId: try issueUUID(message.runID),
            outcome: message.outcome,
            attempt: try issueSafeInt(message.attempt),
            stage: status.rawValue
        )
    }
}

extension ResumeRunResponse {
    init(connectMessage message: BriarAPI_ResumeRunResponse) throws {
        let outcome: String
        switch message.outcome {
        case .approved: outcome = "approved"
        case .alreadyApproved: outcome = "already_approved"
        case .resumed: outcome = "resumed"
        case .alreadyResumed: outcome = "already_resumed"
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            runId: try issueUUID(message.runID),
            outcome: outcome,
            workflowStage: message.hasWorkflowStage ? message.workflowStage : nil,
            startStage: message.hasStartStage ? message.startStage : nil,
            checkpointKey: message.hasCheckpointKey ? message.checkpointKey : nil,
            attempt: message.hasAttempt ? try issueSafeInt(message.attempt) : nil,
            revision: message.hasRevision ? try issueSafeInt(message.revision) : nil,
            terminalReviewOnly: message.terminalReviewOnly
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

private func issueDispatchMessage(_ request: DispatchRunRequest) -> BriarAPI_DispatchRunInput {
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

private func issueExecutionApprovalMessage(
    _ approval: AcceptIssueExecutionProposalRequest
) -> BriarAPI_IssueExecutionApproval {
    var message = BriarAPI_IssueExecutionApproval()
    message.provider = issueProviderMessage(approval.provider)
    if let model = approval.model { message.model = model }
    if let effort = approval.effort { message.effort = effort.rawValue }
    if let workerID = approval.workerId { message.workerID = workerID }
    return message
}

private func issueConnectMessage<Message: Sendable>(
    _ response: ResponseMessage<Message>
) throws -> Message {
    do {
        return try response.result.get()
    } catch {
        throw MobileAPIError.connect(error)
    }
}

private func issueAuthorizationHeaders(_ token: String) -> Connect.Headers {
    ["authorization": ["Bearer \(token)"]]
}

private func issueUUIDString(_ value: UUID) -> String {
    value.uuidString.lowercased()
}

private func issueCanonicalRequestUUIDString(_ value: String) throws -> String {
    guard let value = UUID(uuidString: value) else { throw MobileAPIError.invalidRequest }
    return issueUUIDString(value)
}

private func issueUUID(_ value: String) throws -> UUID {
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

private func issueProviderMessage(_ value: AgentProvider) -> BriarTypes_AgentProvider {
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

private func issueRunStatusMessage(_ value: DashboardRun.Status) -> BriarAPI_RunStatus {
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
