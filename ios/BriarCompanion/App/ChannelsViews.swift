import PhotosUI
import SwiftUI

typealias ChannelIssueOpenHandler = (
    UUID,
    UUID,
    @escaping @MainActor () -> Bool
) async -> Void

typealias SkillSessionMaterializedHandler = @MainActor (ProjectAgentSession) -> Void
typealias SkillSessionOpenHandler = @MainActor (UUID, String) -> Void

private struct ChannelExecutionApprovalError: LocalizedError, Sendable {
    let message: String
    var errorDescription: String? { message }
}

func channelProposalApprovalIsEnabled(
    acceptanceInFlight: Bool,
    channelArchived: Bool,
    targetProjectID: UUID?,
    issue: ChannelMessage.Proposal.Payload.Issue?
) -> Bool {
    !acceptanceInFlight && !channelArchived && targetProjectID != nil && issue != nil
}

func channelExecutionProposalApprovalIsEnabled(
    acceptanceInFlight: Bool,
    channelArchived: Bool,
    proposal: IssueExecutionProposal
) -> Bool {
    !acceptanceInFlight && !channelArchived && proposal.status == .pending
}

func channelSkillExecutionProposalApprovalIsEnabled(
    acceptanceInFlight: Bool,
    channelArchived: Bool,
    proposal: AgentSkillExecutionProposal
) -> Bool {
    !acceptanceInFlight && !channelArchived && proposal.status == .pending
}

