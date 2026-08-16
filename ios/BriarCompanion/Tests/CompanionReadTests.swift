import XCTest
@testable import BriarCompanion

final class CompanionReadTests: XCTestCase {
    private let older = Date(timeIntervalSince1970: 1_700_000_000)
    private let middle = Date(timeIntervalSince1970: 1_700_000_100)
    private let newer = Date(timeIntervalSince1970: 1_700_000_200)

    func testCompanionLocalesMatchTheSharedMobileLocaleContract() {
        XCTAssertEqual(CompanionLocale.allCases.map(\.rawValue), ["ko", "en", "zh"])
        XCTAssertEqual(
            CompanionLocale.allCases.map(\.foundationIdentifier),
            ["ko-KR", "en-US", "zh-CN"]
        )
    }

    func testEnglishTranslationsCoverNativeStatusAndFormattedMessages() {
        XCTAssertEqual(L10n.text("실행 중", locale: .en), "Running")
        XCTAssertEqual(DashboardRun.Status.blocked.displayName(locale: .en), "Blocked")
        XCTAssertEqual(ProjectAgentSession.Status.skipped.displayName(locale: .en), "Skipped")
        XCTAssertEqual(L10n.format("%d 실행 중", locale: .en, 3), "3 running")
        XCTAssertEqual(
            L10n.format(
                "제목이 너무 깁니다. %d자 이내로 줄여 주세요. (현재 %d자)",
                locale: .en,
                80,
                92
            ),
            "The title is too long. Shorten it to 80 characters or fewer (currently 92)."
        )
        XCTAssertEqual(L10n.text("계정 메뉴", locale: .en), "Account menu")
        XCTAssertEqual(L10n.text("보내는 중", locale: .en), "Sending")
        XCTAssertEqual(L10n.text("보내는 중", locale: .zh), "发送中")
    }

    func testIssueCreateApprovalExplainsBacklogBoundaryInEveryLocale() {
        XCTAssertTrue(
            L10n.text(.channelIssueCreationSafety, locale: .ko).contains("별도 승인")
        )
        XCTAssertTrue(
            L10n.text(.channelIssueCreationSafety, locale: .en)
                .contains("Separate approval")
        )
        XCTAssertTrue(
            L10n.text(.channelIssueCreationSafety, locale: .zh).contains("另行批准")
        )
        XCTAssertEqual(
            issueProposalAcceptanceSystemImage(for: .create),
            "plus.circle.fill"
        )
        XCTAssertEqual(
            issueProposalAcceptanceSystemImage(for: .update),
            "play.fill"
        )
    }

    func testDelegationNoticeNamesTheOrganizationAgentAndHidesDirectProposals() {
        XCTAssertEqual(
            issueExecutionDelegationNotice(agentName: "Bumble", locale: .ko),
            "Organization Agent Bumble의 위임"
        )
        XCTAssertEqual(
            issueExecutionDelegationNotice(agentName: "Bumble", locale: .en),
            "Delegated by Organization Agent Bumble"
        )
        XCTAssertNil(issueExecutionDelegationNotice(agentName: nil, locale: .ko))
        XCTAssertNil(issueExecutionDelegationNotice(agentName: "   ", locale: .ko))
    }

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

