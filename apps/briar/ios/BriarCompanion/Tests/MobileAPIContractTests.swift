import BriarContracts
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

final class MobileAPIContractTests: XCTestCase {
    func testProjectAgentSessionProtobufMappingAndPutRoundTrip() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let agentID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let skillID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
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
        message.agentName = "Release Agent"
        message.skillID = skillID.uuidString.lowercased()
        message.sessionType = .task
        message.trigger = .scheduled
        message.scheduleID = "nightly"
        message.scheduleRunID = "nightly-17"
        message.parentSessionID = "session-parent"
        message.request = "Ship the iOS app"
        message.followUps = [followUp]
        message.status = .completed
        message.issues = [issue]
        message.startedAt = .init(date: startedAt)
        message.completedAt = .init(date: completedAt)
        message.conversationID = "conversation-17"
        message.requestedWorkerID = "worker-requested"
        message.workerID = "worker-selected"
        message.requestedByUserID = "user-17"
        message.summary = "Release complete"
        message.events = [event]
        message.updatedAt = .init(date: completedAt)
        message.archived = true

        let mapped = try ProjectAgentSession(connectMessage: message)
        XCTAssertEqual(mapped.projectId, projectID)
        XCTAssertEqual(mapped.agentId, agentID)
        XCTAssertEqual(mapped.skillId, skillID)
        XCTAssertEqual(mapped.sessionType, .task)
        XCTAssertEqual(mapped.trigger, .scheduled)
        XCTAssertEqual(mapped.status, .completed)
        XCTAssertEqual(mapped.issues.first?.runNumber, 17)
        XCTAssertEqual(mapped.issues.first?.outcome, .completed)
        XCTAssertEqual(mapped.events?.first?.type, .completed)
        XCTAssertEqual(mapped.followUps?.first?.message, "Verify TestFlight")
        XCTAssertEqual(mapped.requestedByUserId, "user-17")
        XCTAssertEqual(mapped.archived, true)

        let put = try mapped.putConnectRequest(projectID: projectID)
        XCTAssertEqual(put.projectID, projectID.uuidString.lowercased())
        XCTAssertEqual(put.sessionID, mapped.id)
        XCTAssertEqual(put.agentID, agentID.uuidString.lowercased())
        XCTAssertEqual(put.skillID, skillID.uuidString.lowercased())
        XCTAssertEqual(put.sessionType, .task)
        XCTAssertEqual(put.trigger, .scheduled)
        XCTAssertEqual(put.status, .completed)
        XCTAssertEqual(put.issues.first?.runNumber, 17)
        XCTAssertEqual(put.events.first?.type, .completed)
        XCTAssertEqual(put.followUps.first?.message, "Verify TestFlight")

        var invalid = message
        invalid.status = .UNRECOGNIZED(999)
        XCTAssertThrowsError(try ProjectAgentSession(connectMessage: invalid))
    }

    func testChannelRealtimeProtobufOneofFrame() throws {
        var frame = BriarRealtime_OrganizationNotification()
        var changed = BriarRealtime_ProjectAgentSessionsChanged()
        changed.projectID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        changed.version = 43
        frame.projectAgentSessionsChanged = changed
        let decoded = try BriarRealtime_OrganizationNotification(
            serializedBytes: frame.serializedData()
        )
        XCTAssertEqual(
            try ChannelRealtimeNotification(protobuf: decoded),
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

}
