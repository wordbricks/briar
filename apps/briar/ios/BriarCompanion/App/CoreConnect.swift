import BriarContracts
import Connect
import Foundation
import SwiftProtobuf

struct CurrentUser: Equatable, Sendable {
    let id: String
    let username: String?
    let name: String
    let email: String
    let image: String?

    init(
        id: String,
        username: String?,
        name: String,
        email: String,
        image: String?
    ) {
        self.id = id
        self.username = username
        self.name = name
        self.email = email
        self.image = image
    }

    init(connectMessage message: BriarAPI_GetCurrentUserResponse) throws {
        guard message.hasUser else { throw MobileAPIError.invalidResponse }
        let user = message.user
        guard !user.id.isEmpty, !user.name.isEmpty, !user.email.isEmpty else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: user.id,
            username: user.hasUsername ? user.username : nil,
            name: user.name,
            email: user.email,
            image: user.hasImage ? user.image : nil
        )
    }
}

struct AuthenticatedMobileServices: Sendable {
    let account: any BriarAPI_AccountServiceClientInterface
    let project: any BriarAPI_ProjectServiceClientInterface
    let dashboard: any BriarAPI_DashboardServiceClientInterface
    let inbox: any BriarAPI_InboxServiceClientInterface
    let issue: any BriarAPI_IssueServiceClientInterface
    let channel: any BriarAPI_ChannelServiceClientInterface
    let agent: any BriarAPI_AgentServiceClientInterface

    init(
        account: any BriarAPI_AccountServiceClientInterface,
        project: any BriarAPI_ProjectServiceClientInterface,
        dashboard: any BriarAPI_DashboardServiceClientInterface,
        inbox: any BriarAPI_InboxServiceClientInterface,
        issue: any BriarAPI_IssueServiceClientInterface,
        channel: any BriarAPI_ChannelServiceClientInterface,
        agent: any BriarAPI_AgentServiceClientInterface
    ) {
        self.account = account
        self.project = project
        self.dashboard = dashboard
        self.inbox = inbox
        self.issue = issue
        self.channel = channel
        self.agent = agent
    }

    init(baseURL: URL, session: URLSession, token: String) {
        let protocolClient = ProtocolClient(
            httpClient: URLSessionHTTPClient(configuration: session.configuration),
            config: ProtocolClientConfig(
                host: baseURL.absoluteString,
                networkProtocol: .connect,
                codec: ProtoCodec(),
                unaryGET: .disabled,
                interceptors: [.init { _ in BearerTokenInterceptor(token: token) }]
            )
        )
        account = BriarAPI_AccountServiceClient(client: protocolClient)
        project = BriarAPI_ProjectServiceClient(client: protocolClient)
        dashboard = BriarAPI_DashboardServiceClient(client: protocolClient)
        inbox = BriarAPI_InboxServiceClient(client: protocolClient)
        issue = BriarAPI_IssueServiceClient(client: protocolClient)
        channel = BriarAPI_ChannelServiceClient(client: protocolClient)
        agent = BriarAPI_AgentServiceClient(client: protocolClient)
    }
}

protocol AuthenticatedMobileServicesFactory: Sendable {
    func authenticatedServices(token: String) -> AuthenticatedMobileServices
}

extension MobileHTTPClient: AuthenticatedMobileServicesFactory {
    func authenticatedServices(token: String) -> AuthenticatedMobileServices {
        AuthenticatedMobileServices(baseURL: baseURL, session: session, token: token)
    }
}

func authenticatedMobileServices(
    for api: any MobileHTTPClientProtocol,
    token: String
) throws -> AuthenticatedMobileServices {
    guard let factory = api as? any AuthenticatedMobileServicesFactory else {
        throw MobileAPIError.invalidRequest
    }
    return factory.authenticatedServices(token: token)
}

private final class BearerTokenInterceptor: UnaryInterceptor, @unchecked Sendable {
    private let token: String

