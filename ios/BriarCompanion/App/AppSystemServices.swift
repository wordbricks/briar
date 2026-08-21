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

    var title: String { title(locale: .current) }

    func title(locale: CompanionLocale) -> String {
        switch self {
        case .purple: L10n.text("보라", locale: locale)
        case .gray: L10n.text("회색", locale: locale)
        case .pink: L10n.text("분홍", locale: locale)
        case .green: L10n.text("초록", locale: locale)
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
final class IssueConversationViewTracker: ObservableObject {
    private(set) var runID: UUID?
    private var refreshAction: (() async -> Void)?

    func view(runID: UUID, refresh: @escaping () async -> Void) {
        self.runID = runID
        refreshAction = refresh
    }

    func leave(runID: UUID) {
        guard self.runID == runID else { return }
        self.runID = nil
        refreshAction = nil
    }

    func refreshChanges() async {
        await refreshAction?()
    }
}

@MainActor
final class LocalNotificationService: ObservableObject {
    @Published var preferences = InboxNotificationPreferences.load()
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private var knownIDs = Set<String>()
    private var baselineID: String?
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

    func process(
        messages: [InboxMessage],
        baselineID: String = "local",
        viewingChannelID: UUID? = nil,
        viewingChannelThreadID: UUID? = nil,
        viewingIssueConversationID: UUID? = nil
    ) async {
        let currentIDs = Set(messages.map(\.id))
        guard self.baselineID == baselineID else {
            self.baselineID = baselineID
            knownIDs = currentIDs
            return
        }
        let enabled = InboxCategory.allCases.filter { preferences[$0] }
        guard !enabled.isEmpty else {
            knownIDs = currentIDs
            return
        }

        let authorized = await requestAuthorizationIfNeeded()
        guard authorized else {
            knownIDs = currentIDs
            return
        }

        let newcomers = messages.filter { message in
            message.isUnread &&
                !knownIDs.contains(message.id) &&
                enabled.contains(InboxMessageBuilder.classify(message)) &&
                Self.shouldDeliver(
                    message,
                    viewingChannelID: viewingChannelID,
                    viewingChannelThreadID: viewingChannelThreadID,
                    viewingIssueConversationID: viewingIssueConversationID
                )
        }
        for message in newcomers.prefix(5) {
            await schedule(message)
        }
        knownIDs = currentIDs
    }

    static func shouldDeliver(
        _ message: InboxMessage,
        viewingChannelID: UUID?,
        viewingChannelThreadID: UUID? = nil,
        viewingIssueConversationID: UUID? = nil
    ) -> Bool {
        guard let notificationTargetID = UUID(uuidString: message.targetId) else {
            return true
        }
        if message.kind == .channel, let viewingChannelID {
            guard notificationTargetID == viewingChannelID else { return true }
            if message.rootMessageId == message.channelMessageId { return false }
            return message.rootMessageId != viewingChannelThreadID
        }
        if message.kind == .conversation, let viewingIssueConversationID {
            return notificationTargetID != viewingIssueConversationID
        }
        return true
    }

    private func schedule(_ message: InboxMessage) async {
        let presentation = InboxNotificationPresentationBuilder.content(for: message)
        let content = UNMutableNotificationContent()
        content.title = presentation.title
        content.body = presentation.body
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

struct InboxNotificationPresentation: Equatable {
    let title: String
    let body: String
}

enum InboxNotificationPresentationBuilder {
    static func content(for message: InboxMessage) -> InboxNotificationPresentation {
        if message.kind == .session {
            let name = message.authorName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayName = name?.isEmpty == false ? name ?? "Briar" : "Briar"
            let status = message.statusLabel ?? L10n.text("새 알림")
            let finalMessage = message.body?.trimmingCharacters(in: .whitespacesAndNewlines)
            let body = preview(finalMessage?.isEmpty == false ? message.body ?? status : message.title)
            return InboxNotificationPresentation(
                title: "\(displayName) · \(status)",
                body: body.isEmpty ? status : body
            )
        }

        if isReply(message) ||
            ((message.kind == .conversation || message.kind == .channel) &&
                message.reason == "subscription") {
            let destination = message.kind == .channel
                ? "#\(message.channelName ?? message.title)"
                : (message.issueKey ?? message.title)
            let author = message.authorName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayAuthor = author?.isEmpty == false ? author ?? "Briar" : "Briar"
            return InboxNotificationPresentation(
                title: "\(displayAuthor) in \(destination)",
                body: preview(message.body ?? "")
            )
        }

        let fallbackBody = message.body?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title: String
        if message.kind == .issue || message.kind == .session {
            title = L10n.format("Briar · %@", message.statusLabel ?? L10n.text("새 알림"))
        } else {
            title = message.title
        }
        return InboxNotificationPresentation(
            title: title,
            body: fallbackBody?.isEmpty == false
                ? (message.body ?? message.statusLabel ?? L10n.text("새 알림"))
                : (message.statusLabel ?? L10n.text("새 알림"))
        )
    }

    private static func isReply(_ message: InboxMessage) -> Bool {
        guard let rootMessageId = message.rootMessageId else { return false }
        switch message.kind {
        case .conversation:
            return message.conversationMessageId != rootMessageId
        case .channel:
            return message.channelMessageId != rootMessageId
        case .issue, .session:
            return false
        }
    }

    private static func preview(_ body: String) -> String {
        body
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(3)
            .joined(separator: "\n")
    }
}

enum ClipboardService {
    static func copy(_ value: String) {
        UIPasteboard.general.string = value
    }
}

struct CompanionToast: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.16), radius: 14, y: 6)
            .accessibilityIdentifier("companion-toast")
            .accessibilityAddTraits(.updatesFrequently)
    }
}

struct CompanionToastModifier: ViewModifier {
    @Binding var isPresented: Bool
    let message: String
    var duration: Duration = .seconds(2)

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if isPresented {
                    CompanionToast(message: message)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 28)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .allowsHitTesting(false)
                }
            }
            .animation(.easeOut(duration: 0.18), value: isPresented)
            .onChange(of: isPresented) { _, presented in
                guard presented else { return }
                Task { @MainActor in
                    try? await Task.sleep(for: duration)
                    if isPresented {
                        isPresented = false
                    }
                }
            }
    }
}

extension View {
    func companionToast(
        isPresented: Binding<Bool>,
        message: String,
        duration: Duration = .seconds(2)
    ) -> some View {
        modifier(CompanionToastModifier(
            isPresented: isPresented,
            message: message,
            duration: duration
        ))
    }
}
