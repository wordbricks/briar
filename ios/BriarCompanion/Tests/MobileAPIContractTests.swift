import XCTest
@testable import BriarCompanion

final class MobileAPIContractTests: XCTestCase {
    private var operations: [String: [String: Any]] = [:]

    override func setUpWithError() throws {
        let bundle = Bundle(for: Self.self)
        let fixtureURL = try XCTUnwrap(
            bundle.url(forResource: "companion-v1", withExtension: "json")
        )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixtureData) as? [String: Any]
        )
        operations = try XCTUnwrap(fixture["operations"] as? [String: [String: Any]])
    }

    func testClientIDsAndContractVersionAreStable() {
        XCTAssertEqual(MobileAPIContract.version, "1.0.0")
        XCTAssertEqual(MobileAPIContract.iOSClientID, "briar-mobile")
        XCTAssertEqual(MobileAPIContract.androidClientID, "briar-android")
        XCTAssertEqual(DeviceCodeRequest(), DeviceCodeRequest(clientID: "briar-mobile"))
    }

    func testDecodesEveryReadResponseFromSharedWorkerFixture() throws {
        let health: HealthResponse = try decodeResponse("getHealth")
        let device: DeviceCodeResponse = try decodeResponse("beginDeviceAuthorization")
        let token: DeviceTokenResponse = try decodeResponse("pollDeviceToken")
        let pending: DeviceTokenErrorResponse = try decode(
            "pollDeviceToken",
            field: "errorResponse"
        )
        let user: CurrentUserResponse = try decodeResponse("getCurrentUser")
        let projects: ProjectsResponse = try decodeResponse("listProjects")
        let snapshot: DashboardSnapshot = try decodeResponse("getDashboardSnapshot")
        let delta: DashboardDelta = try decodeResponse("getDashboardDelta")
        let events: RunEventsResponse = try decodeResponse("listRunEvents")
        let messages: IssueMessagesResponse = try decodeResponse("listIssueMessages")
        let evidence: RunEvidenceResponse = try decodeResponse("listRunEvidence")
        let agents: ProjectAgentsResponse = try decodeResponse("listProjectAgents")
        let sessions: ProjectAgentSessionsResponse = try decodeResponse("listProjectAgentSessions")
        let resume: ResumeRunResponse = try decodeResponse("resumeRun")
        let dispatch: DispatchRunResponse = try decodeResponse("dispatchRun")
        let reassign: DispatchRunResponse = try decodeResponse("reassignRun")
        let accepted: AcceptIssueReworkProposalResponse = try decodeResponse(
            "acceptIssueReworkProposal"
        )
        let acceptedAction: AcceptIssueActionProposalResponse = try decodeResponse(
            "acceptIssueActionProposal"
        )
        let channels: ChannelsResponse = try decodeResponse("listChannels")
        let channel: ChannelDetailResponse = try decodeResponse("getChannel")
        let channelMessages: ChannelMessagesResponse = try decodeResponse(
            "listChannelMessages"
        )
        let acceptedChannelProposal: AcceptChannelProposalResponse = try decodeResponse(
            "acceptChannelProposal"
        )

        XCTAssertTrue(health.ok)
        XCTAssertEqual(device.userCode, "BRIAR123")
        XCTAssertEqual(token.tokenType, "Bearer")
        XCTAssertEqual(pending.error, .authorizationPending)
        XCTAssertEqual(user.user.email, "user@example.com")
        XCTAssertEqual(projects.projects.first?.role, .owner)
        XCTAssertEqual(projects.projects.first?.effectiveIssueKeyPrefix, "BR")
        XCTAssertEqual(projects.projects.first?.issueKey(runNumber: 42), "BR-42")
        XCTAssertEqual(snapshot.cursor, 41)
        XCTAssertEqual(snapshot.runs.first?.status, .running)
        XCTAssertEqual(snapshot.runs.first?.workflow?.stages.count, 3)
        XCTAssertEqual(snapshot.runs.first?.requestedProvider, .codex)
        XCTAssertEqual(snapshot.runs.first?.requestedWorkerId, "worker-1")
        XCTAssertEqual(snapshot.runs.first?.attachments?.first?.filename, "design.png")
        XCTAssertEqual(snapshot.workers?.first?.readiness, "available")
        XCTAssertEqual(snapshot.workers?.first?.icon?.type, .emoji)
        XCTAssertEqual(snapshot.workers?.first?.icon?.value, "🍋")
        XCTAssertEqual(delta.cursor, 42)
        XCTAssertEqual(delta.runs.first?.status, .completed)
        XCTAssertEqual(delta.runs.first?.structuredResult?.outcome, "completed")
        XCTAssertEqual(events.events.first?.workflowStage, "implementing")
        XCTAssertEqual(messages.messages.first?.author.name, "Briar User")
        XCTAssertEqual(evidence.evidence.first?.status, .passed)
        XCTAssertEqual(evidence.evidence.first?.images?.first?.filename, "companion.png")
        XCTAssertEqual(agents.agents.first?.name, "Issue processing agent")
        XCTAssertEqual(sessions.sessions.first?.id, "session-fixture-1")
        XCTAssertEqual(resume.checkpointKey, "user-before-production_qa")
        XCTAssertEqual(resume.attempt, 2)
        XCTAssertEqual(resume.revision, 3)
        XCTAssertEqual(dispatch.dispatchMode, "any")
        XCTAssertNil(dispatch.requestedWorkerId)
        XCTAssertEqual(dispatch.outcome, "dispatched")
        XCTAssertEqual(reassign.dispatchMode, "specific")
        XCTAssertEqual(reassign.requestedWorkerId, "worker-1")
        XCTAssertEqual(accepted.proposal.status, .accepted)
        XCTAssertEqual(accepted.revision, 2)
        XCTAssertEqual(acceptedAction.proposal.type, .update)
        XCTAssertEqual(acceptedAction.proposal.changes?.description, "Use the revised acceptance criteria.")
        XCTAssertEqual(channels.channels.count, 2)
        XCTAssertEqual(channel.messages.first?.body, "@honey 온보딩 개편 계획서를 정리해줘")
        XCTAssertEqual(channelMessages.messages.last?.proposal?.status, .pending)
        XCTAssertEqual(acceptedChannelProposal.outcome, .accepted)
        XCTAssertEqual(
            acceptedChannelProposal.projectId.uuidString.lowercased(),
            "11111111-1111-4111-8111-111111111111"
        )
    }

    func testEndpointPathsMatchOpenAPISubset() {
        XCTAssertEqual(MobileAPIContract.Endpoint.health, "/health")
        XCTAssertEqual(MobileAPIContract.Endpoint.deviceCode, "/api/auth/device/code")
        XCTAssertEqual(MobileAPIContract.Endpoint.deviceToken, "/api/auth/device/token")
        XCTAssertEqual(MobileAPIContract.Endpoint.currentUser, "/me")
        XCTAssertEqual(MobileAPIContract.Endpoint.projects, "/projects")
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        XCTAssertEqual(
            MobileAPIContract.Endpoint.dashboard(projectID: projectID),
            "/projects/11111111-1111-4111-8111-111111111111/dashboard"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.dashboardDelta(projectID: projectID, cursor: 41),
            "/projects/11111111-1111-4111-8111-111111111111/dashboard/delta?cursor=41"
        )
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        XCTAssertEqual(
            MobileAPIContract.Endpoint.runEvents(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/events"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/messages"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.runEvidence(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/evidence"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.runResume(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/resume"
        )
        let proposalID = UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!
        let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let channelID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptChannelProposal(
                organizationID: organizationID,
                channelID: channelID,
                proposalID: proposalID
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channels/33333333-3333-4333-8333-333333333333/proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptIssueReworkProposal(
                projectID: projectID,
                runID: runID,
                proposalID: proposalID
            ),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/rework-proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptIssueActionProposal(
                projectID: projectID,
                runID: runID,
                proposalID: proposalID
            ),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/issue-action-proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgents(projectID: projectID, locale: "en"),
            "/projects/11111111-1111-4111-8111-111111111111/agents?locale=en"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgentSessions(projectID: projectID),
            "/projects/11111111-1111-4111-8111-111111111111/agent-sessions"
        )
    }

    private func decodeResponse<Response: Decodable>(_ operationID: String) throws -> Response {
        try decode(operationID, field: "response")
    }

    private func decode<Response: Decodable>(
        _ operationID: String,
        field: String
    ) throws -> Response {
        let operation = try XCTUnwrap(operations[operationID])
        let response = try XCTUnwrap(operation[field])
        let data = try JSONSerialization.data(withJSONObject: response)
        return try JSONDecoder.mobileContract.decode(Response.self, from: data)
    }
}
