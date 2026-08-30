import Connect
import Foundation

enum MobileAPIContract {
    static let iOSClientID = "briar-mobile"
    static let androidClientID = "briar-android"

    enum Endpoint {
        static let health = "/health"
        static let deviceCode = "/api/auth/device/code"
        static let deviceToken = "/api/auth/device/token"
        static let currentUser = "/me"
        static let inboxReadStates = "/inbox/read-states"

        static func inbox(organizationID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/inbox"
        }

        static func issues(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/issues"
        }

        static func run(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())"
        }

        static func runTransfer(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/transfer"
        }

        static func runSubscription(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/subscription"
        }

        static func dashboard(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/dashboard"
        }

        static func dashboardDelta(projectID: UUID, cursor: Int) -> String {
            "\(dashboard(projectID: projectID))/delta?cursor=\(cursor)"
        }


        static func channels(organizationID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channels"
        }

        static func directMessages(organizationID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/dms"
        }

        static func organizationMembers(organizationID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/members"
        }

        static func organizationAgents(organizationID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/agents"
        }

        static func channelChanges(organizationID: UUID, cursor: Int) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channel-changes?since=\(cursor)"
        }

        static func channelEvents(organizationID: UUID, cursor: Int) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channel-events?cursor=\(cursor)"
        }

        static func channelActivityEvents(organizationID: UUID, channelID: UUID) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/agent-activity-events"
        }

        static func issueActivityEvents(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/agent-activity-events"
        }

        static func channel(
            organizationID: UUID,
            channelID: UUID,
            messageLimit: Int? = nil
        ) -> String {
            let base = "\(channels(organizationID: organizationID))/\(channelID.uuidString.lowercased())"
            guard let messageLimit else { return base }
            return "\(base)?limit=\(messageLimit)"
        }

        static func channelRead(organizationID: UUID, channelID: UUID) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/read"
        }

        static func channelMessages(
            organizationID: UUID,
            channelID: UUID,
            parentMessageID: UUID? = nil,
            cursor: UUID? = nil,
            limit: Int? = nil
        ) -> String {
            let base = "\(channel(organizationID: organizationID, channelID: channelID))/messages"
            var query: [String] = []
            if let parentMessageID {
                query.append("parentMessageId=\(parentMessageID.uuidString.lowercased())")
            }
            if let limit { query.append("limit=\(limit)") }
            if let cursor { query.append("cursor=\(cursor.uuidString.lowercased())") }
            guard !query.isEmpty else { return base }
            return "\(base)?\(query.joined(separator: "&"))"
        }

        static func channelMessageReactions(
            organizationID: UUID,
            channelID: UUID,
            messageID: UUID
        ) -> String {
            "\(channelMessages(organizationID: organizationID, channelID: channelID))/\(messageID.uuidString.lowercased())/reactions"
        }

        static func channelMessage(
            organizationID: UUID,
            channelID: UUID,
            messageID: UUID
        ) -> String {
            "\(channelMessages(organizationID: organizationID, channelID: channelID))/\(messageID.uuidString.lowercased())"
        }

        static func channelThreadSubscription(
            organizationID: UUID,
            channelID: UUID,
            messageID: UUID
        ) -> String {
            "\(channelMessages(organizationID: organizationID, channelID: channelID))/\(messageID.uuidString.lowercased())/subscription"
        }

        static func acceptChannelProposal(
            organizationID: UUID,
            channelID: UUID,
            proposalID: UUID
        ) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func acceptChannelExecutionProposal(
            organizationID: UUID,
            channelID: UUID,
            proposalID: UUID
        ) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/proposals/\(proposalID.uuidString.lowercased())/accept-execution"
        }

        static func declineChannelProposal(
            organizationID: UUID,
            channelID: UUID,
            proposalID: UUID
        ) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/proposals/\(proposalID.uuidString.lowercased())/decline"
        }

        static func acceptChannelSkillExecutionProposal(
            organizationID: UUID,
            channelID: UUID,
            proposalID: UUID
        ) -> String {
            "\(channel(organizationID: organizationID, channelID: channelID))/skill-execution-proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func runEvents(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/events"
        }

        static func runMessages(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/messages"
        }

        static func runMessagesDelta(projectID: UUID, runID: UUID, cursor: Int) -> String {
            "\(runMessages(projectID: projectID, runID: runID))/delta?cursor=\(cursor)"
        }

        static func runEvidence(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/evidence"
        }

        static func runPreferences(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/preferences"
        }

        static func runDependency(projectID: UUID, runID: UUID, prerequisiteID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/dependencies/\(prerequisiteID.uuidString.lowercased())"
        }

        static func runStatus(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/status"
        }

        static func runDispatch(projectID: UUID, runID: UUID, reassign: Bool) -> String {
            "\(run(projectID: projectID, runID: runID))/\(reassign ? "reassign" : "dispatch")"
        }

        static func runRecovery(projectID: UUID, runID: UUID, action: String) -> String {
            "\(run(projectID: projectID, runID: runID))/\(action)"
        }

        static func runResume(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/resume"
        }

        static func runResultReviews(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/result-reviews"
        }

        static func runAgentReply(projectID: UUID, runID: UUID, triggerMessageID: UUID) -> String {
            "\(runMessages(projectID: projectID, runID: runID))/\(triggerMessageID.uuidString.lowercased())/agent-reply"
        }

        static func acceptIssueReworkProposal(
            projectID: UUID,
            runID: UUID,
            proposalID: UUID
        ) -> String {
            "\(run(projectID: projectID, runID: runID))/rework-proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func acceptIssueActionProposal(
            projectID: UUID,
            runID: UUID,
            proposalID: UUID
        ) -> String {
            "\(run(projectID: projectID, runID: runID))/issue-action-proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func acceptIssueExecutionProposal(
            projectID: UUID,
            conversationRunID: UUID,
            proposalID: UUID
        ) -> String {
            "\(run(projectID: projectID, runID: conversationRunID))/issue-execution-proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func acceptIssueSkillExecutionProposal(
            projectID: UUID,
            conversationRunID: UUID,
            proposalID: UUID
        ) -> String {
            "\(run(projectID: projectID, runID: conversationRunID))/skill-execution-proposals/\(proposalID.uuidString.lowercased())/accept"
        }

        static func projectAgents(projectID: UUID, locale: String) -> String {
            "/projects/\(projectID.uuidString.lowercased())/agents?locale=\(locale)"
        }

        static func projectAgentSessions(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/agent-sessions"
        }

        static func projectAgentTasks(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/agent-tasks"
        }

        static func projectAgentSession(projectID: UUID, sessionID: String) -> String {
            "\(projectAgentSessions(projectID: projectID))/\(sessionID)"
        }
    }
}

