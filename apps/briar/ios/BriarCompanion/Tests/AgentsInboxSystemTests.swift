import BriarContracts
import BriarContractsMocks
import Connect
import SwiftProtobuf
import XCTest
import UIKit
import UserNotifications
@testable import BriarCompanion

final class AgentsInboxSystemTests: XCTestCase {
    func testNotificationSoundPreferenceDefaultsOnAndPersistsOff() throws {
        let suiteName = "AgentsInboxSystemTests.notification-sound.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let legacyPreferences = try JSONSerialization.data(withJSONObject: [
            "urgent": true,
            "action_required": false,
            "important": true,
            "activity": false,
        ])
        defaults.set(legacyPreferences, forKey: "briar.settings.inbox-notifications.v1")

        var preferences = InboxNotificationPreferences.load(defaults: defaults)
        XCTAssertTrue(preferences.playSound)

        preferences.playSound = false
        preferences.save(defaults: defaults)
        XCTAssertFalse(InboxNotificationPreferences.load(defaults: defaults).playSound)
    }

    @MainActor
    func testAppDelegateOwnsForegroundAndRemoteNotificationDelivery() {
        let delegate = InboxPushAppDelegate()

        XCTAssertTrue(delegate.application(UIApplication.shared, didFinishLaunchingWithOptions: nil))
        XCTAssertTrue(UNUserNotificationCenter.current().delegate === delegate)
    }

    @MainActor
    func testRemoteNotificationProtoTargetValidatesAndOpensDestination() throws {
        let projectID = try XCTUnwrap(
            UUID(uuidString: "22222222-2222-4222-8222-222222222222")
        )
        let runID = try XCTUnwrap(
            UUID(uuidString: "11111111-1111-4111-8111-111111111111")
        )
        var destination = BriarAPI_MobilePushConversationDestination()
        destination.conversationMessageID = "33333333-3333-4333-8333-333333333333"
        var wireTarget = BriarAPI_MobilePushNotificationTarget()
        wireTarget.inboxMessageID = "conversation:33333333-3333-4333-8333-333333333333"
        wireTarget.inboxMessageVersion = "33333333-3333-4333-8333-333333333333"
        wireTarget.notificationID = "conversation-thread:\(projectID):\(runID):root"
        wireTarget.projectID = projectID.uuidString.lowercased()
        wireTarget.targetID = runID.uuidString.lowercased()
        wireTarget.conversation = destination
        let target = try XCTUnwrap(RemotePushNotificationTarget.parse(userInfo: [
            "briarInboxTargetProto": try wireTarget.serializedData().base64EncodedString(),
        ]))

        let navigation = CompanionNavigationModel()
        navigation.openRemoteNotification(target)
        XCTAssertEqual(navigation.selectedTab, .tasks)
        XCTAssertEqual(navigation.pendingProjectID, projectID)
        XCTAssertEqual(navigation.pendingIssueID, runID)
        XCTAssertEqual(navigation.pendingIssueDetailTab, .conversation)

        wireTarget.projectID = "not-a-uuid"
        XCTAssertNil(RemotePushNotificationTarget.parse(userInfo: [
            "briarInboxTargetProto": try wireTarget.serializedData().base64EncodedString(),
        ]))

        wireTarget.projectID = projectID.uuidString.lowercased()
        wireTarget.targetID = "session-fixture-1"
        wireTarget.session = .init()
        let sessionTarget = try XCTUnwrap(RemotePushNotificationTarget.parse(userInfo: [
            "briarInboxTargetProto": try wireTarget.serializedData().base64EncodedString(),
        ]))
        XCTAssertEqual(sessionTarget.kind, .session)
        XCTAssertEqual(sessionTarget.targetId, "session-fixture-1")
    }

    @MainActor
    func testRemotePushRegistrationUsesGeneratedAccountService() async throws {
        let expectedEndpoint: BriarAPI_MobilePushEndpoint
        switch Bundle.main.object(forInfoDictionaryKey: "BriarAPNSEnvironment") as? String {
        case "development": expectedEndpoint = .apnsDevelopment
        case "production": expectedEndpoint = .apnsProduction
        default:
            return XCTFail("The test host must declare its APNs environment")
        }

        let tokenKey = "briar.remote-push-token.v1"
        let originalToken = UserDefaults.standard.object(forKey: tokenKey)
        defer {
            if let originalToken {
                UserDefaults.standard.set(originalToken, forKey: tokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: tokenKey)
            }
        }

        let recorder = MobilePushRequestRecorder()
        let account = BriarAPI_AccountServiceClientMock()
        account.mockAsyncRegisterMobilePushDevice = { request in
            recorder.record(request)
            return .init(result: .success(.init()))
        }
        account.mockAsyncUnregisterMobilePushDevice = { request in
            recorder.record(request)
            return .init(result: .success(.init()))
        }
        let service = RemotePushRegistrationService(accountService: account)
        RemotePushNotificationBridge.updateToken("apns-device-token")
        var preferences = InboxNotificationPreferences()
        preferences.playSound = false
        preferences.urgent = true
        preferences.important = true
        service.configure(
            sessionToken: "session-token",
            preferences: preferences,
            locale: .en
        )

        for _ in 0..<100 {
            if recorder.registration != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let registration = try XCTUnwrap(recorder.registration)
        XCTAssertEqual(registration.endpoint, expectedEndpoint)
        XCTAssertEqual(registration.token, "apns-device-token")
        XCTAssertEqual(registration.locale, .en)
        XCTAssertTrue(registration.hasPreferences)
        XCTAssertFalse(registration.preferences.playSound)
        XCTAssertTrue(registration.preferences.urgent)
        XCTAssertTrue(registration.preferences.important)

        await service.unregister(sessionToken: "session-token")
        let unregistration = try XCTUnwrap(recorder.unregistration)
        XCTAssertEqual(unregistration.endpoint, expectedEndpoint)
        XCTAssertEqual(unregistration.token, "apns-device-token")
    }

    @MainActor
    func testIssueConversationTrackerRefreshesOnlyTheVisibleIssue() async {
        let tracker = IssueConversationViewTracker()
        let visibleRunID = UUID()
        var refreshCount = 0

        tracker.view(runID: visibleRunID) {
            refreshCount += 1
        }
        await tracker.refreshChanges()
        XCTAssertEqual(tracker.runID, visibleRunID)
        XCTAssertEqual(refreshCount, 1)

        tracker.leave(runID: UUID())
        await tracker.refreshChanges()
        XCTAssertEqual(refreshCount, 2)

        tracker.leave(runID: visibleRunID)
        await tracker.refreshChanges()
        XCTAssertNil(tracker.runID)
        XCTAssertEqual(refreshCount, 2)
    }

    @MainActor
    func testIssueConversationTrackerRoutesOnlyMatchingProjectRealtimeChanges() async {
        let tracker = IssueConversationViewTracker()
        let visibleProjectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let visibleRunID = UUID()
        var refreshCount = 0

        tracker.view(projectID: visibleProjectID, runID: visibleRunID) {
            refreshCount += 1
        }

        await tracker.receiveRealtimeNotification(
            .projectChanged(
                projectID: "22222222-2222-4222-8222-222222222222",
                cursor: 2
            )
        )
        XCTAssertEqual(refreshCount, 0)

        await tracker.receiveRealtimeNotification(
            .projectChanged(
                projectID: visibleProjectID.uuidString.uppercased(),
                cursor: 3
            )
        )
        XCTAssertEqual(refreshCount, 1)

        await tracker.receiveRealtimeNotification(.ready)
        XCTAssertEqual(refreshCount, 2)
    }

    @MainActor
    func testDirectAgentTaskSendsTheExplicitSelectedSkill() async throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let skillID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let createdAt = Date(timeIntervalSince1970: 1_700_000_000)
        let skill = ProjectAgent.Skill(
            id: skillID,
            agentId: agentID,
            name: "iOS 릴리즈",
            instructions: "iOS 앱을 릴리즈합니다.",
            provider: .claude,
            model: "sonnet",
            effort: .high,
            kind: .custom,
            position: 1,
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let agent = ProjectAgent(
            id: agentID,
            projectId: projectID,
            name: "개발자 Agent",
            avatar: nil,
            codexPet: nil,
            provider: .codex,
            model: nil,
            effort: nil,
            description: "제품 개발 에이전트",
            responsibility: "제품 개발을 담당합니다.",
            skill: "legacy runtime profile",
            skills: [skill],
            calendarColor: "#3275d5",
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let services = AgentTestServices(projectID: projectID)
        let store = AgentsStore(
            agentService: services.agent,
            issueService: services.issue
        )
        store.select(projectID: projectID, token: "token", locale: "ko")

        let session = try await store.run(
            agent: agent,
            skill: skill,
            request: skill.instructions,
            workerID: "worker-claude"
        )
        XCTAssertEqual(session.agentId, agentID)
        XCTAssertEqual(session.request, skill.instructions)

        let directTaskRequests = await services.scenario.directTaskRequests()
        let taskRequest = try XCTUnwrap(directTaskRequests.first)
        XCTAssertEqual(taskRequest.agentID, agentID)
        XCTAssertEqual(taskRequest.skillID, skillID)
        XCTAssertEqual(taskRequest.request, skill.instructions)
        XCTAssertEqual(taskRequest.workerID, "worker-claude")
    }

    @MainActor
    func testApprovedSkillSessionMaterializesImmediatelyForTheSelectedProject() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let otherProjectID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let services = AgentTestServices(projectID: projectID)
        let store = AgentsStore(
            agentService: services.agent,
            issueService: services.issue
        )
        store.select(projectID: projectID, token: "token", locale: "ko")
        await services.scenario.waitForSessionListStarts(1)
        while store.isRefreshing {
            await Task.yield()
        }
        let session = ProjectAgentSession(
            id: "approved-session",
            projectId: projectID,
            dispatchGroupId: nil,
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            agentName: "Project Agent",
            skillId: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "iOS를 배포해 줘",
            status: .running,
            issues: [],
            startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            requestedWorkerId: "worker-1",
            workerId: "worker-1",
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        store.materialize(session)
        XCTAssertEqual(store.session(id: session.id), session)

        let otherSession = ProjectAgentSession(
            id: "other-session",
            projectId: otherProjectID,
            dispatchGroupId: nil,
            agentId: nil,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "다른 프로젝트",
            status: .running,
            issues: [],
            startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: nil
        )
        store.materialize(otherSession)
        XCTAssertNil(store.session(id: otherSession.id))
    }

    @MainActor
    func testMaterializedSessionSurvivesAStaleRefreshAndAcceptsNewerServerState() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let skillID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let startedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let materialized = ProjectAgentSession(
            id: "approved-session",
            projectId: projectID,
            dispatchGroupId: "approved-session",
            agentId: agentID,
            agentName: "Project Agent",
            skillId: skillID,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "iOS를 배포해 줘",
            status: .running,
            issues: [],
            startedAt: startedAt,
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: "/tmp/briar-local-workspace",
            requestedWorkerId: "worker-1",
            workerId: "worker-1",
            summary: nil,
            error: nil,
            events: [.init(id: "started", type: .started, occurredAt: startedAt)],
            updatedAt: startedAt
        )
        let completedAt = startedAt.addingTimeInterval(30)
        let completed = ProjectAgentSession(
            id: materialized.id,
            projectId: projectID,
            dispatchGroupId: materialized.dispatchGroupId,
            agentId: agentID,
            agentName: materialized.agentName,
            skillId: skillID,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: materialized.request,
            status: .completed,
            issues: [],
            startedAt: startedAt,
            completedAt: completedAt,
            conversationId: "conversation-1",
            workspaceRoot: nil,
            requestedWorkerId: "worker-1",
            workerId: "worker-1",
            summary: "배포 완료",
            error: nil,
            events: [
                .init(id: "started", type: .started, occurredAt: startedAt),
                .init(id: "completed", type: .completed, occurredAt: completedAt),
            ],
            updatedAt: completedAt
        )
        let services = AgentTestServices(
            projectID: projectID,
            sessionSnapshots: [[], [completed]],
            suspendFirstSessionList: true
        )
        let store = AgentsStore(
            agentService: services.agent,
            issueService: services.issue,
            pollInterval: .seconds(3_600)
        )
        store.select(projectID: projectID, token: "token", locale: "ko")
        await services.scenario.waitForSessionListStarts(1)

        store.materialize(materialized)
        await services.scenario.releaseSessionList()
        for _ in 0..<100 where store.isRefreshing {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertFalse(store.isRefreshing)
        XCTAssertEqual(store.session(id: materialized.id), materialized)

        await store.refresh()

        XCTAssertEqual(store.session(id: materialized.id)?.status, .completed)
        XCTAssertEqual(store.session(id: materialized.id)?.summary, "배포 완료")
        XCTAssertEqual(
            store.session(id: materialized.id)?.workspaceRoot,
            "/tmp/briar-local-workspace"
        )

        store.materialize(materialized)
        XCTAssertEqual(store.session(id: materialized.id)?.status, .completed)
        XCTAssertEqual(store.session(id: materialized.id)?.summary, "배포 완료")
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testDirectAgentTaskAllowsConcurrentRunsForTheSameAgent() async throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let skillID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let createdAt = Date(timeIntervalSince1970: 1_700_000_000)
        let skill = ProjectAgent.Skill(
            id: skillID,
            agentId: agentID,
            name: "iOS 릴리즈",
            instructions: "iOS 앱을 릴리즈합니다.",
            provider: .claude,
            model: "sonnet",
            effort: .high,
            kind: .custom,
            position: 1,
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let agent = ProjectAgent(
            id: agentID,
            projectId: projectID,
            name: "개발자 Agent",
            avatar: nil,
            codexPet: nil,
            provider: .codex,
            model: nil,
            effort: nil,
            description: "제품 개발 에이전트",
            responsibility: "제품 개발을 담당합니다.",
            skill: "legacy runtime profile",
            skills: [skill],
            calendarColor: "#3275d5",
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let services = AgentTestServices(projectID: projectID, suspendDirectTasks: true)
        let store = AgentsStore(
            agentService: services.agent,
            issueService: services.issue
        )
        store.select(projectID: projectID, token: "token", locale: "ko")

        let firstRun = Task {
            try await store.run(
                agent: agent,
                skill: skill,
                request: skill.instructions,
                workerID: "worker-claude"
            )
        }
        await services.scenario.waitForDirectTaskStarts(1)
        XCTAssertTrue(store.executingAgentIDs.contains(agentID))

        let secondRun = Task {
            try await store.run(
                agent: agent,
                skill: skill,
                request: skill.instructions,
                workerID: "worker-claude"
            )
        }
        await services.scenario.waitForDirectTaskStarts(2)

        let requests = await services.scenario.directTaskRequests()
        XCTAssertEqual(requests.count, 2)
        let requestIDs = requests.map(\.requestID)
        XCTAssertEqual(Set(requestIDs).count, 2)

        await services.scenario.releaseDirectTask()
        _ = try await firstRun.value
        XCTAssertTrue(store.executingAgentIDs.contains(agentID))

        await services.scenario.releaseDirectTask()
        _ = try await secondRun.value
        XCTAssertFalse(store.executingAgentIDs.contains(agentID))
        XCTAssertEqual(store.sessions.count, 2)
    }

    @MainActor
    func testSelectQueuedRunsMatchesSharedAgentDispatchRules() {
        let readyOld = DashboardRun(
            id: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            runNumber: 1,
            sourceKey: "briar-issue:old",
            sourceCreatedAt: Date(timeIntervalSince1970: 100),
            title: "긴급 준비 이슈",
            status: .queued,
            priority: 1,
            executionReadiness: "ready",
            updatedAt: Date(timeIntervalSince1970: 1_000)
        )
        let readyNew = DashboardRun(
            id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            runNumber: 2,
            sourceKey: "briar-issue:new",
            sourceCreatedAt: Date(timeIntervalSince1970: 200),
            title: "두 번째 준비 이슈",
            status: .queued,
            priority: 1,
            executionReadiness: "ready",
            updatedAt: Date(timeIntervalSince1970: 900)
        )
        let readyByPrerequisite = DashboardRun(
            id: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            runNumber: 3,
            sourceKey: "briar-issue:fallback",
            title: "선행 조건 완료 이슈",
            status: .queued,
            priority: 2,
            prerequisites: [IssueDependencyReference(
                id: readyOld.id,
                runNumber: 1,
                title: readyOld.title,
                status: .completed
            )],
            startedAt: Date(timeIntervalSince1970: 300),
            updatedAt: Date(timeIntervalSince1970: 10)
        )
        let readyButAfterLimit = DashboardRun(
            id: UUID(uuidString: "dddddddd-dddd-4ddd-8ddd-dddddddddddd")!,
            runNumber: 4,
            sourceKey: "briar-issue:fourth",
            sourceCreatedAt: Date(timeIntervalSince1970: 400),
            title: "네 번째 준비 이슈",
            status: .queued,
            priority: 2,
            executionReadiness: "ready",
            updatedAt: Date(timeIntervalSince1970: 400)
        )
        let waiting = DashboardRun(
            id: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
            runNumber: 5,
            title: "선행 조건 대기 이슈",
            status: .queued,
            executionReadiness: "waiting",
            waitingOnPrerequisiteCount: 1,
            updatedAt: Date(timeIntervalSince1970: 1)
        )
        let incompleteFallback = DashboardRun(
            id: UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")!,
            runNumber: 6,
            title: "미완료 선행 조건 이슈",
            status: .queued,
            prerequisites: [IssueDependencyReference(
                id: readyNew.id,
                runNumber: 2,
                title: readyNew.title,
                status: .running
            )],
            updatedAt: Date(timeIntervalSince1970: 2)
        )
        let unknownReadiness = DashboardRun(
            id: UUID(uuidString: "12121212-1212-4121-8121-121212121212")!,
            runNumber: 7,
            title: "알 수 없는 준비 상태",
            status: .queued,
            executionReadiness: "unknown",
            updatedAt: Date(timeIntervalSince1970: 1)
        )

        let selected = AgentsStore.selectQueuedRuns(
            [
                readyButAfterLimit,
                incompleteFallback,
                readyNew,
                waiting,
                readyByPrerequisite,
                readyOld,
                unknownReadiness,
            ],
            maxIssues: 3
        )

        XCTAssertEqual(selected.map { $0.runNumber }, [1, 2, 3].map(Optional.some))
    }

    @MainActor
    func testRunningAgentDispatchesReadyIssuesWithAgentConfiguration() async throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let skillID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let services = AgentTestServices(projectID: projectID)
        let store = AgentsStore(
            agentService: services.agent,
            issueService: services.issue
        )
        store.select(projectID: projectID, token: "token", locale: "ko")
        await store.refresh()

        let agent = ProjectAgent(
            id: agentID,
            projectId: projectID,
            name: "처리 Agent",
            avatar: nil,
            codexPet: nil,
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .high,
            description: "이슈 처리 에이전트",
            responsibility: "queued 이슈를 처리합니다.",
            skill: "skill",
            skills: [ProjectAgent.Skill(
                id: skillID,
                agentId: agentID,
                name: "이슈 처리",
                instructions: "queued 이슈를 처리합니다.",
                provider: .codex,
                model: "gpt-5.6-sol",
                effort: .high,
                kind: .issueProcessing,
                position: 0,
                createdAt: Date(timeIntervalSince1970: 1_700_000_000),
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )],
            calendarColor: "#22c55e",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let run = DashboardRun(
            id: runID,
            runNumber: 7,
            sourceKey: "briar-issue:test",
            title: "처리할 이슈",
            status: .queued,
            priority: 1,
            executionReadiness: "ready",
            preferredProvider: .claude,
            preferredModel: "opus",
            preferredEffort: .medium,
            startedAt: Date(timeIntervalSince1970: 1_700_000_001),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_001)
        )

        let dispatchID = try await store.run(agent: agent, runs: [run], maxIssues: 1)
        XCTAssertFalse(dispatchID.isEmpty)

        let requests = await services.scenario.dispatchRequests()
        let dispatch = try XCTUnwrap(requests.first { $0.runID == runID })
        XCTAssertEqual(UUID(uuidString: dispatch.dispatch.agentID), agentID)
        XCTAssertEqual(dispatch.dispatch.provider, .claude)
        XCTAssertEqual(dispatch.dispatch.model, "opus")
        XCTAssertEqual(dispatch.dispatch.effort, "medium")
        XCTAssertTrue(dispatch.dispatch.persistPreferences)
        XCTAssertFalse(dispatch.dispatch.hasWorkerID)
        let putSessionRequestCount = await services.scenario.putSessionRequestCount()
        XCTAssertEqual(putSessionRequestCount, 1)
    }

    func testParsesDeepLinksAndUniversalLinks() {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let trustedOrigin = URL(string: "https://briar-api.wbai.workers.dev")!

        XCTAssertEqual(
            BriarLinkParser.parse("briar-companion://issues/\(projectID.uuidString)/\(runID.uuidString)"),
            .issue(projectID: projectID, runID: runID)
        )
        XCTAssertEqual(
            BriarLinkParser.parse(
                "https://briar-api.wbai.workers.dev/open/issues/\(projectID.uuidString)/\(runID.uuidString)",
                trustedOrigin: trustedOrigin
            ),
            .issue(projectID: projectID, runID: runID)
        )
        XCTAssertNil(
            BriarLinkParser.parse(
                "https://attacker.example/open/issues/\(projectID.uuidString)/\(runID.uuidString)",
                trustedOrigin: trustedOrigin
            )
        )
        XCTAssertEqual(
            BriarLinkParser.parse("briar-companion://sessions/\(projectID.uuidString)/session-1"),
            .session(projectID: projectID, sessionID: "session-1")
        )
        XCTAssertEqual(
            BriarLinkParser.parse(
                "https://briar-api.wbai.workers.dev/open/sessions/\(projectID.uuidString)/session-1",
                trustedOrigin: trustedOrigin
            ),
            .session(projectID: projectID, sessionID: "session-1")
        )
        let organizationID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        let channelID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        let messageID = UUID(uuidString: "66666666-6666-4666-8666-666666666666")!
        let rootMessageID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
        XCTAssertEqual(
            BriarLinkParser.parse(
                "briar-companion://channels/\(organizationID.uuidString)/\(channelID.uuidString)/\(messageID.uuidString)?root=\(rootMessageID.uuidString)"
            ),
            .channel(
                organizationID: organizationID,
                channelID: channelID,
                messageID: messageID,
                rootMessageID: rootMessageID
            )
        )
        XCTAssertEqual(
            BriarLinkParser.parse(
                "https://briar-api.wbai.workers.dev/open/channels/\(organizationID.uuidString)/\(channelID.uuidString)/\(messageID.uuidString)",
                trustedOrigin: trustedOrigin
            ),
            .channel(
                organizationID: organizationID,
                channelID: channelID,
                messageID: messageID,
                rootMessageID: messageID
            )
        )
        XCTAssertNil(BriarLinkParser.parse("briar-companion://auth-complete"))
    }

    @MainActor
    func testInAppIssueURLUsesTrustedParserAndNavigationModel() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let navigation = CompanionNavigationModel()
        let trustedOrigin = try XCTUnwrap(URL(string: "https://briar-api.wbai.workers.dev"))
        let trustedURL = try XCTUnwrap(URL(string:
            "https://briar-api.wbai.workers.dev/open/issues/\(projectID.uuidString)/\(runID.uuidString)"
        ))

        XCTAssertEqual(
            navigation.open(trustedURL, trustedOrigin: trustedOrigin),
            .issue(projectID: projectID, runID: runID)
        )
        XCTAssertEqual(navigation.selectedTab, .tasks)
        XCTAssertEqual(navigation.pendingProjectID, projectID)
        XCTAssertEqual(navigation.pendingIssueID, runID)

        let untrustedURL = try XCTUnwrap(URL(string:
            "https://attacker.example/open/issues/\(projectID.uuidString)/\(runID.uuidString)"
        ))
        XCTAssertNil(navigation.open(untrustedURL, trustedOrigin: trustedOrigin))
        navigation.failPendingNavigation("요청한 이슈가 없습니다.")
        XCTAssertNil(navigation.pendingProjectID)
        XCTAssertNil(navigation.pendingIssueID)
        XCTAssertFalse(navigation.preparingIssue)
        XCTAssertEqual(navigation.linkErrorMessage, "요청한 이슈가 없습니다.")
    }

    @MainActor
    func testPreparedIssueWaitsForAvailabilityBeforeItCanBeConsumed() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let navigation = CompanionNavigationModel()
        var resumeAvailability: ((Bool) -> Void)?
        let preparation = Task {
            await navigation.openIssueWhenAvailable(
                projectID: projectID,
                runID: runID,
                ensureAvailable: { _, _ in
                    await withCheckedContinuation { continuation in
                        resumeAvailability = { continuation.resume(returning: $0) }
                    }
                },
                sourceIsCurrent: { true }
            )
        }
        while resumeAvailability == nil { await Task.yield() }

        XCTAssertTrue(navigation.preparingIssue)
        XCTAssertNil(navigation.pendingIssueID)
        resumeAvailability?(true)
        let prepared = await preparation.value
        XCTAssertTrue(prepared)
        XCTAssertEqual(navigation.pendingProjectID, projectID)
        XCTAssertEqual(navigation.pendingIssueID, runID)
        let token = navigation.pathIssueToken
        XCTAssertNil(navigation.consumePendingIssue(
            projectID: projectID,
            runID: runID,
            pathToken: token &+ 1
        ))
        XCTAssertEqual(navigation.consumePendingIssue(
            projectID: projectID,
            runID: runID,
            pathToken: token
        ), runID)
    }

    @MainActor
    func testStalePreparedIssueCannotNavigateAfterItsSourceLeaves() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let navigation = CompanionNavigationModel()
        var sourceIsCurrent = true
        var resumeAvailability: ((Bool) -> Void)?
        let preparation = Task {
            await navigation.openIssueWhenAvailable(
                projectID: projectID,
                runID: runID,
                ensureAvailable: { _, _ in
                    await withCheckedContinuation { continuation in
                        resumeAvailability = { continuation.resume(returning: $0) }
                    }
                },
                sourceIsCurrent: { sourceIsCurrent }
            )
        }
        while resumeAvailability == nil { await Task.yield() }

        sourceIsCurrent = false
        resumeAvailability?(true)
        let prepared = await preparation.value
        XCTAssertFalse(prepared)
        XCTAssertFalse(navigation.preparingIssue)
        XCTAssertNil(navigation.pendingProjectID)
        XCTAssertNil(navigation.pendingIssueID)
    }

    @MainActor
    func testInboxClassificationAndReadState() async throws {
        let project = Project(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            name: "Briar",
            issueKeyPrefix: "WB",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let blocked = DashboardRun(
            id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            runNumber: 1321,
            title: "Needs help",
            status: .blocked,
            priority: 1,
            structuredResult: StructuredRunResult(
                summary: "Blocked",
                outcome: "blocked",
                importance: "critical",
                urgency: "immediate",
                impact: "issue",
                humanActionRequired: true,
                nextAction: "Review",
                dueAt: nil
            ),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
        let completed = DashboardRun(
            id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
            title: "Done",
            status: .completed,
            priority: 3,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_050)
        )
        let running = DashboardRun(
            id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            title: "Working",
            status: .running,
            priority: 3,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_090)
        )
        let snapshot = DashboardSnapshot(
            project: project,
            runs: [blocked, running, completed],
            conversationNotifications: [
                ConversationNotification(
                    id: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
                    runId: blocked.id,
                    runTitle: blocked.title,
                    rootMessageId: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
                    body: "@you please look\n\nSecond line\nThird line\nFourth line",
                    author: IssueMessage.Author(
                        id: "u1",
                        name: "Alex",
                        image: "https://example.com/alex.png",
                        provider: nil
                    ),
                    reason: "mention",
                    createdAt: Date(timeIntervalSince1970: 1_700_000_120)
                ),
            ],
            channelNotifications: [
                ChannelNotification(
                    id: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
                    channelId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
                    channelName: "product",
                    rootMessageId: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
                    body: "Thread reply",
                    author: IssueMessage.Author(
                        id: "u2",
                        name: "Taylor",
                        image: "https://example.com/taylor.png",
                        provider: nil
                    ),
                    reason: "subscription",
                    createdAt: Date(timeIntervalSince1970: 1_700_000_125)
                ),
            ],
            cursor: 1,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_130)
        )
        let session = ProjectAgentSession(
            id: "session-1",
            projectId: project.id,
            dispatchGroupId: "d1",
            agentId: nil,
            agentName: "Review Agent",
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "Run work",
            status: .failed,
            issues: [],
            startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            completedAt: Date(timeIntervalSince1970: 1_700_000_080),
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: "First line\n\nSecond line\nThird line\nFourth line",
            events: [
                .init(id: "e1", type: .failed, occurredAt: Date(timeIntervalSince1970: 1_700_000_080)),
            ],
            updatedAt: Date(timeIntervalSince1970: 1_700_000_080),
            requestedByUserId: "u1"
        )

        let messages = InboxMessageBuilder.build(
            snapshot: snapshot,
            sessions: [session],
            project: project,
            currentUserID: "u1"
        )
        XCTAssertEqual(messages.count, 5)
        // In-progress issues never surface as a message; only decision and
        // terminal states do.
        XCTAssertFalse(messages.contains { $0.title == "Working" })
        // Newest first: channel reply (125) > mention (120) > blocked issue (100) > failed session (80) > completed (50)
        XCTAssertEqual(messages.map(\.occurredAt), messages.map(\.occurredAt).sorted(by: >))
        XCTAssertEqual(messages.map(\.kind), [.channel, .conversation, .issue, .session, .issue])
        XCTAssertEqual(messages.map(\.title)[2], "Needs help")
        XCTAssertEqual(messages.map(\.title)[4], "Done")

        let blockedMessage = try XCTUnwrap(
            messages.first { $0.kind == .issue && $0.title == "Needs help" }
        )
        XCTAssertEqual(InboxMessageBuilder.classify(blockedMessage), .urgent)
        XCTAssertEqual(
            InboxNotificationPresentationBuilder.content(for: blockedMessage).title,
            "Briar · 차단"
        )
        let mention = try XCTUnwrap(messages.first { $0.kind == .conversation })
        XCTAssertEqual(InboxMessageBuilder.classify(mention), .actionRequired)
        XCTAssertEqual(mention.authorImage, "https://example.com/alex.png")
        // This reply also contains a mention. The message hierarchy, not the
        // reason label, controls the reply-specific system notification.
        XCTAssertEqual(
            InboxNotificationPresentationBuilder.content(for: mention),
            InboxNotificationPresentation(
                title: "Alex in WB-1321",
                body: "@you please look\nSecond line\nThird line"
            )
        )
        let issueConversationID = try XCTUnwrap(UUID(uuidString: mention.targetId))
        XCTAssertFalse(
            LocalNotificationService.shouldDeliver(
                mention,
                viewingChannelID: nil,
                viewingIssueConversationID: issueConversationID
            )
        )
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                mention,
                viewingChannelID: nil,
                viewingIssueConversationID: UUID()
            )
        )
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                blockedMessage,
                viewingChannelID: nil,
                viewingIssueConversationID: issueConversationID
            )
        )
        let issueNavigation = CompanionNavigationModel()
        issueNavigation.openInboxMessage(mention)
        XCTAssertEqual(issueNavigation.selectedTab, .tasks)
        XCTAssertEqual(issueNavigation.pendingIssueID, blocked.id)
        XCTAssertEqual(issueNavigation.pendingIssueDetailTab, .conversation)
        let issueRoute = issueNavigation.consumePendingIssueNavigation(
            projectID: project.id,
            runID: blocked.id,
            pathToken: issueNavigation.pathIssueToken
        )
        XCTAssertEqual(issueRoute?.runID, blocked.id)
        XCTAssertEqual(issueRoute?.initialTab, .conversation)
        let channelReply = try XCTUnwrap(messages.first { $0.kind == .channel })
        XCTAssertEqual(InboxMessageBuilder.classify(channelReply), .actionRequired)
        XCTAssertEqual(channelReply.authorName, "Taylor")
        XCTAssertEqual(channelReply.authorImage, "https://example.com/taylor.png")
        XCTAssertEqual(
            InboxNotificationPresentationBuilder.content(for: channelReply),
            InboxNotificationPresentation(title: "Taylor in #product", body: "Thread reply")
        )
        let channelID = try XCTUnwrap(UUID(uuidString: channelReply.targetId))
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                channelReply,
                viewingChannelID: channelID
            )
        )
        XCTAssertFalse(
            LocalNotificationService.shouldDeliver(
                channelReply,
                viewingChannelID: channelID,
                viewingChannelThreadID: channelReply.rootMessageId
            )
        )
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                channelReply,
                viewingChannelID: channelID,
                viewingChannelThreadID: UUID()
            )
        )
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                blockedMessage,
                viewingChannelID: channelID
            )
        )
        let navigation = CompanionNavigationModel()
        navigation.openInboxMessage(channelReply)
        XCTAssertEqual(navigation.selectedTab, .home)
        XCTAssertEqual(navigation.pendingChannelID, UUID(uuidString: channelReply.targetId))
        XCTAssertEqual(navigation.pendingChannelMessageID, channelReply.channelMessageId)
        XCTAssertEqual(navigation.pendingChannelRootMessageID, channelReply.rootMessageId)
        let pending = try XCTUnwrap(navigation.consumePendingChannel())
        let threadRoute = ChannelInboxNavigation.threadRoute(
            isDirectMessage: false,
            channelID: pending.channelID,
            messageID: pending.messageID,
            rootMessageID: pending.rootMessageID
        )
        XCTAssertEqual(threadRoute?.parentMessageID, channelReply.rootMessageId)
        XCTAssertEqual(threadRoute?.highlightMessageID, channelReply.channelMessageId)
        XCTAssertNil(
            ChannelInboxNavigation.threadRoute(
                isDirectMessage: true,
                channelID: pending.channelID,
                messageID: pending.messageID,
                rootMessageID: pending.rootMessageID
            )
        )
        XCTAssertNil(
            ChannelInboxNavigation.threadRoute(
                isDirectMessage: false,
                channelID: pending.channelID,
                messageID: pending.rootMessageID,
                rootMessageID: pending.rootMessageID
            )
        )
        let failedSession = try XCTUnwrap(messages.first { $0.kind == .session })
        XCTAssertEqual(InboxMessageBuilder.classify(failedSession), .actionRequired)
        XCTAssertEqual(
            InboxNotificationPresentationBuilder.content(for: failedSession),
            InboxNotificationPresentation(
                title: "Review Agent · 실패",
                body: "First line\nSecond line\nThird line"
            )
        )

        let completedMessage = try XCTUnwrap(
            messages.first { $0.kind == .issue && $0.title == "Done" }
        )
        XCTAssertEqual(
            InboxNotificationPresentationBuilder.content(for: completedMessage).title,
            "Briar · 완료"
        )

        // Importance filter keeps chronological order and drops excluded categories.
        XCTAssertEqual(
            InboxMessageBuilder.filter(messages, to: [.urgent]).map(\.title),
            ["Needs help"]
        )
        XCTAssertEqual(
            InboxMessageBuilder.filter(messages, to: [.urgent, .actionRequired]).count,
            4
        )
        XCTAssertEqual(
            InboxMessageBuilder.filter(messages, to: [.activity]).map(\.title),
            ["Done"]
        )
        XCTAssertEqual(
            InboxMessageBuilder.filter(messages, to: Set(InboxCategory.allCases)).map(\.id),
            messages.map(\.id)
        )
        XCTAssertTrue(InboxMessageBuilder.filter(messages, to: []).isEmpty)

        await MainActor.run {
            let suiteName = "AgentsInboxSystemTests.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suiteName)!
            defer { defaults.removePersistentDomain(forName: suiteName) }
            let store = InboxStore(defaults: defaults)
            store.configure(token: nil, userID: "u1")
            store.update(snapshot: snapshot, sessions: [session], project: project)
            XCTAssertEqual(store.unreadCount, 4)
            // Store keeps a single chronological list for the mobile feed.
            XCTAssertEqual(store.messages.map(\.id), messages.map(\.id))
            XCTAssertEqual(store.messages(in: .urgent).count, 1)
            XCTAssertEqual(store.messages(in: .actionRequired).count, 3)
            store.markIssueRead(runID: blocked.id)
            XCTAssertEqual(store.unreadCount, 2)
            XCTAssertFalse(
                store.messages.contains {
                    $0.targetId == blocked.id.uuidString.lowercased() && $0.isUnread
                }
            )
            XCTAssertTrue(store.messages.first { $0.kind == .channel }?.isUnread == true)
            store.markAllRead()
            XCTAssertEqual(store.unreadCount, 0)

            // Account-scoped local cache survives store recreation for the same user.
            let restored = InboxStore(defaults: defaults)
            restored.configure(token: nil, userID: "u1")
            restored.update(snapshot: snapshot, sessions: [session], project: project)
            XCTAssertEqual(restored.unreadCount, 0)
        }
    }

    func testInboxCollapsesThreadRepliesAtTheOldestUnreadMessage() async throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        let rootID = UUID(uuidString: "88888888-8888-4888-8888-888888888888")!
        let firstID = UUID(uuidString: "99999999-9999-4999-8999-999999999991")!
        let secondID = UUID(uuidString: "99999999-9999-4999-8999-999999999992")!
        let first = InboxMessage(
            id: "conversation:\(firstID.uuidString.lowercased())",
            kind: .conversation,
            projectId: projectID,
            projectName: "Briar",
            targetId: runID.uuidString.lowercased(),
            title: "Grouped thread",
            occurredAt: Date(timeIntervalSince1970: 1_700_000_100),
            version: firstID.uuidString.lowercased(),
            body: "Oldest unread reply",
            authorName: "First member",
            statusLabel: "답글",
            requiresAttention: true,
            priority: nil,
            structuredResult: nil,
            reason: "thread_reply",
            rootMessageId: rootID,
            conversationMessageId: firstID
        )
        let second = InboxMessage(
            id: "conversation:\(secondID.uuidString.lowercased())",
            kind: .conversation,
            projectId: projectID,
            projectName: "Briar",
            targetId: runID.uuidString.lowercased(),
            title: "Grouped thread",
            occurredAt: Date(timeIntervalSince1970: 1_700_000_200),
            version: secondID.uuidString.lowercased(),
            body: "Newest unread reply",
            authorName: "Second member",
            statusLabel: "답글",
            requiresAttention: true,
            priority: nil,
            structuredResult: nil,
            reason: "thread_reply",
            rootMessageId: rootID,
            conversationMessageId: secondID
        )

        let groupedMessages = InboxMessageBuilder.collapseThreads([second, first])
        XCTAssertEqual(groupedMessages.count, 1)
        let grouped = try XCTUnwrap(groupedMessages.first)

        XCTAssertEqual(grouped.id, first.id)
        XCTAssertEqual(grouped.conversationMessageId, firstID)
        XCTAssertEqual(grouped.body, "Oldest unread reply")
        XCTAssertEqual(grouped.occurredAt, second.occurredAt)
        XCTAssertEqual(grouped.version, second.version)
        XCTAssertEqual(grouped.threadMessageCount, 2)
        XCTAssertEqual(grouped.threadUnreadCount, 2)
        XCTAssertEqual(grouped.groupedReadVersions, [
            first.id: first.version,
            second.id: second.version,
        ])

        var readFirst = first
        readFirst.isUnread = false
        let next = try XCTUnwrap(
            InboxMessageBuilder.collapseThreads([readFirst, second]).first
        )
        XCTAssertEqual(next.id, second.id)
        XCTAssertEqual(next.conversationMessageId, secondID)
        XCTAssertEqual(next.threadUnreadCount, 1)

        let project = Project(
            id: projectID,
            name: "Briar",
            issueKeyPrefix: "BR",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let run = DashboardRun(
            id: runID,
            title: "Grouped thread",
            status: .running,
            subscribers: [
                IssueSubscriber(userId: "u1", subscribedAt: Date(timeIntervalSince1970: 1_700_000_000)),
            ],
            updatedAt: Date(timeIntervalSince1970: 1_700_000_200)
        )
        let snapshot = DashboardSnapshot(
            project: project,
            runs: [run],
            conversationNotifications: [
                ConversationNotification(
                    id: firstID,
                    runId: runID,
                    runTitle: run.title,
                    rootMessageId: rootID,
                    body: "Oldest unread reply",
                    author: IssueMessage.Author(
                        id: "member-1",
                        name: "First member",
                        image: nil,
                        provider: nil
                    ),
                    reason: "thread_reply",
                    createdAt: first.occurredAt
                ),
                ConversationNotification(
                    id: secondID,
                    runId: runID,
                    runTitle: run.title,
                    rootMessageId: rootID,
                    body: "Newest unread reply",
                    author: IssueMessage.Author(
                        id: "member-2",
                        name: "Second member",
                        image: nil,
                        provider: nil
                    ),
                    reason: "thread_reply",
                    createdAt: second.occurredAt
                ),
            ],
            cursor: 1,
            generatedAt: second.occurredAt
        )

        await MainActor.run {
            let suiteName = "AgentsInboxThreadGroupingTests.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suiteName)!
            defer { defaults.removePersistentDomain(forName: suiteName) }
            let store = InboxStore(defaults: defaults)
            store.configure(token: nil, userID: "u1")
            store.update(snapshot: snapshot, sessions: [], project: project)

            XCTAssertEqual(store.messages.count, 1)
            XCTAssertEqual(store.unreadCount, 1)
            XCTAssertEqual(store.messages.first?.conversationMessageId, firstID)

            store.markRead(id: first.id)

            XCTAssertEqual(store.messages.count, 1)
            XCTAssertEqual(store.unreadCount, 0)
            XCTAssertFalse(store.messages.first?.isUnread ?? true)
            XCTAssertEqual(store.messages.first?.conversationMessageId, secondID)
        }
    }

    func testInboxSessionMessagesAreLimitedToTheCurrentRequester() {
        let project = Project(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            name: "Briar",
            issueKeyPrefix: "AH",
            scheduleTabEnabled: true,
            icon: nil,
            organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let completedAt = Date(timeIntervalSince1970: 1_700_000_080)
        func terminalSession(id: String, requester: String?) -> ProjectAgentSession {
            ProjectAgentSession(
                id: id,
                projectId: project.id,
                dispatchGroupId: id,
                agentId: nil,
                sessionType: .task,
                trigger: .manual,
                scheduleId: nil,
                scheduleRunId: nil,
                parentSessionId: nil,
                request: "Private result",
                status: .failed,
                issues: [],
                startedAt: completedAt.addingTimeInterval(-60),
                completedAt: completedAt,
                conversationId: nil,
                workspaceRoot: nil,
                summary: nil,
                error: "Runner stopped",
                events: [.init(id: "\(id)-failed", type: .failed, occurredAt: completedAt)],
                updatedAt: completedAt,
                requestedByUserId: requester
            )
        }
        let sessions = [
            terminalSession(id: "owned-by-a", requester: "user-a"),
            terminalSession(id: "owned-by-b", requester: "user-b"),
            terminalSession(id: "legacy-unknown", requester: nil),
        ]

        let userA = InboxMessageBuilder.build(
            snapshot: nil,
            sessions: sessions,
            project: project,
            currentUserID: "user-a"
        )
        let userB = InboxMessageBuilder.build(
            snapshot: nil,
            sessions: sessions,
            project: project,
            currentUserID: "user-b"
        )

        XCTAssertEqual(userA.map(\.id), ["session:owned-by-a"])
        XCTAssertEqual(userB.map(\.id), ["session:owned-by-b"])
        XCTAssertTrue(userA.first?.requiresAttention == true)
    }

    func testCollapseLinkedSessionsHidesParentsWithChildren() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let parent = ProjectAgentSession(
            id: "parent",
            projectId: projectID,
            dispatchGroupId: "d1",
            agentId: nil,
            sessionType: .dispatch,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "parent",
            status: .completed,
            issues: [],
            startedAt: Date(),
            completedAt: Date(),
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: Date()
        )
        let child = ProjectAgentSession(
            id: "child",
            projectId: projectID,
            dispatchGroupId: "d1",
            agentId: nil,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: "parent",
            request: "child",
            status: .completed,
            issues: [],
            startedAt: Date(),
            completedAt: Date(),
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: Date()
        )
        let collapsed = await MainActor.run {
            AgentsStore.collapseLinked([parent, child])
        }
        XCTAssertEqual(collapsed.map(\.id), ["child"])
    }
}