    init(token: String) {
        self.token = token
    }

    func handleUnaryRequest<Message: ProtobufMessage>(
        _ request: HTTPRequest<Message>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Message>, ConnectError>) -> Void
    ) {
        var headers = request.headers
        headers["authorization"] = ["Bearer \(token)"]
        proceed(.success(HTTPRequest(
            url: request.url,
            headers: headers,
            message: request.message,
            method: request.method,
            trailers: request.trailers,
            idempotencyLevel: request.idempotencyLevel
        )))
    }
}

extension ResponseMessage {
    func briarValue() throws -> Output {
        do {
            return try result.get()
        } catch {
            throw MobileAPIError.connect(error)
        }
    }
}

func coreUUIDString(_ value: UUID) -> String {
    value.uuidString.lowercased()
}

extension DashboardSnapshot {
    init(connectMessage message: BriarAPI_GetDashboardResponse) throws {
        guard message.hasProject, message.hasSettings, message.hasGeneratedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            project: try Project(connectMessage: message.project),
            settings: try ProjectSettings(connectMessage: message.settings),
            runs: try message.runs.map(DashboardRun.init(connectMessage:)),
            workers: try message.workers.map(DashboardWorker.init(connectMessage:)),
            organizationProviders: try message.organizationProviders.map(coreProvider),
            executionPolicy: message.hasExecutionPolicy
                ? try .init(connectMessage: message.executionPolicy)
                : nil,
            members: try message.members.map(OrganizationMember.init(connectMessage:)),
            conversationNotifications: try message.conversationNotifications.map(
                ConversationNotification.init(connectMessage:)
            ),
            channelNotifications: try message.channelNotifications.map(
                ChannelNotification.init(connectMessage:)
            ),
            cursor: try coreSafeInt(message.cursor),
            generatedAt: try coreDate(message.generatedAt)
        )
    }
}

extension DashboardDelta {
    init(connectMessage message: BriarAPI_SyncDashboardResponse) throws {
        guard message.hasGeneratedAt else { throw MobileAPIError.invalidResponse }
        self.init(
            cursor: try coreSafeInt(message.cursor),
            hasMore: message.hasMore_p,
            reset: message.reset,
            runs: try message.runs.map(DashboardRun.init(connectMessage:)),
            deletedRunIds: try message.deletedRunIds.map(coreUUID),
            project: message.hasProject ? try .init(connectMessage: message.project) : nil,
            settings: message.hasSettings ? try .init(connectMessage: message.settings) : nil,
            workers: try message.workers.map(DashboardWorker.init(connectMessage:)),
            organizationProviders: try message.organizationProviders.map(coreProvider),
            executionPolicy: message.hasExecutionPolicy
                ? try .init(connectMessage: message.executionPolicy)
                : nil,
            members: message.hasMembers
                ? try message.members.values.map(OrganizationMember.init(connectMessage:))
                : nil,
            conversationNotifications: message.hasConversationNotifications
                ? try message.conversationNotifications.values.map(
                    ConversationNotification.init(connectMessage:)
                )
                : nil,
            channelNotifications: try message.channelNotifications.map(
                ChannelNotification.init(connectMessage:)
            ),
            generatedAt: try coreDate(message.generatedAt)
        )
    }
}

extension ProjectSettings {
    init(connectMessage message: BriarAPI_ProjectSettings) throws {
        guard message.hasLinear, message.hasWorkflow else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            velenOrg: message.hasVelenOrg ? message.velenOrg : nil,
            dataSource: message.hasDataSource ? message.dataSource : nil,
            linear: .init(
                enabled: message.linear.enabled,
                source: message.linear.hasSource ? message.linear.source : nil,
                teamKey: message.linear.hasTeamKey ? message.linear.teamKey : nil
            ),
            githubRepositoryId: message.hasGithubRepositoryID
                ? try coreSafeInt(message.githubRepositoryID)
                : nil,
            githubRepository: message.hasGithubRepository ? message.githubRepository : nil,
            workflow: try coreWorkflow(message.workflow),
            checkpointPolicy: message.hasCheckpointPolicy
                ? try .init(connectMessage: message.checkpointPolicy)
                : nil
        )
    }
}

