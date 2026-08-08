import SwiftUI

/// Home: the organization's channels, grouped by project with section dividers.
struct ChannelsHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let activeProjectID: UUID?
    let currentUserID: String?
    let projects: [ProjectsResponse.Project]
    let onIssueOpen: (UUID, UUID) -> Void

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
                currentUserID: currentUserID,
                projects: projects,
                onIssueOpen: onIssueOpen
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
    let projects: [ProjectsResponse.Project]
    let onIssueOpen: (UUID, UUID) -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(channels.messages) { message in
                        ChannelMessageRow(
                            acceptingProposalID: channels.acceptingProposalID,
                            agents: channels.agents,
                            channel: channel,
                            members: channels.members,
                            message: message,
                            locale: locale,
                            onAcceptProposal: { proposalID, projectID in
                                await channels.acceptProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID,
                                    projectID: projectID
                                )
                            },
                            onIssueOpen: onIssueOpen,
                            projects: projects,
                            showsThreadSummary: true
                        )
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
                currentUserID: currentUserID,
                projects: projects,
                onIssueOpen: onIssueOpen
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
    let projects: [ProjectsResponse.Project]
    let onIssueOpen: (UUID, UUID) -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(channels.thread) { message in
                        ChannelMessageRow(
                            acceptingProposalID: channels.acceptingProposalID,
                            agents: channels.agents,
                            channel: channel,
                            members: channels.members,
                            message: message,
                            locale: locale,
                            onAcceptProposal: { proposalID, projectID in
                                await channels.acceptProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID,
                                    projectID: projectID
                                )
                            },
                            onIssueOpen: onIssueOpen,
                            projects: projects
                        )
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
    let acceptingProposalID: UUID?
    let agents: [ChannelAgentSummary]
    let channel: ChannelSummary
    let members: [ChannelMember]
    let message: ChannelMessage
    let locale: CompanionLocale
    let onAcceptProposal: (UUID, UUID) async -> AcceptChannelProposalResponse?
    let onIssueOpen: (UUID, UUID) -> Void
    let projects: [ProjectsResponse.Project]
    var showsThreadSummary = false

    private var mentionHandles: Set<String> {
        MessageMentions.channelHandles(
            mentionedUserIds: message.mentionedUserIds,
            mentionedAgentIds: message.mentionedAgentIds,
            members: members,
            agents: agents
        )
    }

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
                MentionText(text: message.body, handles: mentionHandles)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let document = message.document {
                    Label(document.title, systemImage: "doc.text")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 3)
                }
                if let proposal = message.proposal,
                   proposal.actionType == .createIssue {
                    ChannelProposalCard(
                        accepting: acceptingProposalID == proposal.id,
                        channel: channel,
                        locale: locale,
                        onAccept: { projectID in
                            await onAcceptProposal(proposal.id, projectID)
                        },
                        onIssueOpen: onIssueOpen,
                        projects: projects,
                        proposal: proposal
                    )
                    .padding(.top, 5)
                }
                if showsThreadSummary {
                    NavigationLink(value: message) {
                        HStack(spacing: 6) {
                            Image(systemName: "bubble.left")
                            Text(
                                message.replyCount > 0
                                    ? String(
                                        format: L10n.text(.channelReplies, locale: locale),
                                        message.replyCount
                                    )
                                    : L10n.text(.channelReplyInThread, locale: locale)
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
                    .buttonStyle(.plain)
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

private struct ChannelProposalCard: View {
    @State private var selectedProjectID: UUID?

    let accepting: Bool
    let channel: ChannelSummary
    let locale: CompanionLocale
    let onAccept: (UUID) async -> AcceptChannelProposalResponse?
    let onIssueOpen: (UUID, UUID) -> Void
    let projects: [ProjectsResponse.Project]
    let proposal: ChannelMessage.Proposal

    private var availableProjects: [ProjectsResponse.Project] {
        projects
            .filter { $0.organizationId == channel.organizationId }
            .sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
    }

    private var targetProjectID: UUID? {
        proposal.projectId ?? channel.defaultProjectId ?? selectedProjectID
    }

    private var selectedProjectName: String? {
        guard let selectedProjectID else { return nil }
        return availableProjects.first(where: { $0.id == selectedProjectID })?.name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.text(.channelIssueProposal, locale: locale))
                    .font(.caption.weight(.bold))
                Text(
                    L10n.text(
                        proposal.status == .accepted
                            ? .channelIssueProposalAccepted
                            : .channelIssueProposalPending,
                        locale: locale
                    )
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            if proposal.status == .pending {
                if proposal.projectId == nil, channel.defaultProjectId == nil {
                    Menu {
                        ForEach(availableProjects, id: \.id) { project in
                            Button(project.name) { selectedProjectID = project.id }
                        }
                    } label: {
                        Label(
                            selectedProjectName ?? L10n.text(
                                .channelSelectProposalProject,
                                locale: locale
                            ),
                            systemImage: "folder"
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier(
                        "channel-proposal-project-\(proposal.id.uuidString.lowercased())"
                    )
                }

                Button {
                    guard let targetProjectID else { return }
                    Task {
                        if let result = await onAccept(targetProjectID) {
                            onIssueOpen(result.projectId, result.resultRunId)
                        }
                    }
                } label: {
                    if accepting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(L10n.text(.channelCreateIssue, locale: locale))
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(accepting || targetProjectID == nil)
                .accessibilityIdentifier(
                    "accept-channel-proposal-\(proposal.id.uuidString.lowercased())"
                )
            } else if let projectID = proposal.projectId,
                      let runID = proposal.resultRunId {
                Button(L10n.text(.channelViewIssue, locale: locale)) {
                    onIssueOpen(projectID, runID)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .accessibilityIdentifier(
                    "open-channel-proposal-result-\(proposal.id.uuidString.lowercased())"
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.accentColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.accentColor.opacity(0.24), lineWidth: 1)
        }
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