struct HealthResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let service: String
    let database: String
    let updates: String
}

struct InboxReadStatesResponse: Codable, Equatable, Sendable {
    let readVersions: [String: String]
}

struct InboxReadStatesRequest: Codable, Equatable, Sendable {
    let readVersions: [String: String]
}

struct DeviceCodeRequest: Codable, Equatable, Sendable {
    let clientID: String
    let scope: String

    init(clientID: String = MobileAPIContract.iOSClientID) {
        self.clientID = clientID
        scope = "openid profile email"
    }

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case scope
    }
}

struct DeviceCodeResponse: Codable, Equatable, Sendable {
    let deviceCode: String
    let userCode: String
    let verificationURI: URL
    let verificationURIComplete: URL?
    let expiresIn: Int?
    let interval: Int?

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case verificationURIComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }
}

struct DeviceTokenRequest: Codable, Equatable, Sendable {
    let grantType: String
    let deviceCode: String
    let clientID: String

    init(
        deviceCode: String,
        clientID: String = MobileAPIContract.iOSClientID
    ) {
        grantType = "urn:ietf:params:oauth:grant-type:device_code"
        self.deviceCode = deviceCode
        self.clientID = clientID
    }

    enum CodingKeys: String, CodingKey {
        case grantType = "grant_type"
        case deviceCode = "device_code"
        case clientID = "client_id"
    }
}

struct DeviceTokenResponse: Codable, Equatable, Sendable {
    let accessToken: String
    let tokenType: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
    }
}

struct DeviceTokenErrorResponse: Codable, Equatable, Sendable {
    let error: State
    let errorDescription: String?

    enum State: String, Codable, Sendable {
        case authorizationPending = "authorization_pending"
        case slowDown = "slow_down"
        case accessDenied = "access_denied"
        case expiredToken = "expired_token"
    }

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

struct CurrentUserResponse: Codable, Equatable, Sendable {
    let user: User

