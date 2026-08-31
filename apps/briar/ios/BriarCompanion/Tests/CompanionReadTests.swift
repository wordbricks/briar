import BriarContracts
import BriarContractsMocks
import Connect
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

@MainActor
final class CompanionReadTests: XCTestCase {
    private let older = Date(timeIntervalSince1970: 1_700_000_000)
    private let middle = Date(timeIntervalSince1970: 1_700_000_100)
    private let newer = Date(timeIntervalSince1970: 1_700_000_200)

    private var runs: [DashboardRun] {
        [
            DashboardRun(
                id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
                title: "Active native shell",
                status: .running,
                detail: "Implement tabs",
                issueDescription: "Searchable Markdown description",
                updatedAt: middle
            ),
            DashboardRun(
                id: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
                runNumber: 2,
                title: "Offline recovery",
                status: .blocked,
                detail: "Needs network attention",
                updatedAt: older
            ),
            DashboardRun(
                id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                title: "Finished contract",
                status: .completed,
                resultSummary: "Android and iOS fixture passed",
                updatedAt: newer
            ),
        ]
    }

    func testTasksListOrdersByMostRecentlyUpdated() {
        // Input order is middle, older, newer (status-mixed); display must be newest first.
        let ordered = TaskOrdering.byMostRecentlyUpdated(runs.filter(TaskFilter.all.includes))
        XCTAssertEqual(ordered.map(\.title), [
            "Finished contract",
            "Active native shell",
            "Offline recovery",
        ])
        XCTAssertEqual(ordered.map(\.updatedAt), ordered.map(\.updatedAt).sorted(by: >))

        // Completed-only filter still respects update recency among matches.
        let completed = TaskOrdering.byMostRecentlyUpdated(runs.filter(TaskFilter.completed.includes))
        XCTAssertEqual(completed.map(\.title), ["Finished contract"])
    }

    func testProjectLobbySummaryCountsStatusBucketsAndLimitsRecentRuns() {
        let extraRuns = (0..<4).map { index in
            DashboardRun(
                id: UUID(),
                title: "Backlog \(index)",
                status: .backlog,
                updatedAt: newer.addingTimeInterval(TimeInterval(index + 1))
            )
        }
        let summary = ProjectLobbySummary(runs: runs + extraRuns)

        XCTAssertEqual(summary.total, 7)
        XCTAssertEqual(summary.active, 1)
        XCTAssertEqual(summary.attention, 1)
        XCTAssertEqual(summary.completed, 1)
        XCTAssertEqual(summary.recent.count, 5)
        XCTAssertEqual(summary.recent.first?.title, "Backlog 3")
    }

