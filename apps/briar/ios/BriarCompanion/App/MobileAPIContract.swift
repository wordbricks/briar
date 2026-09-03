import BriarContracts
import Connect
import Foundation

enum MobileAPIContract {
    static let iOSClientID = "briar-mobile"

    enum Endpoint {
        static let deviceCode = "/api/auth/device/code"
        static let deviceToken = "/api/auth/device/token"
    }
}

struct DeviceAuthorizationCode: Equatable, Sendable {
    let deviceCode: String
    let userCode: String
    let verificationURI: URL
    let verificationURIComplete: URL
    let expiresIn: Int
    let interval: Int
}

struct DeviceAuthorizationToken: Equatable, Sendable {
    let accessToken: String
    let tokenType: String
    let expiresIn: Int
    let scope: String
}

enum DeviceTokenPollResult: Equatable, Sendable {
    case authorized(DeviceAuthorizationToken)
    case authorizationPending(String)
    case slowDown(String)
    case accessDenied(String)
    case expiredToken(String)
}

enum DeviceAuthorizationRequestErrorCode: String, Equatable, Sendable {
    case invalidRequest = "invalid_request"
    case invalidClient = "invalid_client"
    case invalidGrant = "invalid_grant"
    case invalidScope = "invalid_scope"
    case serverError = "server_error"
    case unauthorizedClient = "unauthorized_client"
}

struct DeviceAuthorizationRequestError: LocalizedError, Equatable, Sendable {
    let statusCode: Int
    let code: DeviceAuthorizationRequestErrorCode
    let message: String

    var errorDescription: String? {
        message
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

enum PlanningProjectStatus: String, CaseIterable, Sendable {
    case planned
    case active
    case completed
    case cancelled
}

struct PlanningProject: Equatable, Identifiable, Sendable {
    let id: UUID
    let workspaceId: UUID
    let workspaceName: String
    let teamId: UUID
    let teamName: String
    let name: String
    let description: String
    let status: PlanningProjectStatus
    let leadUserId: String?
    let leadName: String?
    let startDate: String?
    let targetDate: String?
    let icon: String?
    let color: String?
    let sortOrder: Int
    let isDefault: Bool
    let role: Project.Role
    let createdAt: Date
    let updatedAt: Date

    init(connectMessage message: BriarAPI_PlanningProject) throws {
        guard
            let id = UUID(uuidString: message.id),
            let workspaceId = UUID(uuidString: message.workspaceID),
            let teamId = UUID(uuidString: message.teamID),
            message.hasCreatedAt,
            message.hasUpdatedAt
        else { throw MobileAPIError.invalidResponse }
        let status: PlanningProjectStatus
        switch message.status {
        case .planned: status = .planned
        case .active: status = .active
        case .completed: status = .completed
        case .cancelled: status = .cancelled
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        let role: Project.Role
        switch message.role {
        case .owner: role = .owner
        case .coOwner: role = .coOwner
        case .developer: role = .developer
        case .editor: role = .editor
        case .viewer: role = .viewer
        case .unspecified, .UNRECOGNIZED: throw MobileAPIError.invalidResponse
        }
        self.id = id
        self.workspaceId = workspaceId
        self.workspaceName = message.workspaceName
        self.teamId = teamId
        self.teamName = message.teamName
        self.name = message.name
        self.description = message.description_p
        self.status = status
        self.leadUserId = message.hasLeadUserID ? message.leadUserID : nil
        self.leadName = message.hasLeadName ? message.leadName : nil
        self.startDate = message.hasStartDate ? message.startDate : nil
        self.targetDate = message.hasTargetDate ? message.targetDate : nil
        self.icon = message.hasIcon ? message.icon : nil
        self.color = message.hasColor ? message.color : nil
        self.sortOrder = Int(message.sortOrder)
        self.isDefault = message.isDefault
        self.role = role
        self.createdAt = message.createdAt.date
        self.updatedAt = message.updatedAt.date
    }
}

func planningProjectStatusMessage(
    _ status: PlanningProjectStatus
) -> BriarAPI_PlanningProjectStatus {
    switch status {
    case .planned: .planned
    case .active: .active
    case .completed: .completed
    case .cancelled: .cancelled
    }
}

extension Project {
    init(connectMessage message: BriarAPI_Team) throws {
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
        let validationDetails: [BriarTypes_ValidationErrorDetail] = error.unpackedDetails()
        let detailMessage = validationDetails
            .flatMap(\.violations)
            .map { violation in
                violation.path.isEmpty
                    ? violation.message
                    : "\(violation.path): \(violation.message)"
            }
            .joined(separator: "\n")
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
        case .alreadyExists, .aborted, .failedPrecondition:
            status = 409
        case .outOfRange:
            status = 410
        case .resourceExhausted:
            status = 429
        case .unimplemented:
            status = 501
        case .unavailable:
            status = 503
        case .deadlineExceeded:
            status = 504
        default:
            status = 500
        }
        return .httpStatus(
            status,
            detailMessage.isEmpty
                ? (error.message ?? "Connect request failed")
                : detailMessage
        )
    }
}

protocol PreparedUploadClientProtocol: Sendable {
    func putPreparedUpload(
        _ url: URL,
        capability: String,
        contentType: String,
        data: Data
    ) async throws
}

protocol DeviceAuthorizationClientProtocol: Sendable {
    func requestDeviceCode() async throws -> DeviceAuthorizationCode
    func pollDeviceToken(deviceCode: String) async throws -> DeviceTokenPollResult
}

protocol AuthenticatedDownloadClientProtocol: Sendable {
    func download(_ path: String, token: String, to destination: URL) async throws -> URL
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

struct MobileServiceClientFactory: Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }
}

struct DeviceAuthorizationHTTPClient: DeviceAuthorizationClientProtocol, Sendable {
    typealias DataForRequest = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private let baseURL: URL
    private let dataForRequest: DataForRequest