extension ProjectSettings.CheckpointPolicy {
    init(connectMessage message: BriarTypes_CheckpointPolicy) throws {
        self.init(
            availableBoundaries: try message.availableBoundaries.map { boundary in
                .init(
                    stage: boundary.stage,
                    stageLabel: boundary.stageLabel,
                    position: try coreCheckpointPosition(boundary.position)
                )
            },
            projectMandatory: try message.projectMandatory.map(
                ProjectSettings.CheckpointPolicy.Checkpoint.init(connectMessage:)
            ),
            userDefaults: try message.userDefaults.map(
                ProjectSettings.CheckpointPolicy.Checkpoint.init(connectMessage:)
            ),
            effective: try message.effective.map(
                ProjectSettings.CheckpointPolicy.Checkpoint.init(connectMessage:)
            ),
            projectRevision: try coreSafeInt(message.projectRevision),
            userRevision: try coreSafeInt(message.userRevision)
        )
    }
}

extension ProjectSettings.CheckpointPolicy.Checkpoint {
    init(connectMessage message: BriarTypes_WorkflowCheckpointSpec) throws {
        self.init(
            key: message.key,
            stage: message.stage,
            position: try coreCheckpointPosition(message.position)
        )
    }
}

extension DashboardRun {
    init(connectMessage message: BriarAPI_DashboardRun) throws {
        guard message.hasWorkflow,
              message.hasStartedAt,
              message.hasUpdatedAt,
              message.hasLastEventAt
        else { throw MobileAPIError.invalidResponse }

        self.init(
            id: try coreUUID(message.id),
            runNumber: try coreSafeInt(message.runNumber),
            currentAttempt: try coreSafeInt(message.currentAttempt),
            currentRevision: try coreSafeInt(message.currentRevision),
            sourceKey: message.sourceKey,
            sourceCreatedAt: message.hasSourceCreatedAt
                ? try coreDate(message.sourceCreatedAt)
                : nil,
            title: message.title,
            status: try coreRunStatus(message.status),
            workflowStage: message.hasWorkflowStage ? message.workflowStage : nil,
            workflow: try coreWorkflow(message.workflow),
            pausedAt: message.hasPausedAt ? try coreDate(message.pausedAt) : nil,
            resumeRequestedAt: message.hasResumeRequestedAt
                ? try coreDate(message.resumeRequestedAt)
                : nil,
            checkpoint: message.hasCheckpoint
                ? try .init(connectMessage: message.checkpoint)
                : nil,
            progress: message.progress,
            detail: message.hasDetail ? message.detail : nil,
            priority: message.hasPriority ? try coreSafeInt(message.priority) : nil,
            difficulty: message.hasDifficulty ? try coreDifficulty(message.difficulty) : nil,
            assigneeUserId: message.hasAssigneeUserID ? message.assigneeUserID : nil,
            createdByUserId: message.hasCreatedByUserID ? message.createdByUserID : nil,
            subscribers: try message.subscribers.map { subscriber in
                guard subscriber.hasSubscribedAt else { throw MobileAPIError.invalidResponse }
                return IssueSubscriber(
                    userId: subscriber.userID,
                    subscribedAt: try coreDate(subscriber.subscribedAt)
                )
            },
            issueDescription: message.hasIssueDescription ? message.issueDescription : nil,
            relatedMessage: message.hasRelatedMessage
                ? try .init(connectMessage: message.relatedMessage)
                : nil,
            attachments: try message.attachments.map(IssueAttachment.init(connectMessage:)),
            prerequisites: try message.prerequisites.map(
                IssueDependencyReference.init(connectMessage:)
            ),
            dependents: try message.dependents.map(
                IssueDependencyReference.init(connectMessage:)
            ),
            executionReadiness: message.hasExecutionReadiness
                ? try coreExecutionReadiness(message.executionReadiness)
                : nil,
            waitingOnPrerequisiteCount: message.hasWaitingOnPrerequisiteCount
                ? try coreSafeInt(message.waitingOnPrerequisiteCount)
                : nil,
            resultSummary: message.hasResultSummary ? message.resultSummary : nil,
            structuredResult: message.hasStructuredResult
                ? try .init(connectMessage: message.structuredResult)
                : nil,
            resultReviews: try message.resultReviews.map(ResultReview.init(connectMessage:)),
            pullRequestUrls: try message.pullRequestUrls.map(coreURL),
            branch: message.hasBranch ? message.branch : nil,
            commitSha: message.hasCommitSha ? message.commitSha : nil,
            preferredProvider: message.hasPreferredProvider
                ? try coreProvider(message.preferredProvider)
                : nil,
            preferredModel: message.hasPreferredModel ? message.preferredModel : nil,
            preferredEffort: message.hasPreferredEffort
                ? ModelEffort(rawValue: message.preferredEffort)
                : nil,
            fullAuto: message.hasFullAuto ? message.fullAuto : nil,
            dispatchedAt: message.hasDispatchedAt ? try coreDate(message.dispatchedAt) : nil,
            requestedProvider: message.hasRequestedProvider
                ? try coreProvider(message.requestedProvider)
                : nil,
            requestedModel: message.hasRequestedModel ? message.requestedModel : nil,
            requestedEffort: message.hasRequestedEffort
                ? ModelEffort(rawValue: message.requestedEffort)
                : nil,
            requestedWorkerId: message.hasRequestedWorkerID ? message.requestedWorkerID : nil,
            requestedByUserId: message.hasRequestedByUserID ? message.requestedByUserID : nil,
            dispatchMode: message.hasDispatchMode ? try coreDispatchMode(message.dispatchMode) : nil,
            claimedBy: message.hasClaimedBy ? message.claimedBy : nil,
            claimedAt: message.hasClaimedAt ? try coreDate(message.claimedAt) : nil,
            workerId: message.hasWorkerID ? message.workerID : nil,
            startedAt: try coreDate(message.startedAt),
            updatedAt: try coreDate(message.updatedAt),
            completedAt: message.hasCompletedAt ? try coreDate(message.completedAt) : nil,
            lastEventAt: ISO8601DateFormatter.mobileContract.string(
                from: try coreDate(message.lastEventAt)
            ),
            eventCount: try coreSafeInt(message.eventCount)
        )

        _ = try coreRunSource(message.source)
        if message.hasStagingQaStatus { _ = try coreQAStatus(message.stagingQaStatus) }
        if message.hasProductionQaStatus { _ = try coreQAStatus(message.productionQaStatus) }
        if message.hasLeaseExpiresAt { _ = try coreDate(message.leaseExpiresAt) }
        if message.hasExecutionMetrics {
            _ = try coreSafeInt(message.executionMetrics.durationMs)
        }
    }
}

