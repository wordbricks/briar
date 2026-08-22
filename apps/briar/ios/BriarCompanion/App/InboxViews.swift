import SwiftUI

struct InboxHomeView: View {
    @ObservedObject var inbox: InboxStore
    @ObservedObject var navigation: CompanionNavigationModel
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        Group {
            if inbox.messages.isEmpty {
                ContentUnavailableView(
                    L10n.text(.inboxEmpty, locale: locale),
                    systemImage: "tray",
                    description: Text(
                        L10n.text(
                            "멘션, 이슈 변경, 완료된 세션이 이곳에 표시됩니다.",
                            locale: locale
                        )
                    )
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(inbox.messages) { message in
                            inboxRow(message)
                        }
                    }
                    .padding(.bottom, 12)
                }
                .accessibilityIdentifier("inbox-feed")
            }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await refresh()
            await inbox.refreshFeed()
            await inbox.refreshReadStates()
        }
        .toolbar {
            if inbox.unreadCount > 0 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        inbox.markAllRead()
                    } label: {
                        Image(systemName: "checkmark.circle")
                    }
                    .accessibilityLabel(L10n.text(.markAllRead, locale: locale))
                    .accessibilityIdentifier("inbox-mark-all-read")
                }
            }
        }
    }

    @ViewBuilder
    private func inboxRow(_ message: InboxMessage) -> some View {
        Button {
            inbox.markRead(id: message.id)
            navigation.openInboxMessage(message)
        } label: {
            HStack(spacing: 12) {
                inboxIcon(message)

                VStack(alignment: .leading, spacing: 4) {
                    Text(message.title)
                        .font(.body.weight(showsUnreadIndicator(message) ? .semibold : .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 5) {
                        Text(secondaryText(message))
                            .lineLimit(1)
                        Text("·")
                            .accessibilityHidden(true)
                        Text(L10n.relativeDate(message.occurredAt, locale: locale))
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("inbox-message-\(message.id)")
    }

    @ViewBuilder
    private func inboxIcon(_ message: InboxMessage) -> some View {
        let category = InboxMessageBuilder.classify(message)

        Group {
            if message.kind == .conversation || message.kind == .channel {
                ProfileImageView(
                    image: message.authorImage,
                    name: message.authorName,
                    size: 46
                )
            } else {
                Image(systemName: categorySystemImage(category, kind: message.kind))
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(categoryColor(category))
                    .frame(width: 46, height: 46)
                    .background(categoryColor(category).opacity(0.14), in: Circle())
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if showsUnreadIndicator(message) {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 11, height: 11)
                    .overlay {
                        Circle().stroke(Color(.systemBackground), lineWidth: 2)
                    }
            }
        }
        .accessibilityHidden(true)
    }

    private func secondaryText(_ message: InboxMessage) -> String {
        let candidates: [String?]
        switch message.kind {
        case .conversation, .channel:
            candidates = [message.authorName, message.body, message.projectName]
        case .issue:
            candidates = [message.projectName, message.authorName, message.statusLabel]
        case .session:
            candidates = [message.authorName, message.projectName, message.statusLabel]
        }

        let values: [String] = candidates.compactMap { value -> String? in
            guard let value else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return values.prefix(2).joined(separator: " · ")
    }

    private func categorySystemImage(
        _ category: InboxCategory,
        kind: InboxMessageKind
    ) -> String {
        if kind == .conversation || kind == .channel {
            return "message.fill"
        }
        if kind == .session {
            return "cpu.fill"
        }
        switch category {
        case .urgent: return "exclamationmark.triangle.fill"
        case .actionRequired: return "exclamationmark.circle.fill"
        case .important: return "bell.fill"
        case .activity: return "clock.fill"
        }
    }

    private func categoryColor(_ category: InboxCategory) -> Color {
        switch category {
        case .urgent: .red
        case .actionRequired: .orange
        case .important: .purple
        case .activity: .secondary
        }
    }

    private func showsUnreadIndicator(_ message: InboxMessage) -> Bool {
        message.isUnread && InboxMessageBuilder.classify(message) != .activity
    }
}
