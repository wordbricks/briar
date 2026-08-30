import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

enum DeviceAuthorizationError: Error, Equatable {
    case cancelled
    case denied(String?)
    case expired(String?)
    case invalidCallback
}

@MainActor
protocol WebAuthenticationPresenting: AnyObject {
    func authenticate(at url: URL, callbackScheme: String) async throws
}

@MainActor
final class ASWebAuthenticationPresenter: NSObject, WebAuthenticationPresenting,
    ASWebAuthenticationPresentationContextProviding
{
    private var session: ASWebAuthenticationSession?

    func authenticate(at url: URL, callbackScheme: String) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, any Error>) in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                self?.session = nil
                if let authenticationError = error as? ASWebAuthenticationSessionError,
                   authenticationError.code == .canceledLogin
                {
                    continuation.resume(throwing: DeviceAuthorizationError.cancelled)
                    return
                }
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard callbackURL?.scheme == callbackScheme else {
                    continuation.resume(throwing: DeviceAuthorizationError.invalidCallback)
                    return
                }
                continuation.resume(returning: ())
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            guard session.start() else {
                self.session = nil
                continuation.resume(throwing: DeviceAuthorizationError.invalidCallback)
                return
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
#if canImport(UIKit)
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? UIWindow(frame: .zero)
#else
        return NSApplication.shared.keyWindow ?? NSWindow()
#endif
    }
}

struct DeviceAuthorizationService: Sendable {
    let api: any MobileHTTPClientProtocol

    @MainActor
    func authorize(using presenter: any WebAuthenticationPresenting) async throws -> String {
        let code: DeviceCodeResponse = try await api.send(
            MobileAPIContract.Endpoint.deviceCode,
            method: "POST",
            token: nil,
            body: DeviceCodeRequest(),
            as: DeviceCodeResponse.self
        )
        guard var components = URLComponents(
            url: code.verificationURIComplete ?? code.verificationURI,
            resolvingAgainstBaseURL: false
        ) else { throw DeviceAuthorizationError.invalidCallback }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "client" }
        queryItems.append(URLQueryItem(name: "client", value: "mobile"))
        components.queryItems = queryItems
        guard let authorizationURL = components.url else {
            throw DeviceAuthorizationError.invalidCallback
        }
        try await presenter.authenticate(at: authorizationURL, callbackScheme: "briar-companion")
        return try await poll(code)
    }

    private func poll(_ code: DeviceCodeResponse) async throws -> String {
        let clock = ContinuousClock()
        let startedAt = clock.now
        let expiresAfter = Duration.seconds(code.expiresIn ?? 600)
        var interval = max(code.interval ?? 5, 1)
        while clock.now - startedAt < expiresAfter {
            do {
                let response: DeviceTokenResponse = try await api.send(
                    MobileAPIContract.Endpoint.deviceToken,
                    method: "POST",
                    token: nil,
                    body: DeviceTokenRequest(deviceCode: code.deviceCode),
                    as: DeviceTokenResponse.self
                )
                return response.accessToken
            } catch let MobileAPIError.httpStatus(status, message) where status == 400 {
                if message.contains("slow_down") {
                    interval += 5
                } else if message.contains("access_denied") {
                    throw DeviceAuthorizationError.denied(message)
                } else if message.contains("expired_token") {
                    throw DeviceAuthorizationError.expired(message)
                } else if !message.contains("authorization_pending") {
                    throw MobileAPIError.httpStatus(status, message)
                }
            }
            try await Task.sleep(for: .seconds(interval))
        }
        throw DeviceAuthorizationError.expired(nil)
    }
}