    init(baseURL: URL, session: URLSession = .shared) {
        self.init(baseURL: baseURL) { request in
            try await session.data(for: request)
        }
    }

    init(baseURL: URL, dataForRequest: @escaping DataForRequest) {
        self.baseURL = baseURL
        self.dataForRequest = dataForRequest
    }

    func requestDeviceCode() async throws -> DeviceAuthorizationCode {
        let (data, status) = try await post(
            MobileAPIContract.Endpoint.deviceCode,
            body: JSONEncoder().encode(DeviceCodeRequestPayload())
        )
        if (200 ..< 300).contains(status) {
            guard
                let payload = try? JSONDecoder().decode(
                    DeviceCodeResponsePayload.self,
                    from: data
                ),
                !payload.deviceCode.isEmpty,
                !payload.userCode.isEmpty,
                payload.expiresIn > 0,
                payload.interval > 0,
                let verificationURI = deviceAuthorizationURL(payload.verificationURI),
                let verificationURIComplete = deviceAuthorizationURL(
                    payload.verificationURIComplete
                )
            else { throw MobileAPIError.invalidResponse }
            return DeviceAuthorizationCode(
                deviceCode: payload.deviceCode,
                userCode: payload.userCode,
                verificationURI: verificationURI,
                verificationURIComplete: verificationURIComplete,
                expiresIn: payload.expiresIn,
                interval: payload.interval
            )
        }

        guard
            status == 400,
            let payload = try? JSONDecoder().decode(
                DeviceCodeErrorPayload.self,
                from: data
            ),
            !payload.errorDescription.isEmpty,
            let errorCode = DeviceAuthorizationRequestErrorCode(
                rawValue: payload.error.rawValue
            )
        else { throw MobileAPIError.invalidResponse }
        throw DeviceAuthorizationRequestError(
            statusCode: status,
            code: errorCode,
            message: payload.errorDescription
        )
    }

    func pollDeviceToken(deviceCode: String) async throws -> DeviceTokenPollResult {
        guard !deviceCode.isEmpty else { throw MobileAPIError.invalidRequest }
        let (data, status) = try await post(
            MobileAPIContract.Endpoint.deviceToken,
            body: JSONEncoder().encode(DeviceTokenRequestPayload(deviceCode: deviceCode))
        )
        if (200 ..< 300).contains(status) {
            guard
                let payload = try? JSONDecoder().decode(
                    DeviceTokenResponsePayload.self,
                    from: data
                ),
                !payload.accessToken.isEmpty,
                !payload.tokenType.isEmpty,
                payload.expiresIn > 0
            else { throw MobileAPIError.invalidResponse }
            return .authorized(DeviceAuthorizationToken(
                accessToken: payload.accessToken,
                tokenType: payload.tokenType,
                expiresIn: payload.expiresIn,
                scope: payload.scope
            ))
        }

        guard
            status == 400,
            let payload = try? JSONDecoder().decode(
                DeviceTokenErrorPayload.self,
                from: data
            ),
            !payload.errorDescription.isEmpty
        else { throw MobileAPIError.invalidResponse }
        switch payload.error {
        case .authorizationPending:
            return .authorizationPending(payload.errorDescription)
        case .slowDown:
            return .slowDown(payload.errorDescription)
        case .accessDenied:
            return .accessDenied(payload.errorDescription)
        case .expiredToken:
            return .expiredToken(payload.errorDescription)
        case .invalidRequest:
            throw DeviceAuthorizationRequestError(
                statusCode: status,
                code: .invalidRequest,
                message: payload.errorDescription
            )
        case .invalidGrant:
            throw DeviceAuthorizationRequestError(
                statusCode: status,
                code: .invalidGrant,
                message: payload.errorDescription
            )
        }
    }