    struct User: Codable, Equatable, Sendable {
        let id: String
        let username: String?
        let name: String
        let email: String
        let image: String?
    }
}

extension Project {
    init(connectMessage message: BriarAPI_Project) throws {
        guard
            let id = UUID(uuidString: message.id),
            let organizationID = UUID(uuidString: message.organizationID),
            message.hasCreatedAt
        else {
            throw MobileAPIError.invalidResponse
        }
        let role: Role
        switch message.role {
        case .owner:
            role = .owner
        case .coOwner:
            role = .coOwner
        case .developer:
            role = .developer
        case .editor:
            role = .editor
        case .viewer:
            role = .viewer
        case .unspecified, .UNRECOGNIZED:
            throw MobileAPIError.invalidResponse
        }
        self.init(
            id: id,
            name: message.name,
            issueKeyPrefix: message.issueKeyPrefix,
            scheduleTabEnabled: message.scheduleTabEnabled,
            icon: message.hasIcon ? message.icon : nil,
            organizationId: organizationID,
            organizationName: message.organizationName,
            role: role,
            createdAt: message.createdAt.date
        )
    }

    var effectiveIssueKeyPrefix: String {
        let normalized = issueKeyPrefix.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalized.range(of: #"^[A-Z0-9]{1,3}$"#, options: .regularExpression) != nil
        else { return "AH" }
        return normalized
    }

    func issueKey(runNumber: Int) -> String {
        "\(effectiveIssueKeyPrefix)-\(runNumber)"
    }
}

enum MobileAPIError: LocalizedError, Equatable {
    case invalidResponse
    case httpStatus(Int, String)
    case invalidRequest
    case invalidDownload

    var statusCode: Int? {
        guard case let .httpStatus(status, _) = self else { return nil }
        return status
    }

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return L10n.text("서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.")
        case let .httpStatus(status, message):
            if status == 401 {
                return L10n.text("세션이 만료되었습니다. 다시 로그인해 주세요.")
            } else {
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty
                    ? L10n.format("요청에 실패했습니다. (HTTP %d)", status)
                    : trimmed
            }
        case .invalidRequest:
            return L10n.text("요청을 준비하지 못했습니다. 입력값을 확인해 주세요.")
        case .invalidDownload:
            return L10n.text("파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.")
        }
    }
}

private extension MobileAPIError {
    static func connect(_ error: ConnectError) -> MobileAPIError {
        let status: Int
        switch error.code {
        case .invalidArgument:
            status = 400
        case .unauthenticated:
            status = 401
        case .permissionDenied:
            status = 403
        case .notFound:
            status = 404
        case .alreadyExists, .aborted:
            status = 409
        case .outOfRange, .failedPrecondition:
            status = 410
        default:
            status = 500
        }
        return .httpStatus(status, error.message ?? "Connect request failed")
    }
}

struct AuthenticatedMobileAPIOperation<Response: Decodable & Sendable>: Sendable {
    let id: String
    let method: String
    let path: String
}

struct PublicMobileAPIOperation<Response: Decodable & Sendable>: Sendable {
    let id: String
    let method: String
    let path: String
}

protocol MobileAPIClientProtocol: Sendable {
    func listProjects(token: String) async throws -> ProjectsResponse

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response

    func download(_ path: String, token: String, to destination: URL) async throws -> URL

    func conditionalGet<Response: Decodable & Sendable>(
        _ path: String,
        token: String,
        eTag: String?,
        as responseType: Response.Type
    ) async throws -> ConditionalGETResponse<Response>
}

struct ConditionalGETResponse<Value: Sendable>: Sendable {
    let value: Value?
    let eTag: String?
    let notModified: Bool
}

struct ChannelRealtimeNotification: Codable, Equatable, Sendable {
    let topic: String
    let cursor: Int?
    let projectId: String?
    let version: Int?

    init(
        topic: String,
        cursor: Int? = nil,
        projectId: String? = nil,
        version: Int? = nil
    ) {
        self.topic = topic
        self.cursor = cursor
        self.projectId = projectId
        self.version = version
    }
}

struct ChannelRealtimeTicketResponse: Codable, Equatable, Sendable {
    let url: String
    let expiresAt: String
}

protocol MobileRealtimeClientProtocol: Sendable {
    func realtimeEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error>

    func channelActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error>

    func issueActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error>
}

extension MobileRealtimeClientProtocol {
    func channelActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error> {
        AsyncThrowingStream { continuation in continuation.finish() }
    }

    func issueActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error> {
        AsyncThrowingStream { continuation in continuation.finish() }
    }
}

extension MobileAPIClientProtocol {
    func listProjects(token: String) async throws -> ProjectsResponse {
        try await send(MobileAPIOperations.listProjects, token: token)
    }