extension WorkflowCheckpoint {
    init(connectMessage message: BriarTypes_WorkflowCheckpoint) throws {
        self.init(
            key: message.key,
            stage: message.stage,
            stageLabel: message.stageLabel,
            position: try coreCheckpointPosition(message.position),
            attempt: try coreSafeInt(message.attempt),
            revision: try coreSafeInt(message.revision),
            reachedAt: message.hasReachedAt ? try coreDate(message.reachedAt) : nil,
            nextStage: message.hasNextStage ? message.nextStage : nil,
            nextStageLabel: message.hasNextStageLabel ? message.nextStageLabel : nil,
            terminalReviewOnly: message.terminalReviewOnly
        )
    }
}

extension RelatedMessageReference {
    init(connectMessage message: BriarAPI_RelatedMessageReference) throws {
        self.init(
            organizationId: try coreUUID(message.organizationID),
            channelId: try coreUUID(message.channelID),
            messageId: try coreUUID(message.messageID),
            rootMessageId: try coreUUID(message.rootMessageID)
        )
    }
}

extension IssueDependencyReference {
    init(connectMessage message: BriarAPI_IssueDependencyReference) throws {
        self.init(
            id: try coreUUID(message.id),
            runNumber: try coreSafeInt(message.runNumber),
            title: message.title,
            status: try coreRunStatus(message.status)
        )
    }
}