private final class MobilePushRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var registrations: [BriarAPI_RegisterMobilePushDeviceRequest] = []
    private var unregistrations: [BriarAPI_UnregisterMobilePushDeviceRequest] = []

    var registration: BriarAPI_RegisterMobilePushDeviceRequest? {
        lock.withLock { registrations.last }
    }

    var unregistration: BriarAPI_UnregisterMobilePushDeviceRequest? {
        lock.withLock { unregistrations.last }
    }

    func record(_ request: BriarAPI_RegisterMobilePushDeviceRequest) {
        lock.withLock { registrations.append(request) }
    }

    func record(_ request: BriarAPI_UnregisterMobilePushDeviceRequest) {
        lock.withLock { unregistrations.append(request) }
    }
}

private final class AgentTestServices: @unchecked Sendable {
    let scenario: AgentExecutionScenario
    let agent: BriarAPI_AgentServiceClientMock
    let issue: BriarAPI_IssueServiceClientMock

    init(
        projectID: UUID,
        suspendDirectTasks: Bool = false,
        sessionSnapshots: [[ProjectAgentSession]] = [[]],
        suspendFirstSessionList: Bool = false
    ) {
        let scenario = AgentExecutionScenario(
            projectID: projectID,
            suspendDirectTasks: suspendDirectTasks,
            sessionSnapshots: sessionSnapshots,
            suspendFirstSessionList: suspendFirstSessionList
        )
        self.scenario = scenario
        agent = AgentServiceScenarioMock(scenario: scenario)
        issue = IssueServiceScenarioMock(scenario: scenario)
    }
}

