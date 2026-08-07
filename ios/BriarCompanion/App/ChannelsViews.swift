import SwiftUI

/// Home: the organization's channels, grouped by project with section dividers.
struct ChannelsHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let activeProjectID: UUID?
    let currentUserID: String?
    let projects: [ProjectsResponse.Project]

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var groups: [ChannelGroup] {
        channels.groups(
            activeProjectID: activeProjectID,
            projects: projects,
            commonLabel: L10n.text(.channelsCommon, locale: locale),
            unknownProjectLabel: L10n.text(.channelsOtherProject, locale: locale)
        )
    }

    var body: some View {
        List {
            ForEach(groups) { group in
                Section {
                    ForEach(group.channels) { channel in
                        NavigationLink(value: channel) {
                            ChannelRow(channel: channel)
                        }
                    }
                } header: {
                    Text(group.label)
                        .accessibilityIdentifier("channel-group-\(group.id)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if groups.isEmpty, !channels.loading {
                ContentUnavailableView(
                    L10n.text(.channelsEmpty, locale: locale),
                    systemImage: "number"
                )
            }
        }
        .refreshable { await channels.refresh() }
        .navigationDestination(for: ChannelSummary.self) { channel in
            ChannelMessagesView(
                channels: channels,
                channel: channel,
                currentUserID: currentUserID
            )
        }
    }
}

private struct ChannelRow: View {
    let channel: ChannelSummary

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: channel.visibility == .restricted ? "lock" : "number")
                .foregroundStyle(.secondary)
                .font(.footnote)
            Text(channel.name).lineLimit(1)
            Spacer(minLength: 8)
            if channel.agentCount > 0 {
                Label("\(channel.agentCount)", systemImage: "cpu")
                    .labelStyle(.titleAndIcon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("channel-row-\(channel.id.uuidString.lowercased())")
    }
}

/// A channel's root messages. Tapping one opens its thread.
struct ChannelMessagesView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""

    let channel: ChannelSummary
    let currentUserID: String?

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(channels.messages) { message in
                        NavigationLink(value: message) {
                            ChannelMessageRow(
                                message: message,
                                locale: locale,
                                showsThreadSummary: true
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                candidates: ChannelMentions.candidates(
                    members: channels.members,
                    agents: channels.agents,
                    currentUserId: currentUserID
                ),
                placeholder: String(
                    format: L10n.text(.channelMessagePlaceholder, locale: locale),
                    channel.name
                ),
                send: { body, mentions in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: nil,
                        body: body,
                        mentions: mentions
                    )
                }
            )
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Label(
                    channel.name,
                    systemImage: channel.visibility == .restricted ? "lock" : "number"
                )
                .font(.headline)
                .lineLimit(1)
            }
        }
        .task(id: channel.id) { await channels.openChannel(channel.id) }
        .navigationDestination(for: ChannelMessage.self) { message in
            ChannelThreadView(
                channels: channels,
                channel: channel,
                parent: message,
                currentUserID: currentUserID
            )
        }
        .overlay {
            if channels.messages.isEmpty, !channels.loading {
                ContentUnavailableView(
                    L10n.text(.channelsEmpty, locale: locale),
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
        }
    }
}

struct ChannelThreadView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""

    let channel: ChannelSummary
    let parent: ChannelMessage
    let currentUserID: String?

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(channels.thread) { message in
                        ChannelMessageRow(message: message, locale: locale)
                    }
                }
            }
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                candidates: ChannelMentions.candidates(
                    members: channels.members,
                    agents: channels.agents,
                    currentUserId: currentUserID
                ),
                placeholder: String(
                    format: L10n.text(.channelMessagePlaceholder, locale: locale),
                    channel.name
                ),
                send: { body, mentions in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: parent.id,
                        body: body,
                        mentions: mentions
                    )
                }
            )
        }
        .navigationTitle(L10n.text(.channelThread, locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: parent.id) {
            await channels.openThread(channelID: channel.id, parentMessageID: parent.id)
        }
    }
}