/// Home: the organization's channels, grouped by project with section dividers.
struct ChannelsHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let activeProjectID: UUID?
    let currentUserID: String?
    let projects: [ProjectsResponse.Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onIssueOpen: ChannelIssueOpenHandler
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler

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
                providers: providers,
                workers: workers,
                onIssueOpen: onIssueOpen,
                onSkillSessionMaterialized: onSkillSessionMaterialized,
                onSkillSessionOpen: onSkillSessionOpen
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
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""
    @State private var previewFile: PreviewFile?

    let channel: ChannelSummary
    let currentUserID: String?
    let projects: [ProjectsResponse.Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onIssueOpen: ChannelIssueOpenHandler
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var currentChannel: ChannelSummary {
        channels.channels.first(where: { $0.id == channel.id }) ?? channel
    }

    var body: some View {
        ChannelConversationView(
            channels: channels,
            draft: $draft,
            previewFile: $previewFile,
            channel: currentChannel,
            currentUserID: currentUserID,
            locale: locale,
            messages: channels.messages,
            onIssueOpen: onIssueOpen,
            parentMessageID: nil,
            projects: projects,
            providers: providers,
            workers: workers,
            onSkillSessionMaterialized: onSkillSessionMaterialized,
            onSkillSessionOpen: onSkillSessionOpen,
            showsThreadSummary: true
        )
        .navigationTitle(currentChannel.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                ChannelNavigationTitle(channel: currentChannel, locale: locale)
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: channel.id) { await channels.openChannel(channel.id) }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
        }
        .navigationDestination(for: ChannelMessage.self) { message in
            ChannelThreadView(
                channels: channels,
                channel: currentChannel,
                parent: message,
                currentUserID: currentUserID,
                projects: projects,
                providers: providers,
                workers: workers,
                onIssueOpen: onIssueOpen,
                onSkillSessionMaterialized: onSkillSessionMaterialized,
                onSkillSessionOpen: onSkillSessionOpen
            )
        }
        .onDisappear {
            // Covers interactive navigation pops. This is intentionally a
            // no-op while a child thread owns the focus.
            channels.closeChannelFocus(channelID: channel.id)
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

private struct ChannelNavigationTitle: View {
    let channel: ChannelSummary
    let locale: CompanionLocale

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
        HStack(spacing: 7) {
            Image(systemName: channel.visibility == .restricted ? "lock.fill" : "number")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 0) {
                Text(channel.name)
                    .font(.headline)
                    .lineLimit(1)
                Text("\(memberLabel) • \(agentLabel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("channel-header-identity")
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
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onIssueOpen: ChannelIssueOpenHandler
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var currentChannel: ChannelSummary {
        channels.channels.first(where: { $0.id == channel.id }) ?? channel
    }

    var body: some View {
        ChannelConversationView(
            channels: channels,
            draft: $draft,
            previewFile: $previewFile,
            channel: currentChannel,
            currentUserID: currentUserID,
            locale: locale,
            messages: channels.thread,
            onIssueOpen: onIssueOpen,
            parentMessageID: parent.id,
            projects: projects,
            providers: providers,
            workers: workers,
            onSkillSessionMaterialized: onSkillSessionMaterialized,
            onSkillSessionOpen: onSkillSessionOpen,
            showsThreadSummary: false
        )
        .navigationTitle(L10n.text(.channelThread, locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
        }
        .task(id: parent.id) {
            await channels.openThread(channelID: channel.id, parentMessageID: parent.id)
        }
        .onDisappear {
            channels.closeThreadFocus(
                channelID: channel.id,
                parentMessageID: parent.id
            )
        }
    }
}

/// Shared channel and thread conversation surface. The two behavioral differences
/// remain explicit inputs: replies carry `parentMessageID`, while only roots show
/// navigation summaries for their threads.
private struct ChannelConversationView: View {
    @ObservedObject var channels: ChannelsStore
    @Binding var draft: String
    @Binding var previewFile: PreviewFile?

    let channel: ChannelSummary
    let currentUserID: String?
    let locale: CompanionLocale
    let messages: [ChannelMessage]
    let onIssueOpen: ChannelIssueOpenHandler
    let parentMessageID: UUID?
    let projects: [ProjectsResponse.Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler
    let showsThreadSummary: Bool

    private var mentionCandidates: [ChannelMentionTarget] {
        ChannelMentions.candidates(
            members: channels.members,
            agents: channels.agents,
            currentUserId: currentUserID
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if let errorMessage = channels.errorMessage {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(errorMessage)
                        .font(.caption)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        channels.dismissError()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.text("닫기", locale: locale))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.red.opacity(0.08))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("channel-error-banner")
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(messages) { message in
                        ChannelMessageRow(
                            acceptingProposalID: channels.acceptingProposalID,
                            approvingExecutionProposalID: channels.approvingExecutionProposalID,
                            preparingExecutionProposalID: channels.preparingExecutionProposalID,
                            approvingSkillExecutionProposalID:
                                channels.approvingSkillExecutionProposalID,
                            preparingSkillExecutionProposalID:
                                channels.preparingSkillExecutionProposalID,
                            agents: channels.agents,
                            channel: channel,
                            currentUserID: currentUserID,
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
                            onApproveExecution: { proposalID, request in
                                guard let response = await channels.acceptExecutionProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID,
                                    request: request
                                ) else {
                                    throw ChannelExecutionApprovalError(
                                        message: channels.errorMessage ?? L10n.text(
                                            "실행 요청을 처리하지 못했습니다.",
                                            locale: locale
                                        )
                                    )
                                }
                                return response
                            },
                            onPrepareExecution: { proposalID in
                                await channels.prepareExecutionProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID
                                )
                            },
                            onApproveSkillExecution: { proposalID, request in
                                guard let response = await channels.acceptSkillExecutionProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID,
                                    request: request
                                ) else {
                                    throw ChannelExecutionApprovalError(
                                        message: channels.errorMessage ?? L10n.text(
                                            "Skill 실행 요청을 처리하지 못했습니다.",
                                            locale: locale
                                        )
                                    )
                                }
                                onSkillSessionMaterialized(response.session)
                                return response
                            },
                            onPrepareSkillExecution: { proposalID in
                                await channels.prepareSkillExecutionProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID
                                )
                            },
                            onSkillSessionOpen: onSkillSessionOpen,
                            onIssueOpen: { projectID, runID in
                                guard let context = channels.captureFocus(
                                    channelID: channel.id,
                                    threadParentID: parentMessageID
                                ) else { return }
                                await onIssueOpen(projectID, runID) {
                                    channels.focusIsCurrent(context)
                                }
                            },
                            onLoadAttachment: { attachment in
                                try await channels.download(
                                    path: attachment.url,
                                    filename: attachment.filename
                                )
                            },
                            onOpenAttachment: { previewFile = PreviewFile(url: $0) },
                            onToggleReaction: { emoji in
                                await channels.toggleReaction(
                                    channelID: channel.id,
                                    messageID: message.id,
                                    emoji: emoji
                                )
                            },
                            projects: projects,
                            providers: providers,
                            workers: workers,
                            showsThreadSummary: showsThreadSummary
                        )
                    }
                }
            }
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                candidates: mentionCandidates,
                placeholder: String(
                    format: L10n.text(.channelMessagePlaceholder, locale: locale),
                    channel.name
                ),
                send: { body, mentions, attachments in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: parentMessageID,
                        body: body,
                        mentions: mentions,
                        attachments: attachments
                    )
                }
            )
        }
    }
}