extension StructuredRunResult {
    init(connectMessage message: BriarAPI_StructuredRunResult) throws {
        self.init(
            summary: message.summary,
            outcome: try coreStructuredOutcome(message.outcome),
            importance: try coreStructuredImportance(message.importance),
            urgency: try coreStructuredUrgency(message.urgency),
            impact: try coreStructuredImpact(message.impact),
            humanActionRequired: message.humanActionRequired,
            nextAction: message.hasNextAction ? message.nextAction : nil,
            dueAt: message.hasDueAt ? try coreDate(message.dueAt) : nil
        )
    }
}

extension DashboardWorker {
    init(connectMessage message: BriarAPI_DashboardWorker) throws {
        guard message.hasCapabilities,
              message.hasLastHeartbeatAt,
              message.hasCreatedAt
        else { throw MobileAPIError.invalidResponse }

        _ = try coreWorkerState(message.state)
        _ = try coreDate(message.lastHeartbeatAt)
        _ = try coreDate(message.createdAt)

        let icon: Icon?
        if message.hasIcon {
            let kind: Icon.Kind
            switch message.icon.kind {
            case .emoji: kind = .emoji
            case .image: kind = .image
            case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
            }
            icon = .init(type: kind, value: message.icon.value)
        } else {
            icon = nil
        }

        var providerCapabilities: [String: AgentProviderCapability] = [:]
        for capability in message.capabilities.providerCapabilities {
            let provider = try coreProvider(capability.provider)
            guard providerCapabilities[provider.rawValue] == nil else {
                throw MobileAPIError.invalidResponse
            }
            providerCapabilities[provider.rawValue] = try .init(connectMessage: capability)
        }

        self.init(
            id: message.id,
            label: message.label,
            icon: icon,
            agentProvider: message.agentProvider == .unspecified
                ? nil
                : try coreProvider(message.agentProvider),
            providers: try message.providers.map(coreProvider),
            capabilities: .init(providerCapabilities: providerCapabilities),
            readiness: try coreWorkerReadiness(message.readiness),
            acceptingWork: message.acceptingWork,
            readinessDetail: message.hasReadinessDetail ? message.readinessDetail : nil,
            activeSessions: try coreSafeInt(message.activeSessions),
            availableSessions: try coreSafeInt(message.availableSessions)
        )
    }
}

private extension AgentProviderCapability {
    init(connectMessage message: BriarTypes_AgentProviderCapability) throws {
        self.init(
            models: message.models.map { model in
                AgentModelCapability(
                    id: model.id,
                    label: model.label,
                    isDefault: model.hasIsDefault ? model.isDefault : nil,
                    defaultEffortId: model.hasDefaultEffortID ? model.defaultEffortID : nil,
                    efforts: model.efforts.map(coreEffortCapability)
                )
            },
            defaultEfforts: message.defaultEfforts.map(coreEffortCapability),
            allowCustomModels: message.hasAllowCustomModels
                ? message.allowCustomModels
                : false,
            error: message.hasError ? message.error : nil
        )
    }
}

