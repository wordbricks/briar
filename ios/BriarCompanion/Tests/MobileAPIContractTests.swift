import XCTest
@testable import BriarCompanion

final class MobileAPIContractTests: XCTestCase {
    private struct OpenAPIOperation {
        let method: String
        let path: String
    }

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

    func testChannelIssueProposalPayloadIsDetailedAndBackwardCompatible() throws {
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

        let legacy = try JSONDecoder.mobileContract.decode(
            ChannelMessage.Proposal.self,
            from: Data(
                #"""
                {
                  "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  "actionType": "request_issue_create",
                  "status": "pending",
                  "projectId": null,
                  "resultRunId": null
                }
                """#.utf8
            )
        )
        XCTAssertNil(legacy.payload)

        let unknownPayload = try JSONDecoder.mobileContract.decode(
            ChannelMessage.Proposal.self,
            from: Data(
                #"""
                {
                  "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  "actionType": "request_issue_create",
                  "status": "pending",
                  "projectId": null,
                  "payload": "legacy-shape",
                  "resultRunId": null
                }
                """#.utf8
            )
        )
        XCTAssertNil(unknownPayload.payload)
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
        XCTAssertEqual(response.proposal.resultSessionId, response.session.id)
        XCTAssertEqual(response.proposal.requestedWorkerLabel, "Build Mac")
        XCTAssertEqual(response.session.requestedWorkerId, "worker-1")
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

    func testCreateAcceptanceExecutionProposalIsOptionalForOlderServers() throws {
        let channelResponses = [
            #"{"outcome":"accepted","projectId":"11111111-1111-4111-8111-111111111111","resultRunId":"33333333-3333-4333-8333-333333333333"}"#,
            #"{"outcome":"accepted","projectId":"11111111-1111-4111-8111-111111111111","resultRunId":"33333333-3333-4333-8333-333333333333","executionProposal":null}"#,
        ]
        for payload in channelResponses {
            let response = try JSONDecoder.mobileContract.decode(
                AcceptChannelProposalResponse.self,
                from: Data(payload.utf8)
            )
            XCTAssertNil(response.executionProposal)
        }

        var actionPayload = try XCTUnwrap(
            operations["acceptIssueActionProposal"]?["response"] as? [String: Any]
        )
        actionPayload.removeValue(forKey: "executionProposal")
        let missing = try JSONDecoder.mobileContract.decode(
            AcceptIssueActionProposalResponse.self,
            from: JSONSerialization.data(withJSONObject: actionPayload)
        )
        XCTAssertNil(missing.executionProposal)

        actionPayload["executionProposal"] = NSNull()
        let null = try JSONDecoder.mobileContract.decode(
            AcceptIssueActionProposalResponse.self,
            from: JSONSerialization.data(withJSONObject: actionPayload)
        )
        XCTAssertNil(null.executionProposal)
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

    func testSharedFixtureOperationsMatchOpenAPI() throws {
        let bundle = Bundle(for: Self.self)
        let openAPIURL = try XCTUnwrap(
            bundle.url(forResource: "companion.openapi", withExtension: "yaml")
        )
        let openAPIData = try Data(contentsOf: openAPIURL)
        let document = try XCTUnwrap(
            JSONSerialization.jsonObject(with: openAPIData) as? [String: Any]
        )
        let info = try XCTUnwrap(document["info"] as? [String: Any])
        XCTAssertEqual(info["version"] as? String, MobileAPIContract.version)

        let components = try XCTUnwrap(document["components"] as? [String: Any])
        let schemas = try XCTUnwrap(components["schemas"] as? [String: Any])
        for responseName in [
            "AcceptIssueActionProposalResponse",
            "AcceptChannelProposalResponse",
        ] {
            let schema = try XCTUnwrap(schemas[responseName] as? [String: Any])
            let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
            XCTAssertNotNil(properties["executionProposal"])
            let required = schema["required"] as? [String] ?? []
            XCTAssertFalse(required.contains("executionProposal"))
        }

        let paths = try XCTUnwrap(document["paths"] as? [String: Any])
        let httpMethods: Set<String> = ["get", "post", "put", "patch", "delete"]
        var openAPIOperations: [String: OpenAPIOperation] = [:]
        for (path, rawPathItem) in paths {
            let pathItem = try XCTUnwrap(rawPathItem as? [String: Any])
            for (method, rawOperation) in pathItem where httpMethods.contains(method) {
                let operation = try XCTUnwrap(rawOperation as? [String: Any])
                let operationID = try XCTUnwrap(operation["operationId"] as? String)
                let previous = openAPIOperations.updateValue(
                    OpenAPIOperation(method: method, path: path),
                    forKey: operationID
                )
                XCTAssertNil(previous, "OpenAPI operationId \(operationID)가 중복되었습니다.")
            }
        }

        let expectedQueryTemplates = [
            "getChannelDelta": "since={since}",
            "getDashboardDelta": "cursor={cursor}",
        ]
        for (operationID, fixtureOperation) in operations {
            let openAPIOperation = try XCTUnwrap(
                openAPIOperations[operationID],
                "fixture operation \(operationID)가 OpenAPI에 없습니다."
            )
            let fixtureMethod = try XCTUnwrap(fixtureOperation["method"] as? String)
            let fixturePath = try XCTUnwrap(fixtureOperation["path"] as? String)
            let pathParts = fixturePath.split(
                separator: "?",
                maxSplits: 1,
                omittingEmptySubsequences: false
            )

            XCTAssertEqual(fixtureMethod.lowercased(), openAPIOperation.method)
            XCTAssertEqual(String(pathParts[0]), openAPIOperation.path)
            if pathParts.count == 2 {
                let expectedQuery = try XCTUnwrap(
                    expectedQueryTemplates[operationID],
                    "fixture operation \(operationID)에 예상하지 않은 query template이 있습니다."
                )
                XCTAssertEqual(String(pathParts[1]), expectedQuery)
            } else if expectedQueryTemplates[operationID] != nil {
                XCTFail("\(operationID) fixture에는 query template이 필요합니다.")
            }
        }
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
        let directTask: ProjectAgentTaskResponse = try decodeResponse("runProjectAgentTask")
        let resume: ResumeRunResponse = try decodeResponse("resumeRun")
        let dispatch: DispatchRunResponse = try decodeResponse("dispatchRun")
        let reassign: DispatchRunResponse = try decodeResponse("reassignRun")
        let accepted: AcceptIssueReworkProposalResponse = try decodeResponse(
            "acceptIssueReworkProposal"
        )
        let acceptedAction: AcceptIssueActionProposalResponse = try decodeResponse(
            "acceptIssueActionProposal"
        )
        let acceptedExecution: AcceptIssueExecutionProposalResponse = try decodeResponse(
            "acceptIssueExecutionProposal"
        )
        let channels: ChannelsResponse = try decodeResponse("listChannels")
        let channel: ChannelDetailResponse = try decodeResponse("getChannel")
        let channelMessages: ChannelMessagesResponse = try decodeResponse(
            "listChannelMessages"
        )
        let acceptedChannelProposal: AcceptChannelProposalResponse = try decodeResponse(
            "acceptChannelProposal"
        )
        let acceptedChannelExecution: AcceptChannelExecutionProposalResponse = try decodeResponse(
            "acceptChannelExecutionProposal"
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
        XCTAssertEqual(directTask.session.status, .running)
        XCTAssertEqual(directTask.session.requestedWorkerId, "worker-1")
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
        XCTAssertEqual(acceptedAction.proposal.type, .create)
        XCTAssertEqual(acceptedAction.proposal.issue?.title, "Native dashboard sync")
        XCTAssertEqual(acceptedAction.proposal.executeAfterCreate, true)
        XCTAssertEqual(acceptedAction.executionProposal?.status, .pending)
        XCTAssertNil(acceptedAction.executionProposal?.delegatedByAgentName)
        XCTAssertEqual(acceptedExecution.proposal.status, .accepted)
        XCTAssertEqual(acceptedExecution.proposal.requestedProvider, .codex)
        XCTAssertEqual(acceptedExecution.dispatch.dispatchMode, "any")
        XCTAssertEqual(channels.channels.count, 2)
        XCTAssertEqual(channels.cursor, 12)
        XCTAssertEqual(channel.messages.first?.body, "@honey 온보딩 개편 계획서를 정리해줘")
        XCTAssertEqual(
            channel.messages.first?.mentionedAgentIds,
            [UUID(uuidString: "66666666-6666-4666-8666-666666666666")!]
        )
        XCTAssertEqual(channelMessages.messages.last?.proposal?.status, .pending)
        XCTAssertEqual(
            channelMessages.messages.last?.proposal?.payload?.issue?.title,
            "온보딩 개편"
        )
        XCTAssertEqual(
            channelMessages.messages.last?.proposal?.payload?.issue?.status,
            .backlog
        )
        XCTAssertEqual(
            channelMessages.messages.last?.proposal?.payload?.executeAfterCreate,
            true
        )
        XCTAssertEqual(acceptedChannelProposal.outcome, .accepted)
        XCTAssertEqual(
            acceptedChannelProposal.projectId.uuidString.lowercased(),
            "11111111-1111-4111-8111-111111111111"
        )
        XCTAssertEqual(acceptedChannelProposal.executionProposal?.status, .pending)
        XCTAssertEqual(
            acceptedChannelProposal.executionProposal?.delegatedByAgentName,
            "Bumble"
        )
        XCTAssertEqual(acceptedChannelExecution.outcome, .accepted)
        XCTAssertEqual(acceptedChannelExecution.proposal.delegatedByAgentName, "Bumble")
        XCTAssertEqual(acceptedChannelExecution.dispatch.requestedWorkerId, "worker-1")
    }

    func testEndpointBuildersProduceExpectedPaths() {
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
        XCTAssertEqual(
            MobileAPIContract.Endpoint.projectAgentTasks(projectID: projectID),
            "/projects/11111111-1111-4111-8111-111111111111/agent-tasks"
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
            MobileAPIContract.Endpoint.channelChanges(
                organizationID: organizationID,
                cursor: 12
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channel-changes?since=12"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptChannelProposal(
                organizationID: organizationID,
                channelID: channelID,
                proposalID: proposalID
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channels/33333333-3333-4333-8333-333333333333/proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept"
        )
        XCTAssertEqual(
            MobileAPIContract.Endpoint.acceptChannelExecutionProposal(
                organizationID: organizationID,
                channelID: channelID,
                proposalID: proposalID
            ),
            "/organizations/22222222-2222-4222-8222-222222222222/channels/33333333-3333-4333-8333-333333333333/proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept-execution"
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
            MobileAPIContract.Endpoint.acceptIssueExecutionProposal(
                projectID: projectID,
                conversationRunID: runID,
                proposalID: proposalID
            ),
            "/projects/11111111-1111-4111-8111-111111111111/runs/33333333-3333-4333-8333-333333333333/issue-execution-proposals/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/accept"
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
