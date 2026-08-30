import Connect
import Foundation
import SwiftProtobuf

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


        static func channelEvents(organizationID: UUID, cursor: Int) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channel-events?cursor=\(cursor)"
        }

        static func channelActivityEvents(organizationID: UUID, channelID: UUID) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channels/\(channelID.uuidString.lowercased())/agent-activity-events"
        }

        static func issueActivityEvents(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/agent-activity-events"
        }

        /// Multipart is intentionally kept as HTTP because Connect requests do not carry file bytes.
        static func channelMessageUpload(
            organizationID: UUID,
            channelID: UUID
        ) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channels/\(channelID.uuidString.lowercased())/messages"
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

struct Project: Codable, Equatable, Sendable {
    let id: UUID
    let name: String
    let issueKeyPrefix: String
    let scheduleTabEnabled: Bool
    let icon: String?
    let organizationId: UUID
    let organizationName: String
    let role: Role
    let createdAt: Date

    enum Role: String, Codable, Sendable {
        case owner
        case coOwner = "co-owner"
        case developer
        case editor
        case viewer
    }
}

struct ProjectsResponse: Codable, Equatable, Sendable {
    let projects: [Project]
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

extension MobileAPIError {
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

protocol MobileAPIClientProtocol: Sendable {
    func listProjects(token: String) async throws -> ProjectsResponse

    func listChannels(
        organizationID: UUID,
        token: String
    ) async throws -> ChannelsResponse

    func syncChannels(
        organizationID: UUID,
        cursor: Int,
        token: String
    ) async throws -> ChannelDeltaResponse

    func listDirectMessageRecipients(
        organizationID: UUID,
        token: String
    ) async throws -> DirectMessageRecipients

    func createDirectMessage(
        organizationID: UUID,
        memberIDs: [String],
        agentIDs: [UUID],
        token: String
    ) async throws -> ChannelSummary

    func getChannel(
        organizationID: UUID,
        channelID: UUID,
        messageLimit: Int?,
        token: String
    ) async throws -> ChannelDetailResponse

    func markChannelRead(
        organizationID: UUID,
        channelID: UUID,
        lastReadAt: Date?,
        token: String
    ) async throws -> ChannelSummary

    func listChannelMessages(
        organizationID: UUID,
        channelID: UUID,
        parentMessageID: UUID?,
        cursor: UUID?,
        limit: Int?,
        token: String
    ) async throws -> ChannelMessagesResponse

    func createChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [UUID],
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateChannelMessageResponse

    func deleteChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        token: String
    ) async throws -> DeleteChannelMessageResponse

    func toggleChannelMessageReaction(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        emoji: String,
        token: String
    ) async throws -> ToggleChannelMessageReactionResponse

    func setChannelThreadSubscription(
        organizationID: UUID,
        channelID: UUID,
        rootMessageID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> ChannelThreadSubscriptionResponse

    func acceptChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        projectID: UUID?,
        execution: AcceptIssueExecutionProposalRequest?,
        token: String
    ) async throws -> AcceptChannelProposalResponse

    func acceptChannelExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptChannelExecutionProposalResponse

    func declineChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> DeclineChannelProposalResponse

    func acceptChannelSkillExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse

    func listOrganizationAgents(
        organizationID: UUID,
        token: String
    ) async throws -> [ChannelAgentSummary]

    func listProjectAgents(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgent]

    func listProjectAgentSessions(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgentSession]

    func syncProjectAgentSessions(
        projectID: UUID,
        cursor: Int?,
        token: String
    ) async throws -> ProjectAgentSessionsSync

    func getProjectAgentSession(
        projectID: UUID,
        sessionID: String,
        token: String
    ) async throws -> ProjectAgentSession

    func putProjectAgentSession(
        _ session: ProjectAgentSession,
        projectID: UUID,
        token: String
    ) async throws -> ProjectAgentSession

    func runProjectAgentTask(
        projectID: UUID,
        agentID: UUID,
        skillID: UUID,
        request: String,
        workerID: String,
        requestID: UUID,
        token: String
    ) async throws -> ProjectAgentSession

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

enum ChannelRealtimeNotification: Equatable, Sendable {
    case ready
    case channelsChanged(cursor: Int)
    case inboxChanged(version: Int)
    case projectChanged(projectID: String, cursor: Int)
    case projectAgentSessionsChanged(projectID: String, version: Int)

    init(protobuf message: BriarRealtime_OrganizationNotification) throws {
        guard let notification = message.notification else {
            throw MobileAPIError.invalidResponse
        }
        switch notification {
        case .ready:
            self = .ready
        case .channelsChanged(let changed):
            self = .channelsChanged(cursor: try Self.safeInt(changed.cursor))
        case .inboxChanged(let changed):
            self = .inboxChanged(version: try Self.safeInt(changed.version))
        case .projectChanged(let changed):
            guard !changed.projectID.isEmpty else { throw MobileAPIError.invalidResponse }
            self = .projectChanged(
                projectID: changed.projectID,
                cursor: try Self.safeInt(changed.cursor)
            )
        case .projectAgentSessionsChanged(let changed):
            guard !changed.projectID.isEmpty else { throw MobileAPIError.invalidResponse }
            self = .projectAgentSessionsChanged(
                projectID: changed.projectID,
                version: try Self.safeInt(changed.version)
            )
        }
    }