extension ProjectExecutionWorkerPolicy {
    init(connectMessage message: BriarAPI_ProjectExecutionWorkerPolicy) throws {
        let selectionMode: SelectionMode
        switch message.selectionMode {
        case .any: selectionMode = .any
        case .allowlist: selectionMode = .allowlist
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.init(
            selectionMode: selectionMode,
            defaultWorkerId: message.hasDefaultWorkerID ? message.defaultWorkerID : nil,
            allowedWorkerIds: message.allowedWorkerIds,
            updatedAt: message.hasUpdatedAt ? try coreDate(message.updatedAt) : nil
        )
    }
}

extension ConversationNotification {
    init(connectMessage message: BriarAPI_ConversationNotification) throws {
        guard message.hasAuthor, message.hasCreatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try coreUUID(message.id),
            runId: try coreUUID(message.runID),
            runTitle: message.runTitle,
            rootMessageId: try coreUUID(message.rootMessageID),
            body: message.body,
            author: try .init(connectMessage: message.author),
            reason: try coreNotificationReason(message.reason),
            createdAt: try coreDate(message.createdAt)
        )
    }
}

extension ChannelNotification {
    init(connectMessage message: BriarAPI_ChannelNotification) throws {
        guard message.hasAuthor, message.hasCreatedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try coreUUID(message.id),
            channelId: try coreUUID(message.channelID),
            channelName: message.channelName,
            rootMessageId: try coreUUID(message.rootMessageID),
            body: message.body,
            author: try .init(connectMessage: message.author),
            reason: try coreNotificationReason(message.reason),
            createdAt: try coreDate(message.createdAt)
        )
    }
}

extension RunEvent {
    init(connectMessage message: BriarAPI_RunEvent) throws {
        guard message.hasOccurredAt, message.hasRecordedAt else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: try coreUUID(message.id),
            status: try coreRunStatus(message.status),
            workflowStage: message.hasWorkflowStage ? message.workflowStage : nil,
            detail: message.hasDetail ? message.detail : nil,
            actor: message.actor,
            actorName: message.hasActorName ? message.actorName : nil,
            occurredAt: try coreDate(message.occurredAt),
            attempt: try coreSafeInt(message.attempt),
            revision: try coreSafeInt(message.revision),
            qaStatus: message.hasQaStatus ? try coreQAStatus(message.qaStatus) : nil,
            trackerState: message.hasTrackerState ? message.trackerState : nil,
            pullRequestUrls: try message.pullRequestUrls.map(coreURL),
            targetSha: message.hasTargetSha ? message.targetSha : nil,
            recordedAt: try coreDate(message.recordedAt)
        )
    }
}

extension InboxFeedUpdate {
    init(connectMessage message: BriarAPI_GetInboxFeedResponse) throws {
        guard message.hasGeneratedAt, !message.version.isEmpty else {
            throw MobileAPIError.invalidResponse
        }
        self.init(
            messages: try message.messages.map(InboxMessage.init(connectMessage:)),
            subscribedIssueIDs: try message.subscribedIssueIds.map(coreUUID),
            generatedAt: try coreDate(message.generatedAt),
            version: message.version,
            unchanged: message.unchanged
        )
    }
}

