import PhotosUI
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
                        .accessibilityIdentifier("channel-row-\(channel.id.uuidString.lowercased())")
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
    }
}

/// A channel's root messages. Tapping one opens its thread.
struct ChannelMessagesView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""
    @State private var previewFile: PreviewFile?

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
                            onLoadAttachment: { attachment in
                                try await channels.download(
                                    path: attachment.url,
                                    filename: attachment.filename
                                )
                            },
                            onOpenAttachment: { previewFile = PreviewFile(url: $0) },
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
                send: { body, mentions, attachments in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: nil,
                        body: body,
                        mentions: mentions,
                        attachments: attachments
                    )
                }
            )
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ChannelHeader(
                channel: channel,
                locale: locale,
                showsStatusIcons: !dynamicTypeSize.isAccessibilitySize,
                onBack: { dismiss() }
            )
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: channel.id) { await channels.openChannel(channel.id) }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
        }
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

private struct ChannelHeader: View {
    let channel: ChannelSummary
    let locale: CompanionLocale
    let showsStatusIcons: Bool
    let onBack: () -> Void

    private var memberLabel: String {
        String(
            format: L10n.text(.channelMembers, locale: locale),
            channel.memberCount
        )
    }

    private var agentLabel: String {
        String(
            format: L10n.text(.channelAgents, locale: locale),
            channel.agentCount
        )
    }

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.title3.weight(.semibold))
                    .frame(width: 46, height: 46)
                    .background(.thinMaterial, in: Circle())
                    .overlay {
                        Circle()
                            .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.text(.channelBack, locale: locale))
            .accessibilityIdentifier("channel-header-back")

            HStack(spacing: 10) {
                Image(systemName: channel.visibility == .restricted ? "lock.fill" : "number")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 30)

                VStack(alignment: .leading, spacing: 1) {
                    Text(channel.name)
                        .font(.headline.weight(.bold))
                        .lineLimit(1)
                    Text("\(memberLabel) • \(agentLabel)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(.thinMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("channel-header-identity")

            if showsStatusIcons {
                HStack(spacing: 16) {
                    Image(systemName: "sparkles")
                    Image(systemName: "headphones")
                }
                .font(.title3.weight(.medium))
                .foregroundStyle(.primary)
                .padding(.horizontal, 15)
                .frame(height: 46)
                .background(.thinMaterial, in: Capsule())
                .overlay {
                    Capsule()
                        .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                }
                .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("channel-header")
    }
}

struct ChannelThreadView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""
    @State private var previewFile: PreviewFile?

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
                            onLoadAttachment: { attachment in
                                try await channels.download(
                                    path: attachment.url,
                                    filename: attachment.filename
                                )
                            },
                            onOpenAttachment: { previewFile = PreviewFile(url: $0) },
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
                send: { body, mentions, attachments in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: parent.id,
                        body: body,
                        mentions: mentions,
                        attachments: attachments
                    )
                }
            )
        }
        .navigationTitle(L10n.text(.channelThread, locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
        }
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
    let onLoadAttachment: @MainActor (ChannelMessageAttachment) async throws -> URL
    let onOpenAttachment: @MainActor (URL) -> Void
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

    private var messageBodyWithoutAttachments: String {
        message.body
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.contains("](briar-attachment://") }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
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
                MentionText(text: messageBodyWithoutAttachments, handles: mentionHandles)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !message.attachments.isEmpty {
                    LazyVGrid(
                        columns: Array(
                            repeating: GridItem(.flexible(), spacing: 6),
                            count: message.attachments.count > 1 ? 2 : 1
                        ),
                        spacing: 6
                    ) {
                        ForEach(message.attachments) { attachment in
                            AuthenticatedImagePreview(
                                sourceID: attachment.url,
                                filename: attachment.filename,
                                detail: ByteCountFormatter.string(
                                    fromByteCount: Int64(attachment.byteSize),
                                    countStyle: .file
                                ),
                                accessibilityID: "channel-message-attachment-\(attachment.id.uuidString.lowercased())",
                                load: {
                                    try await onLoadAttachment(attachment)
                                },
                                open: onOpenAttachment
                            )
                        }
                    }
                    .padding(.top, 4)
                }
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
        formatter.locale = Locale(identifier: locale.foundationIdentifier)
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
    @State private var attachments: [PendingIssueAttachment] = []
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isLoadingPhotos = false
    @State private var attachmentError: String?
    let sending: Bool
    let candidates: [ChannelMentionTarget]
    let placeholder: String
    let send: (String, [ChannelMentionTarget], [PendingIssueAttachment]) async -> Void

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
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            ChannelAttachmentDraft(attachment: attachment) {
                                attachments.removeAll { $0.id == attachment.id }
                                attachmentError = nil
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }
            }
            if let attachmentError {
                Text(attachmentError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }
            HStack(spacing: 8) {
                PhotosPicker(
                    selection: $selectedPhotos,
                    maxSelectionCount: max(
                        1,
                        PendingIssueAttachment.maximumCount - attachments.count
                    ),
                    matching: PhotoAttachmentImportPolicy.imagesOnly.pickerFilter,
                    preferredItemEncoding: .compatible
                ) {
                    Image(systemName: "plus")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                        .background(.background, in: Circle())
                        .overlay { Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 1) }
                }
                .disabled(
                    isLoadingPhotos || sending ||
                        attachments.count >= PendingIssueAttachment.maximumCount
                )
                .accessibilityLabel("이미지 첨부")
                .accessibilityIdentifier("channel-composer-attach")
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...4)
                    .disabled(sending)
                    .accessibilityIdentifier("channel-composer-field")
                    .onChange(of: draft) { _, body in
                        mentions = ChannelMentions.retained(in: body, mentions: mentions)
                    }
                if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                    !attachments.isEmpty {
                    Button {
                        let body = draft
                        let selected = ChannelMentions.retained(in: body, mentions: mentions)
                        draft = ""
                        mentions = []
                        let selectedAttachments = attachments
                        attachments = []
                        Task { await send(body, selected, selectedAttachments) }
                    } label: {
                        if sending {
                            ProgressView().controlSize(.small).frame(width: 40, height: 40)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(.tint, in: Circle())
                        }
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
        .onChange(of: selectedPhotos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
    }

    @MainActor
    private func importPhotos(_ items: [PhotosPickerItem]) async {
        isLoadingPhotos = true
        defer {
            isLoadingPhotos = false
            selectedPhotos = []
        }
        do {
            attachments = try await PhotoAttachmentImporter.importItems(
                items,
                appendingTo: attachments,
                policy: .imagesOnly
            )
            attachmentError = nil
        } catch {
            attachmentError = error.localizedDescription
        }
    }
}

private struct ChannelAttachmentDraft: View {
    let attachment: PendingIssueAttachment
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if let image = UIImage(data: attachment.data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image(systemName: "photo")
                    .frame(width: 34, height: 34)
                    .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            }
            Text(attachment.filename).lineLimit(1).font(.caption)
            Button(role: .destructive, action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("첨부 삭제")
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}
