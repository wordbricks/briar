import Foundation
import UIKit
import UserNotifications

struct RemotePushNotificationTarget: Codable, Equatable, Sendable {
    let messageId: String
    let messageVersion: String
    let notificationId: String
    let projectId: UUID
    let targetId: String
    let kind: InboxMessageKind
    let conversationMessageId: UUID?
    let channelMessageId: UUID?
    let rootMessageId: UUID?

    static func parse(userInfo: [AnyHashable: Any]) -> RemotePushNotificationTarget? {
        guard let raw = userInfo["briarInboxTarget"] else { return nil }
        guard JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw)
        else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}

extension Notification.Name {
    static let briarRemotePushTokenChanged = Notification.Name(
        "briar.remote-push-token-changed"
    )
    static let briarRemoteNotificationOpened = Notification.Name(
        "briar.remote-notification-opened"
    )
}

@MainActor
enum RemotePushNotificationBridge {
    private static let tokenKey = "briar.remote-push-token.v1"
    private static let pendingTargetKey = "briar.remote-push-pending-target.v1"

    static var token: String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    static func updateToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: tokenKey)
        NotificationCenter.default.post(name: .briarRemotePushTokenChanged, object: token)
    }

    static func open(_ target: RemotePushNotificationTarget) {
        if let data = try? JSONEncoder().encode(target) {
            UserDefaults.standard.set(data, forKey: pendingTargetKey)
        }
        RemotePushNotificationReceiptStore.record(target)
        NotificationCenter.default.post(name: .briarRemoteNotificationOpened, object: target)
    }

    static func drainPendingTarget() -> RemotePushNotificationTarget? {
        guard let data = UserDefaults.standard.data(forKey: pendingTargetKey) else {
            return nil
        }
        UserDefaults.standard.removeObject(forKey: pendingTargetKey)
        return try? JSONDecoder().decode(RemotePushNotificationTarget.self, from: data)
    }
}

@MainActor
enum RemotePushNotificationReceiptStore {
    private static let storageKey = "briar.remote-push-receipts.v1"
    private static let lifetime: TimeInterval = 7 * 24 * 60 * 60

    static func record(_ target: RemotePushNotificationTarget) {
        var receipts = load()
        receipts[key(target.notificationId, target.messageVersion)] = Date().timeIntervalSince1970
        save(receipts)
    }

    static func contains(notificationId: String, version: String) -> Bool {
        let receipts = load()
        return receipts[key(notificationId, version)] != nil
    }

    private static func key(_ notificationId: String, _ version: String) -> String {
        "\(notificationId)\u{0}\(version)"
    }

    private static func load() -> [String: TimeInterval] {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([String: TimeInterval].self, from: data)
        else { return [:] }
        let cutoff = Date().timeIntervalSince1970 - lifetime
        return decoded.filter { $0.value >= cutoff }
    }

    private static func save(_ receipts: [String: TimeInterval]) {
        if let data = try? JSONEncoder().encode(receipts) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }
}

final class InboxPushAppDelegate: NSObject, UIApplicationDelegate,
    @preconcurrency UNUserNotificationCenterDelegate
{
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()
        if let userInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any],
           let target = RemotePushNotificationTarget.parse(userInfo: userInfo) {
            Task { @MainActor in RemotePushNotificationBridge.open(target) }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in RemotePushNotificationBridge.updateToken(token) }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if let target = RemotePushNotificationTarget.parse(
            userInfo: notification.request.content.userInfo
        ) {
            Task { @MainActor in RemotePushNotificationReceiptStore.record(target) }
        }
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let target = RemotePushNotificationTarget.parse(
            userInfo: response.notification.request.content.userInfo
        ) {
            Task { @MainActor in RemotePushNotificationBridge.open(target) }
        }
        completionHandler()
    }
}

private struct MobilePushPreferencesRequest: Encodable, Sendable {
    let playSound: Bool
    let urgent: Bool
    let actionRequired: Bool
    let important: Bool
    let activity: Bool
}

private struct MobilePushRegistrationRequest: Encodable, Sendable {
    let platform: String
    let token: String
    let environment: String
    let topic: String
    let locale: String
    let preferences: MobilePushPreferencesRequest
}

private struct MobilePushRegistrationDeleteRequest: Encodable, Sendable {
    let platform: String
    let token: String
}

@MainActor
final class RemotePushRegistrationService: ObservableObject {
    private let api: any MobileAPIClientProtocol
    private var syncTask: Task<Void, Never>?
    private var sessionToken: String?
    private var preferences = InboxNotificationPreferences()
    private var locale = CompanionLocale.ko
    private var lastPayload: Data?

    init(api: any MobileAPIClientProtocol) {
        self.api = api
    }

    func configure(
        sessionToken: String?,
        preferences: InboxNotificationPreferences,
        locale: CompanionLocale
    ) {
        self.sessionToken = sessionToken
        self.preferences = preferences
        self.locale = locale
        synchronize()
    }

    func deviceTokenChanged() {
        lastPayload = nil
        synchronize()
    }

    func unregister(sessionToken: String?) async {
        guard let sessionToken, let deviceToken = RemotePushNotificationBridge.token else {
            return
        }
        try? await api.sendVoid(
            MobileAPIContract.Endpoint.pushRegistration,
            method: "DELETE",
            token: sessionToken,
            body: MobilePushRegistrationDeleteRequest(
                platform: "apns",
                token: deviceToken
            )
        )
        lastPayload = nil
    }

    private func synchronize() {
        syncTask?.cancel()
        guard let sessionToken,
              let deviceToken = RemotePushNotificationBridge.token,
              let topic = Bundle.main.bundleIdentifier
        else { return }
        let request = MobilePushRegistrationRequest(
            platform: "apns",
            token: deviceToken,
            environment: Bundle.main.object(
                forInfoDictionaryKey: "BriarAPNSEnvironment"
            ) as? String ?? "development",
            topic: topic,
            locale: locale.rawValue,
            preferences: MobilePushPreferencesRequest(
                playSound: preferences.playSound,
                urgent: preferences.urgent,
                actionRequired: preferences.actionRequired,
                important: preferences.important,
                activity: preferences.activity
            )
        )
        guard let payload = try? JSONEncoder().encode(request), payload != lastPayload else {
            return
        }
        syncTask = Task { [weak self, api] in
            do {
                try await api.sendVoid(
                    MobileAPIContract.Endpoint.pushRegistration,
                    method: "PUT",
                    token: sessionToken,
                    body: request
                )
                guard !Task.isCancelled else { return }
                self?.lastPayload = payload
            } catch {
                // A later token, preference, locale, or foreground change retries registration.
            }
        }
    }
}
