import SwiftUI

/// Home: the organization's channels, grouped by project with section dividers.
struct ChannelsHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let activeProjectID: UUID?
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
            ChannelMessagesView(channels: channels, channel: channel)
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

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            List {
                ForEach(channels.messages) { message in
                    NavigationLink(value: message) {
                        ChannelMessageRow(message: message)
                    }
                }
            }
            .listStyle(.plain)
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                send: { body in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: nil,
                        body: body
                    )
                }
            )
        }
        .navigationTitle(channel.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: channel.id) { await channels.openChannel(channel.id) }
        .navigationDestination(for: ChannelMessage.self) { message in
            ChannelThreadView(channels: channels, channel: channel, parent: message)
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

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            List {
                ForEach(channels.thread) { message in
                    ChannelMessageRow(message: message)
                }
            }
            .listStyle(.plain)
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                send: { body in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: parent.id,
                        body: body
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

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(message.author.name).font(.footnote.weight(.semibold))
                if message.author.type == .agent {
                    Image(systemName: "cpu").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Text(message.createdAt, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(message.body).font(.callout)
            if let document = message.document {
                Label(document.title, systemImage: "doc.text")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if message.replyCount > 0 {
                Label("\(message.replyCount)", systemImage: "bubble.left")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("channel-message-\(message.id.uuidString.lowercased())")
    }
}

private struct ChannelComposer: View {
    @Binding var draft: String
    let sending: Bool
    let send: (String) async -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField("", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .disabled(sending)
                .accessibilityIdentifier("channel-composer-field")
            Button {
                let body = draft
                draft = ""
                Task { await send(body) }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("channel-composer-send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