    private static func safeInt(_ value: UInt64) throws -> Int {
        guard value <= UInt64(Int.max) else { throw MobileAPIError.invalidResponse }
        return Int(value)
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
        throw MobileAPIError.invalidRequest
    }

    func listChannels(
        organizationID: UUID,
        token: String
    ) async throws -> ChannelsResponse {
        throw MobileAPIError.invalidRequest
    }

    func syncChannels(
        organizationID: UUID,
        cursor: Int,
        token: String
    ) async throws -> ChannelDeltaResponse {
        throw MobileAPIError.invalidRequest
    }

    func listDirectMessageRecipients(
        organizationID: UUID,
        token: String
    ) async throws -> DirectMessageRecipients {
        throw MobileAPIError.invalidRequest
    }

    func createDirectMessage(
        organizationID: UUID,
        memberIDs: [String],
        agentIDs: [UUID],
        token: String
    ) async throws -> ChannelSummary {
        throw MobileAPIError.invalidRequest
    }

    func getChannel(
        organizationID: UUID,
        channelID: UUID,
        messageLimit: Int?,
        token: String
    ) async throws -> ChannelDetailResponse {
        throw MobileAPIError.invalidRequest
    }

    func markChannelRead(
        organizationID: UUID,
        channelID: UUID,
        lastReadAt: Date?,
        token: String
    ) async throws -> ChannelSummary {
        throw MobileAPIError.invalidRequest
    }

    func listChannelMessages(
        organizationID: UUID,
        channelID: UUID,
        parentMessageID: UUID?,
        cursor: UUID?,
        limit: Int?,
        token: String
    ) async throws -> ChannelMessagesResponse {
        throw MobileAPIError.invalidRequest
    }

    func createChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [UUID],
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateChannelMessageResponse {
        throw MobileAPIError.invalidRequest
    }

    func deleteChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        token: String
    ) async throws -> DeleteChannelMessageResponse {
        throw MobileAPIError.invalidRequest
    }

    func toggleChannelMessageReaction(
        organizationID: UUID,
        channelID: UUID,
        messageID: UUID,
        emoji: String,
        token: String
    ) async throws -> ToggleChannelMessageReactionResponse {
        throw MobileAPIError.invalidRequest
    }

    func setChannelThreadSubscription(
        organizationID: UUID,
        channelID: UUID,
        rootMessageID: UUID,
        subscribed: Bool,
        token: String
    ) async throws -> ChannelThreadSubscriptionResponse {
        throw MobileAPIError.invalidRequest
    }

    func acceptChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        projectID: UUID?,
        execution: AcceptIssueExecutionProposalRequest?,
        token: String
    ) async throws -> AcceptChannelProposalResponse {
        throw MobileAPIError.invalidRequest
    }