extension InboxMessage {
    init(connectMessage message: BriarAPI_InboxFeedMessage) throws {
        guard message.hasIdentity, message.identity.hasOccurredAt else {
            throw MobileAPIError.invalidResponse
        }
        let identity = message.identity
        guard !identity.id.isEmpty,
              !identity.targetID.isEmpty,
              !identity.version.isEmpty
        else { throw MobileAPIError.invalidResponse }

        let projectID = try coreUUID(identity.projectID)
        let occurredAt = try coreDate(identity.occurredAt)

        switch message.content {
        case let .issue(issue):
            let status = try coreRunStatus(issue.status)
            self.init(
                id: identity.id,
                kind: .issue,
                projectId: projectID,
                projectName: identity.projectName,
                targetId: identity.targetID,
                title: identity.title,
                occurredAt: occurredAt,
                version: identity.version,
                body: issue.hasStructuredResult ? issue.structuredResult.summary : nil,
                authorName: nil,
                statusLabel: status.displayName,
                requiresAttention: status.needsAttention,
                priority: issue.hasPriority ? try coreSafeInt(issue.priority) : nil,
                structuredResult: issue.hasStructuredResult
                    ? try .init(connectMessage: issue.structuredResult)
                    : nil,
                rootMessageId: nil
            )
            _ = try coreSafeInt(issue.runNumber)

        case let .conversation(conversation):
            let reason = try coreNotificationReason(conversation.reason)
            self.init(
                id: identity.id,
                kind: .conversation,
                projectId: projectID,
                projectName: identity.projectName,
                targetId: identity.targetID,
                title: identity.title,
                occurredAt: occurredAt,
                version: identity.version,
                body: conversation.body,
                authorName: conversation.authorName,
                statusLabel: coreNotificationLabel(reason),
                requiresAttention: reason == "mention",
                priority: nil,
                structuredResult: nil,
                reason: reason,
                rootMessageId: try coreUUID(conversation.rootMessageID),
                conversationMessageId: try coreUUID(conversation.messageID),
                issueKey: conversation.hasIssueKey ? conversation.issueKey : nil,
                authorImage: conversation.hasAuthorImage ? conversation.authorImage : nil
            )

        case let .channel(channel):
            let reason = try coreNotificationReason(channel.reason)
            self.init(
                id: identity.id,
                kind: .channel,
                projectId: projectID,
                projectName: identity.projectName,
                targetId: identity.targetID,
                title: "#\(channel.channelName)",
                occurredAt: occurredAt,
                version: identity.version,
                body: channel.body,
                authorName: channel.authorName,
                statusLabel: coreNotificationLabel(reason),
                requiresAttention: reason == "mention",
                priority: nil,
                structuredResult: nil,
                reason: reason,
                rootMessageId: try coreUUID(channel.rootMessageID),
                channelMessageId: try coreUUID(channel.messageID),
                channelName: channel.channelName,
                authorImage: channel.hasAuthorImage ? channel.authorImage : nil
            )
            _ = try coreUUID(channel.channelID)

        case let .session(session):
            let status: DashboardRun.Status
            switch session.status {
            case .completed: status = .completed
            case .failed: status = .failed
            case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
            }
            self.init(
                id: identity.id,
                kind: .session,
                projectId: projectID,
                projectName: identity.projectName,
                targetId: identity.targetID,
                title: identity.title,
                occurredAt: occurredAt,
                version: identity.version,
                body: session.hasSummary
                    ? session.summary
                    : session.hasError ? session.error : nil,
                authorName: session.hasAgentName ? session.agentName : nil,
                statusLabel: status.displayName,
                requiresAttention: session.requiresAttention,
                priority: nil,
                structuredResult: nil,
                rootMessageId: nil
            )
            _ = try coreSafeInt(session.issueCount)

        case nil:
            throw MobileAPIError.invalidResponse
        }
    }
}

private func coreSafeInt<T: BinaryInteger>(_ value: T) throws -> Int {
    guard let exact = Int(exactly: value),
          exact.magnitude <= 9_007_199_254_740_991
    else { throw MobileAPIError.invalidResponse }
    return exact
}

private func coreUUID(_ value: String) throws -> UUID {
    guard let uuid = UUID(uuidString: value) else {
        throw MobileAPIError.invalidResponse
    }
    return uuid
}

private func coreURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.scheme != nil else {
        throw MobileAPIError.invalidResponse
    }
    return url
}

private func coreDate(_ value: Google_Protobuf_Timestamp) throws -> Date {
    guard (-62_135_596_800...253_402_300_799).contains(value.seconds),
          (0...999_999_999).contains(value.nanos)
    else { throw MobileAPIError.invalidResponse }
    return Date(
        timeIntervalSince1970: Double(value.seconds) + Double(value.nanos) / 1_000_000_000
    )
}

