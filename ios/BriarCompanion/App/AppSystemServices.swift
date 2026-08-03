import Foundation
import SwiftUI
import UIKit
import UserNotifications

enum AppIconName: String, CaseIterable, Identifiable, Sendable {
    case purple
    case gray
    case pink
    case green

    var id: String { rawValue }

    var title: String {
        switch self {
        case .purple: "보라"
        case .gray: "회색"
        case .pink: "분홍"
        case .green: "초록"
        }
    }

    /// Asset catalog name used by `setAlternateIconName`. Primary purple uses `nil`.
    var alternateIconName: String? {
        switch self {
        case .purple: nil
        case .gray: "AppIconGray"
        case .pink: "AppIconPink"
        case .green: "AppIconGreen"
        }
    }

    var previewImageName: String {
        switch self {
        case .purple: "AppIconPreviewPurple"
        case .gray: "AppIconPreviewGray"
        case .pink: "AppIconPreviewPink"
        case .green: "AppIconPreviewGreen"
        }
    }

    var previewColor: Color {
        switch self {
        case .purple: Color(red: 0.45, green: 0.28, blue: 0.78)
        case .gray: Color(white: 0.55)
        case .pink: Color(red: 0.90, green: 0.40, blue: 0.60)
        case .green: Color(red: 0.20, green: 0.65, blue: 0.45)
        }
    }
}

@MainActor
enum AppIconService {
    private static let storageKey = "briar.app-icon.v1"

    static var current: AppIconName {
        if let alternate = UIApplication.shared.alternateIconName {
            if alternate == "AppIconGray" { return .gray }
            if alternate == "AppIconPink" { return .pink }
            if alternate == "AppIconGreen" { return .green }
        }
        if let stored = UserDefaults.standard.string(forKey: storageKey),
           let icon = AppIconName(rawValue: stored) {
            return icon
        }
        return .purple
    }

    static func set(_ icon: AppIconName) async throws {
        guard UIApplication.shared.supportsAlternateIcons || icon == .purple else {
            throw AppIconError.unsupported
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            UIApplication.shared.setAlternateIconName(icon.alternateIconName) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    UserDefaults.standard.set(icon.rawValue, forKey: storageKey)
                    continuation.resume()
                }
            }
        }
    }

    enum AppIconError: Error {
        case unsupported
    }
}

enum AppBadgeService {
    @MainActor
    static func sync(count: Int) async {
        let normalized = max(0, count)
        if #available(iOS 16.0, *) {
            try? await UNUserNotificationCenter.current().setBadgeCount(normalized)
        } else {
            UIApplication.shared.applicationIconBadgeNumber = normalized
        }
    }
}

struct InboxNotificationPreferences: Equatable, Sendable {
    var urgent = false
    var actionRequired = false
    var important = false
    var activity = false

    subscript(category: InboxCategory) -> Bool {
        get {
            switch category {
            case .urgent: urgent
            case .actionRequired: actionRequired
            case .important: important
            case .activity: activity
            }
        }
        set {
            switch category {
            case .urgent: urgent = newValue
            case .actionRequired: actionRequired = newValue
            case .important: important = newValue
            case .activity: activity = newValue
            }
        }
    }

    static func load(defaults: UserDefaults = .standard) -> InboxNotificationPreferences {
        guard
            let data = defaults.data(forKey: storageKey),
            let decoded = try? JSONDecoder().decode(Storage.self, from: data)
        else {
            return InboxNotificationPreferences()
        }
        return InboxNotificationPreferences(
            urgent: decoded.urgent,
            actionRequired: decoded.action_required,
            important: decoded.important,
            activity: decoded.activity
        )
    }

    func save(defaults: UserDefaults = .standard) {
        let storage = Storage(
            urgent: urgent,
            action_required: actionRequired,
            important: important,
            activity: activity
        )
        if let data = try? JSONEncoder().encode(storage) {
            defaults.set(data, forKey: Self.storageKey)
        }
    }

    private static let storageKey = "briar.settings.inbox-notifications.v1"

    private struct Storage: Codable {
        var urgent: Bool
        var action_required: Bool
        var important: Bool
        var activity: Bool
    }
}

@MainActor
final class LocalNotificationService: ObservableObject {
    @Published var preferences = InboxNotificationPreferences.load()
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private var knownIDs = Set<String>()
    private let center = UNUserNotificationCenter.current()

    init() {
        Task { await refreshAuthorizationStatus() }
    }

    func refreshAuthorizationStatus() async {
        let settings = await center.notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func requestAuthorizationIfNeeded() async -> Bool {
        await refreshAuthorizationStatus()
        if authorizationStatus == .authorized || authorizationStatus == .provisional {
            return true
        }
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            return granted
        } catch {
            return false
        }
    }

    func updatePreferences(_ preferences: InboxNotificationPreferences) {
        self.preferences = preferences
        preferences.save()
    }

    func process(messages: [InboxMessage]) async {
        let enabled = InboxCategory.allCases.filter { preferences[$0] }
        guard !enabled.isEmpty else {
            knownIDs = Set(messages.map(\.id))
            return
        }

        let authorized = await requestAuthorizationIfNeeded()
        guard authorized else {
            knownIDs = Set(messages.map(\.id))
            return
        }

        let currentIDs = Set(messages.map(\.id))
        if knownIDs.isEmpty {
            knownIDs = currentIDs
            return
        }

        let newcomers = messages.filter { message in
            message.isUnread &&
                !knownIDs.contains(message.id) &&
                enabled.contains(InboxMessageBuilder.classify(message))
        }
        for message in newcomers.prefix(5) {
            await schedule(message)
        }
        knownIDs = currentIDs
    }

    private func schedule(_ message: InboxMessage) async {
        let content = UNMutableNotificationContent()
        content.title = message.title
        content.body = message.body?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? (message.body ?? message.statusLabel ?? "새 알림")
            : (message.statusLabel ?? "새 알림")
        content.sound = .default
        content.userInfo = [
            "briarInboxTarget": [
                "messageId": message.id,
                "projectId": message.projectId.uuidString.lowercased(),
                "targetId": message.targetId,
                "kind": message.kind.rawValue,
            ],
        ]
        let request = UNNotificationRequest(
            identifier: "inbox-\(message.id)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }
}

enum ClipboardService {
    static func copy(_ value: String) {
        UIPasteboard.general.string = value
    }
}