    func testSearchCoversTitleDescriptionDetailAndResult() {
        XCTAssertEqual(TaskSearch.results(in: runs, query: "native").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Markdown").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "network").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Android").count, 1)
        XCTAssertEqual(
            TaskSearch.results(in: runs, query: "BR-2", issueKeyPrefix: "BR").count,
            1
        )
        XCTAssertEqual(TaskSearch.results(in: runs, query: "missing").count, 0)
    }

    func testSearchResultsOrderByMostRecentlyUpdated() {
        // All three fixtures contain "a"/"e" in title, detail, or result.
        let multi = TaskSearch.results(in: runs, query: "a")
        XCTAssertEqual(multi.count, 3)
        XCTAssertEqual(multi.map(\.title), [
            "Finished contract",
            "Active native shell",
            "Offline recovery",
        ])
        XCTAssertEqual(multi.map(\.updatedAt), multi.map(\.updatedAt).sorted(by: >))
    }

    @MainActor
    func testRunRowResolvesAssignedAndRequestedWorker() {
        let assignedWorker = DashboardWorker(
            id: "worker-assigned",
            label: "Assigned Mac",
            icon: .init(type: .emoji, value: "🍋"),
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let requestedWorker = DashboardWorker(
            id: "worker-requested",
            label: "Requested Mac",
            icon: .init(type: .emoji, value: "🍏"),
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let workers = [assignedWorker, requestedWorker]
        let assignedRun = DashboardRun(
            id: UUID(),
            title: "Assigned task",
            status: .completed,
            workflowStage: "merged",
            requestedWorkerId: requestedWorker.id,
            workerId: assignedWorker.id,
            updatedAt: newer
        )
        let requestedRun = DashboardRun(
            id: UUID(),
            title: "Requested task",
            status: .queued,
            requestedWorkerId: requestedWorker.id,
            updatedAt: newer
        )
        let unknownRun = DashboardRun(
            id: UUID(),
            title: "Unknown worker task",
            status: .completed,
            workerId: "worker-unknown",
            updatedAt: newer
        )

        XCTAssertEqual(RunRow.worker(for: assignedRun, workers: workers), assignedWorker)
        XCTAssertEqual(RunRow.worker(for: requestedRun, workers: workers), requestedWorker)
        XCTAssertNil(RunRow.worker(for: unknownRun, workers: workers))
    }

    func testSessionDetailPrefersAssignedWorkerNameOverUUID() {
        let assignedWorker = DashboardWorker(
            id: "94ba9871-ec10-4752-9e7b-de876b587214",
            label: "Studio Mac",
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let requestedWorker = DashboardWorker(
            id: "worker-requested",
            label: "Laptop Mac",
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let workers = [assignedWorker, requestedWorker]
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!

        XCTAssertEqual(
            SessionDetailView.workerLabel(
                for: session(
                    projectID: projectID,
                    requestedWorkerId: requestedWorker.id,
                    workerId: assignedWorker.id
                ),
                workers: workers
            ),
            "Studio Mac"
        )
        XCTAssertEqual(
            SessionDetailView.workerLabel(
                for: session(
                    projectID: projectID,
                    requestedWorkerId: requestedWorker.id
                ),
                workers: workers
            ),
            "Laptop Mac"
        )
        XCTAssertEqual(
            SessionDetailView.workerLabel(
                for: session(
                    projectID: projectID,
                    workerId: "missing-worker"
                ),
                workers: workers
            ),
            "missing-worker"
        )
        XCTAssertNil(
            SessionDetailView.workerLabel(
                for: session(projectID: projectID),
                workers: workers
            )
        )
    }

    func testAgentSkillWorkerEligibilityUsesAvailabilityAndHealthyProviders() {
        let pausedWorker = DashboardWorker(
            id: "worker-paused",
            label: "Paused Mac",
            agentProvider: .codex,
            providers: [.codex],
            readiness: "available",
            acceptingWork: false,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertFalse(workerCanRunAgentSkill(pausedWorker, provider: .codex))

        let providerOverride = DashboardWorker(
            id: "worker-provider-override",
            label: "Claude Mac",
            agentProvider: .codex,
            providers: [.claude],
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertFalse(workerCanRunAgentSkill(providerOverride, provider: .codex))
        XCTAssertTrue(workerCanRunAgentSkill(providerOverride, provider: .claude))

        let legacyProvider = DashboardWorker(
            id: "worker-legacy-provider",
            label: "Legacy Mac",
            agentProvider: .codex,
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertTrue(workerCanRunAgentSkill(legacyProvider, provider: .codex))
    }

    func testHostReadinessLabelsCoverEveryDashboardState() {
        XCTAssertEqual(hostReadinessLabel("available", locale: .ko), "사용 가능")
        XCTAssertEqual(hostReadinessLabel("busy", locale: .en), "Running")
        XCTAssertEqual(hostReadinessLabel("offline", locale: .en), "Offline")
        XCTAssertEqual(hostReadinessLabel("needs_attention", locale: .zh), "需要处理")
        XCTAssertEqual(hostReadinessLabel("disabled", locale: .en), "Sharing disabled")
        XCTAssertEqual(hostReadinessLabel("future_state", locale: .ko), "future_state")
    }

    @MainActor
    func testRunDetailShowsLatestIssueAgentActivityUnderItsParentMessage() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let parentMessageID = UUID(uuidString: "99999999-9999-4999-8999-999999999999")!
        let replyID = UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: projectID,
            runID: runID,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.updateAgentReply(IssueAgentReplyJob(
            id: replyID,
            triggerMessageId: parentMessageID,
            parentMessageId: parentMessageID,
            status: .running,
            attempts: 1,
            error: nil
        ))
        store.applyActivityFrame(IssueAgentActivityFrame(
            replyJobId: replyID,
            attempt: 1,
            sequence: 1,
            projectId: projectID,
            runId: runID,
            triggerMessageId: parentMessageID,
            parentMessageId: parentMessageID,
            activity: ChannelAgentActivity(
                id: "commentary-1",
                kind: .message,
                headline: "원인을 확인하고 있습니다."
            ),
            sentAt: Date(),
            expiresAt: Date().addingTimeInterval(30)
        ))

        let status = try XCTUnwrap(store.typingStatuses(parentMessageID: parentMessageID).first)
        XCTAssertEqual(status.activity?.headline, "원인을 확인하고 있습니다.")
        XCTAssertEqual(status.activity?.displayHeadline, "원인을 확인하고 있습니다.")
    }

    func testChannelActivityDisplayHeadlineExtractsReplyBody() {
        let streamed = ChannelAgentActivity(
            id: "commentary-json",
            kind: .message,
            headline:
                "{\"body\":\"Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.\",\"attachments\":[],\"document\":null,\"issueProposal\""
        )
        XCTAssertEqual(
            streamed.displayHeadline,
            "Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다."
        )

        let command = ChannelAgentActivity(
            id: "command-1",
            kind: .command,
            headline: "{\"body\":\"should not extract\"}"
        )
        XCTAssertEqual(command.displayHeadline, "{\"body\":\"should not extract\"}")

        XCTAssertEqual(
            ChannelAgentActivity.naturalLanguage(
                from: "{\"body\":null,\"attachments\":[],\"document\":null}"
            ),
            "{\"body\":null,\"attachments\":[],\"document\":null}"
        )
    }

    @MainActor
    func testRunDetailResetReplacesTheEntireConversationSnapshot() async throws {
        let initial = issueMessage(body: "stale")
        let replacement = issueMessage(
            id: UUID(uuidString: "dddddddd-dddd-4ddd-8ddd-dddddddddddd")!,
            body: "authoritative"
        )
        let optimistic = issueMessage(
            id: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
            body: "optimistic"
        )
        let reply = IssueAgentReplyJob(
            id: UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")!,
            triggerMessageId: replacement.id,
            parentMessageId: replacement.id,
            status: .completed,
            attempts: 1,
            error: nil
        )
        let services = RunDetailTestServices(
            messageSnapshots: [IssueMessagesResponse(messages: [initial], cursor: 41)],
            messageDeltas: [IssueMessagesDeltaResponse(
                cursor: 2,
                hasMore: false,
                changed: true,
                reset: true,
                messages: [replacement],
                agentReplies: [reply]
            )]
        )
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            runID: initial.runId,
            token: "token",
            dashboardService: services.dashboard,
            issueService: services.issue
        )
        await store.load()
        XCTAssertNil(store.errorMessage, store.errorMessage ?? "unexpected load error")
        XCTAssertEqual(store.messages.map(\.id), [initial.id])
        store.appendOptimisticMessage(optimistic)
        await store.syncConversationChanges()
        XCTAssertNil(store.errorMessage, store.errorMessage ?? "unexpected sync error")

        XCTAssertEqual(store.messages.map(\.id), [replacement.id])
        XCTAssertFalse(store.isMessageOptimistic(optimistic.id))
        XCTAssertEqual(store.agentReplies, [reply])
        let snapshotRequests = services.scenario.messageRequestCount
        XCTAssertEqual(snapshotRequests, 1)
    }

    @MainActor
    func testCreateAcceptanceResponseImmediatelyAddsSeparateExecutionProposal() throws {
        let proposalID = UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!
        let pendingCreate = IssueProposedAction(
            id: proposalID,
            type: .create,
            issue: .init(
                title: "Follow-up",
                description: nil,
                priority: 2,
                status: "backlog"
            ),
            status: .pending,
            executeAfterCreate: true
        )
        let acceptedCreate = IssueProposedAction(
            id: proposalID,
            type: .create,
            issue: pendingCreate.issue,
            status: .accepted,
            acceptedAt: newer,
            resultRunId: executionProposal().runId,
            executeAfterCreate: true
        )
        let execution = executionProposal()
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: execution.projectId,
            runID: execution.runId,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([issueMessage(
            proposedAction: pendingCreate,
            executionProposal: nil
        )])

        store.updateIssueProposal(
            acceptedCreate,
            executionProposal: execution
        )

        XCTAssertEqual(store.messages.first?.proposedAction?.status, .accepted)
        XCTAssertEqual(store.messages.first?.executionProposal?.id, execution.id)
        XCTAssertNotNil(store.captureExecutionProposal(proposalID: execution.id))
    }

    @MainActor
    func testRunDetailSkillProposalReplacementInvalidatesTheOriginalContext() throws {
        let pending = skillExecutionProposal()
        let replacement = skillExecutionProposal(
            id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        )
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([issueMessage(skillExecutionProposal: pending)])
        let context = try XCTUnwrap(
            store.captureSkillExecutionProposal(proposalID: pending.id)
        )

        store.appendMessages([issueMessage(skillExecutionProposal: replacement)])

        XCTAssertFalse(store.skillExecutionProposalIsCurrent(context))
        XCTAssertNil(store.captureSkillExecutionProposal(proposalID: pending.id))
        XCTAssertNotNil(store.captureSkillExecutionProposal(proposalID: replacement.id))
    }

    @MainActor
    func testLeavingRunDetailInvalidatesAnInFlightSkillPreparationContext() throws {
        let pending = skillExecutionProposal()
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([issueMessage(skillExecutionProposal: pending)])
        let context = try XCTUnwrap(
            store.captureSkillExecutionProposal(proposalID: pending.id)
        )

        store.close()

        XCTAssertFalse(store.skillExecutionProposalIsCurrent(context))
    }

    @MainActor
    func testAcceptedSkillProposalIsImmediatelyMaterializedInIssueHistory() throws {
        let pending = skillExecutionProposal()
        let accepted = skillExecutionProposal(status: .accepted)
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([issueMessage(skillExecutionProposal: pending)])
        let context = try XCTUnwrap(
            store.captureSkillExecutionProposal(proposalID: pending.id)
        )

        store.updateSkillExecutionProposal(accepted)

        XCTAssertFalse(store.skillExecutionProposalIsCurrent(context))
        XCTAssertEqual(store.messages.first?.skillExecutionProposal, accepted)
        XCTAssertEqual(
            store.messages.first?.skillExecutionProposal?.resultSessionId,
            "session-1"
        )
    }

    @MainActor
    func testDelayedPendingIssueMessageCannotRegressAcceptedSkillHistory() {
        let pending = skillExecutionProposal()
        let accepted = skillExecutionProposal(status: .accepted)
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([issueMessage(skillExecutionProposal: pending)])
        store.updateSkillExecutionProposal(accepted)

        store.appendMessages([issueMessage(skillExecutionProposal: pending)])

        XCTAssertEqual(store.messages.first?.skillExecutionProposal, accepted)

        store.appendMessages([issueMessage(skillExecutionProposal: nil)])
        XCTAssertNil(store.messages.first?.skillExecutionProposal)
    }

    @MainActor
    func testRunDetailRollsBackOnlyPendingOptimisticMessage() {
        let parent = issueMessage(body: "Parent")
        let pending = issueMessage(
            id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            parentMessageId: parent.id,
            body: "실패할 답글"
        )
        let store = RunDetailStore(
            api: RunDetailHTTPStub(),
            projectID: executionProposal().projectId,
            runID: parent.runId,
            token: "token",
            dashboardService: BriarAPI_DashboardServiceClientMock(),
            issueService: BriarAPI_IssueServiceClientMock()
        )
        store.appendMessages([parent])
        store.appendOptimisticMessage(pending)

        store.removeOptimisticMessage(pending.id)
        store.removeOptimisticMessage(pending.id)

        XCTAssertFalse(store.messages.contains { $0.id == pending.id })
        XCTAssertEqual(store.messages.first(where: { $0.id == parent.id })?.replyCount, 0)
    }

    private func executionProposal(
        status: IssueExecutionProposal.Status = .pending
    ) -> IssueExecutionProposal {
        IssueExecutionProposal(
            id: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            status: status,
            projectId: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            runId: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            title: "Fresh backlog",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            acceptedAt: status == .accepted ? Date(timeIntervalSince1970: 1_700_000_100) : nil,
            requestedProvider: status == .accepted ? .codex : nil,
            requestedModel: status == .accepted ? "gpt-5.6-sol" : nil,
            requestedEffort: status == .accepted ? .high : nil,
            requestedWorkerId: status == .accepted ? "worker-1" : nil
        )
    }

    private func skillExecutionProposal(
        id: UUID = UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
        status: AgentSkillExecutionProposal.Status = .pending
    ) -> AgentSkillExecutionProposal {
        AgentSkillExecutionProposal(
            id: id,
            status: status,
            projectId: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: "Project Agent",
            skillId: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            skillName: "iOS 배포",
            request: "TestFlight에 최신 빌드를 배포해 줘",
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .high,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            acceptedAt: status == .accepted
                ? Date(timeIntervalSince1970: 1_700_000_100)
                : nil,
            requestedWorkerId: status == .accepted ? "worker-1" : nil,
            requestedWorkerLabel: status == .accepted ? "Build Mac" : nil,
            resultSessionId: status == .accepted ? "session-1" : nil,
            delegatedByAgentId: nil,
            delegatedByAgentName: nil
        )
    }

    private func issueMessage(
        id: UUID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
        parentMessageId: UUID? = nil,
        body: String = "Execution proposal",
        proposedAction: IssueProposedAction? = nil,
        executionProposal: IssueExecutionProposal? = nil,
        skillExecutionProposal: AgentSkillExecutionProposal? = nil
    ) -> IssueMessage {
        IssueMessage(
            id: id,
            runId: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            parentMessageId: parentMessageId,
            body: body,
            attachments: [],
            author: .init(id: nil, name: "Bumble", image: nil, provider: "codex"),
            replyCount: 0,
            proposedAction: proposedAction,
            executionProposal: executionProposal,
            skillExecutionProposal: skillExecutionProposal,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func session(
        projectID: UUID,
        requestedWorkerId: String? = nil,
        workerId: String? = nil
    ) -> ProjectAgentSession {
        ProjectAgentSession(
            id: "session-1",
            projectId: projectID,
            dispatchGroupId: "session-1",
            agentId: nil,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "릴리즈",
            status: .running,
            issues: [],
            startedAt: newer,
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            requestedWorkerId: requestedWorkerId,
            workerId: workerId,
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: newer
        )
    }
}

private struct RunDetailHTTPStub: AuthenticatedDownloadClientProtocol {
    func download(_: String, token _: String, to _: URL) async throws -> URL {
        throw MobileAPIError.invalidDownload
    }
}

private final class RunDetailTestServices: @unchecked Sendable {
    let scenario: RunDetailConnectScenario
    let dashboard: BriarAPI_DashboardServiceClientMock
    let issue: BriarAPI_IssueServiceClientMock

    init(
        messageSnapshots: [IssueMessagesResponse],
        messageDeltas: [IssueMessagesDeltaResponse]
    ) {
        let scenario = RunDetailConnectScenario(
            messageSnapshots: messageSnapshots,
            messageDeltas: messageDeltas
        )
        self.scenario = scenario
        dashboard = BriarAPI_DashboardServiceClientMock()
        issue = BriarAPI_IssueServiceClientMock()
        issue.mockAsyncListIssueMessages = { request in
            .init(result: scenario.listIssueMessages(request))
        }
        issue.mockAsyncSyncIssueMessages = { request in
            .init(result: scenario.syncIssueMessages(request))
        }
        issue.mockAsyncListRunEvidence = { request in
            var response = BriarAPI_ListRunEvidenceResponse()
            response.runID = request.runID
            return .init(result: .success(response))
        }
    }
}

private final class RunDetailConnectScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var messageSnapshots: [IssueMessagesResponse]
    private var messageDeltas: [IssueMessagesDeltaResponse]
    private var messageRequests = 0

    init(
        messageSnapshots: [IssueMessagesResponse],
        messageDeltas: [IssueMessagesDeltaResponse]
    ) {
        self.messageSnapshots = messageSnapshots
        self.messageDeltas = messageDeltas
    }

    var messageRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return messageRequests
    }

    func listIssueMessages(
        _ request: BriarAPI_ListIssueMessagesRequest
    ) -> Result<BriarAPI_ListIssueMessagesResponse, ConnectError> {
        lock.lock()
        defer { lock.unlock() }
        guard !messageSnapshots.isEmpty else {
            return .failure(.init(code: .internalError, message: "missing snapshot"))
        }
        messageRequests += 1
        let response = messageSnapshots.removeFirst()
        return .success(wireSnapshot(response))
    }

    func syncIssueMessages(
        _ request: BriarAPI_SyncIssueMessagesRequest
    ) -> Result<BriarAPI_SyncIssueMessagesResponse, ConnectError> {
        lock.lock()
        defer { lock.unlock() }
        guard !messageDeltas.isEmpty else {
            return .failure(.init(code: .internalError, message: "missing delta"))
        }
        let response = messageDeltas.removeFirst()
        var message = BriarAPI_SyncIssueMessagesResponse()
        message.cursor = UInt64(response.cursor)
        message.hasMore_p = response.hasMore
        message.changed = response.changed
        message.reset = response.reset
        message.messages = (response.messages ?? []).map(wireMessage)
        message.agentReplies = (response.agentReplies ?? []).map(wireReply)
        return .success(message)
    }

    func wireMessage(_ value: IssueMessage) -> BriarAPI_IssueMessage {
        var author = BriarAPI_MessageAuthor()
        author.name = value.author.name
        var message = BriarAPI_IssueMessage()
        message.id = value.id.uuidString.lowercased()
        message.runID = value.runId.uuidString.lowercased()
        if let parentMessageID = value.parentMessageId {
            message.parentMessageID = parentMessageID.uuidString.lowercased()
        }
        message.body = value.body
        message.author = author
        message.replyCount = UInt32(value.replyCount)
        message.createdAt = .init(date: value.createdAt)
        message.updatedAt = .init(date: value.updatedAt)
        return message
    }

    func wireSnapshot(
        _ response: IssueMessagesResponse
    ) -> BriarAPI_ListIssueMessagesResponse {
        var message = BriarAPI_ListIssueMessagesResponse()
        message.messages = response.messages.map(wireMessage)
        message.agentReplies = response.agentReplies.map(wireReply)
        message.cursor = UInt64(response.cursor ?? 0)
        return message
    }

    private func wireReply(_ value: IssueAgentReplyJob) -> BriarAPI_IssueAgentReply {
        var message = BriarAPI_IssueAgentReply()
        message.id = value.id.uuidString.lowercased()
        message.triggerMessageID = value.triggerMessageId.uuidString.lowercased()
        message.parentMessageID = value.parentMessageId.uuidString.lowercased()
        if let agentID = value.agentId { message.agentID = agentID.uuidString.lowercased() }
        if let agentName = value.agentName { message.agentName = agentName }
        switch value.status {
        case .queued: message.status = .queued
        case .running: message.status = .running
        case .completed: message.status = .completed
        case .failed: message.status = .failed
        }
        message.attempts = UInt32(value.attempts)
        if let error = value.error { message.error = error }
        message.updatedAt = .init(date: Date(timeIntervalSince1970: 1_700_000_000))
        return message
    }
}