private struct ChannelMessageRow: View {
    private static let quickReactionEmojis = ["👍", "❤️", "😂", "🎉"]

    let acceptingProposalID: UUID?
    let approvingExecutionProposalID: UUID?
    let preparingExecutionProposalID: UUID?
    let approvingSkillExecutionProposalID: UUID?
    let preparingSkillExecutionProposalID: UUID?
    let agents: [ChannelAgentSummary]
    let channel: ChannelSummary
    let currentUserID: String?
    let members: [ChannelMember]
    let message: ChannelMessage
    let locale: CompanionLocale
    let onAcceptProposal: (UUID, UUID) async -> AcceptChannelProposalResponse?
    let onApproveExecution: (
        UUID,
        AcceptIssueExecutionProposalRequest
    ) async throws -> AcceptChannelExecutionProposalResponse
    let onPrepareExecution: (
        UUID
    ) async -> ChannelsStore.ExecutionApprovalContext?
    let onApproveSkillExecution: (
        UUID,
        AcceptAgentSkillExecutionProposalRequest
    ) async throws -> AcceptAgentSkillExecutionProposalResponse
    let onPrepareSkillExecution: (
        UUID
    ) async -> ChannelsStore.SkillExecutionApprovalContext?
    let onSkillSessionOpen: SkillSessionOpenHandler
    let onIssueOpen: (UUID, UUID) async -> Void
    let onLoadAttachment: @MainActor (ChannelMessageAttachment) async throws -> URL
    let onOpenAttachment: @MainActor (URL) -> Void
    let onToggleReaction: (String) async -> Void
    let projects: [ProjectsResponse.Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
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
                        acceptanceInFlight: acceptingProposalID != nil ||
                            approvingExecutionProposalID != nil ||
                            preparingExecutionProposalID != nil ||
                            approvingSkillExecutionProposalID != nil ||
                            preparingSkillExecutionProposalID != nil,
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
                if let proposal = message.executionProposal {
                    ChannelExecutionProposalCard(
                        acceptanceInFlight: acceptingProposalID != nil ||
                            approvingExecutionProposalID != nil ||
                            preparingExecutionProposalID != nil ||
                            approvingSkillExecutionProposalID != nil ||
                            preparingSkillExecutionProposalID != nil,
                        approving: approvingExecutionProposalID == proposal.id,
                        opening: preparingExecutionProposalID == proposal.id,
                        channel: channel,
                        locale: locale,
                        onApprove: { request in
                            try await onApproveExecution(proposal.id, request)
                        },
                        onIssueOpen: onIssueOpen,
                        onPrepare: {
                            await onPrepareExecution(proposal.id)
                        },
                        projects: projects,
                        proposal: proposal,
                        workers: workers
                    )
                    .padding(.top, 5)
                }
                if let proposal = message.skillExecutionProposal {
                    ChannelSkillExecutionProposalCard(
                        acceptanceInFlight: acceptingProposalID != nil ||
                            approvingExecutionProposalID != nil ||
                            preparingExecutionProposalID != nil ||
                            approvingSkillExecutionProposalID != nil ||
                            preparingSkillExecutionProposalID != nil,
                        approving: approvingSkillExecutionProposalID == proposal.id,
                        opening: preparingSkillExecutionProposalID == proposal.id,
                        channel: channel,
                        locale: locale,
                        onApprove: { request in
                            try await onApproveSkillExecution(proposal.id, request)
                        },
                        onPrepare: {
                            await onPrepareSkillExecution(proposal.id)
                        },
                        onSessionOpen: onSkillSessionOpen,
                        proposal: proposal,
                        workers: workers
                    )
                    .padding(.top, 5)
                }
                ChannelReactionBar(
                    currentUserID: currentUserID,
                    locale: locale,
                    message: message,
                    onToggleReaction: onToggleReaction,
                    quickEmojis: Self.quickReactionEmojis
                )
                .padding(.top, 4)
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

private struct ChannelReactionBar: View {
    let currentUserID: String?
    let locale: CompanionLocale
    let message: ChannelMessage
    let onToggleReaction: (String) async -> Void
    let quickEmojis: [String]

    var body: some View {
        FlowReactionRow {
            ForEach(message.reactions) { reaction in
                let mine = currentUserID.map { reaction.userIds.contains($0) } ?? false
                Button {
                    Task { await onToggleReaction(reaction.emoji) }
                } label: {
                    HStack(spacing: 4) {
                        Text(reaction.emoji)
                        Text("\(reaction.count)")
                            .font(.caption.weight(.semibold))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(
                        Capsule(style: .continuous)
                            .fill(mine ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.12))
                    )
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(
                                mine ? Color.accentColor.opacity(0.45) : Color.secondary.opacity(0.2),
                                lineWidth: 1
                            )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(
                    "channel-reaction-\(message.id.uuidString.lowercased())-\(reaction.emoji)"
                )
            }

            Menu {
                ForEach(quickEmojis, id: \.self) { emoji in
                    Button(emoji) {
                        Task { await onToggleReaction(emoji) }
                    }
                }
            } label: {
                Label(
                    L10n.text(.channelReact, locale: locale),
                    systemImage: "face.smiling"
                )
                .labelStyle(.iconOnly)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.secondary.opacity(0.12))
                )
            }
            .accessibilityLabel(L10n.text(.channelReact, locale: locale))
            .accessibilityIdentifier(
                "channel-react-\(message.id.uuidString.lowercased())"
            )
        }
    }
}

/// Lightweight wrapping row for reaction chips without a third-party layout dependency.
private struct FlowReactionRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        // iOS 16+ Layout that wraps; fall back to a simple HStack-style wrap via LazyVGrid.
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 44), spacing: 6, alignment: .leading)],
            alignment: .leading,
            spacing: 6
        ) {
            content
        }
    }
}

