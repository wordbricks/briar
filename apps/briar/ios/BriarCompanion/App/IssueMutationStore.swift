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
    private let projectID: UUID
    private let token: String
    private let requestID: @Sendable () -> UUID
    private let attachmentReference: @Sendable () -> String
    private var pendingRequestIDs: [String: UUID] = [:]

    init(
        api: any MobileAPIClientProtocol,
        projectID: UUID,
        token: String,
        requestID: @escaping @Sendable () -> UUID = UUID.init,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
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
                return try await api.createIssue(
                    projectID: projectID,
                    draft: normalizedDraft,
                    attachmentReferences: [],
                    token: token,
                )
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
            return try await api.updateIssue(
                projectID: projectID,
                runID: runID,
                draft: normalizedDraft,
                assigneeUpdate: draft.assigneeUserId.map(IssueAssigneeUpdate.assign) ?? .clear,
                attachmentReferences: [],
                keptAttachmentIDs: nil,
                token: token,
            )
        }
    }

    func setSubscription(
        runID: UUID,
        subscribed: Bool
    ) async throws -> IssueSubscriptionResponse {
        try await perform("subscription-\(runID)") {
            try await api.setIssueSubscription(
                projectID: projectID,
                runID: runID,
                subscribed: subscribed,
                token: token,
            )
        }
    }

    func deleteIssue(runID: UUID) async throws {
        try await perform("delete-\(runID)") {
            try await api.deleteIssue(projectID: projectID, runID: runID, token: token)
        }
    }

    func transferIssue(runID: UUID, targetProjectID: UUID) async throws -> TransferIssueResponse {
        try await perform("transfer-\(runID)") {
            try await api.transferIssue(
                projectID: projectID,
                runID: runID,
                targetProjectID: targetProjectID,
                token: token,
            )
        }
    }

    func savePreferences(
        runID: UUID,
        preferences: IssueExecutionPreferences
    ) async throws -> IssueExecutionPreferencesResponse {
        try await perform("preferences-\(runID)") {
            guard preferences.isValid else { throw IssueMutationError.invalidPreferences }
            return try await api.updateIssuePreferences(
                projectID: projectID,
                runID: runID,
                preferences: preferences,
                token: token,
            )
        }
    }

    func setDependency(runID: UUID, prerequisiteID: UUID, enabled: Bool) async throws {
        try await perform("dependency-\(runID)-\(prerequisiteID)") {
            _ = try await api.setIssueDependency(
                projectID: projectID,
                runID: runID,
                prerequisiteRunID: prerequisiteID,
                enabled: enabled,
                token: token
            )
        }
    }

    func move(runID: UUID, status: DashboardRun.Status, workflowStage: String? = nil) async throws {
        try await perform("move-\(runID)") {
            let idempotencyKey = "move-\(runID)-\(status.rawValue)-\(workflowStage ?? "none")"
            _ = try await api.moveRun(
                projectID: projectID,
                runID: runID,
                requestID: idempotencyID(for: idempotencyKey),
                status: status,
                workflowStage: workflowStage,
                token: token,
            )
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
            _ = try await api.dispatchRun(
                projectID: projectID,
                runID: runID,
                request: DispatchRunRequest(
                    provider: provider,
                    model: preferences.model,
                    effort: preferences.effort,
                    persistPreferences: true,
                    workerId: workerID,
                    requestId: idempotencyID(for: idempotencyKey)
                ),
                reassign: reassign,
                token: token,
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func recover(runID: UUID, action: String, reason: String? = nil) async throws {
        try await perform("recover-\(runID)") {
            let idempotencyKey = "recover-\(runID)-\(action)-\(reason ?? "none")"
            _ = try await api.recoverRun(
                projectID: projectID,
                runID: runID,
                requestID: idempotencyID(for: idempotencyKey),
                action: action,
                reason: reason,
                token: token,
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func resume(runID: UUID, checkpoint: WorkflowCheckpoint) async throws {
        try await perform("resume-\(runID)") {
            let idempotencyKey = "resume-\(runID)-\(checkpoint.key)-\(checkpoint.attempt)-\(checkpoint.revision)"
            _ = try await api.resumeRun(
                projectID: projectID,
                runID: runID,
                requestID: idempotencyID(for: idempotencyKey),
                checkpoint: checkpoint,
                token: token,
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func completeReview(runID: UUID) async throws -> ResultReview {
        try await perform("review-\(runID)") {
            try await api.completeResultReview(projectID: projectID, runID: runID, token: token)
        }
    }

    func acceptIssueProposal(
        runID: UUID,
        proposal: IssueProposedAction
    ) async throws -> AcceptIssueProposalResult {
        try await perform("issue-proposal-\(proposal.id)") {
            if proposal.type == .rework {
                let response = try await api.acceptIssueReworkProposal(
                    projectID: projectID,
                    runID: runID,
                    proposalID: proposal.id,
                    token: token,
                )
                return AcceptIssueProposalResult(
                    proposal: response.proposal,
                    executionProposal: nil,
                    requiresAuthoritativeReload: false
                )
            }
            let response = try await api.acceptIssueActionProposal(
                projectID: projectID,
                runID: runID,
                proposalID: proposal.id,
                token: token,
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
            try await api.acceptIssueExecutionProposal(
                projectID: projectID,
                conversationRunID: conversationRunID,
                proposalID: proposalID,
                approval: request,
                token: token,
            )
        }
    }

    func acceptAgentSkillExecutionProposal(
        conversationRunID: UUID,
        proposalID: UUID,
        request: AcceptAgentSkillExecutionProposalRequest
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        try await perform("agent-skill-execution-proposal-\(proposalID)") {
            try await api.acceptIssueSkillExecutionProposal(
                projectID: projectID,
                conversationRunID: conversationRunID,
                proposalID: proposalID,
                workerID: request.workerId,
                token: token,
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
                response = try await api.createIssueMessage(
                    projectID: projectID,
                    runID: runID,
                    clientMessageID: clientMessageID ?? UUID(),
                    body: trimmed,
                    parentMessageID: parentMessageID,
                    mentionedUserIDs: uniqueMentionedUserIds,
                    mentionedAgentIDs: uniqueMentionedAgentIds,
                    agentConversationID: nil,
                    attachmentReferences: attachmentReferences ?? [],
                    token: token,
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
                    polled = try await api.getIssueAgentReply(
                        projectID: projectID,
                        runID: runID,
                        triggerMessageID: response.message.id,
                        token: token,
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
}