    func send<Response: Decodable & Sendable>(
        _ operation: AuthenticatedMobileAPIOperation<Response>,
        token: String
    ) async throws -> Response {
        try await send(
            operation.path,
            method: operation.method,
            token: token,
            body: nil,
            as: Response.self
        )
    }

    func send<Response: Decodable & Sendable>(
        _ operation: PublicMobileAPIOperation<Response>
    ) async throws -> Response {
        try await send(
            operation.path,
            method: operation.method,
            token: nil,
            body: nil,
            as: Response.self
        )
    }

    func get<Response: Decodable & Sendable>(
        _ path: String,
        token: String? = nil,
        as responseType: Response.Type = Response.self
    ) async throws -> Response {
        try await send(path, method: "GET", token: token, body: nil, as: responseType)
    }

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws {
        let _: EmptyAPIResponse = try await send(
            path,
            method: method,
            token: token,
            body: body,
            as: EmptyAPIResponse.self
        )
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }

    func download(_ path: String, token: String, to destination: URL) async throws -> URL {
        throw MobileAPIError.invalidDownload
    }

    func conditionalGet<Response: Decodable & Sendable>(
        _ path: String,
        token: String,
        eTag: String?,
        as responseType: Response.Type = Response.self
    ) async throws -> ConditionalGETResponse<Response> {
        ConditionalGETResponse(
            value: try await get(path, token: token, as: responseType),
            eTag: nil,
            notModified: false
        )
    }
}

private struct EmptyAPIResponse: Decodable, Sendable {}

