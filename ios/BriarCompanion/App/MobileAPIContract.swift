import Foundation

enum MobileAPIContract {
    static let version = "1.0.0"
    static let iOSClientID = "briar-mobile"
    static let androidClientID = "briar-android"

    enum Endpoint {
        static let health = "/health"
        static let deviceCode = "/api/auth/device/code"
        static let deviceToken = "/api/auth/device/token"
        static let currentUser = "/me"
        static let projects = "/projects"
    }
}

struct HealthResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let service: String
    let database: String
    let updates: String
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

enum MobileAPIError: Error, Equatable {
    case invalidResponse
    case httpStatus(Int)
}

struct MobileAPIClient: Sendable {
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
        let url = baseURL.appending(
            path: path.trimmingCharacters(
                in: CharacterSet(charactersIn: "/")
            )
        )
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MobileAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw MobileAPIError.httpStatus(httpResponse.statusCode)
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: data)
    }
}

extension JSONDecoder {
    static var mobileContract: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