    private func post(_ path: String, body: Data) async throws -> (Data, Int) {
        guard let url = mobileEndpointURL(baseURL: baseURL, path: path) else {
            throw MobileAPIError.invalidRequest
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await dataForRequest(request)
        guard let response = response as? HTTPURLResponse else {
            throw MobileAPIError.invalidResponse
        }
        return (data, response.statusCode)
    }
}

struct PreparedUploadHTTPClient: PreparedUploadClientProtocol, Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func putPreparedUpload(
        _ url: URL,
        capability: String,
        contentType: String,
        data: Data
    ) async throws {
        guard mobileSameOrigin(url, baseURL), !capability.isEmpty else {
            throw MobileAPIError.invalidRequest
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(capability)", forHTTPHeaderField: "Authorization")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (responseData, urlResponse) = try await session.data(for: request)
        let response = try validatedHTTPResponse(urlResponse, data: responseData)
        guard response.statusCode == 204 else {
            throw MobileAPIError.invalidResponse
        }
    }
}

struct AuthenticatedDownloadClient: AuthenticatedDownloadClientProtocol, Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func download(_ path: String, token: String, to destination: URL) async throws -> URL {
        guard let url = mobileEndpointURL(baseURL: baseURL, path: path) else {
            throw MobileAPIError.invalidRequest
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (temporaryURL, response) = try await session.download(for: request)
        _ = try validatedHTTPResponse(response, data: Data())
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
}

private struct DeviceCodeRequestPayload: Encodable {
    let clientID = MobileAPIContract.iOSClientID
    let scope = "openid profile email"

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case scope
    }
}

private struct DeviceCodeResponsePayload: Decodable {
    let deviceCode: String
    let userCode: String
    let verificationURI: String
    let verificationURIComplete: String
    let expiresIn: Int
    let interval: Int

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case verificationURIComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }
}

private enum DeviceCodeErrorCode: String, Decodable {
    case invalidRequest = "invalid_request"
    case invalidClient = "invalid_client"
    case invalidScope = "invalid_scope"
    case serverError = "server_error"
    case unauthorizedClient = "unauthorized_client"
}

private struct DeviceCodeErrorPayload: Decodable {
    let error: DeviceCodeErrorCode
    let errorDescription: String

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

private struct DeviceTokenRequestPayload: Encodable {
    let grantType = "urn:ietf:params:oauth:grant-type:device_code"
    let deviceCode: String
    let clientID = MobileAPIContract.iOSClientID

    enum CodingKeys: String, CodingKey {
        case grantType = "grant_type"
        case deviceCode = "device_code"
        case clientID = "client_id"
    }
}

private struct DeviceTokenResponsePayload: Decodable {
    let accessToken: String
    let tokenType: String
    let expiresIn: Int
    let scope: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case scope
    }
}

private enum DeviceTokenErrorCode: String, Decodable {
    case authorizationPending = "authorization_pending"
    case slowDown = "slow_down"
    case expiredToken = "expired_token"
    case accessDenied = "access_denied"
    case invalidRequest = "invalid_request"
    case invalidGrant = "invalid_grant"
}

private struct DeviceTokenErrorPayload: Decodable {
    let error: DeviceTokenErrorCode
    let errorDescription: String

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

private struct GenericHTTPErrorPayload: Decodable {
    let error: String?
    let message: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case message
        case errorDescription = "error_description"
    }
}

private func deviceAuthorizationURL(_ value: String) -> URL? {
    guard
        let components = URLComponents(string: value),
        let scheme = components.scheme?.lowercased(),
        scheme == "http" || scheme == "https",
        components.host != nil
    else { return nil }
    return components.url
}

private func mobileEndpointURL(baseURL: URL, path: String) -> URL? {
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
        return nil
    }
    let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    let basePath = components.path.hasSuffix("/")
        ? String(components.path.dropLast())
        : components.path
    components.path = basePath + "/" + parts[0].trimmingCharacters(
        in: CharacterSet(charactersIn: "/")
    )
    components.percentEncodedQuery = parts.count == 2 ? String(parts[1]) : nil
    return components.url
}

private func mobileSameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
    guard
        let left = URLComponents(url: lhs, resolvingAgainstBaseURL: false),
        let right = URLComponents(url: rhs, resolvingAgainstBaseURL: false)
    else { return false }
    return left.scheme?.lowercased() == right.scheme?.lowercased()
        && left.host?.lowercased() == right.host?.lowercased()
        && left.port == right.port
}

@discardableResult
private func validatedHTTPResponse(_ response: URLResponse, data: Data) throws -> HTTPURLResponse {
    guard let response = response as? HTTPURLResponse else {
        throw MobileAPIError.invalidResponse
    }
    guard (200 ..< 300).contains(response.statusCode) else {
        let error = try? JSONDecoder().decode(GenericHTTPErrorPayload.self, from: data)
        throw MobileAPIError.httpStatus(
            response.statusCode,
            error?.error ?? error?.message ?? error?.errorDescription ??
                HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        )
    }
    return response
}

extension ISO8601DateFormatter {
    /// Matches the fractional-second ISO timestamps used by desktop inbox versions.
    static var mobileContract: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
