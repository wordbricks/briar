import Foundation
import XCTest
@testable import BriarCompanion

final class ChannelsStoreTests: XCTestCase {
    private let organizationID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private let otherOrganizationID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
    private let channelID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    private let otherChannelID = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
    private let rootID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
    private let replyID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
    private let proposalID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
    private let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let resultRunID = UUID(uuidString: "88888888-8888-4888-8888-888888888888")!

    func testArchivedChannelCannotApproveAnIssueProposal() {
        let issue = ChannelMessage.Proposal.Payload.Issue(
            title: "Build onboarding",
            description: "Full canonical description",
            priority: 2,
            status: .backlog
        )
        XCTAssertTrue(
            channelProposalApprovalIsEnabled(
                acceptanceInFlight: false,
                channelArchived: false,
                targetProjectID: projectID,
                issue: issue
            )
        )
        XCTAssertFalse(
            channelProposalApprovalIsEnabled(
                acceptanceInFlight: false,
                channelArchived: true,
                targetProjectID: projectID,
                issue: issue
            )
        )
    }

    @MainActor
    func testOpenChannelReplacesTheCatalogSummaryWithCanonicalDetailState() async throws {
        let listed = summary(id: channelID, name: "Briar")
        let archivedAt = Date(timeIntervalSince1970: 1_700_000_100)
        let archived = summary(
            id: channelID,
            name: "Briar archived",
            archivedAt: archivedAt
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let api = ChannelPollingAPI(routes: [
            listPath: [try encoded(ChannelsResponse(channels: [listed], cursor: 10))],
            detailPath: [try encoded(ChannelDetailResponse(
                channel: archived,
                members: [],
                agents: [],
                messages: []
            ))],
        ])
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))
        store.select(organizationID: organizationID, token: "token")
        await waitForChannels(store, count: 1)

        await store.openChannel(channelID)

