import BriarContracts
import Foundation

protocol MobileRealtimeClientProtocol: Sendable {
    func realtimeEvents(
        organizationID: UUID,
        token: String
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error>

    func channelActivityEvents(
        organizationID: UUID,
        channelID: UUID,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error>

    func issueActivityEvents(
        projectID: UUID,
        runID: UUID,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error>
}

protocol MobileWebSocketConnection: Sendable {
    func resume()
    func receiveData() async throws -> Data
    func cancel()
}

protocol MobileWebSocketSession: Sendable {
    func connection(url: URL) -> any MobileWebSocketConnection
}

private final class URLSessionWebSocketConnection: MobileWebSocketConnection, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    func resume() {
        task.resume()
    }

    func receiveData() async throws -> Data {
        switch try await task.receive() {
        case .data(let data):
            return data
        case .string:
            throw MobileAPIError.invalidResponse
        @unknown default:
            throw MobileAPIError.invalidResponse
        }
    }

    func cancel() {
        task.cancel(with: .goingAway, reason: nil)
    }
}

private struct URLSessionWebSocketSession: MobileWebSocketSession {
    let session: URLSession

    func connection(url: URL) -> any MobileWebSocketConnection {
        URLSessionWebSocketConnection(task: session.webSocketTask(with: url))
    }
}

struct RealtimeConnectClient: Sendable {
    private let service: any BriarAPI_RealtimeServiceClientInterface
    private let socketSession: any MobileWebSocketSession

    init(
        service: any BriarAPI_RealtimeServiceClientInterface,
        socketSession: any MobileWebSocketSession
    ) {
        self.service = service
        self.socketSession = socketSession
    }

    func organizationEvents(
        organizationID: UUID
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error> {
        var scope = BriarAPI_CreateRealtimeTicketRequest.OrganizationNotifications()
        scope.organizationID = coreUUIDString(organizationID)
        var request = BriarAPI_CreateRealtimeTicketRequest()
        request.organizationNotifications = scope
        return webSocketEvents(request: request) { data in
            let message = try BriarRealtime_OrganizationNotification(
                serializedBytes: data
            )
            return try ChannelRealtimeNotification(protobuf: message)
        }
    }

    func channelActivityEvents(
        organizationID: UUID,
        channelID: UUID
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error> {
        var scope = BriarAPI_CreateRealtimeTicketRequest.ChannelActivity()
        scope.organizationID = coreUUIDString(organizationID)
        scope.channelID = coreUUIDString(channelID)
        var request = BriarAPI_CreateRealtimeTicketRequest()
        request.channelActivity = scope
        return webSocketEvents(request: request) { data in
            let message = try BriarRealtime_AgentReplyActivityFrame(
                serializedBytes: data
            )
            guard case .channel(let frame) = try AgentReplyActivityFrame(
                protobuf: message
            ) else { throw MobileAPIError.invalidResponse }
            return frame
        }
    }

    func issueActivityEvents(
        projectID: UUID,
        runID: UUID
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error> {
        var scope = BriarAPI_CreateRealtimeTicketRequest.IssueActivity()
        scope.projectID = coreUUIDString(projectID)
        scope.runID = coreUUIDString(runID)
        var request = BriarAPI_CreateRealtimeTicketRequest()
        request.issueActivity = scope
        return webSocketEvents(request: request) { data in
            let message = try BriarRealtime_AgentReplyActivityFrame(
                serializedBytes: data
            )
            guard case .issue(let frame) = try AgentReplyActivityFrame(
                protobuf: message
            ) else { throw MobileAPIError.invalidResponse }
            return frame
        }
    }

    private func webSocketEvents<Event: Sendable>(
        request: BriarAPI_CreateRealtimeTicketRequest,
        decode: @escaping @Sendable (Data) throws -> Event
    ) -> AsyncThrowingStream<Event, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let response = try await service.createRealtimeTicket(
                        request: request,
                        headers: [:]
                    ).briarValue()
                    try Task.checkCancellation()
                    let url = try Self.webSocketURL(response.url)
                    let socket = socketSession.connection(url: url)
                    socket.resume()
                    try await withTaskCancellationHandler {
                        while !Task.isCancelled {
                            continuation.yield(try decode(await socket.receiveData()))
                        }
                    } onCancel: {
                        socket.cancel()
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    if Task.isCancelled {
                        continuation.finish()
                    } else {
                        continuation.finish(throwing: error)
                    }
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func webSocketURL(_ value: String) throws -> URL {
        guard
            let url = URL(string: value),
            let scheme = url.scheme?.lowercased(),
            scheme == "ws" || scheme == "wss",
            url.host != nil
        else {
            throw MobileAPIError.invalidRequest
        }
        return url
    }
}

extension MobileServiceClientFactory: MobileRealtimeClientProtocol {
    func realtimeEvents(
        organizationID: UUID,
        token: String
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error> {
        realtimeClient(token: token).organizationEvents(
            organizationID: organizationID
        )
    }

    func channelActivityEvents(
        organizationID: UUID,
        channelID: UUID,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error> {
        realtimeClient(token: token).channelActivityEvents(
            organizationID: organizationID,
            channelID: channelID
        )
    }

    func issueActivityEvents(
        projectID: UUID,
        runID: UUID,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error> {
        realtimeClient(token: token).issueActivityEvents(
            projectID: projectID,
            runID: runID
        )
    }

    private func realtimeClient(token: String) -> RealtimeConnectClient {
        RealtimeConnectClient(
            service: authenticatedServices(token: token).realtime,
            socketSession: URLSessionWebSocketSession(session: session)
        )
    }
}
