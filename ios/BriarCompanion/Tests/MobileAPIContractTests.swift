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
        XCTAssertEqual(MobileAPIContract.version, "1.1.0")
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
        let evidence: RunEvidenceResponse = try decodeResponse("listRunEvidence")
        let messages: IssueMessagesResponse = try decodeResponse("listIssueMessages")

        XCTAssertTrue(health.ok)
        XCTAssertEqual(device.userCode, "BRIAR123")
        XCTAssertEqual(token.tokenType, "Bearer")
        XCTAssertEqual(pending.error, .authorizationPending)
        XCTAssertEqual(user.user.email, "user@example.com")
        XCTAssertEqual(projects.projects.first?.role, .owner)
        XCTAssertEqual(snapshot.cursor, 41)
        XCTAssertEqual(snapshot.runs.first?.status, .running)
        XCTAssertEqual(snapshot.runs.first?.attachments.first?.filename, "companion.png")
        XCTAssertEqual(delta.cursor, 42)
        XCTAssertEqual(delta.runs.first?.status, .completed)
        XCTAssertEqual(delta.runs.first?.resultReviews.first?.name, "Briar User")
        XCTAssertEqual(events.events.first?.workflowStage, "implementing")
        XCTAssertEqual(evidence.evidence.first?.status, .passed)
        XCTAssertEqual(messages.messages.first?.author.name, "Briar User")
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
            MobileAPIContract.Endpoint.runEvidence(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/evidence"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/messages"
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
