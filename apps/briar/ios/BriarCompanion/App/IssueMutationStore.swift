import BriarContracts
import Foundation

struct AcceptIssueProposalResult: Sendable {
    let proposal: IssueProposedAction?
    let executionProposal: IssueExecutionProposal?
    let requiresAuthoritativeReload: Bool
}

@MainActor
final class IssueMutationStore: ObservableObject {
    @Published private(set) var activeActions: Set<String> = []
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let issueService: (any BriarAPI_IssueServiceClientInterface)?
    private let projectID: UUID
    private let token: String
    private let requestID: @Sendable () -> UUID
    private let attachmentReference: @Sendable () -> String
    private var pendingRequestIDs: [String: UUID] = [:]

    init(
        api: any MobileAPIClientProtocol,
        issueService: (any BriarAPI_IssueServiceClientInterface)? = nil,
        projectID: UUID,
        token: String,
        requestID: @escaping @Sendable () -> UUID = UUID.init,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
        self.issueService = issueService ?? (api as? any AuthenticatedMobileServicesFactory)?
            .authenticatedServices(token: token).issue
        self.projectID = projectID
        self.token = token
        self.requestID = requestID
        self.attachmentReference = attachmentReference
    }

    func isActive(_ action: String) -> Bool { activeActions.contains(action) }

    func createIssue(
        draft: IssueDraft,
        attachments: [PendingIssueAttachment]
    ) async throws -> CreateIssueResponse {
        try await perform("create") {
            let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if let titleError = IssueTitleLimits.validationError(for: title) {
                throw titleError
            }
            if let message = PendingIssueAttachment.validationMessage(for: attachments) {
                throw IssueMutationError.attachment(message)
            }
            let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
            if attachments.isEmpty {
                var normalizedDraft = draft
                normalizedDraft.title = title
                normalizedDraft.description = description
                normalizedDraft.preferredEffort = draft.preferredProvider != nil &&
                        draft.preferredModel != nil
                    ? draft.preferredEffort
                    : nil
                let response = try await issueClient().createIssue(
                    request: issueCreateRequest(
                        projectID: projectID,
                        draft: normalizedDraft,
                        attachmentReferences: []
                    ),
                    headers: [:]
                )
                return try CreateIssueResponse(connectMessage: response.briarValue())
            }
            return try await api.upload(
                MobileAPIContract.Endpoint.issues(projectID: projectID),
                fields: [
                    "title": title,
                    "description": description,
                    "priority": draft.priority.map(String.init) ?? "",
                    "difficulty": draft.difficulty?.rawValue ?? "",
                    "assigneeUserId": draft.assigneeUserId ?? "",
                    "status": draft.status.rawValue,
                    "preferredProvider": draft.preferredProvider?.rawValue ?? "",
                    "preferredModel": draft.preferredModel ?? "",
                    "preferredEffort": draft.preferredProvider != nil && draft.preferredModel != nil
                        ? (draft.preferredEffort?.rawValue ?? "")
                        : "",
                    "fullAuto": draft.fullAuto ? "true" : "false",
                ],
                files: attachments.map {
                    MultipartFile(
                        fieldName: "attachments",
                        filename: $0.filename,
                        contentType: $0.contentType,
                        data: $0.data
                    )
                },
                token: token,
                as: CreateIssueResponse.self
            )
        }
    }

    func updateIssue(runID: UUID, draft: IssueDraft) async throws -> UpdateIssueResponse {
        try await perform("update-\(runID)") {
            let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if let titleError = IssueTitleLimits.validationError(for: title) {
                throw titleError
            }
            let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
            var normalizedDraft = draft
            normalizedDraft.title = title
            normalizedDraft.description = description
            let response = try await issueClient().updateIssue(
                request: issueUpdateRequest(
                    projectID: projectID,
                    runID: runID,
                    draft: normalizedDraft,
                    assigneeUpdate: draft.assigneeUserId.map(IssueAssigneeUpdate.assign) ?? .clear,
                    attachmentReferences: [],
                    keptAttachmentIDs: nil
                ),
                headers: [:]
            )
            return try UpdateIssueResponse(connectMessage: response.briarValue())
        }
    }

