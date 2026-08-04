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
        XCTAssertEqual(agents.agents.first?.name, "Auto Hunt agent")
        XCTAssertEqual(agents.agents.first?.provider, .codex)
        XCTAssertNotNil(agents.agents.first?.avatar)
        XCTAssertNotNil(ProfileImageSource.uiImage(from: agents.agents.first?.avatar))

        let sessionsPayload = try XCTUnwrap(operations["listProjectAgentSessions"]?["response"])
        let sessionsData = try JSONSerialization.data(withJSONObject: sessionsPayload)
        let sessions = try JSONDecoder.mobileContract.decode(
            ProjectAgentSessionsResponse.self,
            from: sessionsData
        )
        XCTAssertEqual(sessions.sessions.count, 1)
        XCTAssertEqual(sessions.sessions.first?.status, .completed)
        XCTAssertEqual(sessions.sessions.first?.issues.first?.runNumber, 3832)
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

    func testInboxClassificationAndReadState() async throws {
        let project = ProjectsResponse.Project(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            name: "Briar",
            icon: nil,
            organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let blocked = DashboardRun(
            id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
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
        let snapshot = DashboardSnapshot(
            project: project,
            runs: [blocked, completed],
            conversationNotifications: [
                ConversationNotification(
                    id: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
                    runId: blocked.id,
                    runTitle: blocked.title,
                    rootMessageId: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
                    body: "@you please look",
                    author: IssueMessage.Author(id: "u1", name: "Alex", image: nil, provider: nil),
                    reason: "mention",
                    createdAt: Date(timeIntervalSince1970: 1_700_000_120)
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
            error: "worker lost",
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
        XCTAssertEqual(messages.count, 4)
        // Newest first: mention (120) > blocked issue (100) > failed session (80) > completed (50)
        XCTAssertEqual(messages.map(\.occurredAt), messages.map(\.occurredAt).sorted(by: >))
        XCTAssertEqual(messages.map(\.kind), [.conversation, .issue, .session, .issue])
        XCTAssertEqual(messages.map(\.title)[1], "Needs help")
        XCTAssertEqual(messages.map(\.title)[3], "Done")

        let blockedMessage = try XCTUnwrap(
            messages.first { $0.kind == .issue && $0.title == "Needs help" }
        )
        XCTAssertEqual(InboxMessageBuilder.classify(blockedMessage), .urgent)
        let mention = try XCTUnwrap(messages.first { $0.kind == .conversation })
        XCTAssertEqual(InboxMessageBuilder.classify(mention), .actionRequired)
        let failedSession = try XCTUnwrap(messages.first { $0.kind == .session })
        XCTAssertEqual(InboxMessageBuilder.classify(failedSession), .actionRequired)

        await MainActor.run {
            let suiteName = "AgentsInboxSystemTests.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suiteName)!
            defer { defaults.removePersistentDomain(forName: suiteName) }
            let store = InboxStore(defaults: defaults)
            store.update(snapshot: snapshot, sessions: [session], project: project)
            XCTAssertEqual(store.unreadCount, 4)
            // Store keeps a single chronological list for the mobile feed.
            XCTAssertEqual(store.messages.map(\.id), messages.map(\.id))
            XCTAssertEqual(store.messages(in: .urgent).count, 1)
            XCTAssertEqual(store.messages(in: .actionRequired).count, 2)
            store.markRead(id: blockedMessage.id)
            XCTAssertEqual(store.unreadCount, 3)
            store.markAllRead()
            XCTAssertEqual(store.unreadCount, 0)
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