private struct ChannelProposalCard: View {
    @State private var selectedProjectID: UUID?
    @State private var descriptionExpanded = false

    let accepting: Bool
    let acceptanceInFlight: Bool
    let channel: ChannelSummary
    let locale: CompanionLocale
    let onAccept: (UUID) async -> AcceptChannelProposalResponse?
    let onIssueOpen: (UUID, UUID) async -> Void
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

    private var targetProjectName: String? {
        guard let targetProjectID else { return nil }
        return availableProjects.first(where: { $0.id == targetProjectID })?.name
            ?? targetProjectID.uuidString.lowercased()
    }

    private var issueDescription: String? {
        guard let rawDescription = proposal.payload?.issue?.description else { return nil }
        let description = rawDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return description.isEmpty ? nil : description
    }

    private var descriptionNeedsExpansion: Bool {
        guard let issueDescription else { return false }
        return issueDescription.count > 240 ||
            issueDescription.components(separatedBy: .newlines).count > 3
    }

    private var requestsExecutionFollowUp: Bool {
        proposal.payload?.executeAfterCreate == true
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

            if let issue = proposal.payload?.issue {
                VStack(alignment: .leading, spacing: 5) {
                    Text(issue.title)
                        .font(.subheadline.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if let issueDescription {
                        Text(issueDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(
                                descriptionNeedsExpansion && !descriptionExpanded ? 3 : nil
                            )
                            .fixedSize(horizontal: false, vertical: true)
                        if descriptionNeedsExpansion {
                            Button(
                                L10n.text(
                                    descriptionExpanded
                                        ? .channelIssueHideDescription
                                        : .channelIssueShowDescription,
                                    locale: locale
                                )
                            ) {
                                descriptionExpanded.toggle()
                            }
                            .buttonStyle(.plain)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier(
                                "channel-proposal-description-\(proposal.id.uuidString.lowercased())"
                            )
                        }
                    }
                    if let priority = issue.priority {
                        Label(
                            String(
                                format: L10n.text(.channelIssuePriority, locale: locale),
                                priority
                            ),
                            systemImage: "flag"
                        )
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier(
                    "channel-proposal-details-\(proposal.id.uuidString.lowercased())"
                )
            }

            if proposal.status == .pending {
                if let targetProjectName {
                    Label(
                        String(
                            format: L10n.text(.channelIssueProject, locale: locale),
                            targetProjectName
                        ),
                        systemImage: "folder"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                Label(
                    L10n.text(.channelIssueCreationSafety, locale: locale),
                    systemImage: "tray"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                if requestsExecutionFollowUp {
                    Label(
                        L10n.text(
                            "생성 승인 후에도 자동 실행되지 않습니다. 별도의 실행 승인 카드가 이어서 표시됩니다.",
                            locale: locale
                        ),
                        systemImage: "checkmark.shield"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(
                        "channel-proposal-execution-follow-up-\(proposal.id.uuidString.lowercased())"
                    )
                }

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
                    .disabled(acceptanceInFlight || channel.archivedAt != nil)
                    .accessibilityIdentifier(
                        "channel-proposal-project-\(proposal.id.uuidString.lowercased())"
                    )
                }

                Button {
                    guard let targetProjectID else { return }
                    Task {
                        if let result = await onAccept(targetProjectID),
                           !requestsExecutionFollowUp,
                           result.executionProposal == nil {
                            await onIssueOpen(result.projectId, result.resultRunId)
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
                .disabled(
                    !channelProposalApprovalIsEnabled(
                        acceptanceInFlight: acceptanceInFlight,
                        channelArchived: channel.archivedAt != nil,
                        targetProjectID: targetProjectID,
                        issue: proposal.payload?.issue
                    )
                )
                .accessibilityIdentifier(
                    "accept-channel-proposal-\(proposal.id.uuidString.lowercased())"
                )
            } else if let projectID = proposal.projectId,
                      let runID = proposal.resultRunId {
                Button(L10n.text(.channelViewIssue, locale: locale)) {
                    Task { await onIssueOpen(projectID, runID) }
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

private struct ChannelExecutionProposalCard: View {
    @State private var approvalContext: ChannelsStore.ExecutionApprovalContext?

    let acceptanceInFlight: Bool
    let approving: Bool
    let opening: Bool
    let channel: ChannelSummary
    let locale: CompanionLocale
    let onApprove: (
        AcceptIssueExecutionProposalRequest
    ) async throws -> AcceptChannelExecutionProposalResponse
    let onIssueOpen: (UUID, UUID) async -> Void
    let onPrepare: () async -> ChannelsStore.ExecutionApprovalContext?
    let projects: [ProjectsResponse.Project]
    let proposal: IssueExecutionProposal
    let workers: [DashboardWorker]

    private var targetProjectID: UUID? {
        proposal.projectId
    }

    private var targetProjectName: String? {
        guard let targetProjectID else { return nil }
        return projects.first(where: { $0.id == targetProjectID })?.name
            ?? targetProjectID.uuidString.lowercased()
    }

    private var targetTitle: String {
        let normalized = proposal.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? L10n.text("실행할 이슈", locale: locale) : normalized
    }

    private var delegationNotice: String? {
        issueExecutionDelegationNotice(
            agentName: proposal.delegatedByAgentName,
            locale: locale
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.text("이슈 실행 제안", locale: locale))
                    .font(.caption.weight(.bold))
                Text(
                    proposal.status == .accepted
                        ? L10n.text("승인되어 실행을 요청했습니다.", locale: locale)
                        : L10n.text("설정을 선택하고 명시적으로 승인해야 실행됩니다.", locale: locale)
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            Text(targetTitle)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            if let targetProjectName {
                Label(
                    String(
                        format: L10n.text(.channelIssueProject, locale: locale),
                        targetProjectName
                    ),
                    systemImage: "folder"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            if let delegationNotice {
                Label(delegationNotice, systemImage: "arrow.triangle.branch")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if proposal.status == .pending {
                Label(
                    L10n.text(
                        "승인 시점에도 fresh backlog 상태인지 다시 확인합니다.",
                        locale: locale
                    ),
                    systemImage: "checkmark.shield"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)

                Button {
                    Task {
                        approvalContext = await onPrepare()
                    }
                } label: {
                    if approving || opening {
                        ProgressView().controlSize(.small)
                    } else {
                        Label(
                            L10n.text("실행 설정 선택", locale: locale),
                            systemImage: "slider.horizontal.3"
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(
                    !channelExecutionProposalApprovalIsEnabled(
                        acceptanceInFlight: acceptanceInFlight,
                        channelArchived: channel.archivedAt != nil,
                        proposal: proposal
                    )
                )
                .accessibilityIdentifier(
                    "configure-channel-execution-proposal-\(proposal.id.uuidString.lowercased())"
                )
            } else {
                executionSummary
                if let projectID = targetProjectID {
                    Button(L10n.text(.channelViewIssue, locale: locale)) {
                        Task { await onIssueOpen(projectID, proposal.runId) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .accessibilityIdentifier(
                        "open-channel-execution-result-\(proposal.id.uuidString.lowercased())"
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.orange.opacity(0.35), lineWidth: 1)
        }
        .sheet(item: $approvalContext) { context in
            ExecutionProposalApprovalSheet(
                targetTitle: targetTitle,
                providers: context.snapshot.organizationProviders ?? [],
                workers: context.snapshot.workers ?? [],
                policy: context.snapshot.executionPolicy,
                locale: locale,
                delegationNotice: delegationNotice,
                approve: { request in
                    _ = try await onApprove(request)
                    return true
                }
            )
        }
        .onChange(of: channel.archivedAt) { _, archivedAt in
            if archivedAt != nil { approvalContext = nil }
        }
        .onChange(of: proposal.id) { _, _ in
            approvalContext = nil
        }
        .onChange(of: proposal.status) { _, status in
            if status != .pending { approvalContext = nil }
        }
    }

    @ViewBuilder
    private var executionSummary: some View {
        if let provider = proposal.requestedProvider {
            let components = [
                provider.displayName,
                proposal.requestedModel,
                proposal.requestedEffort?.rawValue,
            ].compactMap { $0 }
            Label(components.joined(separator: " · "), systemImage: "cpu")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        if let workerID = proposal.requestedWorkerId {
            let label = workers.first(where: { $0.id == workerID })?.label ?? workerID
            Label(label, systemImage: "desktopcomputer")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ChannelSkillExecutionProposalCard: View {
    @State private var approvalContext: ChannelsStore.SkillExecutionApprovalContext?

    let acceptanceInFlight: Bool
    let approving: Bool
    let opening: Bool
    let channel: ChannelSummary
    let locale: CompanionLocale
    let onApprove: (
        AcceptAgentSkillExecutionProposalRequest
    ) async throws -> AcceptAgentSkillExecutionProposalResponse
    let onPrepare: () async -> ChannelsStore.SkillExecutionApprovalContext?
    let onSessionOpen: SkillSessionOpenHandler
    let proposal: AgentSkillExecutionProposal
    let workers: [DashboardWorker]

    private var runtimeLabel: String {
        [
            proposal.provider.displayName,
            proposal.model,
            proposal.effort?.rawValue,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    private var workerLabel: String? {
        proposal.requestedWorkerLabel ?? proposal.requestedWorkerId.flatMap { workerID in
            workers.first(where: { $0.id == workerID })?.label ?? workerID
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.text("Agent Skill 실행 제안", locale: locale))
                    .font(.caption.weight(.bold))
                Text(
                    proposal.status == .accepted
                        ? L10n.text("승인되어 Agent 세션을 시작했습니다.", locale: locale)
                        : L10n.text(
                            "정확한 Worker를 선택하고 명시적으로 승인해야 실행됩니다.",
                            locale: locale
                        )
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            LabeledContent("Agent", value: proposal.agentName)
                .font(.caption)
            LabeledContent(L10n.text("Skill", locale: locale), value: proposal.skillName)
                .font(.caption)
            Label(runtimeLabel, systemImage: "cpu")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(proposal.request)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)

            if let delegatedBy = proposal.delegatedByAgentName {
                Label(
                    L10n.format(
                        "%@ Agent가 Project Agent에게 위임했습니다.",
                        locale: locale,
                        delegatedBy
                    ),
                    systemImage: "arrow.triangle.branch"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            if proposal.status == .pending {
                Label(
                    L10n.text(
                        "Agent, Skill, 요청과 런타임은 승인 화면에서 변경할 수 없습니다.",
                        locale: locale
                    ),
                    systemImage: "lock.shield"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)

                Button {
                    Task { approvalContext = await onPrepare() }
                } label: {
                    if approving || opening {
                        ProgressView().controlSize(.small)
                    } else {
                        Label(
                            L10n.text("Worker 선택", locale: locale),
                            systemImage: "desktopcomputer"
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(
                    !channelSkillExecutionProposalApprovalIsEnabled(
                        acceptanceInFlight: acceptanceInFlight,
                        channelArchived: channel.archivedAt != nil,
                        proposal: proposal
                    )
                )
                .accessibilityIdentifier(
                    "configure-channel-skill-execution-proposal-\(proposal.id.uuidString.lowercased())"
                )
            } else {
                if let workerLabel {
                    Label(workerLabel, systemImage: "desktopcomputer")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let sessionID = proposal.resultSessionId {
                    Button(L10n.text("Agent 세션 보기", locale: locale)) {
                        onSessionOpen(proposal.projectId, sessionID)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .accessibilityIdentifier(
                        "open-channel-skill-session-\(proposal.id.uuidString.lowercased())"
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.purple.opacity(0.35), lineWidth: 1)
        }
        .sheet(item: $approvalContext) { context in
            AgentSkillExecutionApprovalSheet(
                proposal: proposal,
                workers: context.snapshot.workers ?? [],
                policy: context.snapshot.executionPolicy,
                locale: locale,
                approve: { request in
                    _ = try await onApprove(request)
                    return true
                }
            )
        }
        .onChange(of: channel.archivedAt) { _, archivedAt in
            if archivedAt != nil { approvalContext = nil }
        }
        .onChange(of: proposal) { previous, current in
            if previous != current { approvalContext = nil }
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
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .controlSize(.regular)
                .disabled(
                    isLoadingPhotos || sending ||
                        attachments.count >= PendingIssueAttachment.maximumCount
                )
                .accessibilityLabel(L10n.text("이미지 첨부"))
                .accessibilityIdentifier("channel-composer-attach")
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
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
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .controlSize(.regular)
                    .disabled(sending)
                    .accessibilityIdentifier("channel-composer-send")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
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
            .accessibilityLabel(L10n.text("첨부 삭제"))
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}
