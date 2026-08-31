import BriarContracts
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

final class MobileAPIContractTests: XCTestCase {
    func testProjectAgentSessionMapsRequiredDomainSemanticsAndRejectsMalformedMessages() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let startedAt = Date(timeIntervalSince1970: 1_786_310_400)
        let completedAt = startedAt.addingTimeInterval(120)

        var issue = BriarAPI_ProjectAgentSessionIssue()
        issue.runID = "44444444-4444-4444-8444-444444444444"
        issue.runNumber = 17
        issue.sourceKey = "BRIAR-17"
        issue.title = "Connect Agent session"
        issue.outcome = .completed
        issue.summary = "typed contract verified"

        var event = BriarAPI_ProjectAgentSessionEvent()
        event.id = "event-completed"
        event.type = .completed
        event.occurredAt = .init(date: completedAt)

        var followUp = BriarAPI_ProjectAgentSessionFollowUp()
        followUp.id = "follow-up-1"
        followUp.message = "Verify TestFlight"
        followUp.sentAt = .init(date: completedAt)

        var message = BriarAPI_ProjectAgentSession()
        message.id = "session-17"
        message.projectID = projectID.uuidString.lowercased()
        message.dispatchGroupID = "dispatch-17"
        message.agentID = agentID.uuidString.lowercased()
        message.sessionType = .task
        message.trigger = .scheduled
        message.followUps = [followUp]
        message.status = .completed
        message.issues = [issue]
        message.startedAt = .init(date: startedAt)
        message.completedAt = .init(date: completedAt)
        message.requestedByUserID = "user-17"
        message.events = [event]
        message.updatedAt = .init(date: completedAt)

        let mapped = try ProjectAgentSession(connectMessage: message)
        XCTAssertEqual(mapped.projectId, projectID)
        XCTAssertEqual(mapped.dispatchGroupId, "dispatch-17")
        XCTAssertEqual(mapped.agentId, agentID)
        XCTAssertEqual(mapped.sessionType, .task)
        XCTAssertEqual(mapped.trigger, .scheduled)
        XCTAssertEqual(mapped.status, .completed)
        XCTAssertEqual(mapped.issues.first?.outcome, .completed)
        XCTAssertEqual(mapped.events?.first?.type, .completed)
        XCTAssertEqual(mapped.followUps?.first?.message, "Verify TestFlight")
        XCTAssertEqual(mapped.requestedByUserId, "user-17")
        XCTAssertEqual(mapped.updatedAt, completedAt)

        let put = try mapped.putConnectRequest(projectID: projectID)
        XCTAssertEqual(put.dispatchGroupID, "dispatch-17")
        XCTAssertEqual(put.sessionType, .task)
        XCTAssertEqual(put.updatedAt.date, completedAt)