private struct ChannelMessageRow: View {
    let message: ChannelMessage
    let locale: CompanionLocale
    var showsThreadSummary = false

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            ProfileImageView(
                image: message.author.type == .user ? message.author.image : nil,
                name: message.author.type == .user ? message.author.name : nil,
                systemImage: message.author.type == .agent ? "cpu" : "person.fill",
                size: 40
            )
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(message.author.name)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    if message.author.type == .agent {
                        Image(systemName: "cpu")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Text(message.createdAt, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(message.body)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let document = message.document {
                    Label(document.title, systemImage: "doc.text")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 3)
                }
                if showsThreadSummary, message.replyCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "bubble.left")
                        Text(
                            String(
                                format: L10n.text(.channelReplies, locale: locale),
                                message.replyCount
                            )
                        )
                        .fontWeight(.semibold)
                        if let lastReplyText {
                            Text("· \(lastReplyText)")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.tint)
                    .padding(.top, 4)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
        .accessibilityIdentifier("channel-message-\(message.id.uuidString.lowercased())")
    }

    private var lastReplyText: String? {
        guard let lastReplyAt = message.lastReplyAt else { return nil }
        let formatter = RelativeDateTimeFormatter()
        let localeIdentifier: String
        switch locale {
        case .ko: localeIdentifier = "ko_KR"
        case .en: localeIdentifier = "en_US"
        case .zh: localeIdentifier = "zh_CN"
        }
        formatter.locale = Locale(identifier: localeIdentifier)
        let relative = formatter.localizedString(for: lastReplyAt, relativeTo: Date())
        return String(
            format: L10n.text(.channelLastReply, locale: locale),
            relative
        )
    }
}

private struct ChannelComposer: View {
    @Binding var draft: String
    @State private var mentions: [ChannelMentionTarget] = []
    let sending: Bool
    let candidates: [ChannelMentionTarget]
    let placeholder: String
    let send: (String, [ChannelMentionTarget]) async -> Void

    private var suggestions: [ChannelMentionTarget] {
        Array(ChannelMentions.suggestions(in: draft, candidates: candidates).prefix(6))
    }

    var body: some View {
        VStack(spacing: 0) {
            if !suggestions.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(suggestions) { target in
                            Button {
                                draft = ChannelMentions.insert(target, into: draft)
                                if !mentions.contains(where: { $0.id == target.id }) {
                                    mentions.append(target)
                                }
                            } label: {
                                HStack(spacing: 10) {
                                    ProfileImageView(
                                        image: target.image,
                                        name: target.label,
                                        systemImage: target.kind == .agent ? "cpu" : "person.fill",
                                        size: 36
                                    )
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(target.label)
                                            .font(.subheadline.weight(.semibold))
                                            .lineLimit(1)
                                        Text("@\(target.handle)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Spacer(minLength: 8)
                                    Text(target.detail)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("channel-mention-\(target.id)")
                        }
                    }
                    .padding(5)
                }
                .frame(maxHeight: 250)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.12), radius: 12, y: 5)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .accessibilityIdentifier("channel-mention-menu")
            }
            HStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(.background, in: Circle())
                    .overlay { Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 1) }
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...4)
                    .disabled(sending)
                    .accessibilityIdentifier("channel-composer-field")
                    .onChange(of: draft) { _, body in
                        mentions = ChannelMentions.retained(in: body, mentions: mentions)
                    }
                if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        let body = draft
                        let selected = ChannelMentions.retained(in: body, mentions: mentions)
                        draft = ""
                        mentions = []
                        Task { await send(body, selected) }
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.tint, in: Circle())
                    }
                    .disabled(sending)
                    .accessibilityIdentifier("channel-composer-send")
                }
            }
            .padding(7)
            .background(.secondary.opacity(0.1), in: Capsule())
            .overlay { Capsule().stroke(Color.secondary.opacity(0.18), lineWidth: 1) }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }
}
