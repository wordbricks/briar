import SwiftUI

struct InboxHomeView: View {
    @ObservedObject var inbox: InboxStore
    @ObservedObject var navigation: CompanionNavigationModel
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var activeCategories: Set<InboxCategory> = Set(InboxCategory.allCases)

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var filteredMessages: [InboxMessage] {
        InboxMessageBuilder.filter(inbox.messages, to: activeCategories)
    }

    private func toggleCategory(_ category: InboxCategory) {
        if activeCategories.contains(category) {
            activeCategories.remove(category)
        } else {
            activeCategories.insert(category)
        }
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
                    description: Text(L10n.text("멘션, 이슈 변경, 완료된 세션이 이곳에 표시됩니다.", locale: locale))
                )
            } else {
                // Importance filter: one toggle per urgency category, all on by default.
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(InboxCategory.allCases) { category in
                                filterChip(category)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .accessibilityIdentifier("inbox-importance-filters")
                }

                if filteredMessages.isEmpty {
                    ContentUnavailableView(
                        L10n.text("선택한 필터에 메시지가 없습니다.", locale: locale),
                        systemImage: "line.3.horizontal.decrease.circle",
                        description: Text(L10n.text("다른 필터를 선택해 메시지를 확인해 보세요.", locale: locale))
                    )
                } else {
                    // Single chronological feed: newest first, no urgency sections.
                    Section {
                        ForEach(filteredMessages) { message in
                            inboxRow(message)
                        }
                    }
                }
            }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await refresh()
            await inbox.refreshReadStates()
        }
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
    private func filterChip(_ category: InboxCategory) -> some View {
        let isActive = activeCategories.contains(category)
        Button {
            toggleCategory(category)
        } label: {
            HStack(spacing: 5) {
                Text(category.title(locale: locale))
                Text("\(inbox.messages(in: category).count)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        Capsule().fill(isActive ? Color.accentColor.opacity(0.15) : Color(.secondarySystemFill))
                    )
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(isActive ? Color.accentColor.opacity(0.12) : Color(.tertiarySystemFill))
            )
            .foregroundStyle(isActive ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("inbox-filter-\(category.rawValue)")
    }

    @ViewBuilder
    private func inboxRow(_ message: InboxMessage) -> some View {
        Button {
            inbox.markRead(id: message.id)
            navigation.openInboxMessage(message)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(showsUnreadIndicator(message) ? Color.accentColor : Color.clear)
                    .frame(width: 8, height: 8)
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(message.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        Text(L10n.relativeDate(message.occurredAt, locale: locale))
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

    private func showsUnreadIndicator(_ message: InboxMessage) -> Bool {
        message.isUnread && InboxMessageBuilder.classify(message) != .activity
    }
}