        var invalid = message
        invalid.clearUpdatedAt()
        XCTAssertThrowsError(try ProjectAgentSession(connectMessage: invalid))
    }

    func testChannelRealtimeGeneratedOneofMapsToDomainEvent() throws {
        var frame = BriarRealtime_OrganizationNotification()
        var changed = BriarRealtime_ProjectAgentSessionsChanged()
        changed.projectID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        changed.version = 43
        frame.projectAgentSessionsChanged = changed
        XCTAssertEqual(
            try ChannelRealtimeNotification(protobuf: frame),
            .projectAgentSessionsChanged(
                projectID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                version: 43
            )
        )
    }

    func testAgentActivityProtobufChannelAndIssueScopes() throws {
        var activity = BriarRealtime_AgentActivity()
        activity.id = "command-1"
        activity.kind = .command
        activity.headline = "Running tests"

        var common = BriarRealtime_AgentReplyActivityFrame()
        common.replyJobID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        common.attempt = 2
        common.sequence = 7
        common.triggerMessageID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        common.parentMessageID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        common.activity = activity
        common.sentAt = .init(date: Date(timeIntervalSince1970: 1_787_184_000))
        common.expiresAt = .init(date: Date(timeIntervalSince1970: 1_787_184_030))

        var channel = common
        var channelScope = BriarRealtime_ChannelActivityScope()
        channelScope.agentID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        channelScope.channelID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        channel.channel = channelScope
        guard case .channel(let mappedChannel) = try AgentReplyActivityFrame(
            protobuf: channel
        ) else {
            return XCTFail("Expected a channel activity scope")
        }
        XCTAssertEqual(mappedChannel.channelId.uuidString.lowercased(), channelScope.channelID)
        XCTAssertEqual(mappedChannel.activity?.kind, .command)

        var issue = common
        var issueScope = BriarRealtime_IssueActivityScope()
        issueScope.projectID = "11111111-1111-4111-8111-111111111111"
        issueScope.runID = "22222222-2222-4222-8222-222222222222"
        issue.issue = issueScope
        guard case .issue(let mappedIssue) = try AgentReplyActivityFrame(
            protobuf: issue
        ) else {
            return XCTFail("Expected an issue activity scope")
        }
        XCTAssertEqual(mappedIssue.projectId.uuidString.lowercased(), issueScope.projectID)
        XCTAssertEqual(mappedIssue.runId.uuidString.lowercased(), issueScope.runID)
    }

    func testDeviceAuthorizationRejectsMalformedSuccessAndUnknownPollingError() async {
        let malformedSuccess = deviceAuthorizationClient(status: 200, body: #"""
        {
            "device_code":"device-code",
            "user_code":"USER-CODE",
            "verification_uri":"https://briar.example/device",
            "verification_uri_complete":"https://briar.example/device?user_code=USER-CODE",
            "expires_in":600
        }
        """#)
        do {
            _ = try await malformedSuccess.requestDeviceCode()
            XCTFail("Malformed 2xx response must not authorize a device")
        } catch {
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }

        let unknownError = deviceAuthorizationClient(status: 400, body: #"""
        {
            "error":"future_polling_state",
            "error_description":"A future server state"
        }
        """#)
        do {
            _ = try await unknownError.pollDeviceToken(deviceCode: "device-code")
            XCTFail("Unknown polling states must fail closed")
        } catch {
            XCTAssertEqual(error as? MobileAPIError, .invalidResponse)
        }
    }

    func testDeviceAuthorizationDecodesSuccessAndStructuredPollingStates() async throws {
        let code = try await deviceAuthorizationClient(status: 200, body: #"""
        {
            "device_code":"device-code",
            "user_code":"USER-CODE",
            "verification_uri":"https://briar.example/device",
            "verification_uri_complete":"https://briar.example/device?user_code=USER-CODE",
            "expires_in":600,
            "interval":5
        }
        """#).requestDeviceCode()
        XCTAssertEqual(code.deviceCode, "device-code")
        XCTAssertEqual(code.userCode, "USER-CODE")
        XCTAssertEqual(code.expiresIn, 600)
        XCTAssertEqual(code.interval, 5)

        let authorized = try await deviceAuthorizationClient(status: 200, body: #"""
        {
            "access_token":"access-token",
            "token_type":"Bearer",
            "expires_in":3600,
            "scope":"openid profile email"
        }
        """#).pollDeviceToken(deviceCode: code.deviceCode)
        XCTAssertEqual(authorized, .authorized(DeviceAuthorizationToken(
            accessToken: "access-token",
            tokenType: "Bearer",
            expiresIn: 3_600,
            scope: "openid profile email"
        )))

        let slowDown = try await deviceAuthorizationClient(status: 400, body: #"""
        {
            "error":"slow_down",
            "error_description":"Poll less often"
        }
        """#).pollDeviceToken(deviceCode: "device-code")
        XCTAssertEqual(slowDown, .slowDown("Poll less often"))

        let denied = try await deviceAuthorizationClient(status: 400, body: #"""
        {
            "error":"access_denied",
            "error_description":"The user denied access"
        }
        """#).pollDeviceToken(deviceCode: "device-code")
        XCTAssertEqual(denied, .accessDenied("The user denied access"))
    }

    private func deviceAuthorizationClient(
        status: Int,
        body: String
    ) -> DeviceAuthorizationHTTPClient {
        DeviceAuthorizationHTTPClient(
            baseURL: URL(string: "https://briar.example")!
        ) { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (Data(body.utf8), response)
        }
    }
}
