import Foundation

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
            let path = MobileAPIContract.Endpoint.issues(projectID: projectID)
            if attachments.isEmpty {
                return try await api.send(
                    path,
                    method: "POST",
                    token: token,
                    body: CreateIssueRequest(
                        title: title,
                        description: description.isEmpty ? nil : description,
                        priority: draft.priority,
                        assigneeUserId: draft.assigneeUserId,
                        status: draft.status,
                        preferredProvider: draft.preferredProvider,
                        preferredModel: draft.preferredModel,
                        preferredEffort: draft.preferredProvider != nil && draft.preferredModel != nil
                            ? draft.preferredEffort
                            : nil,
                        fullAuto: draft.fullAuto
                    ),
                    as: CreateIssueResponse.self
                )
            }
            return try await api.upload(
                path,
                fields: [
                    "title": title,
                    "description": description,
                    "priority": draft.priority.map(String.init) ?? "",
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
            return try await api.send(
                MobileAPIContract.Endpoint.run(projectID: projectID, runID: runID),
                method: "PATCH",
                token: token,
                body: UpdateIssueRequest(
                    title: title,
                    description: description.isEmpty ? nil : description,
                    priority: draft.priority,
                    assigneeUserId: draft.assigneeUserId
                ),
                as: UpdateIssueResponse.self
            )
        }
    }

    func deleteIssue(runID: UUID) async throws {
        try await perform("delete-\(runID)") {
            try await api.sendVoid(
                MobileAPIContract.Endpoint.run(projectID: projectID, runID: runID),
                method: "DELETE",
                token: token,
                body: nil
            )
        }
    }

    func transferIssue(runID: UUID, targetProjectID: UUID) async throws -> TransferIssueResponse {
        try await perform("transfer-\(runID)") {
            try await api.send(
                MobileAPIContract.Endpoint.runTransfer(projectID: projectID, runID: runID),
                method: "POST",
                token: token,
                body: TransferIssueRequest(targetProjectId: targetProjectID),
                as: TransferIssueResponse.self
            )
        }
    }

    func savePreferences(
        runID: UUID,
        preferences: IssueExecutionPreferences
    ) async throws -> IssueExecutionPreferencesResponse {
        try await perform("preferences-\(runID)") {
            guard preferences.isValid else { throw IssueMutationError.invalidPreferences }
            return try await api.send(
                MobileAPIContract.Endpoint.runPreferences(projectID: projectID, runID: runID),
                method: "PUT",
                token: token,
                body: preferences,
                as: IssueExecutionPreferencesResponse.self
            )
        }
    }

    func setDependency(runID: UUID, prerequisiteID: UUID, enabled: Bool) async throws {
        try await perform("dependency-\(runID)-\(prerequisiteID)") {
            let path = MobileAPIContract.Endpoint.runDependency(
                projectID: projectID,
                runID: runID,
                prerequisiteID: prerequisiteID
            )
            if enabled {
                let _: DependencyResponse = try await api.send(
                    path,
                    method: "PUT",
                    token: token,
                    body: nil,
                    as: DependencyResponse.self
                )
            } else {
                try await api.sendVoid(path, method: "DELETE", token: token, body: nil)
            }
        }
    }

    func move(runID: UUID, status: DashboardRun.Status, workflowStage: String? = nil) async throws {
        try await perform("move-\(runID)") {
            let idempotencyKey = "move-\(runID)-\(status.rawValue)-\(workflowStage ?? "none")"
            let _: RunStatusResponse = try await api.send(
                MobileAPIContract.Endpoint.runStatus(projectID: projectID, runID: runID),
                method: "PUT",
                token: token,
                body: RunStatusRequest(
                    requestId: idempotencyID(for: idempotencyKey),
                    status: status,
                    workflowStage: workflowStage
                ),
                as: RunStatusResponse.self
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
            let _: DispatchRunResponse = try await api.send(
                MobileAPIContract.Endpoint.runDispatch(
                    projectID: projectID,
                    runID: runID,
                    reassign: reassign
                ),
                method: "POST",
                token: token,
                body: DispatchRunRequest(
                    provider: provider,
                    model: preferences.model,
                    effort: preferences.effort,
                    persistPreferences: true,
                    workerId: workerID,
                    requestId: idempotencyID(for: idempotencyKey)
                ),
                as: DispatchRunResponse.self
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func recover(runID: UUID, action: String, reason: String? = nil) async throws {
        try await perform("recover-\(runID)") {
            let idempotencyKey = "recover-\(runID)-\(action)-\(reason ?? "none")"
            let _: RunRecoveryResponse = try await api.send(
                MobileAPIContract.Endpoint.runRecovery(
                    projectID: projectID,
                    runID: runID,
                    action: action
                ),
                method: "POST",
                token: token,
                body: RequestIdentity(
                    requestId: idempotencyID(for: idempotencyKey),
                    reason: reason
                ),
                as: RunRecoveryResponse.self
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func resume(runID: UUID, checkpoint: WorkflowCheckpoint) async throws {
        try await perform("resume-\(runID)") {
            let idempotencyKey = "resume-\(runID)-\(checkpoint.key)-\(checkpoint.attempt)-\(checkpoint.revision)"
            let _: ResumeRunResponse = try await api.send(
                MobileAPIContract.Endpoint.runResume(projectID: projectID, runID: runID),
                method: "POST",
                token: token,
                body: ResumeRunRequest(
                    requestId: idempotencyID(for: idempotencyKey),
                    checkpointKey: checkpoint.key,
                    attempt: checkpoint.attempt,
                    revision: checkpoint.revision
                ),
                as: ResumeRunResponse.self
            )
            pendingRequestIDs.removeValue(forKey: idempotencyKey)
        }
    }

    func completeReview(runID: UUID) async throws -> ResultReview {
        try await perform("review-\(runID)") {
            try await api.send(
                MobileAPIContract.Endpoint.runResultReviews(projectID: projectID, runID: runID),
                method: "POST",
                token: token,
                body: nil,
                as: ResultReview.self
            )
        }
    }

    func acceptIssueProposal(
        runID: UUID,
        proposal: IssueProposedAction
    ) async throws -> IssueProposedAction {
        try await perform("issue-proposal-\(proposal.id)") {
            if proposal.type == .rework {
                let response: AcceptIssueReworkProposalResponse = try await api.send(
                    MobileAPIContract.Endpoint.acceptIssueReworkProposal(
                        projectID: projectID,
                        runID: runID,
                        proposalID: proposal.id
                    ),
                    method: "POST",
                    token: token,
                    body: nil,
                    as: AcceptIssueReworkProposalResponse.self
                )
                return response.proposal
            }
            let response: AcceptIssueActionProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.acceptIssueActionProposal(
                    projectID: projectID,
                    runID: runID,
                    proposalID: proposal.id
                ),
                method: "POST",
                token: token,
                body: nil,
                as: AcceptIssueActionProposalResponse.self
            )
            return response.proposal
        }
    }

    func sendMessage(
        runID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIds: [String] = [],
        attachments: [PendingIssueAttachment] = [],
        pollInterval: Duration = .seconds(2),
        maximumPolls: Int = 150
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
                throw IssueMutationError.attachment("대화에는 이미지만 첨부할 수 있습니다.")
            }
            let path = MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID)
            let uniqueMentionedUserIds = Array(Set(mentionedUserIds.filter { !$0.isEmpty })).sorted()
            let mentionedUserIdsJSON = String(
                data: try JSONEncoder().encode(uniqueMentionedUserIds),
                encoding: .utf8
            ) ?? "[]"
            let response: CreateIssueMessageResponse
            if attachments.isEmpty {
                response = try await api.send(
                    path,
                    method: "POST",
                    token: token,
                    body: CreateIssueMessageRequest(
                        body: trimmed,
                        parentMessageId: parentMessageID,
                        mentionedUserIds: uniqueMentionedUserIds,
                        agentConversationId: nil
                    ),
                    as: CreateIssueMessageResponse.self
                )
            } else {
                let payload = try AttachmentMessagePayload(
                    body: trimmed,
                    attachments: attachments,
                    referenceGenerator: attachmentReference
                )
                response = try await api.upload(
                    path,
                    fields: [
                        "body": payload.body,
                        "parentMessageId": parentMessageID?.uuidString.lowercased() ?? "",
                        "mentionedUserIds": mentionedUserIdsJSON,
                        "agentConversationId": "",
                        "attachmentReferences": payload.referencesJSON,
                    ],
                    files: payload.files,
                    token: token,
                    as: CreateIssueMessageResponse.self
                )
            }
            guard response.agentReply != nil else { return [response.message] }
            for _ in 0..<maximumPolls {
                try await Task.sleep(for: pollInterval)
                let polled: IssueAgentReplyResponse
                do {
                    polled = try await api.send(
                        MobileAPIContract.Endpoint.runAgentReply(
                            projectID: projectID,
                            runID: runID,
                            triggerMessageID: response.message.id
                        ),
                        method: "GET",
                        token: token,
                        body: nil,
                        as: IssueAgentReplyResponse.self
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    throw IssueMutationError.agentReplyPollingFailed
                }
                switch polled.agentReply.status {
                case .completed:
                    return [response.message] + (polled.message.map { [$0] } ?? [])
                case .failed:
                    throw IssueMutationError.agentReplyFailed(
                        polled.agentReply.error ?? "Briar가 답변을 만들지 못했습니다."
                    )
                case .queued, .running:
                    continue
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
