import BriarContracts
import Connect
import Foundation
import SwiftProtobuf

enum MobileAPIContract {
    static let iOSClientID = "briar-mobile"
    static let androidClientID = "briar-android"

    enum Endpoint {
        static let deviceCode = "/api/auth/device/code"
        static let deviceToken = "/api/auth/device/token"

        /// Multipart issue creation remains HTTP because Connect requests do not carry file bytes.
        static func issues(projectID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/issues"
        }

        /// Multipart is intentionally kept as HTTP because Connect requests do not carry file bytes.
        static func channelMessageUpload(
            organizationID: UUID,
            channelID: UUID
        ) -> String {
            "/organizations/\(organizationID.uuidString.lowercased())/channels/\(channelID.uuidString.lowercased())/messages"
        }

        /// Multipart issue messages remain HTTP because Connect requests do not carry file bytes.
        static func runMessages(projectID: UUID, runID: UUID) -> String {
            "/projects/\(projectID.uuidString.lowercased())/runs/\(runID.uuidString.lowercased())/messages"
        }
    }
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

protocol MobileHTTPClientProtocol: Sendable {
    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response

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

extension MobileHTTPClientProtocol {
    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
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

struct MobileHTTPClient: MobileHTTPClientProtocol, Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
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

    /// Executes the remaining JSON-only device authorization requests after applying
    /// Briar's shared URL, encoding, and HTTP error contract.
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
