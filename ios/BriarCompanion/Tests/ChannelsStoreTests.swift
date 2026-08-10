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
                channels: [],
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

    private func summary(
        id: UUID,
        name: String,
        organizationID: UUID? = nil
    ) -> ChannelSummary {
        ChannelSummary(
            id: id,
            organizationId: organizationID ?? self.organizationID,
            slug: name.lowercased(),
            name: name,
            topic: nil,
            visibility: .org,
            defaultProjectId: nil,
            archivedAt: nil,
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
        authorKind: ChannelMessage.Author.Kind = .user
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
            proposal: nil,
            createdAt: createdAt
        )
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
    private var requests: [String] = []

    init(
        routes: [String: [Data]],
        repeating: [String: Data] = [:],
        delays: [String: Duration] = [:]
    ) {
        self.routes = routes
        self.repeating = repeating
        self.delays = delays
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
        if let delay = delays[path] {
            try await Task.sleep(for: delay)
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
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

private func encoded<Value: Encodable>(_ value: Value) throws -> Data {
    try JSONEncoder.mobileContract.encode(value)
}
