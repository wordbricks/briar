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
    private let executionProposalID = UUID(
        uuidString: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"
    )!
    private let skillExecutionProposalID = UUID(
        uuidString: "abababab-abab-4bab-8bab-abababababab"
    )!
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
    func testLoadsTwentyNewestMessagesThenPrependsAnEarlierPage() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let cursor = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let olderID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let latestID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let older = message(
            id: olderID,
            channelID: channelID,
            body: "Older",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let latest = message(
            id: latestID,
            channelID: channelID,
            body: "Latest",
            createdAt: Date(timeIntervalSince1970: 1_700_000_010)
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
        )
        let earlierPath = MobileAPIContract.Endpoint.channelMessages(
            organizationID: organizationID,
            channelID: channelID,
            cursor: cursor,
            limit: ChannelsStore.messagePageSize
        )
        let navigationPath = MobileAPIContract.Endpoint.channelMessages(
            organizationID: organizationID,
            channelID: channelID,
            parentMessageID: olderID
        )
        let api = ChannelPollingAPI(routes: [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
            detailPath: [try encoded(ChannelDetailResponse(
                channel: channel,
                members: [],
                agents: [],
                messages: [latest],
                nextCursor: cursor
            ))],
            earlierPath: [try encoded(ChannelMessagesResponse(
                messages: [older],
                nextCursor: nil
            ))],
            navigationPath: [try encoded(ChannelMessagesResponse(
                messages: [older],
                nextCursor: nil
            ))],
        ])
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)

        XCTAssertEqual(store.messages.map(\.id), [latestID])
        XCTAssertTrue(store.hasEarlierMessages)
        let navigatedRoot = await store.loadRootMessageForNavigation(
            channelID: channelID,
            messageID: olderID
        )
        XCTAssertEqual(navigatedRoot?.id, olderID)
        XCTAssertEqual(store.messages.map(\.id), [olderID, latestID])
        await store.loadEarlierMessages(channelID: channelID)

        XCTAssertEqual(store.messages.map(\.id), [olderID, latestID])
        XCTAssertFalse(store.hasEarlierMessages)
        let navigationRequestCount = await api.requestCount(for: navigationPath)
        let earlierRequestCount = await api.requestCount(for: earlierPath)
        XCTAssertEqual(navigationRequestCount, 1)
        XCTAssertEqual(earlierRequestCount, 1)
        store.applicationDidEnterBackground()
    }

    @MainActor
    func testReopeningChannelShowsCachedMessagesWhileRefreshing() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let cached = message(id: rootID, channelID: channelID, body: "Cached immediately")
        let refreshed = message(id: rootID, channelID: channelID, body: "Refreshed")
        let staleReply = ChannelAgentReply(
            id: proposalID,
            agentId: projectID,
            channelId: channelID,
            triggerMessageId: rootID,
            parentMessageId: rootID,
            replyMessageId: replyID,
            status: .running,
            attempts: 1,
            error: nil,
            createdAt: Date(timeIntervalSince1970: 1_700_000_020),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_021)
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
        )
        let api = ChannelPollingAPI(
            routes: [
                listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
                detailPath: [
                    try encoded(ChannelDetailResponse(
                        channel: channel,
                        members: [],
                        agents: [],
                        messages: [cached],
                        agentReplies: [staleReply]
                    )),
                    try encoded(ChannelDetailResponse(
                        channel: channel,
                        members: [],
                        agents: [],
                        messages: [refreshed]
                    )),
                ],
            ],
            requestDelays: [
                detailPath: [.zero, .milliseconds(200)],
            ]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))

        store.select(organizationID: organizationID, token: "token")
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        XCTAssertEqual(store.agentReplies.map(\.id), [staleReply.id])
        store.closeChannelFocus(channelID: channelID)

        let refresh = Task { await store.openChannel(channelID) }
        await waitForRequests(api, path: detailPath, count: 2)

        XCTAssertEqual(store.messages.first?.body, "Cached immediately")
        XCTAssertTrue(store.agentReplies.isEmpty)
        XCTAssertTrue(store.loading)

        await refresh.value
        XCTAssertEqual(store.messages.first?.body, "Refreshed")
        XCTAssertFalse(store.loading)
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
    func testRealtimeCursorNotificationFetchesAuthoritativeDelta() async throws {
        let channel = summary(id: channelID, name: "Briar")
        let updated = summary(id: channelID, name: "Briar realtime")
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let deltaPath = MobileAPIContract.Endpoint.channelChanges(
            organizationID: organizationID,
            cursor: 5
        )
        let api = ChannelPollingAPI(routes: [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 5))],
            deltaPath: [try encoded(ChannelDeltaResponse(
                cursor: 6,
                hasMore: false,
                channels: [updated],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: []
            ))],
        ])
        let realtime = ChannelRealtimeStub()
        let store = ChannelsStore(
            api: api,
            realtime: realtime,
            pollInterval: .seconds(3_600)
        )

        store.select(organizationID: organizationID, token: "token")
        await waitForChannels(store, count: 1)
        realtime.send(ChannelRealtimeNotification(topic: "channels", cursor: 6))
        await waitForRequests(api, path: deltaPath, count: 1)
        for _ in 0..<100 {
            if store.channels.first?.name == "Briar realtime" { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(store.channels.first?.name, "Briar realtime")
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
        await waitForRequests(api, path: deltaPath, count: 2)
        for _ in 0..<100 where store.messages.first?.replyCount != 1 {
            try? await Task.sleep(for: .milliseconds(10))
        }
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
    func testCreateApprovalOnlyMaterializesASeparatePendingExecutionProposal() async throws {
        let configured = try await proposalStore(
            response: AcceptChannelProposalResponse(
                outcome: .accepted,
                projectId: projectID,
                resultRunId: resultRunID,
                executionProposal: executionProposal()
            ),
            requestsExecutionFollowUp: true
        )

        let result = await configured.store.acceptProposal(
            channelID: channelID,
            proposalID: proposalID,
            projectID: projectID
        )

        XCTAssertEqual(result?.outcome, .accepted)
        XCTAssertEqual(configured.store.messages.first?.proposal?.status, .accepted)
        XCTAssertEqual(
            configured.store.messages.first?.executionProposal?.status,
            .pending
        )
        let executionAcceptPath = MobileAPIContract.Endpoint.acceptChannelExecutionProposal(
            organizationID: organizationID,
            channelID: channelID,
            proposalID: executionProposalID
        )
        let executionRequests = await configured.api.requestCount(for: executionAcceptPath)
        XCTAssertEqual(executionRequests, 0, "create acceptance must never auto-dispatch")
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
        )
        let detailRequests = await configured.api.requestCount(for: detailPath)
        XCTAssertEqual(
            detailRequests,
            1,
            "the accept response should materialize the follow-up without a race-prone reload"
        )
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
                    proposal: transferredProposal,
                    executionProposal: executionProposal(
                        projectID: transferredProjectID,
                        runID: transferredRunID
                    )
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
        XCTAssertEqual(navigableResult?.executionProposal?.projectId, transferredProjectID)
        XCTAssertEqual(navigableResult?.executionProposal?.runId, transferredRunID)
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

    @MainActor
    func testPreparingExecutionApprovalUsesTheTargetProjectCapabilitySnapshot() async throws {
        let configured = try await executionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)]
        )

        let context = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )

        XCTAssertEqual(context?.proposalID, executionProposalID)
        XCTAssertEqual(context?.snapshot.project.id, projectID)
        XCTAssertEqual(context?.snapshot.organizationProviders, [.codex])
        XCTAssertEqual(context?.snapshot.workers?.map(\.id), ["worker-1"])
        XCTAssertEqual(context?.snapshot.executionPolicy?.selectionMode, .allowlist)
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(dashboardRequests, 1)
        XCTAssertEqual(approvalRequests, 0)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testExecutionApprovalRechecksImmediatelyBeforeAndAfterTheMutation() async throws {
        let pendingSnapshot = executionDashboard(dispatched: false)
        let configured = try await executionProposalStore(
            dashboardSnapshots: [
                pendingSnapshot,
                pendingSnapshot,
                executionDashboard(dispatched: true),
            ],
            approvalResponse: executionApprovalResponse()
        )
        let context = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )
        XCTAssertNotNil(context)

        let result = await configured.store.acceptExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID,
            request: executionApprovalRequest()
        )

        XCTAssertEqual(result?.outcome, .accepted)
        XCTAssertEqual(configured.store.messages.first?.executionProposal?.status, .accepted)
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(
            dashboardRequests,
            3,
            "open, pre-submit, and post-response must each read the exact target dashboard"
        )
        XCTAssertEqual(approvalRequests, 1)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testDelayedPendingDeltaCannotRegressLocallyAcceptedExecutionProposal() async throws {
        let pendingDelta = ChannelDeltaResponse(
            cursor: 11,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Delayed pending execution proposal",
                authorKind: .agent,
                executionProposal: executionProposal()
            )],
            removedMessageIds: []
        )
        let configured = try await executionProposalStore(
            dashboardSnapshots: [
                executionDashboard(dispatched: false),
                executionDashboard(dispatched: true),
            ],
            approvalResponse: executionApprovalResponse(),
            delta: pendingDelta
        )

        let accepted = await configured.store.acceptExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID,
            request: executionApprovalRequest()
        )
        XCTAssertEqual(accepted?.proposal.status, .accepted)

        await configured.store.refreshChanges()

        XCTAssertEqual(
            configured.store.messages.first?.executionProposal?.status,
            .accepted
        )
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testNewExecutionProposalIDStillTombstonesLocallyAcceptedProposal() async throws {
        let replacementID = UUID(uuidString: "edededed-eded-4ded-8ded-edededededed")!
        let replacementDelta = ChannelDeltaResponse(
            cursor: 11,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Replacement execution proposal",
                authorKind: .agent,
                executionProposal: executionProposal(id: replacementID)
            )],
            removedMessageIds: []
        )
        let configured = try await executionProposalStore(
            dashboardSnapshots: [
                executionDashboard(dispatched: false),
                executionDashboard(dispatched: true),
            ],
            approvalResponse: executionApprovalResponse(),
            delta: replacementDelta
        )
        let accepted = await configured.store.acceptExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID,
            request: executionApprovalRequest()
        )
        XCTAssertNotNil(accepted)

        await configured.store.refreshChanges()

        XCTAssertEqual(configured.store.messages.first?.executionProposal?.id, replacementID)
        XCTAssertEqual(configured.store.messages.first?.executionProposal?.status, .pending)
        let replacedContext = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )
        XCTAssertNil(replacedContext)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testNullExecutionProposalStillTombstonesLocallyAcceptedProposal() async throws {
        let tombstoneDelta = ChannelDeltaResponse(
            cursor: 11,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Execution proposal removed",
                authorKind: .agent,
                executionProposal: nil
            )],
            removedMessageIds: []
        )
        let configured = try await executionProposalStore(
            dashboardSnapshots: [
                executionDashboard(dispatched: false),
                executionDashboard(dispatched: true),
            ],
            approvalResponse: executionApprovalResponse(),
            delta: tombstoneDelta
        )
        let accepted = await configured.store.acceptExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID,
            request: executionApprovalRequest()
        )
        XCTAssertNotNil(accepted)

        await configured.store.refreshChanges()

        XCTAssertNil(configured.store.messages.first?.executionProposal)
        let removedContext = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )
        XCTAssertNil(removedContext)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testExecutionProposalTombstoneInvalidatesDelayedApprovalResponse() async throws {
        let tombstone = message(
            id: rootID,
            channelID: channelID,
            body: "Execution proposal removed after transfer",
            authorKind: .agent,
            executionProposal: nil
        )
        let configured = try await executionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: executionApprovalResponse(),
            approvalDelay: .milliseconds(120),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [],
                removedChannelIds: [],
                messages: [tombstone],
                removedMessageIds: []
            )
        )
        let approval = Task {
            await configured.store.acceptExecutionProposal(
                channelID: channelID,
                proposalID: executionProposalID,
                request: executionApprovalRequest()
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        await configured.store.refreshChanges()
        let result = await approval.value

        XCTAssertNil(result)
        XCTAssertNil(configured.store.messages.first?.executionProposal)
        XCTAssertNil(configured.store.approvingExecutionProposalID)
        XCTAssertNil(configured.store.errorMessage)
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        XCTAssertEqual(
            dashboardRequests,
            1,
            "a tombstone must prevent the delayed response from triggering postflight or UI state"
        )
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testArchivingChannelInvalidatesDelayedExecutionApprovalResponse() async throws {
        let archived = summary(
            id: channelID,
            name: "Briar",
            archivedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
        let configured = try await executionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: executionApprovalResponse(),
            approvalDelay: .milliseconds(120),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [archived],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: []
            )
        )
        let approval = Task {
            await configured.store.acceptExecutionProposal(
                channelID: channelID,
                proposalID: executionProposalID,
                request: executionApprovalRequest()
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        await configured.store.refreshChanges()
        let result = await approval.value

        XCTAssertNil(result)
        XCTAssertNotNil(configured.store.channels.first?.archivedAt)
        XCTAssertEqual(configured.store.messages.first?.executionProposal?.status, .pending)
        XCTAssertNil(configured.store.approvingExecutionProposalID)
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        XCTAssertEqual(dashboardRequests, 1)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testAuthoritativeReloadInvalidatesAnExecutionProposalWhoseMessageWasRemoved() async throws {
        let configured = try await executionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            additionalDetailMessages: [[]]
        )
        let prepared = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )
        XCTAssertNotNil(prepared)

        await configured.store.openChannel(channelID)
        let result = await configured.store.acceptExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID,
            request: executionApprovalRequest()
        )

        XCTAssertTrue(configured.store.messages.isEmpty)
        XCTAssertNil(result)
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(approvalRequests, 0)
        configured.store.applicationDidEnterBackground()
    }

    func testArchivedChannelCannotOpenSkillExecutionApproval() {
        let proposal = skillExecutionProposal()
        XCTAssertTrue(
            channelSkillExecutionProposalApprovalIsEnabled(
                acceptanceInFlight: false,
                channelArchived: false,
                proposal: proposal
            )
        )
        XCTAssertFalse(
            channelSkillExecutionProposalApprovalIsEnabled(
                acceptanceInFlight: false,
                channelArchived: true,
                proposal: proposal
            )
        )
        XCTAssertFalse(
            channelSkillExecutionProposalApprovalIsEnabled(
                acceptanceInFlight: false,
                channelArchived: false,
                proposal: skillExecutionProposal(status: .accepted)
            )
        )
    }

    @MainActor
    func testPreparingSkillExecutionApprovalOnlyLoadsEligibleWorkerContext() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)]
        )

        let context = await configured.store.prepareSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID
        )

        XCTAssertEqual(context?.proposalID, skillExecutionProposalID)
        XCTAssertEqual(context?.snapshot.project.id, projectID)
        XCTAssertEqual(context?.snapshot.workers?.map(\.id), ["worker-1"])
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(dashboardRequests, 1)
        XCTAssertEqual(approvalRequests, 0, "opening the sheet must never execute the Skill")
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSlowSkillPrepareCannotPresentAfterLeavingTheChannel() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            dashboardDelay: .milliseconds(120)
        )
        let preparation = Task {
            await configured.store.prepareSkillExecutionProposal(
                channelID: channelID,
                proposalID: skillExecutionProposalID
            )
        }
        await waitForRequests(configured.api, path: configured.dashboardPath, count: 1)

        configured.store.closeChannelFocus(channelID: channelID)
        let context = await preparation.value

        XCTAssertNil(context)
        XCTAssertNil(configured.store.preparingSkillExecutionProposalID)
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(approvalRequests, 0)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSkillAndIssueExecutionPreparationAreMutuallyExclusiveInFlight() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            dashboardDelay: .milliseconds(120),
            includeIssueExecutionProposal: true
        )
        let skillPreparation = Task {
            await configured.store.prepareSkillExecutionProposal(
                channelID: channelID,
                proposalID: skillExecutionProposalID
            )
        }
        await waitForRequests(configured.api, path: configured.dashboardPath, count: 1)

        let issueContext = await configured.store.prepareExecutionProposal(
            channelID: channelID,
            proposalID: executionProposalID
        )

        XCTAssertNil(issueContext)
        let dashboardRequests = await configured.api.requestCount(
            for: configured.dashboardPath
        )
        XCTAssertEqual(dashboardRequests, 1)
        let skillContext = await skillPreparation.value
        XCTAssertNotNil(skillContext)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSkillSubmitRechecksWorkerAvailabilityBeforePosting() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [
                executionDashboard(dispatched: false),
                executionDashboard(
                    dispatched: false,
                    workerReadiness: "busy",
                    workerAcceptingWork: false
                ),
            ],
            approvalResponse: skillExecutionApprovalResponse()
        )
        let opened = await configured.store.prepareSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID
        )
        XCTAssertNotNil(opened)

        let response = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )

        XCTAssertNil(response)
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .pending
        )
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(approvalRequests, 0)
        XCTAssertNotNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSkillExecutionApprovalSendsOnlyExactWorkerAndAppliesSessionResult() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse()
        )

        let response = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )

        XCTAssertEqual(response?.outcome, .accepted)
        XCTAssertEqual(response?.session.id, "session-1")
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .accepted
        )
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.resultSessionId,
            "session-1"
        )
        let recordedBody = await configured.api.lastJSONBody(for: configured.acceptPath)
        let bodyData = try XCTUnwrap(recordedBody)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        XCTAssertEqual(Set(body.keys), ["workerId"])
        XCTAssertEqual(body["workerId"] as? String, "worker-1")
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testDuplicateSkillApprovalTapPostsOnlyOnce() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse(),
            approvalDelay: .milliseconds(120)
        )
        let first = Task {
            await configured.store.acceptSkillExecutionProposal(
                channelID: channelID,
                proposalID: skillExecutionProposalID,
                request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        let duplicate = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )
        let accepted = await first.value

        XCTAssertNil(duplicate)
        XCTAssertEqual(accepted?.proposal.status, .accepted)
        let approvalRequests = await configured.api.requestCount(for: configured.acceptPath)
        XCTAssertEqual(approvalRequests, 1)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSkillApprovalRejectsAMismatchedReturnedSession() async throws {
        let malformed = AcceptAgentSkillExecutionProposalResponse(
            outcome: .accepted,
            proposal: skillExecutionProposal(status: .accepted),
            projectId: projectID,
            session: skillExecutionSession(id: "other-session")
        )
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: malformed
        )

        let response = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )

        XCTAssertNil(response)
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .pending
        )
        XCTAssertNotNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testDelayedPendingDeltaCannotRegressAcceptedSkillExecutionProposal() async throws {
        let pendingDelta = ChannelDeltaResponse(
            cursor: 11,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [message(
                id: rootID,
                channelID: channelID,
                body: "Delayed pending Skill proposal",
                authorKind: .agent,
                skillExecutionProposal: skillExecutionProposal()
            )],
            removedMessageIds: []
        )
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse(),
            delta: pendingDelta
        )

        let response = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )
        XCTAssertEqual(response?.proposal.status, .accepted)

        await configured.store.refreshChanges()

        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .accepted
        )
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testReactionResponsesPreserveAcceptedSkillProposalButHonorTombstone() async throws {
        let reactionPath = MobileAPIContract.Endpoint.channelMessageReactions(
            organizationID: organizationID,
            channelID: channelID,
            messageID: rootID
        )
        let stalePending = ToggleChannelMessageReactionResponse(message: message(
            id: rootID,
            channelID: channelID,
            body: "Skill execution proposal",
            authorKind: .agent,
            reactions: [ChannelMessageReaction(
                emoji: "👍",
                count: 1,
                userIds: ["fixture-user"]
            )],
            skillExecutionProposal: skillExecutionProposal()
        ))
        let tombstone = ToggleChannelMessageReactionResponse(message: message(
            id: rootID,
            channelID: channelID,
            body: "Skill execution proposal",
            authorKind: .agent,
            reactions: [ChannelMessageReaction(
                emoji: "👍",
                count: 0,
                userIds: []
            )],
            skillExecutionProposal: nil
        ))
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse(),
            reactionResponses: [stalePending, tombstone],
            reactionDelays: [.milliseconds(120), .zero]
        )
        let delayedReaction = Task {
            await configured.store.toggleReaction(
                channelID: channelID,
                messageID: rootID,
                emoji: "👍"
            )
        }
        await waitForRequests(configured.api, path: reactionPath, count: 1)

        let accepted = await configured.store.acceptSkillExecutionProposal(
            channelID: channelID,
            proposalID: skillExecutionProposalID,
            request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
        )
        await delayedReaction.value

        XCTAssertEqual(accepted?.proposal.status, .accepted)
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .accepted
        )
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.resultSessionId,
            "session-1"
        )
        XCTAssertEqual(configured.store.messages.first?.reactions.first?.count, 1)

        await configured.store.toggleReaction(
            channelID: channelID,
            messageID: rootID,
            emoji: "👍"
        )

        XCTAssertNil(configured.store.messages.first?.skillExecutionProposal)
        XCTAssertEqual(configured.store.messages.first?.reactions.first?.count, 0)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testSkillProposalRemovalInvalidatesDelayedApprovalResponse() async throws {
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse(),
            approvalDelay: .milliseconds(120),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: [rootID]
            )
        )
        let approval = Task {
            await configured.store.acceptSkillExecutionProposal(
                channelID: channelID,
                proposalID: skillExecutionProposalID,
                request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        await configured.store.refreshChanges()
        let response = await approval.value

        XCTAssertNil(response)
        XCTAssertTrue(configured.store.messages.isEmpty)
        XCTAssertNil(configured.store.approvingSkillExecutionProposalID)
        XCTAssertNil(configured.store.errorMessage)
        configured.store.applicationDidEnterBackground()
    }

    @MainActor
    func testArchivingChannelInvalidatesDelayedSkillApprovalResponse() async throws {
        let archived = summary(
            id: channelID,
            name: "Briar",
            archivedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
        let configured = try await skillExecutionProposalStore(
            dashboardSnapshots: [executionDashboard(dispatched: false)],
            approvalResponse: skillExecutionApprovalResponse(),
            approvalDelay: .milliseconds(120),
            delta: ChannelDeltaResponse(
                cursor: 11,
                hasMore: false,
                channels: [archived],
                removedChannelIds: [],
                messages: [],
                removedMessageIds: []
            )
        )
        let approval = Task {
            await configured.store.acceptSkillExecutionProposal(
                channelID: channelID,
                proposalID: skillExecutionProposalID,
                request: AcceptAgentSkillExecutionProposalRequest(workerId: "worker-1")
            )
        }
        await waitForRequests(configured.api, path: configured.acceptPath, count: 1)

        await configured.store.refreshChanges()
        let response = await approval.value

        XCTAssertNil(response)
        XCTAssertNotNil(configured.store.channels.first?.archivedAt)
        XCTAssertEqual(
            configured.store.messages.first?.skillExecutionProposal?.status,
            .pending
        )
        XCTAssertNil(configured.store.approvingSkillExecutionProposalID)
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
        reactions: [ChannelMessageReaction] = [],
        proposal: ChannelMessage.Proposal? = nil,
        executionProposal: IssueExecutionProposal? = nil,
        skillExecutionProposal: AgentSkillExecutionProposal? = nil
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
            reactions: reactions,
            replyCount: replyCount,
            lastReplyAt: lastReplyAt,
            document: nil,
            proposal: proposal,
            executionProposal: executionProposal,
            skillExecutionProposal: skillExecutionProposal,
            createdAt: createdAt
        )
    }

    private func executionProposal(
        id: UUID? = nil,
        status: IssueExecutionProposal.Status = .pending,
        projectID: UUID? = nil,
        runID: UUID? = nil
    ) -> IssueExecutionProposal {
        IssueExecutionProposal(
            id: id ?? executionProposalID,
            status: status,
            projectId: projectID ?? self.projectID,
            runId: runID ?? resultRunID,
            title: "Build onboarding",
            createdAt: Date(timeIntervalSince1970: 1_700_000_010),
            acceptedAt: status == .accepted ? Date(timeIntervalSince1970: 1_700_000_100) : nil,
            requestedProvider: status == .accepted ? .codex : nil,
            requestedModel: status == .accepted ? "gpt-5.6-sol" : nil,
            requestedEffort: status == .accepted ? .high : nil,
            requestedWorkerId: status == .accepted ? "worker-1" : nil,
            delegatedByAgentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666"),
            delegatedByAgentName: "Bumble"
        )
    }

    private func skillExecutionProposal(
        status: AgentSkillExecutionProposal.Status = .pending
    ) -> AgentSkillExecutionProposal {
        AgentSkillExecutionProposal(
            id: skillExecutionProposalID,
            status: status,
            projectId: projectID,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: "Project Agent",
            skillId: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
            skillName: "iOS 배포",
            request: "TestFlight에 최신 빌드를 배포해 줘",
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .high,
            createdAt: Date(timeIntervalSince1970: 1_700_000_010),
            acceptedAt: status == .accepted
                ? Date(timeIntervalSince1970: 1_700_000_100)
                : nil,
            requestedWorkerId: status == .accepted ? "worker-1" : nil,
            requestedWorkerLabel: status == .accepted ? "Build Mac" : nil,
            resultSessionId: status == .accepted ? "session-1" : nil,
            delegatedByAgentId: UUID(
                uuidString: "77777777-7777-4777-8777-777777777777"
            ),
            delegatedByAgentName: "Bumble"
        )
    }

    private func skillExecutionSession(id: String = "session-1") -> ProjectAgentSession {
        ProjectAgentSession(
            id: id,
            projectId: projectID,
            dispatchGroupId: nil,
            agentId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            agentName: "Project Agent",
            skillId: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "TestFlight에 최신 빌드를 배포해 줘",
            status: .running,
            issues: [],
            startedAt: Date(timeIntervalSince1970: 1_700_000_100),
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            requestedWorkerId: "worker-1",
            workerId: "worker-1",
            summary: nil,
            error: nil,
            events: nil,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
    }

    private func skillExecutionApprovalResponse()
        -> AcceptAgentSkillExecutionProposalResponse {
        AcceptAgentSkillExecutionProposalResponse(
            outcome: .accepted,
            proposal: skillExecutionProposal(status: .accepted),
            projectId: projectID,
            session: skillExecutionSession()
        )
    }

    private func executionApprovalRequest() -> AcceptIssueExecutionProposalRequest {
        AcceptIssueExecutionProposalRequest(
            provider: .codex,
            model: "gpt-5.6-sol",
            effort: .high,
            workerId: "worker-1"
        )
    }

    private func executionApprovalResponse() -> AcceptChannelExecutionProposalResponse {
        AcceptChannelExecutionProposalResponse(
            proposal: executionProposal(status: .accepted),
            outcome: .accepted,
            projectId: projectID,
            runId: resultRunID,
            dispatch: DispatchRunResponse(
                runId: resultRunID,
                agentId: nil,
                provider: .codex,
                model: "gpt-5.6-sol",
                effort: .high,
                requestedWorkerId: "worker-1",
                requestedByUserId: "fixture-user",
                dispatchMode: "specific",
                dispatchedAt: Date(timeIntervalSince1970: 1_700_000_100),
                outcome: "dispatched"
            )
        )
    }

    private func executionDashboard(
        dispatched: Bool,
        workerReadiness: String = "available",
        workerAcceptingWork: Bool = true
    ) -> DashboardSnapshot {
        let project = ProjectsResponse.Project(
            id: projectID,
            name: "Target",
            icon: nil,
            organizationId: organizationID,
            organizationName: "Wordbricks",
            role: .owner,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let run = DashboardRun(
            id: resultRunID,
            title: "Build onboarding",
            status: dispatched ? .queued : .backlog,
            executionReadiness: "ready",
            dispatchedAt: dispatched ? Date(timeIntervalSince1970: 1_700_000_100) : nil,
            requestedProvider: dispatched ? .codex : nil,
            requestedModel: dispatched ? "gpt-5.6-sol" : nil,
            requestedEffort: dispatched ? .high : nil,
            requestedWorkerId: dispatched ? "worker-1" : nil,
            requestedByUserId: dispatched ? "fixture-user" : nil,
            dispatchMode: dispatched ? "specific" : nil,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
        return DashboardSnapshot(
            project: project,
            runs: [run],
            workers: [DashboardWorker(
                id: "worker-1",
                label: "Build Mac",
                agentProvider: .codex,
                providers: [.codex],
                readiness: workerReadiness,
                acceptingWork: workerAcceptingWork,
                readinessDetail: nil,
                activeSessions: 0,
                availableSessions: 1
            )],
            organizationProviders: [.codex],
            executionPolicy: ProjectExecutionWorkerPolicy(
                selectionMode: .allowlist,
                defaultWorkerId: "worker-1",
                allowedWorkerIds: ["worker-1"],
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            ),
            cursor: 1,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
    }

    @MainActor
    private func executionProposalStore(
        dashboardSnapshots: [DashboardSnapshot],
        approvalResponse: AcceptChannelExecutionProposalResponse? = nil,
        approvalDelay: Duration? = nil,
        delta: ChannelDeltaResponse? = nil,
        additionalDetailMessages: [[ChannelMessage]] = []
    ) async throws -> (
        store: ChannelsStore,
        api: ChannelPollingAPI,
        dashboardPath: String,
        acceptPath: String
    ) {
        let channel = summary(id: channelID, name: "Briar")
        let initialMessage = message(
            id: rootID,
            channelID: channelID,
            body: "Execution proposal",
            authorKind: .agent,
            executionProposal: executionProposal()
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
        )
        let dashboardPath = MobileAPIContract.Endpoint.dashboard(projectID: projectID)
        let acceptPath = MobileAPIContract.Endpoint.acceptChannelExecutionProposal(
            organizationID: organizationID,
            channelID: channelID,
            proposalID: executionProposalID
        )
        var routes: [String: [Data]] = [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
            detailPath: try ([[initialMessage]] + additionalDetailMessages).map { messages in
                try encoded(ChannelDetailResponse(
                    channel: channel,
                    members: [],
                    agents: [],
                    messages: messages
                ))
            },
            dashboardPath: try dashboardSnapshots.map { try encoded($0) },
        ]
        if let approvalResponse {
            routes[acceptPath] = [try encoded(approvalResponse)]
        }
        if let delta {
            routes[MobileAPIContract.Endpoint.channelChanges(
                organizationID: organizationID,
                cursor: 10
            )] = [try encoded(delta)]
        }
        let api = ChannelPollingAPI(
            routes: routes,
            delays: approvalDelay.map { [acceptPath: $0] } ?? [:]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))
        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        return (store, api, dashboardPath, acceptPath)
    }

    @MainActor
    private func skillExecutionProposalStore(
        dashboardSnapshots: [DashboardSnapshot],
        approvalResponse: AcceptAgentSkillExecutionProposalResponse? = nil,
        approvalDelay: Duration? = nil,
        dashboardDelay: Duration? = nil,
        delta: ChannelDeltaResponse? = nil,
        includeIssueExecutionProposal: Bool = false,
        reactionResponses: [ToggleChannelMessageReactionResponse] = [],
        reactionDelays: [Duration]? = nil
    ) async throws -> (
        store: ChannelsStore,
        api: ChannelPollingAPI,
        dashboardPath: String,
        acceptPath: String
    ) {
        let channel = summary(id: channelID, name: "Briar")
        let initialMessage = message(
            id: rootID,
            channelID: channelID,
            body: "Skill execution proposal",
            authorKind: .agent,
            skillExecutionProposal: skillExecutionProposal()
        )
        let initialMessages = [initialMessage] + (includeIssueExecutionProposal
            ? [message(
                id: replyID,
                channelID: channelID,
                body: "Historical issue execution proposal",
                authorKind: .agent,
                executionProposal: executionProposal()
            )]
            : [])
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
        )
        let dashboardPath = MobileAPIContract.Endpoint.dashboard(projectID: projectID)
        let acceptPath = MobileAPIContract.Endpoint.acceptChannelSkillExecutionProposal(
            organizationID: organizationID,
            channelID: channelID,
            proposalID: skillExecutionProposalID
        )
        let reactionPath = MobileAPIContract.Endpoint.channelMessageReactions(
            organizationID: organizationID,
            channelID: channelID,
            messageID: rootID
        )
        var routes: [String: [Data]] = [
            listPath: [try encoded(ChannelsResponse(channels: [channel], cursor: 10))],
            detailPath: [try encoded(ChannelDetailResponse(
                channel: channel,
                members: [],
                agents: [],
                messages: initialMessages
            ))],
            dashboardPath: try dashboardSnapshots.map { try encoded($0) },
        ]
        if let approvalResponse {
            routes[acceptPath] = [try encoded(approvalResponse)]
        }
        if !reactionResponses.isEmpty {
            routes[reactionPath] = try reactionResponses.map { try encoded($0) }
        }
        if let delta {
            routes[MobileAPIContract.Endpoint.channelChanges(
                organizationID: organizationID,
                cursor: 10
            )] = [try encoded(delta)]
        }
        let api = ChannelPollingAPI(
            routes: routes,
            delays: {
                var configured: [String: Duration] = [:]
                if let approvalDelay { configured[acceptPath] = approvalDelay }
                if let dashboardDelay { configured[dashboardPath] = dashboardDelay }
                return configured
            }(),
            requestDelays: reactionDelays.map { [reactionPath: $0] } ?? [:]
        )
        let store = ChannelsStore(api: api, pollInterval: .seconds(3_600))
        store.select(organizationID: organizationID, token: "token")
        await waitForRequests(api, path: listPath, count: 1)
        await waitForChannels(store, count: 1)
        await store.openChannel(channelID)
        return (store, api, dashboardPath, acceptPath)
    }

    @MainActor
    private func proposalStore(
        response: AcceptChannelProposalResponse?,
        delay: Duration? = nil,
        delta: ChannelDeltaResponse? = nil,
        refreshedProposal: ChannelMessage.Proposal? = nil,
        refreshedExecutionProposal: IssueExecutionProposal? = nil,
        requestsExecutionFollowUp: Bool = false,
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
                ),
                executeAfterCreate: requestsExecutionFollowUp
            ),
            resultRunId: nil
        )
        let listPath = MobileAPIContract.Endpoint.channels(organizationID: organizationID)
        let detailPath = MobileAPIContract.Endpoint.channel(
            organizationID: organizationID,
            channelID: channelID,
            messageLimit: ChannelsStore.messagePageSize
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
                    proposal: refreshedProposal,
                    executionProposal: refreshedExecutionProposal
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
                channelID: focusChangeResponse.channel.id,
                messageLimit: ChannelsStore.messagePageSize
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

private final class ChannelRealtimeStub: MobileRealtimeClientProtocol, @unchecked Sendable {
    private let stream: AsyncThrowingStream<ChannelRealtimeNotification, Error>
    private let continuation: AsyncThrowingStream<ChannelRealtimeNotification, Error>.Continuation

    init() {
        var captured: AsyncThrowingStream<ChannelRealtimeNotification, Error>.Continuation?
        stream = AsyncThrowingStream { captured = $0 }
        continuation = captured!
    }

    func realtimeEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error> {
        stream
    }

    func send(_ notification: ChannelRealtimeNotification) {
        continuation.yield(notification)
    }
}

private actor ChannelPollingAPI: MobileAPIClientProtocol {
    private var routes: [String: [Data]]
    private let repeating: [String: Data]
    private let delays: [String: Duration]
    private var requestDelays: [String: [Duration]]
    private var requests: [String] = []
    private var JSONBodies: [String: [Data]] = [:]

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

    func lastJSONBody(for path: String) -> Data? {
        JSONBodies[path]?.last
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        requests.append(path)
        if let body {
            JSONBodies[path, default: []].append(
                try JSONEncoder.mobileContract.encode(ChannelTestAnyEncodable(body))
            )
        }
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

private struct ChannelTestAnyEncodable: Encodable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}

private func encoded<Value: Encodable>(_ value: Value) throws -> Data {
    try JSONEncoder.mobileContract.encode(value)
}
