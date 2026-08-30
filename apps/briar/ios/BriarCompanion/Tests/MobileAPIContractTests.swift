import XCTest
import SwiftProtobuf
@testable import BriarCompanion

final class MobileAPIContractTests: XCTestCase {
    func testChannelRealtimeEndpointAndProtobufOneofFrame() throws {
        let organizationID = UUID(
            uuidString: "22222222-2222-4222-8222-222222222222"
        )!
        XCTAssertEqual(
            MobileAPIContract.Endpoint.channelEvents(
                organizationID: organizationID,
                cursor: 41
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channel-events?cursor=41"
        )

        let ticket = try JSONDecoder.mobileContract.decode(
            ChannelRealtimeTicketResponse.self,
            from: Data(
                #"{"url":"wss://api.briartechnologies.com/organizations/22222222-2222-4222-8222-222222222222/channel-events?ticket=signed","expiresAt":"2026-08-12T00:01:00.000Z"}"#.utf8
            )
        )
        XCTAssertEqual(ticket.url.hasPrefix("wss://"), true)
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
        common.sentAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_787_184_000)
        )
        common.expiresAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_787_184_030)
        )

        var channel = common
        var channelScope = BriarRealtime_ChannelActivityScope()
        channelScope.agentID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        channelScope.channelID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        channel.channel = channelScope
        let channelFrame = try AgentReplyActivityFrame(
            protobuf: BriarRealtime_AgentReplyActivityFrame(
                serializedBytes: channel.serializedData()
            )
        )
        guard case .channel(let mappedChannel) = channelFrame else {
            return XCTFail("Expected a channel activity scope")
        }
        XCTAssertEqual(mappedChannel.channelId.uuidString.lowercased(), channelScope.channelID)
        XCTAssertEqual(mappedChannel.activity?.kind, .command)

        var issue = common
        var issueScope = BriarRealtime_IssueActivityScope()
        issueScope.projectID = "11111111-1111-4111-8111-111111111111"
        issueScope.runID = "22222222-2222-4222-8222-222222222222"
        issue.issue = issueScope
        let issueFrame = try AgentReplyActivityFrame(
            protobuf: BriarRealtime_AgentReplyActivityFrame(
                serializedBytes: issue.serializedData()
            )
        )
        guard case .issue(let mappedIssue) = issueFrame else {
            return XCTFail("Expected an issue activity scope")
        }
        XCTAssertEqual(mappedIssue.projectId.uuidString.lowercased(), issueScope.projectID)
        XCTAssertEqual(mappedIssue.runId.uuidString.lowercased(), issueScope.runID)
    }

    func testChannelIssueProposalPayloadDecodesCanonicalDetails() throws {
        let detailed = try JSONDecoder.mobileContract.decode(
            ChannelMessage.Proposal.self,
            from: Data(
                #"""
                {
                  "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  "actionType": "request_issue_create",
                  "status": "pending",
                  "projectId": null,
                  "payload": {
                    "issue": {
                      "title": "Build onboarding",
                      "description": "Ship the guided setup.",
                      "priority": 2,
                      "status": "queued"
                    }
                  },
                  "resultRunId": null
                }
                """#.utf8
            )
        )
        XCTAssertEqual(detailed.payload?.issue?.title, "Build onboarding")
        XCTAssertEqual(detailed.payload?.issue?.description, "Ship the guided setup.")
        XCTAssertEqual(detailed.payload?.issue?.priority, 2)
        XCTAssertEqual(detailed.payload?.issue?.status, .queued)
    }

    func testChannelIssueBatchProposalAndAcceptedMappingsDecode() throws {
        let proposal = try JSONDecoder.mobileContract.decode(
            ChannelMessage.Proposal.self,
            from: Data(
                #"""
                {
                  "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  "actionType": "request_issue_create",
                  "status": "accepted",
                  "projectId": "11111111-1111-4111-8111-111111111111",
                  "payload": {
                    "batch": {
                      "items": [
                        {
                          "key": "api",
                          "issue": {
                            "title": "Add API",
                            "description": null,
                            "priority": 2,
                            "status": "backlog"
                          }
                        },
                        {
                          "key": "ui",
                          "issue": {
                            "title": "Add UI",
                            "description": "Show the mapping.",
                            "priority": 3,
                            "status": "backlog"
                          }
                        }
                      ],
                      "dependencies": [
                        {"prerequisiteKey": "api", "dependentKey": "ui"}
                      ]
                    },
                    "executeAfterCreate": false
                  },
                  "resultRunId": "33333333-3333-4333-8333-333333333333",
                  "resultItems": [
                    {
                      "localKey": "api",
                      "runId": "33333333-3333-4333-8333-333333333333"
                    },
                    {
                      "localKey": "ui",
                      "runId": "44444444-4444-4444-8444-444444444444"
                    }
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertNil(proposal.payload?.issue)
        XCTAssertEqual(proposal.payload?.batch?.items.map(\.key), ["api", "ui"])
        XCTAssertEqual(proposal.payload?.batch?.dependencies.count, 1)
        XCTAssertEqual(proposal.resultItems.map(\.localKey), ["api", "ui"])

        let response = try JSONDecoder.mobileContract.decode(
            AcceptChannelProposalResponse.self,
            from: Data(
                #"""
                {
                  "outcome": "accepted",
                  "projectId": "11111111-1111-4111-8111-111111111111",
                  "resultRunId": "33333333-3333-4333-8333-333333333333",
                  "resultItems": [
                    {
                      "localKey": "api",
                      "runId": "33333333-3333-4333-8333-333333333333"
                    },
                    {
                      "localKey": "ui",
                      "runId": "44444444-4444-4444-8444-444444444444"
                    }
                  ]
                }
                """#.utf8
            )
        )
        XCTAssertEqual(response.resultItems?.map(\.localKey), ["api", "ui"])
    }

    func testExecutionProposalIsSeparateAndRequiresCanonicalServerSnapshot() throws {
        let proposal = try JSONDecoder.mobileContract.decode(
            IssueExecutionProposal.self,
            from: Data(
                #"""
                {
                  "id": "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
                  "type": "request_issue_execute",
                  "status": "pending",
                  "projectId": "11111111-1111-4111-8111-111111111111",
                  "runId": "33333333-3333-4333-8333-333333333333",
                  "title": "Build onboarding",
                  "createdAt": "2026-08-11T01:00:00.000Z",
                  "acceptedAt": null,
                  "requestedProvider": null,
                  "requestedModel": null,
                  "requestedEffort": null,
                  "requestedWorkerId": null,
                  "delegatedByAgentId": "66666666-6666-4666-8666-666666666666",
                  "delegatedByAgentName": "Bumble"
                }
                """#.utf8
            )
        )

        XCTAssertEqual(proposal.type, .executeIssue)
        XCTAssertEqual(proposal.status, .pending)
        XCTAssertEqual(proposal.title, "Build onboarding")
        XCTAssertEqual(proposal.delegatedByAgentName, "Bumble")

        let create = IssueProposedAction(
            id: UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
            type: .create,
            issue: .init(
                title: "Build onboarding",
                description: nil,
                priority: 2,
                status: "backlog"
            ),
            status: .accepted,
            resultRunId: proposal.runId,
            executeAfterCreate: true
        )
        let message = IssueMessage(
            id: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            runId: proposal.runId,
            parentMessageId: nil,
            body: "Create it, then propose execution.",
            attachments: nil,
            author: .init(id: nil, name: "Bumble", image: nil, provider: "codex"),
            replyCount: 0,
            proposedAction: create,
            executionProposal: proposal,
            createdAt: Date(timeIntervalSince1970: 1_786_413_600),
            updatedAt: Date(timeIntervalSince1970: 1_786_413_600)
        )
        let roundTrip = try JSONDecoder.mobileContract.decode(
            IssueMessage.self,
            from: JSONEncoder.mobileContract.encode(message)
        )
        XCTAssertEqual(roundTrip.proposedAction?.executeAfterCreate, true)
        XCTAssertEqual(roundTrip.executionProposal?.id, proposal.id)
    }

    func testExecutionApprovalRequestEncodesEveryNullableChoiceWithoutRequestID() throws {
        let request = AcceptIssueExecutionProposalRequest(
            provider: .codex,
            model: nil,
            effort: nil,
            workerId: nil
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.mobileContract.encode(request)
            ) as? [String: Any]
        )

        XCTAssertEqual(object["provider"] as? String, "codex")
        XCTAssertTrue(object["model"] is NSNull)
        XCTAssertTrue(object["effort"] is NSNull)
        XCTAssertTrue(object["workerId"] is NSNull)
        XCTAssertNil(object["requestId"])
        XCTAssertEqual(Set(object.keys), ["provider", "model", "effort", "workerId"])
    }

    func testExecutionProposalRejectsMissingCanonicalNullableFields() {
        let missingRequestedWorker = Data(
            #"{"id":"cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd","type":"request_issue_execute","status":"pending","projectId":"11111111-1111-4111-8111-111111111111","runId":"33333333-3333-4333-8333-333333333333","title":"Build onboarding","createdAt":"2026-08-11T01:00:00.000Z","acceptedAt":null,"requestedProvider":null,"requestedModel":null,"requestedEffort":null,"delegatedByAgentId":null,"delegatedByAgentName":null}"#.utf8
        )

        XCTAssertThrowsError(
            try JSONDecoder.mobileContract.decode(
                IssueExecutionProposal.self,
                from: missingRequestedWorker
            )
        )
    }

    func testAgentSkillExecutionProposalRequiresTheCanonicalImmutableSnapshot() throws {
        let data = Data(
            #"""
            {
              "id": "abababab-abab-4bab-8bab-abababababab",
              "type": "request_agent_skill_execute",
              "status": "pending",
              "projectId": "11111111-1111-4111-8111-111111111111",
              "agentId": "66666666-6666-4666-8666-666666666666",
              "agentName": "Project Agent",
              "skillId": "77777777-7777-4777-8777-777777777777",
              "skillName": "iOS 배포",
              "request": "TestFlight에 최신 빌드를 배포해 줘",
              "provider": "codex",
              "model": "gpt-5.6-sol",
              "effort": "high",
              "createdAt": "2026-08-11T01:00:00.000Z",
              "acceptedAt": null,
              "requestedWorkerId": null,
              "requestedWorkerLabel": null,
              "resultSessionId": null,
              "delegatedByAgentId": null,
              "delegatedByAgentName": null
            }
            """#.utf8
        )
        let proposal = try JSONDecoder.mobileContract.decode(
            AgentSkillExecutionProposal.self,
            from: data
        )

        XCTAssertEqual(proposal.type, .executeAgentSkill)
        XCTAssertEqual(proposal.status, .pending)
        XCTAssertEqual(proposal.agentName, "Project Agent")
        XCTAssertEqual(proposal.skillName, "iOS 배포")
        XCTAssertEqual(proposal.provider, .codex)
        XCTAssertEqual(proposal.model, "gpt-5.6-sol")
        XCTAssertEqual(proposal.effort, .high)

        var missingNullable = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        missingNullable.removeValue(forKey: "requestedWorkerLabel")
        XCTAssertThrowsError(
            try JSONDecoder.mobileContract.decode(
                AgentSkillExecutionProposal.self,
                from: JSONSerialization.data(withJSONObject: missingNullable)
            )
        )
    }

    func testAgentSkillExecutionApprovalUsesDedicatedEndpointsAndExactWorkerBody() throws {
        let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let channelID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        let proposalID = UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!

        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptChannelSkillExecutionProposal(
                organizationID: organizationID,
                channelID: channelID,
                proposalID: proposalID
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channels/33333333-3333-4333-8333-333333333333/skill-execution-proposals/abababab-abab-4bab-8bab-abababababab/accept"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptIssueSkillExecutionProposal(
                projectID: projectID,
                conversationRunID: runID,
                proposalID: proposalID
            ),
            "/projects/11111111-1111-4111-8111-111111111111/runs/44444444-4444-4444-8444-444444444444/skill-execution-proposals/abababab-abab-4bab-8bab-abababababab/accept"
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.mobileContract.encode(
                    AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
                )
            ) as? [String: Any]
        )
        XCTAssertEqual(object["workerId"] as? String, "worker-1")
        XCTAssertEqual(Set(object.keys), ["workerId"])
    }

    func testAcceptedAgentSkillExecutionResponseCarriesCanonicalSession() throws {
        let response = try JSONDecoder.mobileContract.decode(
            AcceptAgentSkillExecutionProposalResponse.self,
            from: Data(
                #"""
                {
                  "outcome": "accepted",
                  "projectId": "11111111-1111-4111-8111-111111111111",
                  "proposal": {
                    "id": "abababab-abab-4bab-8bab-abababababab",
                    "type": "request_agent_skill_execute",
                    "status": "accepted",
                    "projectId": "11111111-1111-4111-8111-111111111111",
                    "agentId": "66666666-6666-4666-8666-666666666666",
                    "agentName": "Project Agent",
                    "skillId": "77777777-7777-4777-8777-777777777777",
                    "skillName": "iOS 배포",
                    "request": "TestFlight에 최신 빌드를 배포해 줘",
                    "provider": "codex",
                    "model": "gpt-5.6-sol",
                    "effort": "high",
                    "createdAt": "2026-08-11T01:00:00.000Z",
                    "acceptedAt": "2026-08-11T01:01:00.000Z",
                    "requestedWorkerId": "worker-1",
                    "requestedWorkerLabel": "Build Mac",
                    "resultSessionId": "session-1",
                    "delegatedByAgentId": null,
                    "delegatedByAgentName": null
                  },
                  "session": {
                    "id": "session-1",
                    "projectId": "11111111-1111-4111-8111-111111111111",
                    "agentId": "66666666-6666-4666-8666-666666666666",
                    "skillId": "77777777-7777-4777-8777-777777777777",
                    "request": "TestFlight에 최신 빌드를 배포해 줘",
                    "status": "running",
                    "issues": [],
                    "startedAt": "2026-08-11T01:01:00.000Z",
                    "requestedWorkerId": "worker-1",
                    "workerId": "worker-1"
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.outcome, .accepted)
        let session = try XCTUnwrap(response.session)
        XCTAssertEqual(response.proposal.resultSessionId, session.id)
        XCTAssertEqual(response.proposal.requestedWorkerLabel, "Build Mac")
        XCTAssertEqual(session.requestedWorkerId, "worker-1")
    }

    func testChannelAndIssueMessagesRoundTripAcceptedSkillExecutionHistory() throws {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let proposal = AgentSkillExecutionProposal(
            id: UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
            status: .accepted,
            projectId: projectID,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: "Project Agent",
            skillId: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            skillName: "iOS 배포",
            request: "TestFlight에 최신 빌드를 배포해 줘",
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .high,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            acceptedAt: Date(timeIntervalSince1970: 1_700_000_100),
            requestedWorkerId: "worker-1",
            requestedWorkerLabel: "Build Mac",
            resultSessionId: "session-1"
        )
        let channel = ChannelMessage(
            id: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            channelId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            parentMessageId: nil,
            body: "승인됨",
            author: .init(type: .agent, name: "Project Agent", image: nil, provider: "codex"),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            skillExecutionProposal: proposal,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let issue = IssueMessage(
            id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            runId: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            parentMessageId: nil,
            body: "승인됨",
            attachments: [],
            author: .init(id: nil, name: "Project Agent", image: nil, provider: "codex"),
            replyCount: 0,
            skillExecutionProposal: proposal,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )

        let channelRoundTrip = try JSONDecoder.mobileContract.decode(
            ChannelMessage.self,
            from: JSONEncoder.mobileContract.encode(channel)
        )
        let issueRoundTrip = try JSONDecoder.mobileContract.decode(
            IssueMessage.self,
            from: JSONEncoder.mobileContract.encode(issue)
        )
        XCTAssertEqual(channelRoundTrip.skillExecutionProposal, proposal)
        XCTAssertEqual(issueRoundTrip.skillExecutionProposal, proposal)
        XCTAssertEqual(
            channelRoundTrip.skillExecutionProposal?.requestedWorkerLabel,
            "Build Mac"
        )
    }

    func testChannelWebhookBlocksDecodeCoreSlackFormatting() throws {
        let blocks = try JSONDecoder.mobileContract.decode(
            [ChannelMessageBlock].self,
            from: Data(
                #"""
                [
                  {"type":"header","text":{"type":"plain_text","text":"Deploy complete"}},
                  {"type":"section","text":{"type":"mrkdwn","text":"*Production* is healthy."}},
                  {"type":"divider"},
                  {"type":"markdown","text":"- [x] Health checks"},
                  {
                    "type":"rich_text",
                    "elements":[{
                      "type":"rich_text_list",
                      "style":"bullet",
                      "elements":[{
                        "type":"rich_text_section",
                        "elements":[{
                          "type":"text",
                          "text":"Monitor metrics",
                          "style":{"bold":true}
                        }]
                      }]
                    }]
                  }
                ]
                """#.utf8
            )
        )

        XCTAssertEqual(blocks.map(\.type), [.header, .section, .divider, .markdown, .richText])
        XCTAssertEqual(blocks[1].textObject?.type, .markdown)
        XCTAssertEqual(blocks[3].markdownText, "- [x] Health checks")
        XCTAssertEqual(blocks[4].richTextElements?.first?.sections?.first?.elements.first?.text, "Monitor metrics")
        XCTAssertEqual(blocks[4].richTextElements?.first?.sections?.first?.elements.first?.style?.bold, true)
    }

    func testChannelIssueProposalRejectsPartiallyMalformedCanonicalDetails() throws {
        let malformedIssues = [
            #"{"title":"Missing fields"}"#,
            #"{"title":"","description":null,"priority":2,"status":"backlog"}"#,
            #"{"title":"Bad priority","description":null,"priority":5,"status":"backlog"}"#,
        ]

        for issue in malformedIssues {
            let proposal = try JSONDecoder.mobileContract.decode(
                ChannelMessage.Proposal.self,
                from: Data(
                    """
                    {
                      "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                      "actionType": "request_issue_create",
                      "status": "pending",
                      "projectId": null,
                      "payload": {"issue": \(issue)},
                      "resultRunId": null
                    }
                    """.utf8
                )
            )
            XCTAssertNil(proposal.payload, "Malformed issue unexpectedly decoded: \(issue)")
        }
    }

}