    func acceptChannelExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        approval: AcceptIssueExecutionProposalRequest,
        token: String
    ) async throws -> AcceptChannelExecutionProposalResponse {
        throw MobileAPIError.invalidRequest
    }

    func declineChannelProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        token: String
    ) async throws -> DeclineChannelProposalResponse {
        throw MobileAPIError.invalidRequest
    }

    func acceptChannelSkillExecutionProposal(
        organizationID: UUID,
        channelID: UUID,
        proposalID: UUID,
        workerID: String?,
        token: String
    ) async throws -> AcceptAgentSkillExecutionProposalResponse {
        throw MobileAPIError.invalidRequest
    }

    func listOrganizationAgents(
        organizationID: UUID,
        token: String
    ) async throws -> [ChannelAgentSummary] {
        throw MobileAPIError.invalidRequest
    }

    func listProjectAgents(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgent] {
        throw MobileAPIError.invalidRequest
    }

    func listProjectAgentSessions(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgentSession] {
        throw MobileAPIError.invalidRequest
    }

    func syncProjectAgentSessions(
        projectID: UUID,
        cursor: Int?,
        token: String
    ) async throws -> ProjectAgentSessionsSync {
        throw MobileAPIError.invalidRequest
    }

    func getProjectAgentSession(
        projectID: UUID,
        sessionID: String,
        token: String
    ) async throws -> ProjectAgentSession {
        throw MobileAPIError.invalidRequest
    }

    func putProjectAgentSession(
        _ session: ProjectAgentSession,
        projectID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        throw MobileAPIError.invalidRequest
    }

    func runProjectAgentTask(
        projectID: UUID,
        agentID: UUID,
        skillID: UUID,
        request: String,
        workerID: String,
        requestID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        throw MobileAPIError.invalidRequest
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
    private let agentService: BriarAPI_AgentServiceClient
    let channelService: BriarAPI_ChannelServiceClient

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        let protocolClient = ProtocolClient(
            httpClient: URLSessionHTTPClient(configuration: session.configuration),
            config: ProtocolClientConfig(
                host: baseURL.absoluteString,
                networkProtocol: .connect,
                codec: ProtoCodec(),
                unaryGET: .disabled
            )
        )
        projectService = BriarAPI_ProjectServiceClient(client: protocolClient)
        agentService = BriarAPI_AgentServiceClient(client: protocolClient)
        channelService = BriarAPI_ChannelServiceClient(client: protocolClient)
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

    func listOrganizationAgents(
        organizationID: UUID,
        token: String
    ) async throws -> [ChannelAgentSummary] {
        var request = BriarAPI_ListOrganizationAgentsRequest()
        request.organizationID = organizationID.uuidString.lowercased()
        let response = await agentService.listOrganizationAgents(
            request: request,
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        return try message.agents.map { try ChannelAgentSummary(connectMessage: $0) }
    }

    func listProjectAgents(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgent] {
        var request = BriarAPI_ListProjectAgentsRequest()
        request.projectID = projectID.uuidString.lowercased()
        let response = await agentService.listProjectAgents(
            request: request,
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        return try message.agents.map { try ProjectAgent(connectMessage: $0) }
    }

    func listProjectAgentSessions(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgentSession] {
        var request = BriarAPI_ListProjectAgentSessionsRequest()
        request.projectID = projectID.uuidString.lowercased()
        let response = await agentService.listProjectAgentSessions(
            request: request,
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        return try message.sessions.map { try ProjectAgentSession(connectMessage: $0) }
    }

    func syncProjectAgentSessions(
        projectID: UUID,
        cursor: Int?,
        token: String
    ) async throws -> ProjectAgentSessionsSync {
        var request = BriarAPI_SyncProjectAgentSessionsRequest()
        request.projectID = projectID.uuidString.lowercased()
        if let cursor {
            guard let cursor = UInt64(exactly: cursor) else {
                throw MobileAPIError.invalidRequest
            }
            request.cursor = cursor
        }
        let response = await agentService.syncProjectAgentSessions(
            request: request,
            headers: authorizationHeaders(token)
        )
        return try ProjectAgentSessionsSync(connectMessage: connectMessage(response))
    }

    func getProjectAgentSession(
        projectID: UUID,
        sessionID: String,
        token: String
    ) async throws -> ProjectAgentSession {
        var request = BriarAPI_GetProjectAgentSessionRequest()
        request.projectID = projectID.uuidString.lowercased()
        request.sessionID = sessionID
        let response = await agentService.getProjectAgentSession(
            request: request,
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        guard message.hasSession else { throw MobileAPIError.invalidResponse }
        return try ProjectAgentSession(connectMessage: message.session)
    }

    func putProjectAgentSession(
        _ session: ProjectAgentSession,
        projectID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        let response = await agentService.putProjectAgentSession(
            request: try session.putConnectRequest(projectID: projectID),
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        guard message.hasSession else { throw MobileAPIError.invalidResponse }
        return try ProjectAgentSession(connectMessage: message.session)
            .preservingLocalFields(from: session)
    }

    func runProjectAgentTask(
        projectID: UUID,
        agentID: UUID,
        skillID: UUID,
        request requestText: String,
        workerID: String,
        requestID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        var request = BriarAPI_RunProjectAgentTaskRequest()
        request.projectID = projectID.uuidString.lowercased()
        request.agentID = agentID.uuidString.lowercased()
        request.skillID = skillID.uuidString.lowercased()
        request.request = requestText
        request.workerID = workerID
        request.requestID = requestID.uuidString.lowercased()
        let response = await agentService.runProjectAgentTask(
            request: request,
            headers: authorizationHeaders(token)
        )
        let message = try connectMessage(response)
        guard message.hasSession else { throw MobileAPIError.invalidResponse }
        return try ProjectAgentSession(connectMessage: message.session)
    }

    private func authorizationHeaders(_ token: String) -> Connect.Headers {
        ["authorization": ["Bearer \(token)"]]
    }

    private func connectMessage<Message: Sendable>(
        _ response: ResponseMessage<Message>
    ) throws -> Message {
        do {
            return try response.result.get()
        } catch {
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
        webSocketEvents(path, token: token) { data in
            let message = try BriarRealtime_OrganizationNotification(
                serializedBytes: data
            )
            return try ChannelRealtimeNotification(protobuf: message)
        }
    }

    func channelActivityEvents(
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<ChannelAgentActivityFrame, Error> {
        webSocketEvents(path, token: token) { data in
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
        _ path: String,
        token: String
    ) -> AsyncThrowingStream<IssueAgentActivityFrame, Error> {
        webSocketEvents(path, token: token) { data in
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
        _ path: String,
        token: String,
        decode: @escaping @Sendable (Data) throws -> Event
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
                            case .string:
                                throw MobileAPIError.invalidResponse
                            @unknown default:
                                continue
                            }
                            continuation.yield(try decode(data))
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
