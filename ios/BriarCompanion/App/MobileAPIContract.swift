import Foundation

enum MobileAPIContract {
    // New operations are additive so existing Android and Tauri clients stay
    // on the stable 1.0 contract version.
    static let version = "1.0.0"
    static let iOSClientID = "briar-mobile"
    static let androidClientID = "briar-android"

    enum Endpoint {
        static let health = "/health"
        static let deviceCode = "/api/auth/device/code"
        static let deviceToken = "/api/auth/device/token"
        static let currentUser = "/me"
        static let projects = "/projects"
        static let inboxReadStates = "/inbox/read-states"

        static func issues(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/issues"
        }

        static func run(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())"
        }

        static func runTransfer(projectID: UUID, runID: UUID) -> String {
            "\(run(projectID: projectID, runID: runID))/transfer"
        }

        static func dashboard(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/dashboard"
        }

        static func dashboardDelta(projectID: UUID, cursor: Int) -> String {
            "\(dashboard(projectID: projectID))/delta?cursor=\(cursor)"
        }

        static func ideas(projectID: UUID) -> String { "/projects/\(projectID.uuidString.lowercased())/ideas" }
        static func idea(projectID: UUID, ideaID: UUID) -> String { "\(ideas(projectID: projectID))/\(ideaID.uuidString.lowercased())" }
        static func ideaMessages(projectID: UUID, ideaID: UUID) -> String { "\(idea(projectID: projectID, ideaID: ideaID))/messages" }
        static func ideaPlan(projectID: UUID, ideaID: UUID) -> String { "\(idea(projectID: projectID, ideaID: ideaID))/plan" }
        static func ideaConvert(projectID: UUID, ideaID: UUID) -> String { "\(idea(projectID: projectID, ideaID: ideaID))/convert" }
        static func ideaJobRetry(projectID: UUID, ideaID: UUID, jobID: UUID) -> String { "\(idea(projectID: projectID, ideaID: ideaID))/jobs/\(jobID.uuidString.lowercased())/retry" }

        static func runEvents(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/events"
        }

        static func runMessages(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/messages"
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

        static func projectAgents(projectID: UUID, locale: String) -> String {
            "/projects/\(projectID.uuidString.lowercased())/agents?locale=\(locale)"
        }

        static func projectAgentSessions(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/agent-sessions"
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

struct ProjectsResponse: Codable, Equatable, Sendable {
    let projects: [Project]

    struct Project: Codable, Equatable, Sendable {
        let id: UUID
        let name: String
        var issueKeyPrefix: String? = nil
        let icon: String?
        let organizationId: UUID
        let organizationName: String
        let role: Role
        let createdAt: Date

        enum Role: String, Codable, Sendable {
            case owner
            case admin
            case member
        }
    }
}

extension ProjectsResponse.Project {
    var effectiveIssueKeyPrefix: String {
        let normalized = issueKeyPrefix?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let normalized,
              normalized.range(of: #"^[A-Z0-9]{1,3}$"#, options: .regularExpression) != nil
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
            return "서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요."
        case let .httpStatus(status, message):
            if status == 401 {
                return "세션이 만료되었습니다. 다시 로그인해 주세요."
            } else {
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty
                    ? "요청에 실패했습니다. (HTTP \(status))"
                    : trimmed
            }
        case .invalidRequest:
            return "요청을 준비하지 못했습니다. 입력값을 확인해 주세요."
        case .invalidDownload:
            return "파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
    }
}

protocol MobileAPIClientProtocol: Sendable {
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
}

extension MobileAPIClientProtocol {
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
}

private struct EmptyAPIResponse: Decodable, Sendable {}

struct MobileAPIClient: MobileAPIClientProtocol, Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
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
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws {
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