    func setSubscription(
        runID: UUID,
        subscribed: Bool
    ) async throws -> IssueSubscriptionResponse {
        try await perform("subscription-\(runID)") {
            var request = BriarAPI_SetIssueSubscriptionRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.subscribed = subscribed
            let response = try await issueClient().setIssueSubscription(
                request: request,
                headers: [:]
            )
            return try IssueSubscriptionResponse(connectMessage: response.briarValue())
        }
    }

    func deleteIssue(runID: UUID) async throws {
        try await perform("delete-\(runID)") {
            var request = BriarAPI_DeleteIssueRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            let response = try await issueClient().deleteIssue(request: request, headers: [:])
            guard try response.briarValue().deleted else {
                throw MobileAPIError.invalidResponse
            }
        }
    }

    func transferIssue(runID: UUID, targetProjectID: UUID) async throws -> TransferIssueResponse {
        try await perform("transfer-\(runID)") {
            var request = BriarAPI_TransferIssueRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.targetProjectID = coreUUIDString(targetProjectID)
            let response = try await issueClient().transferIssue(
                request: request,
                headers: [:]
            )
            return try TransferIssueResponse(connectMessage: response.briarValue())
        }
    }

    func savePreferences(
        runID: UUID,
        preferences: IssueExecutionPreferences
    ) async throws -> IssueExecutionPreferencesResponse {
        try await perform("preferences-\(runID)") {
            guard preferences.isValid else { throw IssueMutationError.invalidPreferences }
            var request = BriarAPI_UpdateIssuePreferencesRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            if let provider = preferences.provider {
                request.provider = issueProviderMessage(provider)
            }
            if let model = preferences.model { request.model = model }
            if let effort = preferences.effort { request.effort = effort.rawValue }
            let response = try await issueClient().updateIssuePreferences(
                request: request,
                headers: [:]
            )
            return try IssueExecutionPreferencesResponse(connectMessage: response.briarValue())
        }
    }

    func setDependency(runID: UUID, prerequisiteID: UUID, enabled: Bool) async throws {
        try await perform("dependency-\(runID)-\(prerequisiteID)") {
            var request = BriarAPI_SetIssueDependencyRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.prerequisiteRunID = coreUUIDString(prerequisiteID)
            request.enabled = enabled
            let response = try await issueClient().setIssueDependency(
                request: request,
                headers: [:]
            )
            _ = try DependencyResponse(connectMessage: response.briarValue())
        }
    }

