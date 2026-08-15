import XCTest
@testable import BriarCompanion

final class AgentsInboxSystemTests: XCTestCase {
    func testDecodesAgentAndSessionFixturesFromSharedContract() throws {
        let bundle = Bundle(for: Self.self)
        let fixtureURL = try XCTUnwrap(bundle.url(forResource: "companion-v1", withExtension: "json"))
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any]
        )
        let operations = try XCTUnwrap(fixture["operations"] as? [String: [String: Any]])

        let agentsPayload = try XCTUnwrap(operations["listProjectAgents"]?["response"])
        let agentsData = try JSONSerialization.data(withJSONObject: agentsPayload)
        let agents = try JSONDecoder.mobileContract.decode(ProjectAgentsResponse.self, from: agentsData)
        XCTAssertEqual(agents.agents.count, 1)
        XCTAssertEqual(agents.agents.first?.name, "Issue processing agent")
        XCTAssertEqual(agents.agents.first?.provider, .codex)
        XCTAssertEqual(agents.agents.first?.skills.count, 1)
        XCTAssertEqual(agents.agents.first?.skills.first?.name, "Issue processing")
        XCTAssertEqual(
            agents.agents.first?.skills.first?.id,
            UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        )
        guard case let .data(avatarData) = ProfileImageSource.parse(agents.agents.first?.avatar) else {
            return XCTFail("shared agent fixture should contain a data URL avatar")
        }
        XCTAssertFalse(avatarData.isEmpty)

        let sessionsPayload = try XCTUnwrap(operations["listProjectAgentSessions"]?["response"])
        let sessionsData = try JSONSerialization.data(withJSONObject: sessionsPayload)
        let sessions = try JSONDecoder.mobileContract.decode(
            ProjectAgentSessionsResponse.self,
            from: sessionsData
        )
        XCTAssertEqual(sessions.sessions.count, 1)
        XCTAssertEqual(sessions.sessions.first?.status, .completed)
        XCTAssertEqual(sessions.sessions.first?.agentName, "Issue processing agent")
        XCTAssertEqual(sessions.sessions.first?.issues.first?.runNumber, 3832)

        let taskPayload = try XCTUnwrap(operations["runProjectAgentTask"]?["response"])
        let taskData = try JSONSerialization.data(withJSONObject: taskPayload)
        let task = try JSONDecoder.mobileContract.decode(ProjectAgentTaskResponse.self, from: taskData)
        XCTAssertEqual(
            task.session.skillId,
            UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        )
        XCTAssertEqual(task.session.requestedWorkerId, "worker-1")
        XCTAssertEqual(task.session.workerId, "worker-1")
        XCTAssertEqual(task.session.agentName, "Issue processing agent")
    }

    func testEndpointPathsForAgentsAndSessions() {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgents(projectID: projectID, locale: "ko"),
            "/projects/11111111-1111-4111-8111-111111111111/agents?locale=ko"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgentSessions(projectID: projectID),
            "/projects/11111111-1111-4111-8111-111111111111/agent-sessions"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgentSession(
                projectID: projectID,
                sessionID: "dispatch-1"
            ),
            "/projects/11111111-1111-4111-8111-111111111111/agent-sessions/dispatch-1"
        )
    }

    func testProjectAgentTaskRequestEncodesCanonicalUUIDs() throws {
        let agentID = UUID(uuidString: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")!
        let skillID = UUID(uuidString: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB")!
        let requestID = UUID(uuidString: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC")!
        let request = ProjectAgentTaskRequest(
            agentId: agentID,
            skillId: skillID,
            request: "저장된 Agent를 실행합니다.",
            workerId: "worker-1",
            requestId: requestID
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.mobileContract.encode(request)
            ) as? [String: Any]
        )

        XCTAssertEqual(object["agentId"] as? String, agentID.uuidString.lowercased())
        XCTAssertEqual(object["skillId"] as? String, skillID.uuidString.lowercased())
        XCTAssertEqual(object["requestId"] as? String, requestID.uuidString.lowercased())
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
            responsibility: "제품 개발을 담당합니다.",
            skill: "legacy runtime profile",
            skills: [skill],
            calendarColor: "#3275d5",
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let api = AgentExecutionAPIRecorder(projectID: projectID)
        let store = AgentsStore(api: api)
        store.select(projectID: projectID, token: "token", locale: "ko")

        let session = try await store.run(
            agent: agent,
            skill: skill,
            request: skill.instructions,
            workerID: "worker-claude"
        )
        XCTAssertEqual(session.agentId, agentID)
        XCTAssertEqual(session.request, skill.instructions)

        let requests = await api.requests()
        let taskRequest = try XCTUnwrap(requests.first {
            $0.method == "POST" && $0.path.hasSuffix("/agent-tasks")
        })
        let body = try XCTUnwrap(taskRequest.body)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual(object["agentId"] as? String, agentID.uuidString.lowercased())
        XCTAssertEqual(object["skillId"] as? String, skillID.uuidString.lowercased())
        XCTAssertEqual(object["request"] as? String, skill.instructions)
        XCTAssertEqual(object["workerId"] as? String, "worker-claude")
    }

    @MainActor
    func testApprovedSkillSessionMaterializesImmediatelyForTheSelectedProject() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let otherProjectID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let api = AgentExecutionAPIRecorder(projectID: projectID)
        let store = AgentsStore(api: api)
        store.select(projectID: projectID, token: "token", locale: "ko")
        while (await api.requests()).count < 2 {
            await Task.yield()
        }
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
            workspaceRoot: nil,
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
        let api = AgentExecutionAPIRecorder(
            projectID: projectID,
            sessionSnapshots: [[], [completed]],
            suspendFirstSessionList: true
        )
        let store = AgentsStore(api: api, pollInterval: .seconds(3_600))
        store.select(projectID: projectID, token: "token", locale: "ko")
        await api.waitForSessionListStarts(1)

        store.materialize(materialized)
        await api.releaseSessionList()
        for _ in 0..<100 where store.isRefreshing {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertFalse(store.isRefreshing)
        XCTAssertEqual(store.session(id: materialized.id), materialized)

        await store.refresh()

        XCTAssertEqual(store.session(id: materialized.id), completed)
        XCTAssertEqual(store.session(id: materialized.id)?.status, .completed)
        XCTAssertEqual(store.session(id: materialized.id)?.summary, "배포 완료")

        store.materialize(materialized)
        XCTAssertEqual(
            store.session(id: materialized.id),
            completed,
            "an older approval response must not regress newer server state"
        )
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
            responsibility: "제품 개발을 담당합니다.",
            skill: "legacy runtime profile",
            skills: [skill],
            calendarColor: "#3275d5",
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let api = AgentExecutionAPIRecorder(projectID: projectID, suspendDirectTasks: true)
        let store = AgentsStore(api: api)
        store.select(projectID: projectID, token: "token", locale: "ko")

        let firstRun = Task {
            try await store.run(
                agent: agent,
                skill: skill,
                request: skill.instructions,
                workerID: "worker-claude"
            )
        }
        await api.waitForDirectTaskStarts(1)
        XCTAssertTrue(store.executingAgentIDs.contains(agentID))

        let secondRun = Task {
            try await store.run(
                agent: agent,
                skill: skill,
                request: skill.instructions,
                workerID: "worker-claude"
            )
        }
        await api.waitForDirectTaskStarts(2)

        let requests = await api.requests().filter {
            $0.method == "POST" && $0.path.hasSuffix("/agent-tasks")
        }
        XCTAssertEqual(requests.count, 2)
        let requestIDs = try requests.map { request in
            let body = try XCTUnwrap(request.body)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            return try XCTUnwrap(object["requestId"] as? String)
        }
        XCTAssertEqual(Set(requestIDs).count, 2)

        await api.releaseDirectTask()
        _ = try await firstRun.value
        XCTAssertTrue(store.executingAgentIDs.contains(agentID))

        await api.releaseDirectTask()
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

    func testSessionSyncRequestMatchesWorkerEnvelopeContract() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let timestamp = Date(timeIntervalSince1970: 1_700_000_000)
        let session = ProjectAgentSession(
            id: "dispatch-1",
            projectId: projectID,
            dispatchGroupId: "dispatch-1",
            agentId: agentID,
            agentName: "Inbox Agent",
            sessionType: .dispatch,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "프로젝트 이슈를 처리해 줘",
            status: .running,
            issues: [ProjectAgentSession.Issue(
                runId: "33333333-3333-4333-8333-333333333333",
                runNumber: 7,
                sourceKey: "briar-issue:test",
                title: "계약 검증",
                outcome: .pending,
                summary: nil
            )],
            startedAt: timestamp,
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            summary: nil,
            error: nil,
            events: [ProjectAgentSession.Event(
                id: "event-1",
                type: .started,
                occurredAt: timestamp
            )],
            updatedAt: timestamp
        )

        let data = try JSONEncoder.mobileContract.encode(ProjectAgentSessionSyncRequest(session: session))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set([
            "dispatchGroupId", "agentId", "agentName", "skillId", "sessionType", "trigger", "scheduleId",
            "scheduleRunId", "parentSessionId", "request", "status", "issues",
            "startedAt", "completedAt", "conversationId", "summary", "error", "events",
            "updatedAt",
        ]))
        XCTAssertEqual(object["dispatchGroupId"] as? String, "dispatch-1")
        XCTAssertEqual(object["agentName"] as? String, "Inbox Agent")
        XCTAssertEqual(object["sessionType"] as? String, "dispatch")
        XCTAssertEqual(object["status"] as? String, "running")
        XCTAssertNil(object["workspaceRoot"])
        XCTAssertNil(object["dispatchEvents"])

        var responseObject = object
        responseObject["id"] = session.id
        responseObject["projectId"] = projectID.uuidString.lowercased()
        let envelope = try JSONSerialization.data(withJSONObject: ["session": responseObject])
        let decoded = try JSONDecoder.mobileContract.decode(
            ProjectAgentSessionResponse.self,
            from: envelope
        )
        XCTAssertEqual(decoded.session.id, session.id)
        XCTAssertEqual(decoded.session.agentId, agentID)
        XCTAssertEqual(decoded.session.issues, session.issues)
    }

    @MainActor
    func testRunningAgentDispatchesReadyIssuesWithAgentConfiguration() async throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let skillID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let api = AgentExecutionAPIRecorder(projectID: projectID)
        let store = AgentsStore(api: api)
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

        let requests = await api.requests()
        let dispatch = try XCTUnwrap(requests.first {
            $0.method == "POST" && $0.path.hasSuffix("/runs/\(runID.uuidString.lowercased())/dispatch")
        })
        let dispatchBody = try XCTUnwrap(dispatch.body)
        let dispatchObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: dispatchBody) as? [String: Any]
        )
        XCTAssertEqual((dispatchObject["agentId"] as? String)?.lowercased(), agentID.uuidString.lowercased())
        XCTAssertEqual(dispatchObject["provider"] as? String, "claude")
        XCTAssertEqual(dispatchObject["model"] as? String, "opus")
        XCTAssertEqual(dispatchObject["effort"] as? String, "medium")
        XCTAssertEqual(dispatchObject["persistPreferences"] as? Bool, true)
        XCTAssertNil(dispatchObject["workerId"])
        XCTAssertEqual(
            requests.filter { $0.method == "PUT" && $0.path.contains("/agent-sessions/") }.count,
            1
        )
    }

    func testParsesDeepLinksAndUniversalLinks() {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!

        XCTAssertEqual(
            BriarLinkParser.parse("briar-companion://issues/\(projectID.uuidString)/\(runID.uuidString)"),
            .issue(projectID: projectID, runID: runID)
        )
        XCTAssertEqual(
            BriarLinkParser.parse(
                "https://briar-api.wbai.workers.dev/open/issues/\(projectID.uuidString)/\(runID.uuidString)"
            ),
            .issue(projectID: projectID, runID: runID)
        )
        XCTAssertEqual(
            BriarLinkParser.parse("briar-companion://sessions/\(projectID.uuidString)/session-1"),
            .session(projectID: projectID, sessionID: "session-1")
        )
        XCTAssertEqual(
            BriarLinkParser.parse(
                "https://briar-api.wbai.workers.dev/open/sessions/\(projectID.uuidString)/session-1"
            ),
            .session(projectID: projectID, sessionID: "session-1")
        )
        XCTAssertNil(BriarLinkParser.parse("briar-companion://auth-complete"))
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

    func testShareLinksMatchOpenPathShape() {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let origin = URL(string: "https://briar-api.example")!
        let issueURL = BriarShareLinks.issueShareURL(projectID: projectID, runID: runID, origin: origin)
        XCTAssertEqual(
            issueURL.absoluteString,
            "https://briar-api.example/open/issues/\(projectID.uuidString.lowercased())/\(runID.uuidString.lowercased())"
        )
        let sessionURL = BriarShareLinks.sessionShareURL(
            projectID: projectID,
            sessionID: "session-1",
            origin: origin
        )
        XCTAssertEqual(
            sessionURL.absoluteString,
            "https://briar-api.example/open/sessions/\(projectID.uuidString.lowercased())/session-1"
        )
    }

    @MainActor
    func testInboxClassificationAndReadState() async throws {
        let project = ProjectsResponse.Project(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            name: "Briar",
            issueKeyPrefix: "WB",
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
                    reason: "thread_reply",
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
            updatedAt: Date(timeIntervalSince1970: 1_700_000_080)
        )

        let messages = InboxMessageBuilder.build(
            snapshot: snapshot,
            sessions: [session],
            project: project
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
        XCTAssertFalse(
            LocalNotificationService.shouldDeliver(
                channelReply,
                viewingChannelID: channelID
            )
        )
        XCTAssertTrue(
            LocalNotificationService.shouldDeliver(
                channelReply,
                viewingChannelID: UUID()
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
            store.configure(token: nil, userID: "fixture-user")
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
            restored.configure(token: nil, userID: "fixture-user")
            restored.update(snapshot: snapshot, sessions: [session], project: project)
            XCTAssertEqual(restored.unreadCount, 0)
        }
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

private actor AgentExecutionAPIRecorder: MobileAPIClientProtocol {
    struct Request: Sendable {
        let path: String
        let method: String
        let body: Data?
    }

    private let projectID: UUID
    private let suspendDirectTasks: Bool
    private let suspendFirstSessionList: Bool
    private var recorded: [Request] = []
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

    func requests() -> [Request] { recorded }

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

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let bodyData = try body.map {
            try JSONEncoder.mobileContract.encode(AgentTestAnyEncodable($0))
        }
        recorded.append(Request(path: path, method: method, body: bodyData))

        if method == "PUT", path.contains("/agent-sessions/") {
            guard var session = try JSONSerialization.jsonObject(
                with: try XCTUnwrap(bodyData)
            ) as? [String: Any] else {
                throw MobileAPIError.invalidRequest
            }
            session["id"] = String(path.split(separator: "/").last ?? "")
            session["projectId"] = projectID.uuidString.lowercased()
            return try response(
                ["session": session],
                as: responseType
            )
        }
        if method == "POST", path.hasSuffix("/agent-tasks") {
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
            guard let request = try JSONSerialization.jsonObject(
                with: try XCTUnwrap(bodyData)
            ) as? [String: Any] else {
                throw MobileAPIError.invalidRequest
            }
            let sessionID = request["requestId"] as? String ?? "session-direct-1"
            return try response(
                [
                    "session": [
                        "id": sessionID,
                        "projectId": projectID.uuidString.lowercased(),
                        "dispatchGroupId": sessionID,
                        "agentId": request["agentId"] ?? NSNull(),
                        "skillId": request["skillId"] ?? NSNull(),
                        "sessionType": "task",
                        "trigger": "manual",
                        "scheduleId": NSNull(),
                        "scheduleRunId": NSNull(),
                        "parentSessionId": NSNull(),
                        "request": request["request"] ?? NSNull(),
                        "status": "running",
                        "issues": [],
                        "startedAt": "2026-08-10T00:00:00.000Z",
                        "completedAt": NSNull(),
                        "conversationId": NSNull(),
                        "workspaceRoot": NSNull(),
                        "requestedWorkerId": request["workerId"] ?? NSNull(),
                        "workerId": request["workerId"] ?? NSNull(),
                        "summary": NSNull(),
                        "error": NSNull(),
                        "events": [[
                            "id": "event-\(sessionID)",
                            "type": "started",
                            "occurredAt": "2026-08-10T00:00:00.000Z",
                        ]],
                        "updatedAt": "2026-08-10T00:00:00.000Z",
                    ],
                ],
                as: responseType
            )
        }
        if path.hasSuffix("/dispatch") {
            let runID = path.split(separator: "/").dropLast().last.map(String.init) ?? ""
            return try response(
                [
                    "runId": runID,
                    "agentId": NSNull(),
                    "provider": "claude",
                    "model": "opus",
                    "effort": "medium",
                    "requestedWorkerId": NSNull(),
                    "requestedByUserId": "fixture-user",
                    "dispatchMode": "any",
                    "dispatchedAt": "2026-08-08T00:00:00.000Z",
                    "outcome": "dispatched",
                ],
                as: responseType
            )
        }
        if path.hasSuffix("/agents?locale=ko") {
            return try response(["agents": []], as: responseType)
        }
        if path.hasSuffix("/agent-sessions") {
            let snapshot = sessionSnapshots.isEmpty
                ? []
                : sessionSnapshots.removeFirst()
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
            let data = try JSONEncoder.mobileContract.encode(
                ProjectAgentSessionsResponse(sessions: snapshot)
            )
            return try JSONDecoder.mobileContract.decode(responseType, from: data)
        }
        throw MobileAPIError.invalidRequest
    }

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws {
        throw MobileAPIError.invalidRequest
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }

    func download(_ path: String, token: String, to destination: URL) async throws -> URL {
        throw MobileAPIError.invalidDownload
    }

    private func response<Response: Decodable & Sendable>(
        _ object: Any,
        as responseType: Response.Type
    ) throws -> Response {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

private struct AgentTestAnyEncodable: Encodable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
