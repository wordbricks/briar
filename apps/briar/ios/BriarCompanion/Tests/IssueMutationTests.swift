import Foundation
import UIKit
import XCTest
@testable import BriarCompanion

@MainActor
final class IssueMutationTests: XCTestCase {
    func testIssueTitleLimitsMatchLanguageAwareRules() {
        XCTAssertEqual(IssueTitleLimits.maxLength(for: "로그인 오류"), IssueTitleLimits.hangulMax)
        XCTAssertEqual(IssueTitleLimits.maxLength(for: "登录失败"), IssueTitleLimits.hanMax)
        XCTAssertEqual(IssueTitleLimits.maxLength(for: "Checkout is blank"), IssueTitleLimits.latinMax)
        XCTAssertNil(IssueTitleLimits.validationError(for: "정상 제목"))
        XCTAssertEqual(
            IssueTitleLimits.validationError(for: String(repeating: "가", count: IssueTitleLimits.hangulMax + 1)),
            .titleTooLong(max: IssueTitleLimits.hangulMax, count: IssueTitleLimits.hangulMax + 1)
        )
        XCTAssertEqual(IssueTitleLimits.validationError(for: "   "), .invalidTitle)
    }

    func testAttachmentLimitsMatchSharedMobileContract() {
        let image = PendingIssueAttachment(
            filename: "screen.png",
            contentType: "image/png",
            data: Data([1])
        )
        XCTAssertNil(PendingIssueAttachment.validationMessage(for: [image]))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: Array(repeating: image, count: 6)))
        XCTAssertNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "diagram.svg",
            contentType: "image/svg+xml",
            data: Data([1])
        )]))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "unsafe.pdf",
            contentType: "application/pdf",
            data: Data([1])
        )]))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "large.png",
            contentType: "image/png",
            data: Data(count: PendingIssueAttachment.maximumFileBytes + 1)
        )]))
    }

    func testBuildsJPEGAttachmentFromPastedImageData() {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10))
        let pngData = renderer.pngData { context in
            context.cgContext.setFillColor(UIColor.red.cgColor)
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 10, height: 10))
        }
        guard let attachment = PendingIssueAttachment.jpeg(from: pngData) else {
            return XCTFail("expected a JPEG attachment from clipboard image data")
        }
        XCTAssertEqual(attachment.contentType, "image/jpeg")
        XCTAssertTrue(attachment.filename.hasSuffix(".jpg"))
        XCTAssertFalse(attachment.data.isEmpty)
        XCTAssertNil(PendingIssueAttachment.validationMessage(for: [attachment]))
    }

    func testPastingNonImageDataProducesNoAttachment() {
        XCTAssertNil(PendingIssueAttachment.jpeg(from: Data()))
        XCTAssertNil(PendingIssueAttachment.jpeg(from: Data([0x00, 0x01, 0x02])))
    }

    func testDraftPersistsUntilSuccessfulCreation() {
        let suite = "IssueMutationTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let persistence = IssueDraftPersistence(defaults: defaults)
        let draft = IssueDraft(title: "보존할 제목", description: "본문", priority: 2, status: .backlog)

        persistence.save(draft)
        XCTAssertEqual(persistence.load(), draft)
        persistence.clear()
        XCTAssertTrue(persistence.load().isEmpty)
    }

    func testIssueDraftPersistsPreferredProviderAndModel() {
        let suite = "IssueMutationTests-preferences-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let persistence = IssueDraftPersistence(defaults: defaults)

        var draft = IssueDraft(title: "선호 실행 이슈")
        draft.preferredProvider = .claude
        draft.preferredModel = "sonnet"
        XCTAssertFalse(draft.isEmpty)

        persistence.save(draft)
        let restored = persistence.load()
        XCTAssertEqual(restored.preferredProvider, .claude)
        XCTAssertEqual(restored.preferredModel, "sonnet")
    }

    func testIssueExecutionMenusUseStableProviderModelAndEffortOrder() {
        let model = { (id: String, label: String, efforts: [AgentEffortCapability]) in
            AgentModelCapability(
                id: id,
                label: label,
                isDefault: false,
                defaultEffortId: nil,
                efforts: efforts
            )
        }
        let effort = { (id: String, label: String) in
            AgentEffortCapability(
                id: id,
                label: label,
                description: nil,
                isDefault: false
            )
        }
        let worker = { (id: String, models: [AgentModelCapability]) in
            DashboardWorker(
                id: id,
                label: id,
                providers: [.codex],
                capabilities: .init(providerCapabilities: [
                    AgentProvider.codex.rawValue: AgentProviderCapability(
                        models: models,
                        defaultEfforts: [],
                        allowCustomModels: false,
                        error: nil
                    ),
                ]),
                readiness: "available",
                acceptingWork: true,
                readinessDetail: nil,
                activeSessions: 0,
                availableSessions: 1
            )
        }
        let first = worker("first", [
            model("zeta", "Zeta", [effort("xhigh", "Extra high"), effort("low", "Low")]),
            model("alpha", "alpha", [effort("ultra", "Ultra")]),
        ])
        let second = worker("second", [
            model("beta", "Beta", []),
            model("alpha", "alpha", [effort("high", "High"), effort("medium", "Medium")]),
        ])

        let forward = AgentProviderCapabilityCatalog(workers: [first, second])
        let reversed = AgentProviderCapabilityCatalog(workers: [second, first])

        XCTAssertEqual(
            AgentProvider.stableMenuOrder([.openrouter, .grok, .codex, .claude]),
            [.codex, .claude, .grok, .openrouter]
        )
        XCTAssertEqual(forward.models(for: .codex).map(\.id), ["alpha", "beta", "zeta"])
        XCTAssertEqual(reversed.models(for: .codex).map(\.id), ["alpha", "beta", "zeta"])
        XCTAssertEqual(
            forward.efforts(for: .codex, model: "alpha").map(\.id),
            ["medium", "high", "ultra"]
        )
        XCTAssertEqual(
            reversed.efforts(for: .codex, model: "alpha").map(\.id),
            ["medium", "high", "ultra"]
        )
    }

    func testCreateIssueRequestEncodesPreferredProviderAndModel() throws {
        let request = CreateIssueRequest(
            title: "선호 실행 이슈",
            description: nil,
            priority: 2,
            difficulty: .hard,
            assigneeUserId: nil,
            status: .queued,
            preferredProvider: .claude,
            preferredModel: "sonnet",
            preferredEffort: .high,
            fullAuto: true
        )
        let data = try JSONEncoder.mobileContract.encode(request)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(object["preferredProvider"] as? String, "claude")
        XCTAssertEqual(object["preferredModel"] as? String, "sonnet")
        XCTAssertEqual(object["preferredEffort"] as? String, "high")
        XCTAssertEqual(object["fullAuto"] as? Bool, true)
        XCTAssertEqual(object["difficulty"] as? String, "hard")
    }

    func testCreateIssueMessageRequestEncodesCanonicalParentMessageID() throws {
        let parentMessageID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let clientMessageID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let request = CreateIssueMessageRequest(
            body: "답글",
            clientMessageId: clientMessageID,
            parentMessageId: parentMessageID,
            mentionedUserIds: [],
            agentConversationId: nil
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.mobileContract.encode(request)
            ) as? [String: Any]
        )

        XCTAssertEqual(
            object["clientMessageId"] as? String,
            clientMessageID.uuidString.lowercased()
        )
        XCTAssertEqual(
            object["parentMessageId"] as? String,
            parentMessageID.uuidString.lowercased()
        )
    }

    func testCreateIssueSendsPreferredPreferences() async throws {
        let recorder = MutationAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        var draft = IssueDraft(title: "선호 실행 이슈", description: "", priority: 2, status: .queued)
        draft.preferredProvider = .claude
        draft.preferredModel = "sonnet"
        draft.preferredEffort = .high
        draft.fullAuto = true

        _ = try await store.createIssue(draft: draft, attachments: [])

        let recorded = await recorder.lastJSONBodyData()
        let bodyData = try XCTUnwrap(recorded)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        XCTAssertEqual(body["preferredProvider"] as? String, "claude")
        XCTAssertEqual(body["preferredModel"] as? String, "sonnet")
        XCTAssertEqual(body["preferredEffort"] as? String, "high")
        XCTAssertEqual(body["fullAuto"] as? Bool, true)
        XCTAssertEqual(body["difficulty"] as? String, "normal")
    }

    func testIssueSubscriptionUsesDedicatedPutAndDeleteEndpoint() async throws {
        let recorder = MutationAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        let subscribed = try await store.setSubscription(
            runID: Self.runID,
            subscribed: true
        )
        XCTAssertEqual(subscribed.runId, Self.runID)
        XCTAssertEqual(subscribed.subscribers.map(\.userId), ["fixture-user"])
        let subscribedMethod = await recorder.lastMethod()
        XCTAssertEqual(subscribedMethod, "PUT")
        let subscribedPath = await recorder.lastPath()
        XCTAssertEqual(
            subscribedPath,
            MobileAPIContract.Endpoint.runSubscription(
                projectID: Self.projectID,
                runID: Self.runID
            )
        )

        _ = try await store.setSubscription(runID: Self.runID, subscribed: false)
        let unsubscribedMethod = await recorder.lastMethod()
        XCTAssertEqual(unsubscribedMethod, "DELETE")
    }

    func testDispatchRunRequestEncodesWorkerSelection() throws {
        let agentID = UUID(uuidString: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")!
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!

        let specific = DispatchRunRequest(
            agentId: agentID,
            provider: .codex,
            model: nil,
            effort: nil,
            persistPreferences: true,
            workerId: "worker-1",
            requestId: requestID
        )
        let specificData = try JSONEncoder.mobileContract.encode(specific)
        let specificObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: specificData) as? [String: Any]
        )
        XCTAssertEqual(specificObject["workerId"] as? String, "worker-1")
        XCTAssertEqual(specificObject["agentId"] as? String, agentID.uuidString.lowercased())

        let auto = DispatchRunRequest(
            provider: .codex,
            model: nil,
            effort: nil,
            persistPreferences: true,
            workerId: nil,
            requestId: requestID
        )
        let autoData = try JSONEncoder.mobileContract.encode(auto)
        let autoObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: autoData) as? [String: Any]
        )
        // Swift synthesized Codable omits nil optional keys; the server treats a
        // missing workerId the same as null (auto-assign), matching dispatchMode "any".
        XCTAssertFalse(autoObject.keys.contains("workerId"))
    }

    func testDispatchSendsSelectedWorkerID() async throws {
        let recorder = MutationAPIRecorder()
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            requestID: { requestID }
        )

        try await store.dispatch(
            runID: Self.runID,
            preferences: IssueExecutionPreferences(
                provider: .codex,
                model: nil,
                effort: nil
            ),
            workerID: "worker-1",
            reassign: false
        )

        let recordedBodyData = await recorder.lastJSONBodyData()
        let bodyData = try XCTUnwrap(recordedBodyData)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        XCTAssertEqual(body["workerId"] as? String, "worker-1")
        XCTAssertEqual(body["provider"] as? String, "codex")
        XCTAssertEqual(body["requestId"] as? String, requestID.uuidString.lowercased())
    }

    func testDispatchSendsAutoAssignmentWhenNoWorkerSelected() async throws {
        let recorder = MutationAPIRecorder()
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            requestID: { requestID }
        )

        try await store.dispatch(
            runID: Self.runID,
            preferences: IssueExecutionPreferences(
                provider: .claude,
                model: nil,
                effort: nil
            ),
            workerID: nil,
            reassign: false
        )

        let recordedBodyData = await recorder.lastJSONBodyData()
        let bodyData = try XCTUnwrap(recordedBodyData)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        XCTAssertFalse(body.keys.contains("workerId"))
        XCTAssertEqual(body["provider"] as? String, "claude")
    }

    func testExecutionApprovalRequiresAnUnclaimedFreshBacklog() {
        XCTAssertNil(issueExecutionApprovalUnavailable(
            run: executionRun(),
            targetRunID: Self.runID
        ))
        XCTAssertEqual(
            issueExecutionApprovalUnavailable(
                run: executionRun(executionReadiness: "waiting"),
                targetRunID: Self.runID
            ),
            .prerequisites
        )

        let staleRuns = [
            executionRun(status: .queued),
            executionRun(claimedBy: "worker-1"),
            executionRun(claimedAt: .now),
            executionRun(workerID: "worker-1"),
            executionRun(dispatchedAt: .now),
            executionRun(requestedByUserID: "fixture-user"),
            executionRun(dispatchMode: "any"),
        ]
        for run in staleRuns {
            XCTAssertEqual(
                issueExecutionApprovalUnavailable(run: run, targetRunID: Self.runID),
                .stateChanged,
                "\(run) must not remain approvable"
            )
        }
        XCTAssertEqual(
            issueExecutionApprovalUnavailable(run: nil, targetRunID: Self.runID),
            .targetUnavailable
        )
    }

    func testExecutionSignatureTracksEveryApprovalRelevantTargetChange() throws {
        let changedAt = Date(timeIntervalSince1970: 1_700_000_100)
        let baseline = try XCTUnwrap(issueExecutionSignature(executionRun()))
        let variants = [
            executionRun(status: .queued),
            executionRun(workflowStage: "implementing"),
            executionRun(executionReadiness: "waiting"),
            executionRun(waitingOnPrerequisiteCount: 1),
            executionRun(assigneeUserID: "fixture-user"),
            executionRun(preferredProvider: .codex),
            executionRun(preferredModel: "gpt-5.6-sol"),
            executionRun(preferredEffort: .high),
            executionRun(dispatchedAt: changedAt),
            executionRun(requestedProvider: .codex),
            executionRun(requestedModel: "gpt-5.6-sol"),
            executionRun(requestedEffort: .high),
            executionRun(requestedWorkerID: "worker-requested"),
            executionRun(requestedByUserID: "fixture-user"),
            executionRun(dispatchMode: "specific"),
            executionRun(claimedBy: "worker-1"),
            executionRun(claimedAt: changedAt),
            executionRun(workerID: "worker-1"),
            executionRun(startedAt: changedAt),
            executionRun(updatedAt: changedAt),
        ]

        for variant in variants {
            XCTAssertNotEqual(issueExecutionSignature(variant), baseline)
        }
        XCTAssertEqual(issueExecutionSignature(executionRun()), baseline)
        XCTAssertNil(issueExecutionSignature(nil))
    }

    func testPendingTargetSignatureReloadTriggerIgnoresStableAndInitialState() throws {
        let proposalID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
        let baseline = try XCTUnwrap(issueExecutionSignature(executionRun()))
        let approvedElsewhere = try XCTUnwrap(
            issueExecutionSignature(executionRun(status: .queued))
        )
        let assigned = try XCTUnwrap(
            issueExecutionSignature(executionRun(assigneeUserID: "fixture-user"))
        )
        let previous = [PendingIssueExecutionTargetSignature(
            proposalID: proposalID,
            targetSignature: baseline
        )]

        XCTAssertFalse(pendingIssueExecutionTargetChanged(from: [], to: previous))
        XCTAssertFalse(pendingIssueExecutionTargetChanged(from: previous, to: previous))
        XCTAssertFalse(pendingIssueExecutionTargetChanged(from: previous, to: []))
        XCTAssertTrue(pendingIssueExecutionTargetChanged(
            from: previous,
            to: [PendingIssueExecutionTargetSignature(
                proposalID: proposalID,
                targetSignature: approvedElsewhere
            )]
        ))
        XCTAssertTrue(pendingIssueExecutionTargetChanged(
            from: previous,
            to: [PendingIssueExecutionTargetSignature(
                proposalID: proposalID,
                targetSignature: nil
            )]
        ))
        XCTAssertTrue(pendingIssueExecutionTargetChanged(
            from: [PendingIssueExecutionTargetSignature(
                proposalID: proposalID,
                targetSignature: assigned
            )],
            to: previous
        ))
    }

    func testCreateResponseAcceptsAlreadyApprovedExecutionSnapshotForExactRun() {
        let proposal = IssueExecutionProposal(
            id: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            status: .accepted,
            projectId: Self.projectID,
            runId: Self.runID,
            title: "Fresh backlog",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            acceptedAt: Date(timeIntervalSince1970: 1_700_000_100),
            requestedProvider: .codex,
            requestedModel: "gpt-5.6-sol",
            requestedEffort: .high,
            requestedWorkerId: "worker-1"
        )

        XCTAssertTrue(issueExecutionProposalMatchesCreatedRun(
            proposal,
            projectID: Self.projectID,
            runID: Self.runID
        ))
        XCTAssertFalse(issueExecutionProposalMatchesCreatedRun(
            proposal,
            projectID: UUID(),
            runID: Self.runID
        ))
        XCTAssertFalse(issueExecutionProposalMatchesCreatedRun(
            proposal,
            projectID: Self.projectID,
            runID: UUID()
        ))
    }

    func testConversationApprovalUsesProviderEffortAndWorkerPolicyLimits() {
        XCTAssertEqual(AgentProvider.agy.displayName, "Antigravity")
        XCTAssertEqual(AgentProvider.cursor.displayName, "Cursor")
        XCTAssertEqual(AgentProvider.openrouter.displayName, "OpenRouter")
        XCTAssertTrue(IssueExecutionPreferences(
            provider: .claude,
            model: "sonnet",
            effort: ModelEffort(rawValue: "future-effort")
        ).isValidForConversationApproval)

        let allowed = DashboardWorker(
            id: "allowed",
            label: "Allowed Mac",
            providers: [.codex],
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let blocked = DashboardWorker(
            id: "blocked",
            label: "Blocked Mac",
            providers: [.codex],
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let policy = ProjectExecutionWorkerPolicy(
            selectionMode: .allowlist,
            defaultWorkerId: allowed.id,
            allowedWorkerIds: [allowed.id],
            updatedAt: .now
        )

        XCTAssertEqual(
            eligibleExecutionWorkers(
                workers: [allowed, blocked],
                provider: .codex,
                policy: policy
            ).map(\.id),
            [allowed.id]
        )

        let snapshot = DashboardSnapshot(
            project: ProjectsResponse.Project(
                id: Self.projectID,
                name: "Target",
                icon: nil,
                organizationId: UUID(
                    uuidString: "22222222-2222-4222-8222-222222222222"
                )!,
                organizationName: "Wordbricks",
                role: .owner,
                createdAt: .now
            ),
            runs: [executionRun()],
            workers: [allowed, blocked],
            organizationProviders: [.codex],
            executionPolicy: policy,
            cursor: nil,
            generatedAt: .now
        )
        let proposal = IssueExecutionProposal(
            id: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            status: .pending,
            projectId: Self.projectID,
            runId: Self.runID,
            title: "Fresh backlog",
            createdAt: .now
        )
        XCTAssertThrowsError(
            try validateIssueExecutionApproval(
                snapshot: snapshot,
                proposal: proposal,
                request: AcceptIssueExecutionProposalRequest(
                    provider: .codex,
                    model: "gpt-5.6-sol",
                    effort: .high,
                    workerId: blocked.id
                )
            )
        ) { error in
            XCTAssertEqual(error as? IssueExecutionApprovalError, .workerUnavailable)
        }
    }

    func testAcceptIssueExecutionProposalUsesDedicatedPathAndStrictBody() async throws {
        let recorder = MutationAPIRecorder()
        let proposalID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let request = AcceptIssueExecutionProposalRequest(
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .ultra,
            workerId: "worker-1"
        )

        let response = try await store.acceptIssueExecutionProposal(
            conversationRunID: Self.runID,
            proposalID: proposalID,
            request: request
        )

        XCTAssertEqual(response.proposal.id, proposalID)
        XCTAssertEqual(response.runId, Self.runID)
        let recordedPath = await recorder.lastPath()
        XCTAssertEqual(
            recordedPath,
            MobileAPIContract.Endpoint.acceptIssueExecutionProposal(
                projectID: Self.projectID,
                conversationRunID: Self.runID,
                proposalID: proposalID
            )
        )
        let capturedBodyData = await recorder.lastJSONBodyData()
        let recordedBodyData = try XCTUnwrap(capturedBodyData)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: recordedBodyData) as? [String: Any]
        )
        XCTAssertEqual(Set(body.keys), ["provider", "model", "effort", "workerId"])
        XCTAssertEqual(body["provider"] as? String, "codex")
        XCTAssertEqual(body["model"] as? String, "gpt-5.6-sol")
        XCTAssertEqual(body["effort"] as? String, "ultra")
        XCTAssertEqual(body["workerId"] as? String, "worker-1")
        XCTAssertNil(body["requestId"])
    }

    func testAgentSkillExecutionApprovalRequiresOneExactEligibleWorker() throws {
        let worker = DashboardWorker(
            id: "worker-1",
            label: "Build Mac",
            agentProvider: .codex,
            providers: [.codex],
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let snapshot = DashboardSnapshot(
            project: ProjectsResponse.Project(
                id: Self.projectID,
                name: "Target",
                icon: nil,
                organizationId: UUID(
                    uuidString: "22222222-2222-4222-8222-222222222222"
                )!,
                organizationName: "Wordbricks",
                role: .owner,
                createdAt: .now
            ),
            runs: [],
            workers: [worker],
            organizationProviders: [.codex],
            executionPolicy: ProjectExecutionWorkerPolicy(
                selectionMode: .allowlist,
                defaultWorkerId: worker.id,
                allowedWorkerIds: [worker.id],
                updatedAt: .now
            ),
            cursor: nil,
            generatedAt: .now
        )
        let proposal = agentSkillExecutionProposal()

        XCTAssertEqual(
            try validateAgentSkillExecutionApproval(
                snapshot: snapshot,
                proposal: proposal,
                request: AcceptAgentSkillExecutionProposalRequest(workerId: worker.id)
            ).map(\.id),
            [worker.id]
        )
        XCTAssertThrowsError(
            try validateAgentSkillExecutionApproval(
                snapshot: snapshot,
                proposal: proposal,
                request: AcceptAgentSkillExecutionProposalRequest(workerId: "")
            )
        ) { error in
            XCTAssertEqual(error as? AgentSkillExecutionApprovalError, .workerRequired)
        }
        for invalidWorkerID in ["any", " worker-1", "worker-2"] {
            XCTAssertThrowsError(
                try validateAgentSkillExecutionApproval(
                    snapshot: snapshot,
                    proposal: proposal,
                    request: AcceptAgentSkillExecutionProposalRequest(
                        workerId: invalidWorkerID
                    )
                )
            ) { error in
                XCTAssertEqual(
                    error as? AgentSkillExecutionApprovalError,
                    .workerUnavailable
                )
            }
        }
    }

    func testAgentSkillExecutionResponseMustPreserveEvidenceAndSessionIdentity() {
        let pending = agentSkillExecutionProposal()
        let request = AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        let response = AcceptAgentSkillExecutionProposalResponse(
            outcome: .accepted,
            proposal: agentSkillExecutionProposal(status: .accepted),
            projectId: Self.projectID,
            session: agentSkillExecutionSession()
        )

        XCTAssertTrue(
            agentSkillExecutionApprovalResponseMatches(
                response: response,
                expected: pending,
                request: request
            )
        )
        let mismatches = [
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(
                    id: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
                    status: .accepted
                ),
                projectId: Self.projectID,
                session: agentSkillExecutionSession()
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(
                    status: .accepted,
                    model: "different-runtime"
                ),
                projectId: Self.projectID,
                session: agentSkillExecutionSession()
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(
                    status: .accepted,
                    acceptedWorkerID: "worker-2"
                ),
                projectId: Self.projectID,
                session: agentSkillExecutionSession()
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(id: "different-session")
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(request: "다른 요청")
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(agentName: "다른 Agent")
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(sessionType: .dispatch)
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(trigger: .scheduled)
            ),
            AcceptAgentSkillExecutionProposalResponse(
                outcome: .accepted,
                proposal: agentSkillExecutionProposal(status: .accepted),
                projectId: Self.projectID,
                session: agentSkillExecutionSession(workerID: nil)
            ),
        ]
        for mismatch in mismatches {
            XCTAssertFalse(
                agentSkillExecutionApprovalResponseMatches(
                    response: mismatch,
                    expected: pending,
                    request: request
                )
            )
        }
    }

    func testAcceptAgentSkillExecutionProposalUsesDedicatedPathAndWorkerOnlyBody() async throws {
        let recorder = MutationAPIRecorder()
        let proposalID = UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        let response = try await store.acceptAgentSkillExecutionProposal(
            conversationRunID: Self.runID,
            proposalID: proposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )

        XCTAssertEqual(response.proposal.id, proposalID)
        XCTAssertEqual(response.session.id, "session-1")
        let recordedPath = await recorder.lastPath()
        XCTAssertEqual(
            recordedPath,
            MobileAPIContract.Endpoint.acceptIssueSkillExecutionProposal(
                projectID: Self.projectID,
                conversationRunID: Self.runID,
                proposalID: proposalID
            )
        )
        let capturedBodyData = await recorder.lastJSONBodyData()
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: XCTUnwrap(capturedBodyData))
                as? [String: Any]
        )
        XCTAssertEqual(Set(body.keys), ["workerId"])
        XCTAssertEqual(body["workerId"] as? String, "worker-1")
    }

    func testDuplicateCreateTapSendsOnlyOneRequest() async throws {
        let recorder = MutationAPIRecorder(delay: .milliseconds(100))
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let draft = IssueDraft(title: "한 번만 생성", description: "", priority: nil, status: .queued)

        async let first = store.createIssue(draft: draft, attachments: [])
        try await Task.sleep(for: .milliseconds(10))
        do {
            _ = try await store.createIssue(draft: draft, attachments: [])
            XCTFail("The second tap must be rejected while the first request is active")
        } catch IssueMutationError.duplicateAction {
            // Expected.
        }
        _ = try await first
        let count = await recorder.requestCount()
        XCTAssertEqual(count, 1)
    }

    func testDuplicateDispatchTapSendsOnlyOneRequest() async throws {
        let recorder = MutationAPIRecorder(delay: .milliseconds(100))
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let preferences = IssueExecutionPreferences(
            provider: .codex,
            model: nil,
            effort: nil
        )

        async let first: Void = store.dispatch(
            runID: Self.runID,
            preferences: preferences,
            workerID: nil,
            reassign: false
        )
        try await Task.sleep(for: .milliseconds(10))
        do {
            try await store.dispatch(
                runID: Self.runID,
                preferences: preferences,
                workerID: nil,
                reassign: false
            )
            XCTFail("The second tap must be rejected while dispatch is active")
        } catch IssueMutationError.duplicateAction {
            // Expected.
        }
        try await first
        let count = await recorder.requestCount()
        XCTAssertEqual(count, 1)
    }

    func testMutatingRunRequestUsesInjectedIdempotencyIdentifier() async throws {
        let recorder = MutationAPIRecorder()
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            requestID: { requestID }
        )

        try await store.move(runID: Self.runID, status: .queued)
        let recordedRequestID = await recorder.lastRequestID()
        XCTAssertEqual(recordedRequestID, requestID.uuidString)
    }

    func testMoveRequestEncodesNullWorkflowStageForNonRunningStatus() async throws {
        let recorder = MutationAPIRecorder()
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            requestID: { requestID }
        )

        // cancelled → backlog/queued is the reported iOS control-tab failure path.
        try await store.move(runID: Self.runID, status: .backlog, workflowStage: nil)

        let recordedBody = await recorder.lastJSONBodyData()
        let bodyData = try XCTUnwrap(recordedBody)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        XCTAssertEqual(body["requestId"] as? String, requestID.uuidString)
        XCTAssertEqual(body["status"] as? String, "backlog")
        // Server Zod requires the key; NSNull means JSON null (not key omission).
        XCTAssertTrue(body["workflowStage"] is NSNull)
        XCTAssertTrue(body.keys.contains("workflowStage"))
    }

    func testRunStatusRequestJSONIncludesExplicitNullWorkflowStage() throws {
        let request = RunStatusRequest(
            requestId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            status: .queued,
            workflowStage: nil
        )
        let data = try JSONEncoder.mobileContract.encode(request)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(object["status"] as? String, "queued")
        XCTAssertTrue(object["workflowStage"] is NSNull)

        let withStage = RunStatusRequest(
            requestId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            status: .running,
            workflowStage: "analyzing"
        )
        let staged = try JSONSerialization.jsonObject(
            with: JSONEncoder.mobileContract.encode(withStage)
        ) as? [String: Any]
        XCTAssertEqual(staged?["workflowStage"] as? String, "analyzing")
    }

    func testFailedMutationRetryReusesItsIdempotencyIdentifier() async throws {
        let recorder = MutationAPIRecorder(failuresRemaining: 1)
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        do {
            try await store.move(runID: Self.runID, status: .queued)
            XCTFail("The first transport attempt must fail")
        } catch MobileAPIError.invalidRequest {
            // Expected.
        }
        try await store.move(runID: Self.runID, status: .queued)

        let requestIDs = await recorder.allRequestIDs()
        XCTAssertEqual(requestIDs.count, 2)
        XCTAssertEqual(requestIDs[0], requestIDs[1])
    }

    func testResumeSendsExactCheckpointIdentityAndReusesRequestIDAfterFailure() async throws {
        let recorder = MutationAPIRecorder(failuresRemaining: 1)
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let checkpoint = WorkflowCheckpoint(
            key: "user-before-production_qa",
            stage: "production_qa",
            stageLabel: "Production QA",
            position: .before,
            attempt: 2,
            revision: 3,
            reachedAt: nil,
            nextStage: "production_qa",
            nextStageLabel: "Production QA",
            terminalReviewOnly: false
        )

        do {
            try await store.resume(runID: Self.runID, checkpoint: checkpoint)
            XCTFail("The first transport attempt must fail")
        } catch MobileAPIError.invalidRequest {
            // Expected.
        }
        try await store.resume(runID: Self.runID, checkpoint: checkpoint)

        let requests = await recorder.resumeRequests()
        XCTAssertEqual(requests.map { $0.checkpointKey }, [checkpoint.key, checkpoint.key])
        XCTAssertEqual(requests.map { $0.attempt }, [2, 2])
        XCTAssertEqual(requests.map { $0.revision }, [3, 3])
        XCTAssertEqual(requests[0].requestID, requests[1].requestID)
    }

    func testAgentReplyPollingReturnsTheCompletedReply() async throws {
        let recorder = AgentReplyAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        let messages = try await store.sendMessage(
            runID: Self.runID,
            body: "@Developer 확인해 줘",
            parentMessageID: nil,
            pollInterval: .zero,
            maximumPolls: 1
        )

        XCTAssertEqual(messages.map(\.body), ["@Developer 확인해 줘", "확인했습니다."])
        let methods = await recorder.recordedMethods()
        XCTAssertEqual(methods, ["POST", "GET"])
    }

    func testSendMessageEncodesMentionedUserIds() async throws {
        let recorder = MentionMessageAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        _ = try await store.sendMessage(
            runID: Self.runID,
            body: "@sam 확인해 줘",
            parentMessageID: nil,
            mentionedUserIds: ["user-2", "user-2", ""],
            pollInterval: .zero,
            maximumPolls: 1
        )

        let body = await recorder.recordedBody()
        XCTAssertEqual(body?.body, "@sam 확인해 줘")
        XCTAssertEqual(body?.mentionedUserIds, ["user-2"])
    }

    func testConversationImageUsesMultipartUpload() async throws {
        let recorder = MessageAttachmentAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            attachmentReference: { "fixed-ref" }
        )
        let attachment = PendingIssueAttachment(
            filename: "clipboard [1].png",
            contentType: "image/png",
            data: Data([1, 2, 3])
        )

        let messages = try await store.sendMessage(
            runID: Self.runID,
            body: "",
            parentMessageID: nil,
            attachments: [attachment]
        )

        XCTAssertEqual(messages.first?.attachments?.first?.filename, "clipboard.png")
        let upload = await recorder.recordedUpload()
        XCTAssertEqual(upload?.files.map(\.filename), ["clipboard [1].png"])
        XCTAssertEqual(
            upload?.fields["body"],
            #"![clipboard \[1\].png](briar-attachment://fixed-ref)"#
        )
        XCTAssertEqual(upload?.fields["attachmentReferences"], #"["fixed-ref"]"#)
    }

    private static let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private static let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!

    private func agentSkillExecutionProposal(
        id: UUID = UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
        status: AgentSkillExecutionProposal.Status = .pending,
        model: String? = "gpt-5.6-sol",
        acceptedWorkerID: String = "worker-1",
        resultSessionID: String = "session-1"
    ) -> AgentSkillExecutionProposal {
        AgentSkillExecutionProposal(
            id: id,
            status: status,
            projectId: Self.projectID,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: "Project Agent",
            skillId: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            skillName: "iOS 배포",
            request: "TestFlight에 최신 빌드를 배포해 줘",
            provider: .codex,
            model: model,
            effort: .high,
            createdAt: Date(timeIntervalSince1970: 1_700_000_010),
            acceptedAt: status == .accepted
                ? Date(timeIntervalSince1970: 1_700_000_100)
                : nil,
            requestedWorkerId: status == .accepted ? acceptedWorkerID : nil,
            requestedWorkerLabel: status == .accepted ? "Build Mac" : nil,
            resultSessionId: status == .accepted ? resultSessionID : nil
        )
    }

    private func agentSkillExecutionSession(
        id: String = "session-1",
        request: String = "TestFlight에 최신 빌드를 배포해 줘",
        agentName: String? = "Project Agent",
        sessionType: ProjectAgentSession.SessionType = .task,
        trigger: ProjectAgentSession.Trigger = .manual,
        workerID: String? = "worker-1"
    ) -> ProjectAgentSession {
        ProjectAgentSession(
            id: id,
            projectId: Self.projectID,
            dispatchGroupId: nil,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: agentName,
            skillId: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            sessionType: sessionType,
            trigger: trigger,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: request,
            status: .running,
            issues: [],
            startedAt: Date(timeIntervalSince1970: 1_700_000_100),
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            requestedWorkerId: "worker-1",
            workerId: workerID,
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
    }

    private func executionRun(
        status: DashboardRun.Status = .backlog,
        workflowStage: String? = nil,
        executionReadiness: String? = "ready",
        waitingOnPrerequisiteCount: Int? = nil,
        assigneeUserID: String? = nil,
        preferredProvider: AgentProvider? = nil,
        preferredModel: String? = nil,
        preferredEffort: ModelEffort? = nil,
        claimedBy: String? = nil,
        claimedAt: Date? = nil,
        workerID: String? = nil,
        dispatchedAt: Date? = nil,
        requestedProvider: AgentProvider? = nil,
        requestedModel: String? = nil,
        requestedEffort: ModelEffort? = nil,
        requestedWorkerID: String? = nil,
        requestedByUserID: String? = nil,
        dispatchMode: String? = nil,
        startedAt: Date? = nil,
        updatedAt: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> DashboardRun {
        DashboardRun(
            id: Self.runID,
            title: "Fresh backlog",
            status: status,
            workflowStage: workflowStage,
            assigneeUserId: assigneeUserID,
            executionReadiness: executionReadiness,
            waitingOnPrerequisiteCount: waitingOnPrerequisiteCount,
            preferredProvider: preferredProvider,
            preferredModel: preferredModel,
            preferredEffort: preferredEffort,
            dispatchedAt: dispatchedAt,
            requestedProvider: requestedProvider,
            requestedModel: requestedModel,
            requestedEffort: requestedEffort,
            requestedWorkerId: requestedWorkerID,
            requestedByUserId: requestedByUserID,
            dispatchMode: dispatchMode,
            claimedBy: claimedBy,
            claimedAt: claimedAt,
            workerId: workerID,
            startedAt: startedAt,
            updatedAt: updatedAt
        )
    }
}

private actor MessageAttachmentAPIRecorder: MobileAPIClientProtocol {
    private var upload: (fields: [String: String], files: [MultipartFile])?

    func recordedUpload() -> (fields: [String: String], files: [MultipartFile])? { upload }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        upload = (fields, files)
        let body = fields["body"] ?? ""
        let payload = """
        {"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":null,"body":\(String(reflecting: body)),"attachments":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","filename":"clipboard.png","contentType":"image/png","byteSize":3,"url":"/attachment"}],"author":{"id":"fixture-user","name":"Briar User","image":null,"provider":null},"replyCount":0,"createdAt":"2026-08-05T01:00:00Z","updatedAt":"2026-08-05T01:00:00Z"},"agentReply":null}
        """
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private actor AgentReplyAPIRecorder: MobileAPIClientProtocol {
    private var methods: [String] = []

    func recordedMethods() -> [String] { methods }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        methods.append(method)
        let payload: String
        if method == "POST", path.hasSuffix("/messages") {
            payload = #"{"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":null,"body":"@Developer 확인해 줘","author":{"id":"fixture-user","name":"Briar User","image":null,"provider":null},"replyCount":0,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"},"agentReply":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","triggerMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","status":"queued","error":null}}"#
        } else if method == "GET", path.hasSuffix("/agent-reply") {
            payload = #"{"agentReply":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","triggerMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","parentMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agentName":"Developer","status":"completed","error":null},"message":{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","body":"확인했습니다.","author":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Developer","image":null,"provider":"codex"},"replyCount":0,"createdAt":"2026-08-02T01:01:00Z","updatedAt":"2026-08-02T01:01:00Z"}}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private struct MentionMessageBody: Decodable, Sendable {
    let body: String
    let mentionedUserIds: [String]
}

private actor MentionMessageAPIRecorder: MobileAPIClientProtocol {
    private var bodyObject: MentionMessageBody?

    func recordedBody() -> MentionMessageBody? { bodyObject }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        guard method == "POST", path.hasSuffix("/messages"), let body else {
            throw MobileAPIError.invalidRequest
        }
        let data = try JSONEncoder().encode(body)
        bodyObject = try JSONDecoder.mobileContract.decode(MentionMessageBody.self, from: data)
        let payload = #"{"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":null,"body":"@sam 확인해 줘","author":{"id":"fixture-user","name":"Briar User","image":null,"provider":null},"replyCount":0,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"},"agentReply":null}"#
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private actor MutationAPIRecorder: MobileAPIClientProtocol {
    private var count = 0
    private var paths: [String] = []
    private var methods: [String] = []
    private var recordedRequestID: String?
    private var recordedRequestIDs: [String] = []
    private var recordedJSONBodyData: Data?
    private let delay: Duration
    private var failuresRemaining: Int
    private var recordedResumeRequests: [(requestID: String, checkpointKey: String, attempt: Int, revision: Int)] = []

    init(delay: Duration = .zero, failuresRemaining: Int = 0) {
        self.delay = delay
        self.failuresRemaining = failuresRemaining
    }

    func requestCount() -> Int { count }

    func lastPath() -> String? { paths.last }

    func lastMethod() -> String? { methods.last }

    func lastRequestID() -> String? { recordedRequestID }

    func allRequestIDs() -> [String] { recordedRequestIDs }

    func lastJSONBodyData() -> Data? { recordedJSONBodyData }

    func resumeRequests() -> [(requestID: String, checkpointKey: String, attempt: Int, revision: Int)] {
        recordedResumeRequests
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        count += 1
        paths.append(path)
        methods.append(method)
        if let body {
            let data = try JSONEncoder.mobileContract.encode(TestAnyEncodable(body))
            recordedJSONBodyData = data
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw MobileAPIError.invalidRequest
            }
            recordedRequestID = object["requestId"] as? String
            if let recordedRequestID { recordedRequestIDs.append(recordedRequestID) }
            if path.hasSuffix("/resume"),
               let requestID = object["requestId"] as? String,
               let checkpointKey = object["checkpointKey"] as? String,
               let attempt = object["attempt"] as? Int,
               let revision = object["revision"] as? Int {
                recordedResumeRequests.append((requestID, checkpointKey, attempt, revision))
            }
        }
        if delay != .zero { try await Task.sleep(for: delay) }
        if failuresRemaining > 0 {
            failuresRemaining -= 1
            throw MobileAPIError.invalidRequest
        }
        let payload: String
        if path.hasSuffix("/subscription") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","subscribers":[{"userId":"fixture-user","subscribedAt":"2026-08-12T01:00:00.000Z"}]}"#
        } else if path.hasSuffix("/issues") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","sourceKey":"briar-issue:test","stage":"queued","status":"queued","difficulty":"normal","attachments":[],"createdByUserId":"fixture-user"}"#
        } else if path.hasSuffix("/status") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","outcome":"moved","status":"queued","workflowStage":null}"#
        } else if path.hasSuffix("/resume") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","outcome":"approved","workflowStage":"production_qa","startStage":"production_qa","checkpointKey":"user-before-production_qa","attempt":2,"revision":3,"terminalReviewOnly":false}"#
        } else if path.hasSuffix("/dispatch") || path.hasSuffix("/reassign") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","agentId":null,"provider":"codex","model":null,"effort":null,"requestedWorkerId":"worker-1","requestedByUserId":"fixture-user","dispatchMode":"specific","dispatchedAt":"2026-08-02T01:00:00.000Z","outcome":"dispatched"}"#
        } else if path.contains("/skill-execution-proposals/") && path.hasSuffix("/accept") {
            payload = #"{"outcome":"accepted","projectId":"11111111-1111-4111-8111-111111111111","proposal":{"id":"abababab-abab-4bab-8bab-abababababab","type":"request_agent_skill_execute","status":"accepted","projectId":"11111111-1111-4111-8111-111111111111","agentId":"66666666-6666-4666-8666-666666666666","agentName":"Project Agent","skillId":"77777777-7777-4777-8777-777777777777","skillName":"iOS 배포","request":"TestFlight에 최신 빌드를 배포해 줘","provider":"codex","model":"gpt-5.6-sol","effort":"high","createdAt":"2026-08-11T01:00:00.000Z","acceptedAt":"2026-08-11T01:01:00.000Z","requestedWorkerId":"worker-1","requestedWorkerLabel":"Build Mac","resultSessionId":"session-1","delegatedByAgentId":null,"delegatedByAgentName":null},"session":{"id":"session-1","projectId":"11111111-1111-4111-8111-111111111111","agentId":"66666666-6666-4666-8666-666666666666","agentName":"Project Agent","skillId":"77777777-7777-4777-8777-777777777777","sessionType":"task","trigger":"manual","request":"TestFlight에 최신 빌드를 배포해 줘","status":"running","issues":[],"startedAt":"2026-08-11T01:01:00.000Z","requestedWorkerId":"worker-1","workerId":"worker-1","updatedAt":"2026-08-11T01:01:00.000Z"}}"#
        } else if path.contains("/issue-execution-proposals/") && path.hasSuffix("/accept") {
            payload = #"{"proposal":{"id":"77777777-7777-4777-8777-777777777777","type":"request_issue_execute","status":"accepted","projectId":"11111111-1111-4111-8111-111111111111","runId":"33333333-3333-4333-8333-333333333333","title":"Fresh backlog","createdAt":"2026-08-11T01:00:00.000Z","acceptedAt":"2026-08-11T01:01:00.000Z","requestedProvider":"codex","requestedModel":null,"requestedEffort":"high","requestedWorkerId":null,"delegatedByAgentId":null,"delegatedByAgentName":null},"outcome":"accepted","projectId":"11111111-1111-4111-8111-111111111111","runId":"33333333-3333-4333-8333-333333333333","dispatch":{"runId":"33333333-3333-4333-8333-333333333333","agentId":null,"provider":"codex","model":null,"effort":"high","requestedWorkerId":null,"requestedByUserId":"fixture-user","dispatchMode":"any","dispatchedAt":"2026-08-11T01:01:00.000Z","outcome":"dispatched"}}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private struct TestAnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