    func move(runID: UUID, status: DashboardRun.Status, workflowStage: String? = nil) async throws {
        try await perform("move-\(runID)") {
            let idempotencyKey = "move-\(runID)-\(status.rawValue)-\(workflowStage ?? "none")"
            var request = BriarAPI_MoveRunRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.requestID = coreUUIDString(idempotencyID(for: idempotencyKey))
            request.status = issueRunStatusMessage(status)
            if let workflowStage { request.workflowStage = workflowStage }
            let response = try await issueClient().moveRun(
                request: request,
                headers: [:]
            )
            _ = try RunStatusResponse(connectMessage: response.briarValue())
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func dispatch(
        runID: UUID,
        preferences: IssueExecutionPreferences,
        workerID: String?,
        reassign: Bool
    ) async throws {
        try await perform("dispatch-\(runID)") {
            guard let provider = preferences.provider else {
                throw IssueMutationError.invalidPreferences
            }
            guard preferences.isValid else { throw IssueMutationError.invalidPreferences }
            let idempotencyKey = "dispatch-\(runID)-\(reassign)-\(provider.rawValue)-\(preferences.model ?? "none")-\(preferences.effort?.rawValue ?? "none")-\(workerID ?? "any")"
            let dispatch = issueDispatchMessage(DispatchRunRequest(
                provider: provider,
                model: preferences.model,
                effort: preferences.effort,
                persistPreferences: true,
                workerId: workerID,
                requestId: idempotencyID(for: idempotencyKey)
            ))
            let result: DispatchRunResponse
            if reassign {
                var request = BriarAPI_ReassignRunRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.dispatch = dispatch
                let response = try await issueClient().reassignRun(
                    request: request,
                    headers: [:]
                ).briarValue()
                guard response.hasDispatch else { throw MobileAPIError.invalidResponse }
                result = try DispatchRunResponse(connectMessage: response.dispatch)
            } else {
                var request = BriarAPI_DispatchRunRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.dispatch = dispatch
                let response = try await issueClient().dispatchRun(
                    request: request,
                    headers: [:]
                ).briarValue()
                guard response.hasDispatch else { throw MobileAPIError.invalidResponse }
                result = try DispatchRunResponse(connectMessage: response.dispatch)
            }
            _ = result
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func recover(runID: UUID, action: String, reason: String? = nil) async throws {
        try await perform("recover-\(runID)") {
            let idempotencyKey = "recover-\(runID)-\(action)-\(reason ?? "none")"
            let result: RunRecoveryResponse
            switch action {
            case "retry":
                var request = BriarAPI_RetryRunRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.requestID = coreUUIDString(idempotencyID(for: idempotencyKey))
                if let reason { request.reason = reason }
                let response = try await issueClient().retryRun(
                    request: request,
                    headers: [:]
                )
                result = try RunRecoveryResponse(retryMessage: response.briarValue())
            case "cancel":
                var request = BriarAPI_CancelRunRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.requestID = coreUUIDString(idempotencyID(for: idempotencyKey))
                if let reason { request.reason = reason }
                let response = try await issueClient().cancelRun(
                    request: request,
                    headers: [:]
                )
                result = try RunRecoveryResponse(cancelMessage: response.briarValue())
            default:
                throw MobileAPIError.invalidRequest
            }
            _ = result
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func resume(runID: UUID, checkpoint: WorkflowCheckpoint) async throws {
        try await perform("resume-\(runID)") {
            let idempotencyKey = "resume-\(runID)-\(checkpoint.key)-\(checkpoint.attempt)-\(checkpoint.revision)"
            guard let attempt = UInt32(exactly: checkpoint.attempt),
                  let revision = UInt32(exactly: checkpoint.revision)
            else { throw MobileAPIError.invalidRequest }
            var request = BriarAPI_ResumeRunRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.requestID = coreUUIDString(idempotencyID(for: idempotencyKey))
            request.checkpointKey = checkpoint.key
            request.attempt = attempt
            request.revision = revision
            let response = try await issueClient().resumeRun(
                request: request,
                headers: [:]
            )
            _ = try ResumeRunResponse(connectMessage: response.briarValue())
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func completeReview(runID: UUID) async throws -> ResultReview {
        try await perform("review-\(runID)") {
            var request = BriarAPI_CompleteResultReviewRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            let response = try await issueClient().completeResultReview(
                request: request,
                headers: [:]
            ).briarValue()
            guard response.hasReview else { throw MobileAPIError.invalidResponse }
            return try ResultReview(connectMessage: response.review)
        }
    }

    func acceptIssueProposal(
        runID: UUID,
        proposal: IssueProposedAction
    ) async throws -> AcceptIssueProposalResult {
        try await perform("issue-proposal-\(proposal.id)") {
            if proposal.type == .rework {
                var request = BriarAPI_AcceptIssueReworkProposalRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.proposalID = coreUUIDString(proposal.id)
                let wireResponse = try await issueClient().acceptIssueReworkProposal(
                    request: request,
                    headers: [:]
                )
                let response = try AcceptIssueReworkProposalResponse(
                    connectMessage: wireResponse.briarValue()
                )
                return AcceptIssueProposalResult(
                    proposal: response.proposal,
                    executionProposal: nil,
                    requiresAuthoritativeReload: false
                )
            }
            var request = BriarAPI_AcceptIssueActionProposalRequest()
            request.projectID = coreUUIDString(projectID)
            request.runID = coreUUIDString(runID)
            request.proposalID = coreUUIDString(proposal.id)
            let wireResponse = try await issueClient().acceptIssueActionProposal(
                request: request,
                headers: [:]
            )
            let response = try AcceptIssueActionProposalResponse(
                connectMessage: wireResponse.briarValue()
            )
            let proposalMatches = response.proposal.id == proposal.id
            let executionProposal: IssueExecutionProposal? =
                response.executionProposal.flatMap { candidate in
                guard response.proposal.type == .create,
                      let resultRunID = response.resultRunId,
                      issueExecutionProposalMatchesCreatedRun(
                          candidate,
                          projectID: projectID,
                          runID: resultRunID
                      )
                else { return nil }
                return candidate
            }
            return AcceptIssueProposalResult(
                proposal: proposalMatches ? response.proposal : nil,
                executionProposal: executionProposal,
                requiresAuthoritativeReload: !proposalMatches ||
                    (response.executionProposal != nil && executionProposal == nil)
            )
        }
    }

    func acceptIssueExecutionProposal(
        conversationRunID: UUID,
        proposalID: UUID,
        request: AcceptIssueExecutionProposalRequest
    ) async throws -> AcceptIssueExecutionProposalResponse {
        try await perform("issue-execution-proposal-\(proposalID)") {
            var message = BriarAPI_AcceptIssueExecutionProposalRequest()
            message.projectID = coreUUIDString(projectID)
            message.conversationRunID = coreUUIDString(conversationRunID)
            message.proposalID = coreUUIDString(proposalID)
            message.approval = issueExecutionApprovalMessage(request)
            let response = try await issueClient().acceptIssueExecutionProposal(
                request: message,
                headers: [:]
            )
            return try AcceptIssueExecutionProposalResponse(
                connectMessage: response.briarValue()
            )
        }
    }

    func acceptAgentSkillExecutionProposal(
        conversationRunID: UUID,
        proposalID: UUID,
        request: AcceptAgentSkillExecutionProposalRequest
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        try await perform("agent-skill-execution-proposal-\(proposalID)") {
            var message = BriarAPI_AcceptIssueSkillExecutionProposalRequest()
            message.projectID = coreUUIDString(projectID)
            message.conversationRunID = coreUUIDString(conversationRunID)
            message.proposalID = coreUUIDString(proposalID)
            if let workerID = request.workerId { message.workerID = workerID }
            let response = try await issueClient().acceptIssueSkillExecutionProposal(
                request: message,
                headers: [:]
            )
            return try AcceptAgentSkillExecutionProposalResponse(
                connectMessage: response.briarValue()
            )
        }
    }

    func sendMessage(
        runID: UUID,
        body: String,
        clientMessageID: UUID? = nil,
        parentMessageID: UUID?,
        mentionedUserIds: [String] = [],
        mentionedAgentIds: [String] = [],
        attachments: [PendingIssueAttachment] = [],
        attachmentReferences: [String]? = nil,
        pollInterval: Duration = .seconds(2),
        maximumPolls: Int = 150,
        onCreated: ((IssueMessage) -> Void)? = nil,
        onAgentReplyChanged: ((IssueAgentReplyJob) -> Void)? = nil
    ) async throws -> [IssueMessage] {
        try await perform("message-\(runID)") {
            let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty || !attachments.isEmpty else {
                throw IssueMutationError.invalidMessage
            }
            if let message = PendingIssueAttachment.validationMessage(for: attachments) {
                throw IssueMutationError.attachment(message)
            }
            guard attachments.allSatisfy({ $0.contentType.hasPrefix("image/") }) else {
                throw IssueMutationError.attachment(L10n.text("대화에는 이미지만 첨부할 수 있습니다."))
            }
            let uniqueMentionedUserIds = Array(Set(mentionedUserIds.filter { !$0.isEmpty })).sorted()
            let uniqueMentionedAgentIds = Array(Set(mentionedAgentIds.filter { !$0.isEmpty })).sorted()
            let mentionedUserIdsJSON = String(
                data: try JSONEncoder().encode(uniqueMentionedUserIds),
                encoding: .utf8
            ) ?? "[]"
            let mentionedAgentIdsJSON = String(
                data: try JSONEncoder().encode(uniqueMentionedAgentIds),
                encoding: .utf8
            ) ?? "[]"
            let response: CreateIssueMessageResponse
            if attachments.isEmpty {
                var request = BriarAPI_CreateIssueMessageRequest()
                request.projectID = coreUUIDString(projectID)
                request.runID = coreUUIDString(runID)
                request.clientMessageID = coreUUIDString(clientMessageID ?? UUID())
                request.body = trimmed
                if let parentMessageID {
                    request.parentMessageID = coreUUIDString(parentMessageID)
                }
                request.mentionedUserIds = uniqueMentionedUserIds
                request.mentionedAgentIds = try uniqueMentionedAgentIds.map {
                    guard let id = UUID(uuidString: $0) else {
                        throw MobileAPIError.invalidRequest
                    }
                    return coreUUIDString(id)
                }
                request.attachmentReferences = attachmentReferences ?? []
                let wireResponse = try await issueClient().createIssueMessage(
                    request: request,
                    headers: [:]
                )
                response = try CreateIssueMessageResponse(
                    connectMessage: wireResponse.briarValue()
                )
            } else {
                let payload = try AttachmentMessagePayload(
                    body: trimmed,
                    attachments: attachments,
                    references: attachmentReferences,
                    referenceGenerator: attachmentReference
                )
                response = try await api.upload(
                    MobileAPIContract.Endpoint.runMessages(
                        projectID: projectID,
                        runID: runID
                    ),
                    fields: [
                        "body": payload.body,
                        "clientMessageId": clientMessageID?.uuidString.lowercased() ?? "",
                        "parentMessageId": parentMessageID?.uuidString.lowercased() ?? "",
                        "mentionedUserIds": mentionedUserIdsJSON,
                        "mentionedAgentIds": mentionedAgentIdsJSON,
                        "agentConversationId": "",
                        "attachmentReferences": payload.referencesJSON,
                    ],
                    files: payload.files,
                    token: token,
                    as: CreateIssueMessageResponse.self
                )
            }
            onCreated?(response.message)
            let initialReplies = response.agentReplies.isEmpty
                ? response.agentReply.map { [$0] } ?? []
                : response.agentReplies
            guard !initialReplies.isEmpty else { return [response.message] }
            for initialReply in initialReplies {
                onAgentReplyChanged?(initialReply)
            }
            for _ in 0..<maximumPolls {
                try await Task.sleep(for: pollInterval)
                let polled: IssueAgentReplyResponse
                do {
                    var request = BriarAPI_GetIssueAgentReplyRequest()
                    request.projectID = coreUUIDString(projectID)
                    request.runID = coreUUIDString(runID)
                    request.triggerMessageID = coreUUIDString(response.message.id)
                    let wireResponse = try await issueClient().getIssueAgentReply(
                        request: request,
                        headers: [:]
                    )
                    polled = try IssueAgentReplyResponse(
                        connectMessage: wireResponse.briarValue()
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    throw IssueMutationError.agentReplyPollingFailed
                }
                let polledReplies = polled.agentReplies.isEmpty
                    ? [polled.agentReply]
                    : polled.agentReplies
                for polledReply in polledReplies {
                    onAgentReplyChanged?(polledReply)
                    if polledReply.status == .failed {
                        throw IssueMutationError.agentReplyFailed(
                            polledReply.error ?? L10n.text("Agent가 답변을 만들지 못했습니다.")
                        )
                    }
                }
                if polledReplies.count >= initialReplies.count &&
                    polledReplies.allSatisfy({ $0.status == .completed }) {
                    let completedMessages = polled.messages.isEmpty
                        ? polled.message.map { [$0] } ?? []
                        : polled.messages
                    return [response.message] + completedMessages.filter {
                        $0.id != response.message.id
                    }
                }
            }
            throw IssueMutationError.agentReplyTimedOut
        }
    }

    private func perform<T: Sendable>(
        _ key: String,
        operation: () async throws -> T
    ) async throws -> T {
        guard activeActions.insert(key).inserted else {
            throw IssueMutationError.duplicateAction
        }
        errorMessage = nil
        defer { activeActions.remove(key) }
        do {
            return try await operation()
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    private func idempotencyID(for key: String) -> UUID {
        if let existing = pendingRequestIDs[key] { return existing }
        let created = requestID()
        pendingRequestIDs[key] = created
        return created
    }

    private func issueClient() throws -> any BriarAPI_IssueServiceClientInterface {
        guard let issueService else { throw MobileAPIError.invalidRequest }
        return issueService
    }
}