struct MobileAPIClient: MobileAPIClientProtocol, MobileRealtimeClientProtocol, Sendable {
    let baseURL: URL
    let session: URLSession
    private let projectService: BriarAPI_ProjectServiceClient

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        projectService = BriarAPI_ProjectServiceClient(
            client: ProtocolClient(
                httpClient: URLSessionHTTPClient(configuration: session.configuration),
                config: ProtocolClientConfig(
                    host: baseURL.absoluteString,
                    networkProtocol: .connect,
                    codec: ProtoCodec(),
                    unaryGET: .disabled
                )
            )
        )
    }

    func listProjects(token: String) async throws -> ProjectsResponse {
        let response = await projectService.listProjects(
            request: BriarAPI_ListProjectsRequest(),
            headers: ["authorization": ["Bearer \(token)"]]
        )
        do {
            let message = try response.result.get()
            return ProjectsResponse(
                projects: try message.projects.map { try Project(connectMessage: $0) }
            )
        } catch let error as ConnectError {
            throw MobileAPIError.connect(error)
        }
    }

    func get<Response: Decodable & Sendable>(
        _ path: String,
        token: String? = nil,
        as responseType: Response.Type = Response.self
    ) async throws -> Response {
        try await send(path, method: "GET", token: token, body: nil, as: responseType)
    }

    func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ path: String,
        body: Body,
        token: String? = nil,
        as responseType: Response.Type = Response.self
    ) async throws -> Response {
        try await send(path, method: "POST", token: token, body: body, as: responseType)
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type = Response.self
    ) async throws -> Response {
        let data = try await sendData(path, method: method, token: token, body: body)
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws {
        _ = try await sendData(path, method: method, token: token, body: body)
    }

    func conditionalGet<Response: Decodable & Sendable>(
        _ path: String,
        token: String,
        eTag: String?,
        as responseType: Response.Type = Response.self
    ) async throws -> ConditionalGETResponse<Response> {
        guard let url = endpointURL(path) else { throw MobileAPIError.invalidRequest }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let eTag {
            request.setValue(eTag, forHTTPHeaderField: "If-None-Match")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MobileAPIError.invalidResponse
        }
        let responseETag = httpResponse.value(forHTTPHeaderField: "ETag")
        if httpResponse.statusCode == 304 {
            return ConditionalGETResponse(
                value: nil,
                eTag: responseETag ?? eTag,
                notModified: true
            )
        }
        try validate(response: response, data: data)
        return ConditionalGETResponse(
            value: try JSONDecoder.mobileContract.decode(responseType, from: data),
            eTag: responseETag,
            notModified: false
        )
    }

    /// Executes a JSON API request after applying Briar's shared URL, auth, encoding,
    /// and HTTP error contract. Typed and body-less calls intentionally diverge only
    /// after this transport boundary: `send` decodes the bytes while `sendVoid` ignores them.
    private func sendData(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws -> Data {
        guard let url = endpointURL(path) else { throw MobileAPIError.invalidRequest }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.mobileContract.encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type = Response.self
    ) async throws -> Response {
        guard let url = endpointURL(path) else { throw MobileAPIError.invalidRequest }
        let boundary = "BriarBoundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = MultipartEncoder.encode(fields: fields, files: files, boundary: boundary)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }

    func download(_ path: String, token: String, to destination: URL) async throws -> URL {
        guard let url = endpointURL(path) else { throw MobileAPIError.invalidRequest }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (temporaryURL, response) = try await session.download(for: request)
        try validate(response: response, data: Data())
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if fileManager.fileExists(atPath: destination.path) {
            _ = try fileManager.replaceItemAt(destination, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: destination)
        }
        guard fileManager.fileExists(atPath: destination.path) else {
            throw MobileAPIError.invalidDownload
        }
        return destination
    }

    /// Exchanges the bearer credential for a short-lived signed URL, then opens
    /// a WebSocket that only carries cursor notifications. Authoritative data
    /// still comes from the regular delta endpoint.
    func realtimeEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelRealtimeNotification, Error> {
        webSocketEvents(path, token: token, as: ChannelRealtimeNotification.self)
    }

    func channelActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error> {
        webSocketEvents(path, token: token, as: ChannelAgentActivityFrame.self)
    }

    func issueActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error> {
        webSocketEvents(path, token: token, as: IssueAgentActivityFrame.self)
    }

    private func webSocketEvents<Event: Decodable & Sendable>(
        _ path: String,
        token: String,
        as eventType: Event.Type
    ) -> AsyncThrowingStream<Event, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let ticket: ChannelRealtimeTicketResponse = try await send(
                        path,
                        method: "POST",
                        token: token,
                        body: nil,
                        as: ChannelRealtimeTicketResponse.self
                    )
                    guard
                        let url = URL(string: ticket.url),
                        let scheme = url.scheme?.lowercased(),
                        scheme == "ws" || scheme == "wss"
                    else {
                        throw MobileAPIError.invalidRequest
                    }
                    let socket = session.webSocketTask(with: url)
                    socket.resume()
                    try await withTaskCancellationHandler {
                        while !Task.isCancelled {
                            let message = try await socket.receive()
                            let data: Data
                            switch message {
                            case .data(let value):
                                data = value
                            case .string(let value):
                                data = Data(value.utf8)
                            @unknown default:
                                continue
                            }
                            continuation.yield(
                                try JSONDecoder.mobileContract.decode(
                                    eventType,
                                    from: data
                                )
                            )
                        }
                    } onCancel: {
                        socket.cancel(with: .goingAway, reason: nil)
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func endpointURL(_ path: String) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + "/" + parts[0].trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedQuery = parts.count == 2 ? String(parts[1]) : nil
        return components.url
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MobileAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let error = try? JSONDecoder.mobileContract.decode(APIErrorResponse.self, from: data)
            throw MobileAPIError.httpStatus(
                httpResponse.statusCode,
                error?.error ?? error?.message ?? error?.errorDescription ??
                    HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            )
        }
    }
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = { encoder in try value.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

private struct APIErrorResponse: Decodable {
    let error: String?
    let message: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case message
        case errorDescription = "error_description"
    }
}

struct MultipartFile: Sendable {
    let fieldName: String
    let filename: String
    let contentType: String
    let data: Data
}

private enum MultipartEncoder {
    static func encode(
        fields: [String: String],
        files: [MultipartFile],
        boundary: String
    ) -> Data {
        var data = Data()
        for key in fields.keys.sorted() {
            data.append("--\(boundary)\r\n")
            data.append("Content-Disposition: form-data; name=\"\(quoted(key))\"\r\n\r\n")
            data.append("\(fields[key] ?? "")\r\n")
        }
        for file in files {
            data.append("--\(boundary)\r\n")
            data.append("Content-Disposition: form-data; name=\"\(quoted(file.fieldName))\"; filename=\"\(quoted(file.filename))\"\r\n")
            let contentType = file.contentType.contains("\r") || file.contentType.contains("\n")
                ? "application/octet-stream"
                : file.contentType
            data.append("Content-Type: \(contentType)\r\n\r\n")
            data.append(file.data)
            data.append("\r\n")
        }
        data.append("--\(boundary)--\r\n")
        return data
    }

    private static func quoted(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}

extension JSONDecoder {
    static var mobileContract: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var mobileContract: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

extension ISO8601DateFormatter {
    /// Matches the fractional-second ISO timestamps used by desktop inbox versions.
    static var mobileContract: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
