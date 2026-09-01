import BriarContracts
import BriarContractsMocks
import XCTest
@testable import BriarCompanion

final class RealtimeConnectTests: XCTestCase {
    private let organizationID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let channelID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private let projectID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    private let runID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!

    func testGeneratedClientReceivesEveryRealtimeOneofScope() async throws {
        let requests = RealtimeRequestRecorder()
        let service = BriarAPI_RealtimeServiceClientMock()
        service.mockAsyncCreateRealtimeTicket = { request in
            requests.append(request)
            var response = BriarAPI_CreateRealtimeTicketResponse()
            response.url = "wss://api.example.test/realtime?ticket=signed"
            return .init(result: .success(response))
        }
        let sockets = RealtimeSocketSession(connection: FinishingWebSocketConnection())
        let client = RealtimeConnectClient(service: service, socketSession: sockets)

        try await drain(client.organizationEvents(organizationID: organizationID))
        try await drain(client.channelActivityEvents(
            organizationID: organizationID,
            channelID: channelID
        ))
        try await drain(client.issueActivityEvents(projectID: projectID, runID: runID))

        let recorded = requests.values
        XCTAssertEqual(recorded.count, 3)
        guard case .organizationNotifications(let organization)? = recorded[0].scope else {
            return XCTFail("Expected organization notifications scope")
        }
        XCTAssertEqual(organization.organizationID, coreUUIDString(organizationID))
        guard case .channelActivity(let channel)? = recorded[1].scope else {
            return XCTFail("Expected channel activity scope")
        }
        XCTAssertEqual(channel.organizationID, coreUUIDString(organizationID))
        XCTAssertEqual(channel.channelID, coreUUIDString(channelID))
        guard case .issueActivity(let issue)? = recorded[2].scope else {
            return XCTFail("Expected issue activity scope")
        }
        XCTAssertEqual(issue.projectID, coreUUIDString(projectID))
        XCTAssertEqual(issue.runID, coreUUIDString(runID))
        XCTAssertEqual(sockets.urls.count, 3)
    }

    func testInvalidTicketURLNeverReachesWebSocketTransport() async {
        let service = BriarAPI_RealtimeServiceClientMock()
        service.mockAsyncCreateRealtimeTicket = { _ in
            var response = BriarAPI_CreateRealtimeTicketResponse()
            response.url = "https://api.example.test/not-a-websocket"
            return .init(result: .success(response))
        }
        let sockets = RealtimeSocketSession(connection: FinishingWebSocketConnection())
        let client = RealtimeConnectClient(service: service, socketSession: sockets)

        do {
            try await drain(client.organizationEvents(organizationID: organizationID))
            XCTFail("Expected invalid WebSocket URL to fail")
        } catch {
            XCTAssertEqual(error as? MobileAPIError, .invalidRequest)
        }
        XCTAssertTrue(sockets.urls.isEmpty)
    }

    func testCancellingConsumerCancelsWebSocketConnection() async throws {
        let service = BriarAPI_RealtimeServiceClientMock()
        service.mockAsyncCreateRealtimeTicket = { _ in
            var response = BriarAPI_CreateRealtimeTicketResponse()
            response.url = "wss://api.example.test/realtime?ticket=signed"
            return .init(result: .success(response))
        }
        let connection = BlockingWebSocketConnection()
        let sockets = RealtimeSocketSession(connection: connection)
        let client = RealtimeConnectClient(service: service, socketSession: sockets)
        let stream = client.organizationEvents(organizationID: organizationID)
        let consumer = Task {
            for try await _ in stream {}
        }

        try await waitUntil { connection.didResume }
        consumer.cancel()
        _ = try? await consumer.value
        try await waitUntil { connection.didCancel }

        XCTAssertTrue(connection.didCancel)
    }

    private func drain<Event>(
        _ stream: AsyncThrowingStream<Event, Error>
    ) async throws {
        for try await _ in stream {}
    }

    private func waitUntil(
        _ condition: @escaping @Sendable () -> Bool
    ) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(condition())
    }
}

private final class RealtimeRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [BriarAPI_CreateRealtimeTicketRequest] = []

    var values: [BriarAPI_CreateRealtimeTicketRequest] {
        lock.withLock { storage }
    }

    func append(_ request: BriarAPI_CreateRealtimeTicketRequest) {
        lock.withLock { storage.append(request) }
    }
}

private final class RealtimeSocketSession: MobileWebSocketSession, @unchecked Sendable {
    private let lock = NSLock()
    private let socket: any MobileWebSocketConnection
    private var recordedURLs: [URL] = []

    init(connection: any MobileWebSocketConnection) {
        socket = connection
    }

    var urls: [URL] {
        lock.withLock { recordedURLs }
    }

    func connection(url: URL) -> any MobileWebSocketConnection {
        lock.withLock { recordedURLs.append(url) }
        return socket
    }
}

private final class FinishingWebSocketConnection: MobileWebSocketConnection, @unchecked Sendable {
    func resume() {}

    func receiveData() async throws -> Data {
        throw CancellationError()
    }

    func cancel() {}
}

private final class BlockingWebSocketConnection: MobileWebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false
    private var cancelled = false

    var didResume: Bool {
        lock.withLock { resumed }
    }

    var didCancel: Bool {
        lock.withLock { cancelled }
    }

    func resume() {
        lock.withLock { resumed = true }
    }

    func receiveData() async throws -> Data {
        try await Task.sleep(for: .seconds(3_600))
        return Data()
    }

    func cancel() {
        lock.withLock { cancelled = true }
    }
}