        XCTAssertEqual(store.channels.first?.name, archived.name)
        XCTAssertEqual(store.channels.first?.archivedAt, archivedAt)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testDeltaRefreshMergesOnlyTheFocusedChannelIntoRootsAndOpenThread() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let root = message(id: rootID, channelID: channelID, body: "Question")
        let updatedRoot = message(
            id: rootID,
            channelID: channelID,
            body: "Question",
            replyCount: 1,
            lastReplyAt: Date(timeIntervalSince1970: 1_700_000_020)
        )
        let reply = message(
            id: replyID,
            channelID: channelID,
            parentMessageID: rootID,
            body: "Delegated answer",
            createdAt: Date(timeIntervalSince1970: 1_700_000_020),
            authorKind: .agent
        )
        let unrelated = message(
            id: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            channelID: otherChannelID,
            body: "Other channel"
        )
        let archivedAt = Date(timeIntervalSince1970: 1_700_000_030)
        let archivedChannel = summary(
            id: channelID,
            name: "Briar",
            archivedAt: archivedAt
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let threadPath = MobileAPIContract.Endpoint.channelMessages(
            organizationID: organizationID,
            channelID: channelID,
            parentMessageID: rootID
        )
        let deltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 10
        )
        let api = ChannelPollingAPI(routes: [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
            detailPath: [try encoded(ChannelDetailResponse(
                channel: channel,
                members: [],
                agents: [],
                messages: [root]
            ))],
            threadPath: [try encoded(ChannelMessagesResponse(messages: [root]))],
            deltaPath: [try encoded(ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [archivedChannel],
                removedChannelIds: [],
                messages: [updatedRoot, reply, unrelated],
                removedMessageIds: []
            ))],
        ])
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        await store.openThread(channelID: channelID, parentMessageID: rootID)
        await store.refreshChanges()

        XCTAssertEqual(store.messages.map(\.id), [rootID])
        XCTAssertEqual(store.messages.first?.replyCount, 1)
        XCTAssertEqual(store.thread.map(\.id), [rootID, replyID])
        XCTAssertEqual(store.thread.last?.body, "Delegated answer")
        XCTAssertFalse(store.thread.contains(where: { $0.channelId == otherChannelID }))
        XCTAssertEqual(store.channels.first?.archivedAt, archivedAt)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testPollingStopsInBackgroundAndRestartsImmediatelyWhenActive() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let deltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 5
        )
        let unchanged = try encoded(ChannelDeltaResponse(
            cursor: 5,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [],
            removedMessageIds: []
        ))
        let api = ChannelPollingAPI(
            routes: [
                listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 5))],
            ],
            repeating: [deltaPath: unchanged]
        )
        let store = ChannelsStore(api: api, pollInterval: .milliseconds(20))

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: deltaPath, count: 1)
        store.applicationDidEnterBackground()
        try await Task.sleep(for: .milliseconds(30))
        let stoppedCount = await api.requestCount(for: deltaPath)
        try await Task.sleep(for: .milliseconds(80))
        let backgroundCount = await api.requestCount(for: deltaPath)
        XCTAssertEqual(backgroundCount, stoppedCount)

        store.applicationDidBecomeActive()
        await waitForRequests(api, path: deltaPath, count: stoppedCount + 1)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testChangingOrganizationResetsCursorAndFocusedConversation() async throws {
        let firstChannel = summary(id: channelID, name: "First")
        let secondChannel = summary(
            id: otherChannelID,
            name: "Second",
            organizationID: otherOrganizationID
        )
        let firstListPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let secondListPath = MobileAPIContract.Endpoint.channels(organizationID: otherOrganizationID)
        let firstDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 9
        )
        let secondDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: otherOrganizationID,
            cursor: 2
        )
        let firstDetailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let api = ChannelPollingAPI(routes: [
            firstListPath: [try encoded(ChannelsResponse(channels: [firstChannel], cursor: 9))],
            secondListPath: [try encoded(ChannelsResponse(channels: [secondChannel], cursor: 2))],
            firstDetailPath: [try encoded(ChannelDetailResponse(
                channel: firstChannel,
                members: [],
                agents: [],
                messages: [message(id: rootID, channelID: channelID, body: "First")]
            ))],
            firstDeltaPath: [try encoded(emptyDelta(cursor: 9))],
            secondDeltaPath: [try encoded(emptyDelta(cursor: 2))],
        ])
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "first-token")
        await waitForRequests(api, path: firstListPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        await store.refreshChanges()
        XCTAssertFalse(store.messages.isEmpty)

        store.select(organizationID: otherOrganizationID, token: "second-token")
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertTrue(store.thread.isEmpty)
        await waitForRequests(api, path: secondListPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.refreshChanges()

        let firstDeltaCount = await api.requestCount(for: firstDeltaPath)
        let secondDeltaCount = await api.requestCount(for: secondDeltaPath)
        XCTAssertEqual(firstDeltaCount, 1)
        XCTAssertEqual(secondDeltaCount, 1)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testDeltaCatchUpStopsAtTheConfiguredPageBound() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let firstDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 1
        )
        let secondDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 2
        )
        let beyondBoundPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 3
        )
        let api = ChannelPollingAPI(routes: [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 1))],
            firstDeltaPath: [try encoded(ChannelDeltaResponse(
                cursor: 2,
                hasMore: true,
                channels: [],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: []
            ))],
            secondDeltaPath: [try encoded(ChannelDeltaResponse(
                cursor: 3,
                hasMore: true,
                channels: [],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: []
            ))],
        ])
        let store = ChannelsStore(
            api: api,
            pollInterval: .seconds(3_600),
            maxDeltaPagesPerRefresh: 2
        )

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.refreshChanges()

        let firstCount = await api.requestCount(for: firstDeltaPath)
        let secondCount = await api.requestCount(for: secondDeltaPath)
        let beyondCount = await api.requestCount(for: beyondBoundPath)
        XCTAssertEqual(firstCount, 1)
        XCTAssertEqual(secondCount, 1)
        XCTAssertEqual(beyondCount, 0)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testSlowFullLoadCannotOverwriteAndConsumeANewerDelta() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let oldRoot = message(id: rootID, channelID: channelID, body: "Question")
        let updatedRoot = message(
            id: rootID,
            channelID: channelID,
            body: "Question",
            replyCount: 1,
            lastReplyAt: Date(timeIntervalSince1970: 1_700_000_020)
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let deltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 10
        )
        let delta = try encoded(ChannelDeltaResponse(
            cursor: 11,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [updatedRoot],
            removedMessageIds: []
        ))
        let api = ChannelPollingAPI(
            routes: [
                listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
                detailPath: [try encoded(ChannelDetailResponse(
                    channel: channel,
                    members: [],
                    agents: [],
                    messages: [oldRoot]
                ))],
                deltaPath: [delta, delta],
            ],
            delays: [
                detailPath: .milliseconds(200),
                deltaPath: .milliseconds(80),
            ]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)

        let firstDelta = Task { await store.refreshChanges() }
        await waitForRequests(api, path: deltaPath, count: 1)
        let fullLoad = Task { await store.openChannel(channelID) }
        await Task.yield()
        XCTAssertTrue(store.loading)
        await firstDelta.value
        await fullLoad.value
        XCTAssertEqual(store.messages.first?.replyCount, 0)

        await store.refreshChanges()
        let deltaRequestCount = await api.requestCount(for: deltaPath)
        XCTAssertEqual(deltaRequestCount, 2)
        XCTAssertEqual(store.messages.first?.replyCount, 1)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testOlderDuplicateChannelLoadCannotOverwriteTheNewestResponse() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let stale = message(id: rootID, channelID: channelID, body: "Stale snapshot")
        let current = message(id: rootID, channelID: channelID, body: "Current snapshot")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let api = ChannelPollingAPI(
            routes: [
                listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
                detailPath: [
                    try encoded(ChannelDetailResponse(
                        channel: channel,
                        members: [],
                        agents: [],
                        messages: [stale]
                    )),
                    try encoded(ChannelDetailResponse(
                        channel: channel,
                        members: [],
                        agents: [],
                        messages: [current]
                    )),
                ],
            ],
            requestDelays: [
                detailPath: [.milliseconds(150), .milliseconds(10)],
            ]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        let first = Task { await store.openChannel(channelID) }
        await waitForRequests(api, path: detailPath, count: 1)
        let second = Task { await store.openChannel(channelID) }
        await second.value
        XCTAssertEqual(store.messages.first?.body, "Current snapshot")
        XCTAssertFalse(store.loading)
        await first.value
        XCTAssertEqual(store.messages.first?.body, "Current snapshot")
        XCTAssertFalse(store.loading)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testOlderDuplicateCatalogRefreshCannotOverwriteCursorOrChannels() async throws {
        let staleChannel = summary(id: channelID, name: "Stale")
        let currentChannel = summary(id: channelID, name: "Current")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let staleDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 10
        )
        let currentDeltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 11
        )
        let api = ChannelPollingAPI(
            routes: [
                listPath: [
                    try encoded(ChannelsResponse(channels: [staleChannel], cursor: 10)),
                    try encoded(ChannelsResponse(channels: [currentChannel], cursor: 11)),
                ],
                currentDeltaPath: [try encoded(emptyDelta(cursor: 11))],
            ],
            requestDelays: [
                listPath: [.milliseconds(150), .milliseconds(10)],
            ]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        let latestRefresh = Task { await store.refresh() }
        await latestRefresh.value
        XCTAssertEqual(store.channels.first?.name, "Current")
        try await Task.sleep(for: .milliseconds(180))
        XCTAssertEqual(store.channels.first?.name, "Current")

        await store.refreshChanges()
        let currentDeltaRequests = await api.requestCount(for: currentDeltaPath)
        let staleDeltaRequests = await api.requestCount(for: staleDeltaPath)
        XCTAssertEqual(currentDeltaRequests, 1)
        XCTAssertEqual(staleDeltaRequests, 0)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testCatalogRefreshCannotClearConversationLoadingState() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let list = try encoded(ChannelsResponse(channels: [channel], cursor: 10))
        let api = ChannelPollingAPI(
            routes: [
                listPath: [list, list],
                detailPath: [try encoded(ChannelDetailResponse(
                    channel: channel,
                    members: [],
                    agents: [],
                    messages: [message(id: rootID, channelID: channelID, body: "Loaded")]
                ))],
            ],
            requestDelays: [
                listPath: [.zero, .milliseconds(50)],
                detailPath: [.milliseconds(150)],
            ]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForChannels(store, count: 1)
        let catalogRefresh = Task { await store.refresh() }
        await waitForRequests(api, path: listPath, count: 2)
        let conversationLoad = Task { await store.openChannel(channelID) }
        await waitForRequests(api, path: detailPath, count: 1)
        await catalogRefresh.value
        XCTAssertTrue(store.loading)
        await conversationLoad.value
        XCTAssertFalse(store.loading)
        XCTAssertEqual(store.messages.first?.body, "Loaded")
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testAcceptProposalAppliesAcceptedResultAndPreservesPayload() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            )
        )

        let result = await configured.store.acceptProposal(
            channelID: channelID,
            proposalID: proposalID,
            projectID: projectID
        )

        XCTAssertEqual(result?.outcome, .accepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .accepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.projectId, projectID)
        XCTAssertEqual(configured.store.messages.first?.proposal?.resultRunId, resultRunID)
        XCTAssertEqual(
            configured.store.messages.first?.proposal?.payload?.issue?.title,
            "Build onboarding"
        )
        XCTAssertNil(configured.store.errorMessage)
        XCTAssertNil(configured.store.acceptingProposalID)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testAcceptProposalTreatsAlreadyAcceptedAsSuccess() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .alreadyAccepted,
                projectId: projectID,
                resultRunId: resultRunID
            )
        )

        let result = await configured.store.acceptProposal(
            channelID: channelID,
            proposalID: proposalID,
            projectID: projectID
        )

        XCTAssertEqual(result?.outcome, .alreadyAccepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .accepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.resultRunId, resultRunID)
        XCTAssertNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testAcceptProposalFailureKeepsProposalPendingAndSurfacesError() async throws {
        let configured = try await proposalStore(response: nil)

        let result = await configured.store.acceptProposal(
            channelID: channelID,
            proposalID: proposalID,
            projectID: projectID
        )

        XCTAssertNil(result)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .pending)
        XCTAssertNotNil(configured.store.errorMessage)
        XCTAssertNil(configured.store.acceptingProposalID)
        configured.store.dismissError()
        XCTAssertNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testAcceptProposalPreventsConcurrentApprovalRequests() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100)
        )
        let first = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        let duplicate = await configured.store.acceptProposal(
            channelID: channelID,
            proposalID: proposalID,
            projectID: projectID
        )

        XCTAssertNil(duplicate)
        let requestCount = await configured.api.requestCount(for: configured.acceptPath)
        let firstResult = await first.value
        XCTAssertEqual(requestCount, 1)
        XCTAssertEqual(firstResult?.outcome, .accepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .accepted)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testNewerDeltaWinsOverDelayedProposalAcceptanceResponse() async throws {
        let transferredProjectID = UUID(
            uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        )!
        let transferredRunID = UUID(
            uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        )!
        let transferredProposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .accepted,
            projectId: transferredProjectID,
            payload: ChannelMessage.Proposal.Payload(
                issue: ChannelMessage.Proposal.Payload.Issue(
                    title: "Build onboarding",
                    description: "Ship the guided setup.",
                    priority: 2,
                    status: .backlog
                )
            ),
            resultRunId: transferredRunID
        )
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [],
                removedChannelIds: [],
                messages: [message(
                    id: rootID,
                    channelID: channelID,
                    body: "Issue proposal",
                    authorKind: .agent,
                    proposal: transferredProposal
                )],
                removedMessageIds: []
            )
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)
        await configured.store.refreshChanges()

        let navigableResult = await acceptance.value
        XCTAssertEqual(navigableResult?.projectId, transferredProjectID)
        XCTAssertEqual(navigableResult?.resultRunId, transferredRunID)
        XCTAssertEqual(
            configured.store.messages.first?.proposal?.projectId,
            transferredProjectID
        )
        XCTAssertEqual(
            configured.store.messages.first?.proposal?.resultRunId,
            transferredRunID
        )
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testReservationDeltaRefreshesBeforeApplyingDelayedAcceptance() async throws {
        let reservedProposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .pending,
            projectId: projectID,
            payload: ChannelMessage.Proposal.Payload(
                issue: ChannelMessage.Proposal.Payload.Issue(
                    title: "Build onboarding",
                    description: "Ship the guided setup.",
                    priority: 2,
                    status: .backlog
                )
            ),
            resultRunId: nil
        )
        let acceptedProposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .accepted,
            projectId: projectID,
            payload: reservedProposal.payload,
            resultRunId: resultRunID
        )
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [],
                removedChannelIds: [],
                messages: [message(
                    id: rootID,
                    channelID: channelID,
                    body: "Issue proposal",
                    authorKind: .agent,
                    proposal: reservedProposal
                )],
                removedMessageIds: []
            ),
            refreshedProposal: acceptedProposal
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)
        await configured.store.refreshChanges()

        let result = await acceptance.value
        XCTAssertEqual(result?.projectId, projectID)
        XCTAssertEqual(result?.resultRunId, resultRunID)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .accepted)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testDelayedAcceptanceDoesNotRestoreAChannelAfterFocusChanges() async throws {
        let reservedProposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .pending,
            projectId: projectID,
            payload: ChannelMessage.Proposal.Payload(
                issue: ChannelMessage.Proposal.Payload.Issue(
                    title: "Build onboarding",
                    description: nil,
                    priority: 2,
                    status: .backlog
                )
            ),
            resultRunId: nil
        )
        let otherChannel = summary(id: otherChannelID, name: "Other")
        let otherRoot = message(
            id: replyID,
            channelID: otherChannelID,
            body: "Keep the newly focused channel"
        )
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [],
                removedChannelIds: [],
                messages: [message(
                    id: rootID,
                    channelID: channelID,
                    body: "Issue proposal",
                    authorKind: .agent,
                    proposal: reservedProposal
                )],
                removedMessageIds: []
            ),
            focusChangeResponse: ChannelDetailResponse(
                channel: otherChannel,
                members: [],
                agents: [],
                messages: [otherRoot]
            )
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)
        await configured.store.refreshChanges()
        await configured.store.openChannel(otherChannelID)
        XCTAssertNil(configured.store.acceptingProposalID)

        let result = await acceptance.value
        XCTAssertNil(result)
        XCTAssertEqual(configured.store.messages.map(\.id), [otherRoot.id])
        XCTAssertEqual(configured.store.messages.first?.body, "Keep the newly focused channel")
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testClosingChannelInvalidatesDelayedProposalAcceptance() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100)
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        configured.store.closeChannelFocus(channelID: channelID)
        XCTAssertNil(configured.store.acceptingProposalID)

        let result = await acceptance.value
        XCTAssertNil(result)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .pending)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testDelayedProposalFailureDoesNotLeakAfterChannelCloses() async throws {
        let configured = try await proposalStore(
            response: nil,
            delay: .milliseconds(100),
            malformedAcceptance: true
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        configured.store.closeChannelFocus(channelID: channelID)

        let result = await acceptance.value
        XCTAssertNil(result)
        XCTAssertNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testClosingThreadInvalidatesDelayedProposalAcceptance() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100),
            focusThread: true
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        configured.store.closeThreadFocus(
            channelID: channelID,
            parentMessageID: rootID
        )
        XCTAssertNil(configured.store.acceptingProposalID)

        let result = await acceptance.value
        XCTAssertNil(result)
        XCTAssertEqual(configured.store.thread.first?.proposal?.status, .pending)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testStaleApprovalFailureCannotClearANewerSurfaceApproval() async throws {
        let pendingProposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .pending,
            projectId: nil,
            payload: ChannelMessage.Proposal.Payload(
                issue: .init(
                    title: "Build onboarding",
                    description: nil,
                    priority: 2,
                    status: .backlog
                )
            ),
            resultRunId: nil
        )
        let configured = try await proposalStore(
            response: nil,
            refreshedProposal: pendingProposal,
            malformedAcceptance: true,
            additionalAcceptanceResponses: [
                AcceptChannelProposalResponse(
                    outcome: .accepted,
                    projectId: projectID,
                    resultRunId: resultRunID
                ),
            ],
            acceptanceDelays: [.milliseconds(100), .milliseconds(220)]
        )
        let stale = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        configured.store.closeChannelFocus(channelID: channelID)
        XCTAssertNil(configured.store.acceptingProposalID)
        await configured.store.openChannel(channelID)
        let current = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 2)
        XCTAssertEqual(configured.store.acceptingProposalID, proposalID)

        let staleResult = await stale.value
        XCTAssertNil(staleResult)
        XCTAssertNil(configured.store.errorMessage)
        XCTAssertEqual(configured.store.acceptingProposalID, proposalID)
        let currentResult = await current.value
        XCTAssertEqual(currentResult?.resultRunId, resultRunID)
        XCTAssertNil(configured.store.acceptingProposalID)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testRootDisappearDoesNotCloseAThreadThatAlreadyOwnsFocus() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID
            ),
            delay: .milliseconds(100),
            focusThread: true
        )
        let acceptance = Task {
            await configured.store.acceptProposal(
                channelID: channelID,
                proposalID: proposalID,
                projectID: projectID
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        // ChannelMessagesView can disappear as NavigationStack pushes its
        // thread. Its close hook must not invalidate the child-owned request.
        configured.store.closeChannelFocus(channelID: channelID)

        let result = await acceptance.value
        XCTAssertEqual(result?.resultRunId, resultRunID)
        XCTAssertEqual(configured.store.thread.first?.proposal?.status, .accepted)
        configured.store.applicationDidEnterBackground()
    }

    private func summary(
        id: UUID,
        name: String,
        organizationID: UUID? = nil,
        archivedAt: Date? = nil
    ) -> ChannelSummary {
        ChannelSummary(
            id: id,
            organizationId: organizationID ?? self.organizationID,
            slug: name.lowercased(),
            name: name,
            topic: nil,
            visibility: .org,
            defaultProjectId: nil,
            archivedAt: archivedAt,
            memberCount: 1,
            agentCount: 1,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func message(
        id: UUID,
        channelID: UUID,
        parentMessageID: UUID? = nil,
        body: String,
        replyCount: Int = 0,
        lastReplyAt: Date? = nil,
        createdAt: Date = Date(timeIntervalSince1970: 1_700_000_010),
        authorKind: ChannelMessage.Author.Kind = .user,
        proposal: ChannelMessage.Proposal? = nil
    ) -> ChannelMessage {
        ChannelMessage(
            id: id,
            channelId: channelID,
            parentMessageId: parentMessageID,
            body: body,
            author: .init(
                type: authorKind,
                name: authorKind == .agent ? "Project Agent" : "Jay",
                image: nil,
                provider: authorKind == .agent ? "codex" : nil
            ),
            replyCount: replyCount,
            lastReplyAt: lastReplyAt,
            document: nil,
            proposal: proposal,
            createdAt: createdAt
        )
    }

    @MainActor
    private func proposalStore(
        response: AcceptChannelProposalResponse?,
        delay: Duration? = nil,
        delta: ChannelDeltaResponse? = nil,
        refreshedProposal: ChannelMessage.Proposal? = nil,
        focusChangeResponse: ChannelDetailResponse? = nil,
        focusThread: Bool = false,
        malformedAcceptance: Bool = false,
        additionalAcceptanceResponses: [AcceptChannelProposalResponse] = [],
        acceptanceDelays: [Duration]? = nil
    ) async throws -> (
        store: ChannelsStore,
        api: ChannelPollingAPI,
        acceptPath: String
    ) {
        let channel = summary(id: channelID, name: "Briar")
        let proposal = ChannelMessage.Proposal(
            id: proposalID,
            actionType: .createIssue,
            status: .pending,
            projectId: nil,
            payload: ChannelMessage.Proposal.Payload(
                issue: ChannelMessage.Proposal.Payload.Issue(
                    title: "Build onboarding",
                    description: "Ship the guided setup.",
                    priority: 2,
                    status: .backlog
                )
            ),
            resultRunId: nil
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID
        )
        let acceptPath = MobileAPIContract.Endpoint.acceptChannelProposal(
            organizationID: organizationID,
            channelID: channelID,
            proposalID: proposalID
        )
        var detailResponses = [try encoded(ChannelDetailResponse(
            channel: channel,
            members: [],
            agents: [],
            messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Issue proposal",
                authorKind: .agent,
                proposal: proposal
            )]
        ))]
        if let refreshedProposal {
            detailResponses.append(try encoded(ChannelDetailResponse(
                channel: channel,
                members: [],
                agents: [],
                messages: [message(
                    id: rootID,
                    channelID: channelID,
                    body: "Issue proposal",
                    authorKind: .agent,
                    proposal: refreshedProposal
                )]
            )))
        }
        var routes: [String: [Data]] = [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
            detailPath: detailResponses,
        ]
        if focusThread {
            routes[MobileAPIContract.Endpoint.channelMessages(
                organizationID: organizationID,
                channelID: channelID,
                parentMessageID: rootID
            )] = [try encoded(ChannelMessagesResponse(messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Issue proposal",
                authorKind: .agent,
                proposal: proposal
            )]))]
        }
        if let response {
            routes[acceptPath] = try ([response] + additionalAcceptanceResponses).map {
                try encoded($0)
            }
        } else if malformedAcceptance {
            routes[acceptPath] = [Data("{}".utf8)] +
                (try additionalAcceptanceResponses.map { try encoded($0) })
        }
        if let delta {
            routes[MobileAPIContract.Endpoint.channelChanges(
                organizationID: organizationID,
                cursor: 10
            )] = [try encoded(delta)]
        }
        if let focusChangeResponse {
            routes[MobileAPIContract.Endpoint.channel(
                organizationID: organizationID,
                channelID: focusChangeResponse.channel.id
            )] = [try encoded(focusChangeResponse)]
        }
        let api = ChannelPollingAPI(
            routes: routes,
            delays: delay.map { [acceptPath: $0] } ?? [:],
            requestDelays: acceptanceDelays.map { [acceptPath: $0] } ?? [:]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))
        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        if focusThread {
            await store.openThread(channelID: channelID, parentMessageID: rootID)
        }
        return (store, api, acceptPath)
    }

    private func emptyDelta(cursor: Int) -> ChannelDeltaResponse {
        ChannelDeltaResponse(
            cursor: cursor,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [],
            removedMessageIds: []
        )
    }

    @MainActor
    private func waitForRequests(
        _ api: ChannelPollingAPI,
        path: String,
        count: Int,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<100 {
            if await api.requestCount(for: path) >= count { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for \(count) request(s) to \(path)", file: file, line: line)
    }

    @MainActor
    private func waitForChannels(
        _ store: ChannelsStore,
        count: Int,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<100 {
            if store.channels.count >= count { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for \(count) channel(s)", file: file, line: line)
    }
}

private actor ChannelPollingAPI: MobileAPIClientProtocol {
    private var routes: [String: [Data]]
    private let repeating: [String: Data]
    private let delays: [String: Duration]
    private var requestDelays: [String: [Duration]]
    private var requests: [String] = []

    init(
        routes: [String: [Data]],
        repeating: [String: Data] = [:],
        delays: [String: Duration] = [:],
        requestDelays: [String: [Duration]] = [:]
    ) {
        self.routes = routes
        self.repeating = repeating
        self.delays = delays
        self.requestDelays = requestDelays
    }

    func requestCount(for path: String) -> Int {
        requests.filter { $0 == path }.count
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        requests.append(path)
        let data: Data
        if var queued = routes[path], !queued.isEmpty {
            data = queued.removeFirst()
            routes[path] = queued
        } else if let repeated = repeating[path] {
            data = repeated
        } else {
            throw MobileAPIError.httpStatus(404, "Missing test route: \(path)")
        }
        var delay = delays[path]
        if var queuedDelays = requestDelays[path], !queuedDelays.isEmpty {
            delay = queuedDelays.removeFirst()
            requestDelays[path] = queuedDelays
        }
        if let delay {
            try await Task.sleep(for: delay)
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

private func encoded<Value: Encodable>(_ value: Value) throws -> Data {
    try JSONEncoder.mobileContract.encode(value)
}