private final class AgentServiceScenarioMock: BriarAPI_AgentServiceClientMock,
    @unchecked Sendable
{
    private let scenario: AgentExecutionScenario

    init(scenario: AgentExecutionScenario) {
        self.scenario = scenario
        super.init()
    }

    override func listProjectAgents(
        request: BriarAPI_ListProjectAgentsRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_ListProjectAgentsResponse> {
        .init(result: .success(await scenario.listProjectAgents(request)))
    }

    override func listProjectAgentSessions(
        request: BriarAPI_ListProjectAgentSessionsRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_ListProjectAgentSessionsResponse> {
        .init(result: .success(await scenario.listProjectAgentSessions(request)))
    }

    override func putProjectAgentSession(
        request: BriarAPI_PutProjectAgentSessionRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_PutProjectAgentSessionResponse> {
        .init(result: .success(await scenario.putProjectAgentSession(request)))
    }

    override func runProjectAgentTask(
        request: BriarAPI_RunProjectAgentTaskRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_RunProjectAgentTaskResponse> {
        .init(result: .success(await scenario.runProjectAgentTask(request)))
    }
}

private final class IssueServiceScenarioMock: BriarAPI_IssueServiceClientMock,
    @unchecked Sendable
{
    private let scenario: AgentExecutionScenario

    init(scenario: AgentExecutionScenario) {
        self.scenario = scenario
        super.init()
    }

    override func dispatchRun(
        request: BriarAPI_DispatchRunRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_DispatchRunResponse> {
        .init(result: .success(await scenario.dispatchRun(request)))
    }

    override func reassignRun(
        request: BriarAPI_ReassignRunRequest,
        headers: Connect.Headers = [:]
    ) async -> ResponseMessage<BriarAPI_ReassignRunResponse> {
        .init(result: .success(await scenario.reassignRun(request)))
    }
}

private actor AgentExecutionScenario {
    struct DirectTaskRequest: Sendable {
        let projectID: UUID
        let agentID: UUID
        let skillID: UUID
        let request: String
        let workerID: String
        let requestID: UUID
    }

    struct DispatchRequest: Sendable {
        let projectID: UUID
        let runID: UUID
        let dispatch: BriarAPI_DispatchRunInput
        let reassign: Bool
    }

    private let projectID: UUID
    private let suspendDirectTasks: Bool
    private let suspendFirstSessionList: Bool
    private var recordedDirectTasks: [DirectTaskRequest] = []
    private var recordedDispatches: [DispatchRequest] = []
    private var putSessionRequests = 0
    private var sessionSnapshots: [[ProjectAgentSession]]
    private var sessionListStartCount = 0
    private var sessionListStartWaiters: [(
        count: Int,
        continuation: CheckedContinuation<Void, Never>
    )] = []
    private var sessionListReleases: [CheckedContinuation<Void, Never>] = []
    private var directTaskStartCount = 0
    private var directTaskStartWaiters: [(
        count: Int,
        continuation: CheckedContinuation<Void, Never>
    )] = []
    private var directTaskReleases: [CheckedContinuation<Void, Never>] = []

    init(
        projectID: UUID,
        suspendDirectTasks: Bool = false,
        sessionSnapshots: [[ProjectAgentSession]] = [[]],
        suspendFirstSessionList: Bool = false
    ) {
        self.projectID = projectID
        self.suspendDirectTasks = suspendDirectTasks
        self.sessionSnapshots = sessionSnapshots
        self.suspendFirstSessionList = suspendFirstSessionList
    }

    func directTaskRequests() -> [DirectTaskRequest] { recordedDirectTasks }
    func dispatchRequests() -> [DispatchRequest] { recordedDispatches }
    func putSessionRequestCount() -> Int { putSessionRequests }

    func listProjectAgents(
        _ request: BriarAPI_ListProjectAgentsRequest
    ) -> BriarAPI_ListProjectAgentsResponse {
        precondition(request.projectID == projectID.uuidString.lowercased())
        return .init()
    }

    func listProjectAgentSessions(
        _ request: BriarAPI_ListProjectAgentSessionsRequest
    ) async -> BriarAPI_ListProjectAgentSessionsResponse {
        precondition(request.projectID == projectID.uuidString.lowercased())
        let snapshot = sessionSnapshots.isEmpty ? [] : sessionSnapshots.removeFirst()
        sessionListStartCount += 1
        let waiters = sessionListStartWaiters.filter {
            $0.count <= sessionListStartCount
        }
        sessionListStartWaiters.removeAll {
            $0.count <= sessionListStartCount
        }
        waiters.forEach { $0.continuation.resume() }
        if suspendFirstSessionList, sessionListStartCount == 1 {
            await withCheckedContinuation { continuation in
                sessionListReleases.append(continuation)
            }
        }
        var response = BriarAPI_ListProjectAgentSessionsResponse()
        response.sessions = snapshot.map(wireSession)
        return response
    }

    func putProjectAgentSession(
        _ request: BriarAPI_PutProjectAgentSessionRequest
    ) -> BriarAPI_PutProjectAgentSessionResponse {
        precondition(request.projectID == projectID.uuidString.lowercased())
        putSessionRequests += 1
        var response = BriarAPI_PutProjectAgentSessionResponse()
        response.session = wireSession(request)
        return response
    }

    func runProjectAgentTask(
        _ request: BriarAPI_RunProjectAgentTaskRequest
    ) async -> BriarAPI_RunProjectAgentTaskResponse {
        precondition(request.projectID == projectID.uuidString.lowercased())
        let agentID = UUID(uuidString: request.agentID)!
        let skillID = UUID(uuidString: request.skillID)!
        let requestID = UUID(uuidString: request.requestID)!
        recordedDirectTasks.append(DirectTaskRequest(
            projectID: projectID,
            agentID: agentID,
            skillID: skillID,
            request: request.request,
            workerID: request.workerID,
            requestID: requestID
        ))
        if suspendDirectTasks {
            directTaskStartCount += 1
            let waiters = directTaskStartWaiters.filter {
                $0.count <= directTaskStartCount
            }
            directTaskStartWaiters.removeAll {
                $0.count <= directTaskStartCount
            }
            waiters.forEach { $0.continuation.resume() }
            await withCheckedContinuation { continuation in
                directTaskReleases.append(continuation)
            }
        }
        let startedAt = Date(timeIntervalSince1970: 1_786_310_400)
        var session = BriarAPI_ProjectAgentSession()
        session.id = request.requestID
        session.projectID = request.projectID
        session.dispatchGroupID = request.requestID
        session.agentID = request.agentID
        session.skillID = request.skillID
        session.sessionType = .task
        session.trigger = .manual
        session.request = request.request
        session.status = .running
        session.startedAt = .init(date: startedAt)
        session.requestedWorkerID = request.workerID
        session.workerID = request.workerID
        var event = BriarAPI_ProjectAgentSessionEvent()
        event.id = "event-\(request.requestID)"
        event.type = .started
        event.occurredAt = .init(date: startedAt)
        session.events = [event]
        session.updatedAt = .init(date: startedAt)
        var response = BriarAPI_RunProjectAgentTaskResponse()
        response.session = session
        return response
    }

    func dispatchRun(
        _ request: BriarAPI_DispatchRunRequest
    ) -> BriarAPI_DispatchRunResponse {
        let dispatch = recordDispatch(
            projectID: request.projectID,
            runID: request.runID,
            dispatch: request.dispatch,
            reassign: false
        )
        var response = BriarAPI_DispatchRunResponse()
        response.dispatch = dispatch
        return response
    }

    func reassignRun(
        _ request: BriarAPI_ReassignRunRequest
    ) -> BriarAPI_ReassignRunResponse {
        let dispatch = recordDispatch(
            projectID: request.projectID,
            runID: request.runID,
            dispatch: request.dispatch,
            reassign: true
        )
        var response = BriarAPI_ReassignRunResponse()
        response.dispatch = dispatch
        return response
    }

    func waitForSessionListStarts(_ count: Int) async {
        if sessionListStartCount >= count { return }
        await withCheckedContinuation { continuation in
            sessionListStartWaiters.append((count, continuation))
        }
    }

    func releaseSessionList() {
        guard !sessionListReleases.isEmpty else { return }
        sessionListReleases.removeFirst().resume()
    }

    func waitForDirectTaskStarts(_ count: Int) async {
        if directTaskStartCount >= count { return }
        await withCheckedContinuation { continuation in
            directTaskStartWaiters.append((count, continuation))
        }
    }

    func releaseDirectTask() {
        guard !directTaskReleases.isEmpty else { return }
        directTaskReleases.removeFirst().resume()
    }

    private func recordDispatch(
        projectID projectIDString: String,
        runID runIDString: String,
        dispatch: BriarAPI_DispatchRunInput,
        reassign: Bool
    ) -> BriarAPI_IssueExecutionDispatch {
        let projectID = UUID(uuidString: projectIDString)!
        let runID = UUID(uuidString: runIDString)!
        precondition(projectID == self.projectID)
        recordedDispatches.append(.init(
            projectID: projectID,
            runID: runID,
            dispatch: dispatch,
            reassign: reassign
        ))
        var response = BriarAPI_IssueExecutionDispatch()
        response.runID = runIDString
        if dispatch.hasAgentID { response.agentID = dispatch.agentID }
        response.provider = dispatch.provider
        if dispatch.hasModel { response.model = dispatch.model }
        if dispatch.hasEffort { response.effort = dispatch.effort }
        if dispatch.hasWorkerID { response.requestedWorkerID = dispatch.workerID }
        response.requestedByUserID = "fixture-user"
        response.dispatchMode = dispatch.hasWorkerID ? .specific : .any
        response.dispatchedAt = .init(date: Date(timeIntervalSince1970: 1_786_310_400))
        response.outcome = .dispatched
        return response
    }

    private func wireSession(
        _ request: BriarAPI_PutProjectAgentSessionRequest
    ) -> BriarAPI_ProjectAgentSession {
        var message = BriarAPI_ProjectAgentSession()
        message.id = request.sessionID
        message.projectID = request.projectID
        message.dispatchGroupID = request.dispatchGroupID
        if request.hasAgentID { message.agentID = request.agentID }
        if request.hasAgentName { message.agentName = request.agentName }
        if request.hasSkillID { message.skillID = request.skillID }
        message.sessionType = request.sessionType
        if request.hasTrigger { message.trigger = request.trigger }
        if request.hasRequest { message.request = request.request }
        message.status = request.status
        message.startedAt = request.startedAt
        if request.hasCompletedAt { message.completedAt = request.completedAt }
        if request.hasRequestedWorkerID { message.requestedWorkerID = request.requestedWorkerID }
        if request.hasWorkerID { message.workerID = request.workerID }
        if request.hasSummary { message.summary = request.summary }
        if request.hasError { message.error = request.error }
        message.events = request.events
        message.updatedAt = request.updatedAt
        return message
    }

    private func wireSession(
        _ session: ProjectAgentSession
    ) -> BriarAPI_ProjectAgentSession {
        var message = BriarAPI_ProjectAgentSession()
        message.id = session.id
        message.projectID = session.projectId.uuidString.lowercased()
        if let value = session.dispatchGroupId { message.dispatchGroupID = value }
        if let value = session.agentId { message.agentID = value.uuidString.lowercased() }
        if let value = session.agentName { message.agentName = value }
        if let value = session.skillId { message.skillID = value.uuidString.lowercased() }
        if let value = session.sessionType {
            message.sessionType = value == .task ? .task : .dispatch
        }
        if let value = session.trigger {
            message.trigger = value == .manual ? .manual : .scheduled
        }
        if let value = session.scheduleId { message.scheduleID = value }
        if let value = session.scheduleRunId { message.scheduleRunID = value }
        if let value = session.parentSessionId { message.parentSessionID = value }
        if let value = session.request { message.request = value }
        switch session.status {
        case .running: message.status = .running
        case .completed: message.status = .completed
        case .failed: message.status = .failed
        case .skipped: message.status = .skipped
        case .interrupted: message.status = .interrupted
        }
        message.startedAt = .init(date: session.startedAt)
        if let value = session.completedAt { message.completedAt = .init(date: value) }
        if let value = session.conversationId { message.conversationID = value }
        if let value = session.requestedWorkerId { message.requestedWorkerID = value }
        if let value = session.workerId { message.workerID = value }
        if let value = session.requestedByUserId { message.requestedByUserID = value }
        if let value = session.summary { message.summary = value }
        if let value = session.error { message.error = value }
        let sessionEvents: [ProjectAgentSession.Event] = session.events ?? []
        message.events = sessionEvents.map { value in
            var event = BriarAPI_ProjectAgentSessionEvent()
            event.id = value.id
            switch value.type {
            case .started: event.type = .started
            case .completed: event.type = .completed
            case .failed: event.type = .failed
            case .skipped: event.type = .skipped
            case .interrupted: event.type = .interrupted
            case .stopped: event.type = .stopped
            }
            event.occurredAt = .init(date: value.occurredAt)
            return event
        }
        if let value = session.updatedAt { message.updatedAt = .init(date: value) }
        message.archived = session.archived ?? false
        return message
    }
}