    func testAllActiveAttentionAndCompletedFilters() {
        XCTAssertEqual(runs.filter(TaskFilter.all.includes).count, 3)
        XCTAssertEqual(runs.filter(TaskFilter.active.includes).map(\.status), [.running, .blocked])
        XCTAssertEqual(runs.filter(TaskFilter.attention.includes).map(\.status), [.blocked])
        XCTAssertEqual(runs.filter(TaskFilter.completed.includes).map(\.status), [.completed])
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

    func testCompletedAndPausedPreferResultDetailTab() {
        // Parity with shared React RunPage activeDetailTab default.
        XCTAssertTrue(DashboardRun.Status.completed.prefersResultDetailTab)
        XCTAssertTrue(DashboardRun.Status.paused.prefersResultDetailTab)
        for status in DashboardRun.Status.allCases where status != .completed && status != .paused {
            XCTAssertFalse(
                status.prefersResultDetailTab,
                "\(status.rawValue) should open on the Issue tab"
            )
        }
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

    @MainActor
    func testRunDetailAuthoritativeNullInvalidatesPendingExecutionContext() async throws {
        let proposal = executionProposal()
        let api = RunDetailSnapshotAPI(messageSnapshots: [
            IssueMessagesResponse(messages: [issueMessage(executionProposal: proposal)]),
            IssueMessagesResponse(messages: [issueMessage(executionProposal: nil)]),
        ])
        let store = RunDetailStore(
            api: api,
            projectID: proposal.projectId,
            runID: proposal.runId,
            token: "token"
        )
        await store.load()
        let context = try XCTUnwrap(store.captureExecutionProposal(proposalID: proposal.id))

        await store.load()

        XCTAssertFalse(store.executionProposalIsCurrent(context))
        XCTAssertNil(store.captureExecutionProposal(proposalID: proposal.id))
        XCTAssertNil(store.messages.first?.executionProposal)
    }

    @MainActor
    func testRunDetailAuthoritativeRemovalInvalidatesPendingExecutionContext() async throws {
        let proposal = executionProposal()
        let api = RunDetailSnapshotAPI(messageSnapshots: [
            IssueMessagesResponse(messages: [issueMessage(executionProposal: proposal)]),
            IssueMessagesResponse(messages: []),
        ])
        let store = RunDetailStore(
            api: api,
            projectID: proposal.projectId,
            runID: proposal.runId,
            token: "token"
        )
        await store.load()
        let context = try XCTUnwrap(store.captureExecutionProposal(proposalID: proposal.id))

        await store.load()

        XCTAssertFalse(store.executionProposalIsCurrent(context))
        XCTAssertNil(store.captureExecutionProposal(proposalID: proposal.id))
        XCTAssertTrue(store.messages.isEmpty)
    }

    @MainActor
    func testRunDetailOtherClientApprovalTombstonesPendingExecutionContext() async throws {
        let pending = executionProposal()
        let accepted = executionProposal(status: .accepted)
        let api = RunDetailSnapshotAPI(messageSnapshots: [
            IssueMessagesResponse(messages: [issueMessage(executionProposal: pending)]),
            IssueMessagesResponse(messages: [issueMessage(executionProposal: accepted)]),
        ])
        let store = RunDetailStore(
            api: api,
            projectID: pending.projectId,
            runID: pending.runId,
            token: "token"
        )
        await store.load()
        let context = try XCTUnwrap(store.captureExecutionProposal(proposalID: pending.id))

        await store.load()

        XCTAssertFalse(store.executionProposalIsCurrent(context))
        XCTAssertNil(store.captureExecutionProposal(proposalID: pending.id))
        XCTAssertEqual(store.messages.first?.executionProposal?.status, .accepted)
    }

    @MainActor
    func testRunDetailQueuesForcedReloadBehindAnOlderInFlightSnapshot() async throws {
        let proposal = executionProposal()
        let api = RunDetailSnapshotAPI(
            messageSnapshots: [
                IssueMessagesResponse(messages: [issueMessage(
                    executionProposal: proposal
                )]),
                IssueMessagesResponse(messages: [issueMessage(
                    executionProposal: nil
                )]),
            ],
            messageDelay: .milliseconds(80)
        )
        let store = RunDetailStore(
            api: api,
            projectID: proposal.projectId,
            runID: proposal.runId,
            token: "token"
        )

        let initialLoad = Task { await store.load() }
        while await api.messageRequestCount() == 0 {
            await Task.yield()
        }
        await store.load(queueIfLoading: true)
        await initialLoad.value

        let requestCount = await api.messageRequestCount()
        XCTAssertEqual(requestCount, 2)
        XCTAssertNil(store.messages.first?.executionProposal)
        XCTAssertNil(store.captureExecutionProposal(proposalID: proposal.id))
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
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: execution.projectId,
            runID: execution.runId,
            token: "token"
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
    func testRunDetailOtherClientSkillApprovalInvalidatesPendingContext() async throws {
        let pending = skillExecutionProposal()
        let accepted = skillExecutionProposal(status: .accepted)
        let api = RunDetailSnapshotAPI(messageSnapshots: [
            IssueMessagesResponse(messages: [issueMessage(
                skillExecutionProposal: pending
            )]),
            IssueMessagesResponse(messages: [issueMessage(
                skillExecutionProposal: accepted
            )]),
        ])
        let store = RunDetailStore(
            api: api,
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token"
        )
        await store.load()
        let context = try XCTUnwrap(
            store.captureSkillExecutionProposal(proposalID: pending.id)
        )

        await store.load()

        XCTAssertFalse(store.skillExecutionProposalIsCurrent(context))
        XCTAssertNil(store.captureSkillExecutionProposal(proposalID: pending.id))
        XCTAssertEqual(store.messages.first?.skillExecutionProposal?.status, .accepted)
    }

    @MainActor
    func testRunDetailSkillProposalReplacementInvalidatesTheOriginalContext() throws {
        let pending = skillExecutionProposal()
        let replacement = skillExecutionProposal(
            id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        )
        let store = RunDetailStore(
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token"
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
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token"
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
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token"
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
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: pending.projectId,
            runID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            token: "token"
        )
        store.appendMessages([issueMessage(skillExecutionProposal: pending)])
        store.updateSkillExecutionProposal(accepted)

        store.appendMessages([issueMessage(skillExecutionProposal: pending)])

        XCTAssertEqual(store.messages.first?.skillExecutionProposal, accepted)

        store.appendMessages([issueMessage(skillExecutionProposal: nil)])
        XCTAssertNil(store.messages.first?.skillExecutionProposal)
    }

    @MainActor
    func testRunDetailKeepsOptimisticMessageUntilSameIDBecomesAuthoritative() async {
        let parent = issueMessage(body: "Parent")
        let pendingID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let pending = issueMessage(
            id: pendingID,
            parentMessageId: parent.id,
            body: "바로 보이는 답글"
        )
        let api = RunDetailSnapshotAPI(messageSnapshots: [
            IssueMessagesResponse(messages: [parent]),
        ])
        let store = RunDetailStore(
            api: api,
            projectID: executionProposal().projectId,
            runID: parent.runId,
            token: "token"
        )
        store.appendMessages([parent])
        store.appendOptimisticMessage(pending)

        XCTAssertTrue(store.isMessageOptimistic(pendingID))
        XCTAssertEqual(store.messages.first(where: { $0.id == parent.id })?.replyCount, 1)
        await store.load()
        XCTAssertTrue(store.messages.contains { $0.id == pendingID })
        XCTAssertTrue(store.isMessageOptimistic(pendingID))

        store.appendMessages([pending])

        XCTAssertFalse(store.isMessageOptimistic(pendingID))
        XCTAssertEqual(store.messages.filter { $0.id == pendingID }.count, 1)
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
            api: RunDetailSnapshotAPI(messageSnapshots: []),
            projectID: executionProposal().projectId,
            runID: parent.runId,
            token: "token"
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

private actor RunDetailSnapshotAPI: MobileAPIClientProtocol {
    private var messageSnapshots: [IssueMessagesResponse]
    private let messageDelay: Duration?
    private var messageRequests = 0

    init(
        messageSnapshots: [IssueMessagesResponse],
        messageDelay: Duration? = nil
    ) {
        self.messageSnapshots = messageSnapshots
        self.messageDelay = messageDelay
    }

    func messageRequestCount() -> Int {
        messageRequests
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let data: Data
        if path.hasSuffix("/events") {
            data = try JSONEncoder.mobileContract.encode(RunEventsResponse(events: []))
        } else if path.hasSuffix("/messages") {
            guard !messageSnapshots.isEmpty else { throw MobileAPIError.invalidRequest }
            messageRequests += 1
            let response = messageSnapshots.removeFirst()
            if let messageDelay { try await Task.sleep(for: messageDelay) }
            data = try JSONEncoder.mobileContract.encode(response)
        } else if path.hasSuffix("/evidence") {
            data = try JSONEncoder.mobileContract.encode(RunEvidenceResponse(evidence: []))
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}
