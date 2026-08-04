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
        List {
            if inbox.unreadCount > 0 {
                Section {
                    Button {
                        inbox.markAllRead()
                    } label: {
                        Label(
                            "\(L10n.text(.markAllRead, locale: locale)) (\(inbox.unreadCount))",
                            systemImage: "checkmark.circle"
                        )
                    }
                    .accessibilityIdentifier("inbox-mark-all-read")
                }
            }

            if inbox.messages.isEmpty {
                ContentUnavailableView(
                    L10n.text(.inboxEmpty, locale: locale),
                    systemImage: "tray",
                    description: Text("멘션, 이슈 변경, 완료된 세션이 이곳에 표시됩니다.")
                )
            } else {
                // Single chronological feed: newest first, no urgency sections.
                Section {
                    ForEach(inbox.messages) { message in
                        inboxRow(message)
                    }
                }
            }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await refresh() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if inbox.unreadCount > 0 {
                    Text("\(inbox.unreadCount)")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                        .accessibilityIdentifier("inbox-unread-badge")
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
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(message.isUnread ? Color.accentColor : Color.clear)
                    .frame(width: 8, height: 8)
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(message.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        Text(message.occurredAt, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let body = message.body, !body.isEmpty {
                        Text(body)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                    }
                    HStack {
                        if let status = message.statusLabel {
                            Text(status)
                        }
                        if let author = message.authorName {
                            Text(author)
                        }
                        Spacer()
                        Text(message.kind.rawValue)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("inbox-message-\(message.id)")
    }
}
