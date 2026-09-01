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
    let client: any DeviceAuthorizationClientProtocol

    @MainActor
    func authorize(using presenter: any WebAuthenticationPresenting) async throws -> String {
        let code = try await client.requestDeviceCode()
        guard var components = URLComponents(
            url: code.verificationURIComplete,
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

    private func poll(_ code: DeviceAuthorizationCode) async throws -> String {
        let clock = ContinuousClock()
        let startedAt = clock.now
        let expiresAfter = Duration.seconds(code.expiresIn)
        var interval = max(code.interval, 1)
        while clock.now - startedAt < expiresAfter {
            switch try await client.pollDeviceToken(deviceCode: code.deviceCode) {
            case .authorized(let token):
                return token.accessToken
            case .authorizationPending:
                break
            case .slowDown:
                interval += 5
            case .accessDenied(let message):
                throw DeviceAuthorizationError.denied(message)
            case .expiredToken(let message):
                throw DeviceAuthorizationError.expired(message)
            }
            try await Task.sleep(for: .seconds(interval))
        }
        throw DeviceAuthorizationError.expired(nil)
    }
}
