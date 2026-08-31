import BriarContracts
import Foundation
import SwiftProtobuf
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

    init(protobuf message: BriarAPI_MobilePushNotificationTarget) throws {
        guard !message.inboxMessageID.isEmpty,
              !message.inboxMessageVersion.isEmpty,
              !message.notificationID.isEmpty,
              let projectID = UUID(uuidString: message.projectID),
              !message.targetID.isEmpty,
              let destination = message.destination
        else { throw MobileAPIError.invalidResponse }

        let kind: InboxMessageKind
        let conversationMessageID: UUID?
        let channelMessageID: UUID?
        let rootMessageID: UUID?
        switch destination {
        case .issue:
            guard UUID(uuidString: message.targetID) != nil else {
                throw MobileAPIError.invalidResponse
            }
            kind = .issue
            conversationMessageID = nil
            channelMessageID = nil
            rootMessageID = nil
        case .conversation(let conversation):
            guard UUID(uuidString: message.targetID) != nil,
                  let messageID = UUID(uuidString: conversation.conversationMessageID)
            else {
                throw MobileAPIError.invalidResponse
            }
            kind = .conversation
            conversationMessageID = messageID
            channelMessageID = nil
            rootMessageID = nil
        case .channel(let channel):
            guard UUID(uuidString: message.targetID) != nil,
                  let messageID = UUID(uuidString: channel.channelMessageID),
                  let rootID = UUID(uuidString: channel.rootMessageID)
            else { throw MobileAPIError.invalidResponse }
            kind = .channel
            conversationMessageID = nil
            channelMessageID = messageID
            rootMessageID = rootID
        case .session:
            kind = .session
            conversationMessageID = nil
            channelMessageID = nil
            rootMessageID = nil
        }

        messageId = message.inboxMessageID
        messageVersion = message.inboxMessageVersion
        notificationId = message.notificationID
        projectId = projectID
        targetId = message.targetID
        self.kind = kind
        conversationMessageId = conversationMessageID
        channelMessageId = channelMessageID
        rootMessageId = rootMessageID
    }

    static func parse(userInfo: [AnyHashable: Any]) -> RemotePushNotificationTarget? {
        guard let encoded = userInfo["briarInboxTargetProto"] as? String,
              let data = Data(base64Encoded: encoded),
              let message = try? BriarAPI_MobilePushNotificationTarget(
                  serializedBytes: data
              )
        else { return nil }
        return try? Self(protobuf: message)
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

@MainActor
final class RemotePushRegistrationService: ObservableObject {
    private let accountServiceForToken:
        @Sendable (String) -> any BriarAPI_AccountServiceClientInterface
    private var syncTask: Task<Void, Never>?
    private var sessionToken: String?
    private var preferences = InboxNotificationPreferences()
    private var locale = CompanionLocale.ko
    private var lastPayload: Data?

    init(
        servicesFactory: any AuthenticatedMobileServicesFactory
    ) {
        accountServiceForToken = { token in
            servicesFactory.authenticatedServices(token: token).account
        }
    }

    init(accountService: any BriarAPI_AccountServiceClientInterface) {
        accountServiceForToken = { _ in accountService }
    }

    func configure(
        sessionToken: String?,
        preferences: InboxNotificationPreferences,
        locale: CompanionLocale
    ) {
        if self.sessionToken != sessionToken {
            lastPayload = nil
        }
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
        let pendingSync = syncTask
        syncTask = nil
        pendingSync?.cancel()
        await pendingSync?.value
        lastPayload = nil
        guard let sessionToken,
              let deviceToken = RemotePushNotificationBridge.token,
              let endpoint = Self.apnsEndpoint
        else {
            return
        }
        do {
            let account = accountServiceForToken(sessionToken)
            var request = BriarAPI_UnregisterMobilePushDeviceRequest()
            request.endpoint = endpoint
            request.token = deviceToken
            let response = await account.unregisterMobilePushDevice(
                request: request,
                headers: [:]
            )
            _ = try response.briarValue()
        } catch {
            // Signing out remains local even if best-effort device cleanup fails.
        }
    }

    private func synchronize() {
        syncTask?.cancel()
        guard let sessionToken,
              let deviceToken = RemotePushNotificationBridge.token,
              let endpoint = Self.apnsEndpoint
        else { return }
        let account = accountServiceForToken(sessionToken)
        var pushPreferences = BriarAPI_MobilePushPreferences()
        pushPreferences.playSound = preferences.playSound
        pushPreferences.urgent = preferences.urgent
        pushPreferences.actionRequired = preferences.actionRequired
        pushPreferences.important = preferences.important
        pushPreferences.activity = preferences.activity
        var request = BriarAPI_RegisterMobilePushDeviceRequest()
        request.endpoint = endpoint
        request.token = deviceToken
        request.locale = locale.mobilePushLocale
        request.preferences = pushPreferences
        guard let payload = try? request.serializedData(), payload != lastPayload else {
            return
        }
        syncTask = Task { [weak self, account] in
            do {
                let response = await account.registerMobilePushDevice(
                    request: request,
                    headers: [:]
                )
                _ = try response.briarValue()
                guard !Task.isCancelled, self?.sessionToken == sessionToken else { return }
                self?.lastPayload = payload
            } catch {
                // A later token, preference, locale, or foreground change retries registration.
            }
        }
    }

    private static var apnsEndpoint: BriarAPI_MobilePushEndpoint? {
        switch Bundle.main.object(forInfoDictionaryKey: "BriarAPNSEnvironment") as? String {
        case "development": .apnsDevelopment
        case "production": .apnsProduction
        default: nil
        }
    }
}

private extension CompanionLocale {
    var mobilePushLocale: BriarAPI_MobilePushLocale {
        switch self {
        case .ko: .ko
        case .en: .en
        case .zh: .zh
        }
    }
}