private func coreProvider(_ value: BriarTypes_AgentProvider) throws -> AgentProvider {
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

private func coreWorkflow(_ value: BriarTypes_AutoHuntWorkflow) throws -> AutoHuntWorkflow {
    guard value.version == 2, value.hasExecution, value.hasCompletion else {
        throw MobileAPIError.invalidResponse
    }
    return AutoHuntWorkflow(
        version: 2,
        stages: value.stages.map {
            .init(id: $0.id, label: $0.label, required: $0.required)
        }
    )
}

private func coreCheckpointPosition(
    _ value: BriarTypes_WorkflowCheckpoint.Position
) throws -> WorkflowCheckpoint.Position {
    switch value {
    case .before: .before
    case .after: .after
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreRunStatus(_ value: BriarAPI_RunStatus) throws -> DashboardRun.Status {
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

private func coreDifficulty(_ value: BriarAPI_IssueDifficulty) throws -> IssueDifficulty {
    switch value {
    case .easy: .easy
    case .normal: .normal
    case .hard: .hard
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreExecutionReadiness(
    _ value: BriarAPI_DashboardRun.ExecutionReadiness
) throws -> String {
    switch value {
    case .ready: "ready"
    case .waiting: "waiting"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreDispatchMode(_ value: BriarAPI_DashboardRun.DispatchMode) throws -> String {
    switch value {
    case .any: "any"
    case .specific: "specific"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreRunSource(_ value: BriarAPI_DashboardRun.Source) throws -> String {
    switch value {
    case .issue: "issue"
    case .error: "error"
    case .feedback: "feedback"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreQAStatus(_ value: BriarAPI_DashboardRun.QaStatus) throws -> String {
    switch value {
    case .pending: "pending"
    case .passed: "passed"
    case .skipped: "skipped"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreWorkerState(_ value: BriarAPI_DashboardWorker.State) throws -> String {
    switch value {
    case .online: "online"
    case .stale: "stale"
    case .disabled: "disabled"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreWorkerReadiness(_ value: BriarAPI_DashboardWorker.Readiness) throws -> String {
    switch value {
    case .available: "available"
    case .busy: "busy"
    case .offline: "offline"
    case .needsAttention: "needs_attention"
    case .disabled: "disabled"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreEffortCapability(
    _ message: BriarTypes_AgentEffortCapability
) -> AgentEffortCapability {
    .init(
        id: message.id,
        label: message.label,
        description: message.hasDescription_p ? message.description_p : nil,
        isDefault: message.hasIsDefault ? message.isDefault : nil
    )
}

private func coreNotificationReason(_ value: BriarAPI_NotificationReason) throws -> String {
    switch value {
    case .mention: "mention"
    case .threadReply: "thread_reply"
    case .subscription: "subscription"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreNotificationLabel(_ reason: String) -> String {
    switch reason {
    case "mention": L10n.text("멘션")
    case "subscription": L10n.text("구독 대화")
    default: L10n.text("답글")
    }
}

private func coreStructuredOutcome(
    _ value: BriarAPI_StructuredRunResult.Outcome
) throws -> String {
    switch value {
    case .completed: "completed"
    case .partial: "partial"
    case .blocked: "blocked"
    case .failed: "failed"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreStructuredImportance(
    _ value: BriarAPI_StructuredRunResult.Importance
) throws -> String {
    switch value {
    case .routine: "routine"
    case .important: "important"
    case .critical: "critical"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreStructuredUrgency(
    _ value: BriarAPI_StructuredRunResult.Urgency
) throws -> String {
    switch value {
    case .normal: "normal"
    case .timeSensitive: "time_sensitive"
    case .immediate: "immediate"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}

private func coreStructuredImpact(
    _ value: BriarAPI_StructuredRunResult.Impact
) throws -> String {
    switch value {
    case .issue: "issue"
    case .project: "project"
    case .organization: "organization"
    case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
    }
}
