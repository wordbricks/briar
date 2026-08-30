import SwiftUI

typealias ChannelIssueOpenHandler = (
    UUID,
    UUID,
    @escaping @MainActor () -> Bool
) async -> Void

typealias SkillSessionMaterializedHandler = @MainActor (ProjectAgentSession) -> Void
typealias SkillSessionOpenHandler = @MainActor (UUID, String) -> Void

enum CompanionHomeRoute: Hashable {
    case projectLobby
    case agents
}

private struct ChannelExecutionApprovalError: LocalizedError, Sendable {
    let message: String
    var errorDescription: String? { message }
}

func channelProposalApprovalIsEnabled(
    acceptanceInFlight: Bool,
    channelArchived: Bool,
    targetProjectID: UUID?,
    issue: ChannelMessage.Proposal.Payload.Issue?,
    batch: ChannelMessage.Proposal.Payload.Batch? = nil
) -> Bool {
    !acceptanceInFlight && !channelArchived && targetProjectID != nil &&
        (issue != nil || batch?.items.isEmpty == false)
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

enum ChannelReplySummaryPresentation {
    static func isVisible(
        showsThreadSummary: Bool,
        isOptimistic: Bool,
        replyCount: Int
    ) -> Bool {
        showsThreadSummary && !isOptimistic && replyCount > 0
    }

    static func participants(for message: ChannelMessage) -> [ChannelMessage.Author] {
        var seen = Set<String>()
        var result: [ChannelMessage.Author] = []
        for author in [message.author] + message.replyAuthors {
            let key = "\(author.type.rawValue):\(author.name):\(author.image ?? "")"
            guard seen.insert(key).inserted else { continue }
            result.append(author)
            if result.count == 3 { break }
        }
        return result
    }
}

/// Home: the organization's channels, grouped by project with section dividers.
struct ChannelsHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @ObservedObject var navigation: CompanionNavigationModel
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let activeProjectID: UUID?
    let currentUserID: String?
    let projects: [Project]
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
            Section {
                NavigationLink(value: CompanionHomeRoute.projectLobby) {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.3.group")
                            .font(.headline)
                            .foregroundStyle(.tint)
                            .frame(width: 36, height: 36)
                            .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(L10n.text(.projectLobbyOpen, locale: locale))
                                .font(.subheadline.weight(.semibold))
                            Text(L10n.text(.projectLobbyOpenDescription, locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .accessibilityIdentifier("project-lobby-link")

                NavigationLink(value: CompanionHomeRoute.agents) {
                    HStack(spacing: 12) {
                        Image(systemName: "cpu")
                            .font(.headline)
                            .foregroundStyle(.tint)
                            .frame(width: 36, height: 36)
                            .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(L10n.text(.projectAgentsOpen, locale: locale))
                                .font(.subheadline.weight(.semibold))
                            Text(L10n.text(.projectAgentsOpenDescription, locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .accessibilityIdentifier("project-agents-link")
            }

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

            if groups.isEmpty {
                Section {
                    if channels.loading {
                        ChannelLoadingIndicator(
                            accessibilityID: "channel-list-loading-spinner",
                            label: L10n.text("채널을 불러오는 중…", locale: locale)
                        )
                    } else {
                        Label(
                            L10n.text(.channelsEmpty, locale: locale),
                            systemImage: "number"
                        )
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await channels.refresh() }
        .navigationDestination(for: ChannelSummary.self) { channel in
            ChannelMessagesView(
                channels: channels,
                navigation: navigation,
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

struct ProjectLobbySummary: Equatable {
    let total: Int
    let active: Int
    let attention: Int
    let completed: Int
    let recent: [DashboardRun]

    init(runs: [DashboardRun]) {
        total = runs.count
        active = runs.filter {
            $0.status == .queued || $0.status == .running || $0.status == .paused
        }.count
        attention = runs.filter {
            $0.status == .blocked || $0.status == .failed
        }.count
        completed = runs.filter { $0.status == .completed }.count
        recent = Array(runs.sorted { $0.updatedAt > $1.updatedAt }.prefix(5))
    }
}

struct ProjectLobbyView: View {
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue

    let project: Project
    let snapshot: DashboardSnapshot?
    let errorMessage: String?
    let refresh: () async -> Void
    let onTasksOpen: () -> Void
    let onIssueOpen: ChannelIssueOpenHandler

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var runs: [DashboardRun] {
        snapshot?.project.id == project.id ? snapshot?.runs ?? [] : []
    }

    private var summary: ProjectLobbySummary {
        ProjectLobbySummary(runs: runs)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 12) {
                        ProjectIconView(icon: project.icon, size: 42)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(project.name)
                                .font(.headline)
                            Text(project.organizationName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(L10n.text(.projectLobbyTitle, locale: locale))
                        .font(.largeTitle.bold())
                    Text(L10n.text(.projectLobbyDescription, locale: locale))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 12
                ) {
                    metricCard(
                        title: L10n.text(.projectLobbyAll, locale: locale),
                        value: summary.total,
                        systemImage: "list.bullet"
                    )
                    metricCard(
                        title: L10n.text(.projectLobbyActive, locale: locale),
                        value: summary.active,
                        systemImage: "clock"
                    )
                    metricCard(
                        title: L10n.text(.projectLobbyAttention, locale: locale),
                        value: summary.attention,
                        systemImage: "exclamationmark.triangle"
                    )
                    metricCard(
                        title: L10n.text(.projectLobbyCompleted, locale: locale),
                        value: summary.completed,
                        systemImage: "checkmark.circle"
                    )
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "wifi.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 0) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(L10n.text(.projectLobbyRecent, locale: locale))
                                .font(.headline)
                            Text(L10n.text(.projectLobbyRecentDescription, locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(L10n.text(.projectLobbyViewAll, locale: locale), action: onTasksOpen)
                            .font(.caption.weight(.semibold))
                    }
                    .padding()

                    Divider()

                    if summary.recent.isEmpty {
                        ContentUnavailableView(
                            L10n.text(.projectLobbyEmpty, locale: locale),
                            systemImage: "checklist"
                        )
                        .frame(maxWidth: .infinity, minHeight: 150)
                    } else {
                        ForEach(Array(summary.recent.enumerated()), id: \.element.id) { index, run in
                            if index > 0 { Divider().padding(.leading) }
                            Button {
                                Task {
                                    await onIssueOpen(project.id, run.id, { true })
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    Circle()
                                        .fill(statusColor(run.status))
                                        .frame(width: 8, height: 8)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(run.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        Text(run.status.displayName(locale: locale))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .contentShape(Rectangle())
                                .padding()
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier(
                                "project-lobby-run-\(run.id.uuidString.lowercased())"
                            )
                        }
                    }
                }
                .background(.background, in: RoundedRectangle(cornerRadius: 16))
                .overlay {
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 0.5)
                }
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(L10n.text(.projectLobbyTitle, locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await refresh() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await refresh() }
                } label: {
                    Label(
                        L10n.text(.projectLobbyRefresh, locale: locale),
                        systemImage: "arrow.clockwise"
                    )
                }
                .accessibilityIdentifier("project-lobby-refresh")
            }
        }
    }

    private func metricCard(title: String, value: Int, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value.formatted(.number.locale(Locale(identifier: locale.foundationIdentifier))))
                .font(.title.bold().monospacedDigit())
        }
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 0.5)
        }
    }

    private func statusColor(_ status: DashboardRun.Status) -> Color {
        switch status {
        case .running, .queued: .blue
        case .paused: .orange
        case .blocked, .failed: .red
        case .completed: .green
        case .backlog, .cancelled: .secondary
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
            Text(channel.name)
                .fontWeight(channel.hasUnread == true ? .semibold : .regular)
                .lineLimit(1)
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
    @ObservedObject var navigation: CompanionNavigationModel
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""
    @State private var previewFile: PreviewFile?
    @State private var selectedThread: ChannelThreadRoute?
    @State private var selectedProfile: ConversationProfileTarget?

    let channel: ChannelSummary
    let currentUserID: String?
    let projects: [Project]
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

    private var displayTitle: String {
        currentChannel.isDirectMessage
            ? currentChannel.directMessageDisplayName(currentUserID: currentUserID)
            : currentChannel.name
    }

    private var navigationSubtitle: String {
        channelParticipationLabel(channel: currentChannel, locale: locale)
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
            // Direct messages flow as one continuous conversation, so replies
            // render inline instead of collapsing into a thread summary and
            // long-press thread actions stay unavailable.
            onOpenThread: currentChannel.isDirectMessage
                ? nil
                : { openThread(from: $0) },
            showsThreadSummary: !currentChannel.isDirectMessage
        )
        .navigationTitle(currentChannel.isDirectMessage ? "" : displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .channelNavigationSubtitle(currentChannel.isDirectMessage ? nil : navigationSubtitle)
        .toolbar {
            if currentChannel.isDirectMessage {
                ToolbarItem(placement: .principal) {
                    DirectMessageNavigationTitle(
                        channel: currentChannel,
                        currentUserID: currentUserID,
                        members: channels.members,
                        agents: channels.agents,
                        locale: locale,
                        onSelect: { selectedProfile = $0 }
                    )
                }
            } else {
                ToolbarItem(placement: .principal) {
                    ChannelNavigationTitle(
                        channel: currentChannel,
                        currentUserID: currentUserID,
                        locale: locale
                    )
                }
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: channel.id) { await channels.openChannel(channel.id) }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
                .accessibilityIdentifier("channel-attachment-preview")
        }
        .sheet(item: $selectedProfile) { profile in
            ConversationProfileSheet(profile: profile, locale: locale)
        }
        .navigationDestination(item: $selectedThread) { route in
            ChannelThreadView(
                channels: channels,
                channel: currentChannel,
                parentMessageID: route.parentMessageID,
                highlightMessageID: route.highlightMessageID,
                currentUserID: currentUserID,
                projects: projects,
                providers: providers,
                workers: workers,
                onIssueOpen: onIssueOpen,
                onSkillSessionMaterialized: onSkillSessionMaterialized,
                onSkillSessionOpen: onSkillSessionOpen
            )
        }
        .onChange(of: navigation.pendingChannelThread) { _, _ in
            applyPendingInboxThread()
        }
        .task(id: navigation.pendingChannelThread?.parentMessageID) {
            applyPendingInboxThread()
        }
        .onDisappear {
            // Covers interactive navigation pops. This is intentionally a
            // no-op while a child thread owns the focus.
            channels.closeChannelFocus(channelID: channel.id)
        }
        .overlay {
            if channels.messages.isEmpty {
                if channels.loading {
                    ChannelLoadingIndicator(
                        accessibilityID: "channel-message-loading-spinner",
                        label: L10n.text("채널 메시지를 불러오는 중…", locale: locale)
                    )
                } else {
                    ContentUnavailableView(
                        L10n.text(.channelsEmpty, locale: locale),
                        systemImage: "bubble.left.and.bubble.right"
                    )
                }
            }
        }
    }

    private func openThread(from message: ChannelMessage) {
        selectedThread = ChannelThreadRoute(
            channelID: currentChannel.id,
            parentMessageID: message.id,
            highlightMessageID: nil
        )
    }

    private func applyPendingInboxThread() {
        guard
            let route = navigation.pendingChannelThread,
            route.channelID == channel.id,
            !currentChannel.isDirectMessage
        else { return }
        selectedThread = route
        navigation.pendingChannelThread = nil
    }
}

private struct ChannelLoadingIndicator: View {
    let accessibilityID: String
    let label: String

    var body: some View {
        ProgressView()
            .controlSize(.large)
            .accessibilityLabel(label)
            .accessibilityIdentifier(accessibilityID)
    }
}

private func channelParticipationLabel(
    channel: ChannelSummary,
    locale: CompanionLocale
) -> String {
    let members = String(
        format: L10n.text(.channelMembers, locale: locale),
        channel.memberCount
    )
    let agents = String(
        format: L10n.text(.channelAgents, locale: locale),
        channel.agentCount
    )
    return "\(members) • \(agents)"
}

private extension View {
    @ViewBuilder
    func channelNavigationSubtitle(_ subtitle: String?) -> some View {
        if #available(iOS 26.0, *), let subtitle {
            navigationSubtitle(subtitle)
        } else {
            self
        }
    }
}

private struct ChannelNavigationTitle: View {
    let channel: ChannelSummary
    let currentUserID: String?
    let locale: CompanionLocale

    private var title: String {
        channel.isDirectMessage
            ? channel.directMessageDisplayName(currentUserID: currentUserID)
            : channel.name
    }

    private var subtitle: String {
        channel.isDirectMessage
            ? L10n.text("비공개 대화", locale: locale)
            : channelParticipationLabel(channel: channel, locale: locale)
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: channel.isDirectMessage
                ? "bubble.left.and.bubble.right.fill"
                : channel.visibility == .restricted ? "lock.fill" : "number")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 26)

            if #available(iOS 26.0, *) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .lineLimit(1)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 3)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(title), \(subtitle)"
        )
        .accessibilityIdentifier("channel-header-identity")
    }
}

private struct DirectMessageNavigationTitle: View {
    let channel: ChannelSummary
    let currentUserID: String?
    let members: [ChannelMember]
    let agents: [ChannelAgentSummary]
    let locale: CompanionLocale
    let onSelect: (ConversationProfileTarget) -> Void

    private var participants: [DirectMessageParticipant] {
        channel.directMessageParticipants(excluding: currentUserID)
    }

    private var title: String {
        channel.directMessageDisplayName(currentUserID: currentUserID)
    }

    var body: some View {
        Group {
            if participants.count > 1 {
                Menu {
                    ForEach(participants, id: \.profileKey) { participant in
                        Button {
                            onSelect(
                                ConversationProfileTarget.resolve(
                                    participant: participant,
                                    members: members,
                                    agents: agents
                                )
                            )
                        } label: {
                            Label(
                                participant.name,
                                systemImage: participant.type == .agent
                                    ? "cpu.fill"
                                    : "person.fill"
                            )
                        }
                        .accessibilityIdentifier(
                            "dm-header-participant-\(participant.profileKey)"
                        )
                    }
                } label: {
                    identityPill
                }
                .menuIndicator(.hidden)
                .accessibilityHint(L10n.text("참여자 목록 열기", locale: locale))
                .accessibilityIdentifier("channel-header-identity")
            } else {
                Button {
                    guard let participant = participants.first else { return }
                    onSelect(
                        ConversationProfileTarget.resolve(
                            participant: participant,
                            members: members,
                            agents: agents
                        )
                    )
                } label: {
                    identityPill
                }
                .disabled(participants.isEmpty)
                .accessibilityHint(L10n.text("프로필 보기", locale: locale))
                .accessibilityIdentifier("channel-header-identity")
            }
        }
        .buttonStyle(.plain)
    }

    private var identityPill: some View {
        HStack(spacing: 8) {
            DirectMessageHeaderAvatar(
                participants: participants,
                fallbackName: title
            )
            Text(title)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
        }
        .padding(.leading, 4)
        .padding(.trailing, 12)
        .padding(.vertical, 3)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityIdentifier("channel-header-identity-content")
    }
}

private struct DirectMessageHeaderAvatar: View {
    let participants: [DirectMessageParticipant]
    let fallbackName: String

    var body: some View {
        let visible = Array(participants.prefix(2))
        ZStack {
            if visible.isEmpty {
                ProfileImageView(
                    image: nil,
                    name: fallbackName,
                    systemImage: "person.2.fill",
                    size: 28
                )
            } else {
                ForEach(Array(visible.enumerated()), id: \.offset) { index, participant in
                    ProfileImageView(
                        image: participant.image,
                        name: participant.name,
                        systemImage: participant.type == .agent ? "cpu.fill" : "person.fill",
                        size: visible.count == 1 ? 28 : 22
                    )
                    .offset(
                        x: visible.count == 1 ? 0 : CGFloat(index * 8 - 4),
                        y: visible.count == 1 ? 0 : CGFloat(index * 5 - 2)
                    )
                }
            }
        }
        .frame(width: visible.count > 1 ? 34 : 28, height: 28)
        .accessibilityHidden(true)
    }
}

private struct ConversationProfileSheet: View {
    @Environment(\.dismiss) private var dismiss
    let profile: ConversationProfileTarget
    let locale: CompanionLocale

    private var roleLabel: String {
        switch profile {
        case let .agent(agent):
            return agent.projectId == nil
                ? L10n.text("조직 Agent", locale: locale)
                : L10n.text("프로젝트 Agent", locale: locale)
        case let .user(user):
            if user.role == "owner" {
                return L10n.text("채널 소유자", locale: locale)
            }
            return L10n.text("채널 멤버", locale: locale)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        ProfileImageView(
                            image: profile.image,
                            name: profile.name,
                            systemImage: profile.isAgent ? "cpu.fill" : "person.fill",
                            size: 56
                        )
                        VStack(alignment: .leading, spacing: 4) {
                            Text(profile.name)
                                .font(.title3.weight(.semibold))
                            Text(roleLabel)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(profile.name)
                    .accessibilityIdentifier("conversation-profile-name")
                }

                Section(L10n.text("프로필", locale: locale)) {
                    LabeledContent(L10n.text("역할", locale: locale), value: roleLabel)
                    switch profile {
                    case let .user(user):
                        if let email = user.email, !email.isEmpty {
                            LabeledContent(L10n.text("이메일", locale: locale), value: email)
                        }
                        if let createdAt = user.createdAt {
                            LabeledContent(
                                L10n.text("참여일", locale: locale),
                                value: createdAt.formatted(
                                    Date.FormatStyle(date: .long, time: .omitted)
                                        .locale(Locale(identifier: locale.foundationIdentifier))
                                )
                            )
                        }
                    case let .agent(agent):
                        if let provider = agent.provider, !provider.isEmpty {
                            LabeledContent(
                                L10n.text("실행 환경", locale: locale),
                                value: agent.model.map { "\(provider) · \($0)" } ?? provider
                            )
                        }
                        if let createdAt = agent.createdAt {
                            LabeledContent(
                                L10n.text("참여일", locale: locale),
                                value: createdAt.formatted(
                                    Date.FormatStyle(date: .long, time: .omitted)
                                        .locale(Locale(identifier: locale.foundationIdentifier))
                                )
                            )
                        }
                    }
                }

                if case let .agent(agent) = profile {
                    if let description = agent.description, !description.isEmpty {
                        Section(L10n.text("설명", locale: locale)) {
                            Text(description)
                        }
                    }
                    if let responsibility = agent.responsibility, !responsibility.isEmpty {
                        Section(L10n.text("책임", locale: locale)) {
                            Text(responsibility)
                        }
                    }
                }
            }
            .navigationTitle(L10n.text("프로필", locale: locale))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("닫기", locale: locale)) { dismiss() }
                        .accessibilityIdentifier("conversation-profile-close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("conversation-profile-sheet")
    }
}

struct ChannelThreadView: View {
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var draft = ""
    @State private var previewFile: PreviewFile?

    let channel: ChannelSummary
    let parentMessageID: UUID
    var highlightMessageID: UUID? = nil
    let currentUserID: String?
    let projects: [Project]
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
            parentMessageID: parentMessageID,
            projects: projects,
            providers: providers,
            workers: workers,
            onSkillSessionMaterialized: onSkillSessionMaterialized,
            onSkillSessionOpen: onSkillSessionOpen,
            onOpenThread: nil,
            showsThreadSummary: false,
            focusedMessageID: highlightMessageID
        )
        .navigationTitle(L10n.text(.channelThread, locale: locale))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ChannelThreadSubscriptionControls(
                    channels: channels,
                    channelID: channel.id,
                    currentUserID: currentUserID,
                    locale: locale,
                    rootMessageID: parentMessageID
                )
            }
        }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
                .accessibilityIdentifier("channel-attachment-preview")
        }
        .task(id: parentMessageID) {
            await channels.openThread(
                channelID: channel.id,
                parentMessageID: parentMessageID
            )
        }
        .onDisappear {
            channels.closeThreadFocus(
                channelID: channel.id,
                parentMessageID: parentMessageID
            )
        }
        .overlay {
            if channels.thread.isEmpty, channels.loading {
                ChannelLoadingIndicator(
                    accessibilityID: "channel-thread-loading-spinner",
                    label: L10n.text("채널 메시지를 불러오는 중…", locale: locale)
                )
            }
        }
    }
}

private struct ChannelThreadSubscriptionControls: View {
    @ObservedObject var channels: ChannelsStore

    let channelID: UUID
    let currentUserID: String?
    let locale: CompanionLocale
    let rootMessageID: UUID

    private var rootMessage: ChannelMessage? {
        channels.thread.first(where: { $0.id == rootMessageID })
            ?? channels.messages.first(where: { $0.id == rootMessageID })
    }

    private var subscribers: [IssueSubscriber] {
        rootMessage?.subscribers ?? []
    }

    private var subscriberMembers: [ChannelMember] {
        subscribers.compactMap { subscriber in
            channels.members.first(where: { $0.userId == subscriber.userId })
        }
    }

    private var isSubscribed: Bool {
        guard let currentUserID else { return false }
        return subscribers.contains { $0.userId == currentUserID }
    }

    var body: some View {
        HStack(spacing: 8) {
            if !subscriberMembers.isEmpty {
                HStack(spacing: -6) {
                    ForEach(Array(subscriberMembers.prefix(4)), id: \.userId) { member in
                        ProfileImageView(
                            image: member.image,
                            name: member.name,
                            systemImage: "person.fill",
                            size: 22
                        )
                        .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                    }
                }
                .accessibilityLabel(
                    L10n.format("구독 멤버 %d명", locale: locale, subscriberMembers.count)
                )
            }
            if currentUserID != nil {
                Button {
                    Task {
                        await channels.setThreadSubscription(
                            channelID: channelID,
                            messageID: rootMessageID,
                            subscribed: !isSubscribed
                        )
                    }
                } label: {
                    Label(
                        isSubscribed
                            ? L10n.text("구독 중", locale: locale)
                            : L10n.text("구독", locale: locale),
                        systemImage: isSubscribed ? "bell.fill" : "bell"
                    )
                    .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .disabled(channels.subscriptionPending)
                .accessibilityIdentifier("channel-thread-subscribe-button")
                .help(
                    isSubscribed
                        ? L10n.text("구독 해제", locale: locale)
                        : L10n.text("구독", locale: locale)
                )
            }
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
    let projects: [Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler
    let onOpenThread: ((ChannelMessage) -> Void)?
    let showsThreadSummary: Bool
    var focusedMessageID: UUID? = nil
    @State private var skillResultMessageID: UUID?

    private var mentionCandidates: [ChannelMentionTarget] {
        ChannelMentions.candidates(
            members: channels.members,
            agents: channels.agents,
            currentUserId: currentUserID
        )
    }

    private var typingStatuses: [ChannelsStore.AgentTypingStatus] {
        var messageIDs = Set(messages.map(\.id))
        if let parentMessageID { messageIDs.insert(parentMessageID) }
        return channels.typingStatuses(messageIDs: messageIDs)
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
            ConversationTimeline(
                messages: messages,
                locale: locale,
                accessibilityIdentifier: "channel-message-timeline",
                timestamp: \.createdAt,
                hasEarlierMessages: parentMessageID == nil && channels.hasEarlierMessages,
                loadingEarlierMessages:
                    parentMessageID == nil && channels.loadingEarlierMessages,
                focusedMessageID: skillResultMessageID ?? focusedMessageID,
                onLoadEarlier: parentMessageID == nil
                    ? { await channels.loadEarlierMessages(channelID: channel.id) }
                    : nil
            ) { message in
                ChannelMessageRow(
                            acceptingProposalID: channels.acceptingProposalID,
                            decliningProposalID: channels.decliningProposalID,
                            approvingExecutionProposalID: channels.approvingExecutionProposalID,
                            preparingExecutionProposalID: channels.preparingExecutionProposalID,
                            approvingSkillExecutionProposalID:
                                channels.approvingSkillExecutionProposalID,
                            preparingSkillExecutionProposalID:
                                channels.preparingSkillExecutionProposalID,
                            agents: channels.agents,
                            channel: channel,
                            currentUserID: currentUserID,
                            isOptimistic: channels.isMessageOptimistic(message.id),
                            members: channels.members,
                            message: message,
                            locale: locale,
                            onAcceptProposal: { proposalID, projectID, execution in
                                await channels.acceptProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID,
                                    projectID: projectID,
                                    execution: execution
                                )
                            },
                            onDeclineProposal: { proposalID in
                                await channels.declineProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID
                                )
                            },
                            onPrepareCreateExecution: { proposalID, projectID in
                                await channels.prepareCreateExecutionProposal(
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
                                if let session = response.session {
                                    onSkillSessionMaterialized(session)
                                }
                                return response
                            },
                            onPrepareSkillExecution: { proposalID in
                                await channels.prepareSkillExecutionProposal(
                                    channelID: channel.id,
                                    proposalID: proposalID
                                )
                            },
                            onSkillSessionOpen: onSkillSessionOpen,
                            onSkillResultOpen: { messageID in
                                skillResultMessageID = nil
                                Task { @MainActor in
                                    await Task.yield()
                                    skillResultMessageID = messageID
                                }
                            },
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
                            onDelete: {
                                _ = await channels.deleteMessage(
                                    channelID: channel.id,
                                    messageID: message.id
                                )
                            },
                            onToggleReaction: { emoji in
                                await channels.toggleReaction(
                                    channelID: channel.id,
                                    messageID: message.id,
                                    emoji: emoji
                                )
                            },
                            onOpenThread: showsThreadSummary
                                ? { onOpenThread?(message) }
                                : nil,
                            projects: projects,
                            providers: providers,
                            workers: workers,
                            showsThreadSummary: showsThreadSummary
                )
            }
            if !typingStatuses.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(typingStatuses) { status in
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text(
                                status.activity.map {
                                    "\(status.agentName) · \($0.displayHeadline)"
                                } ?? String(
                                    format: L10n.text(.channelAgentTyping, locale: locale),
                                    status.agentName
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            }
            ChannelComposer(
                draft: $draft,
                sending: channels.sending,
                candidates: mentionCandidates,
                placeholder: String(
                    format: L10n.text(.channelMessagePlaceholder, locale: locale),
                    channel.name
                ),
                locale: locale,
                send: { body, mentions, attachments in
                    await channels.send(
                        channelID: channel.id,
                        parentMessageID: parentMessageID,
                        body: body,
                        currentUserID: currentUserID,
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
    let decliningProposalID: UUID?
    let approvingExecutionProposalID: UUID?
    let preparingExecutionProposalID: UUID?
    let approvingSkillExecutionProposalID: UUID?
    let preparingSkillExecutionProposalID: UUID?
    let agents: [ChannelAgentSummary]
    let channel: ChannelSummary
    let currentUserID: String?
    let isOptimistic: Bool
    let members: [ChannelMember]
    let message: ChannelMessage
    let locale: CompanionLocale
    let onAcceptProposal: (
        UUID,
        UUID,
        AcceptIssueExecutionProposalRequest?
    ) async -> AcceptChannelProposalResponse?
    let onDeclineProposal: (UUID) async -> Bool
    let onPrepareCreateExecution: (
        UUID,
        UUID
    ) async -> ChannelsStore.ExecutionApprovalContext?
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
    let onSkillResultOpen: (UUID) -> Void
    let onIssueOpen: (UUID, UUID) async -> Void
    let onLoadAttachment: @MainActor (ChannelMessageAttachment) async throws -> URL
    let onOpenAttachment: @MainActor (URL) -> Void
    let onDelete: () async -> Void
    let onToggleReaction: (String) async -> Void
    let onOpenThread: (() -> Void)?
    let projects: [Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    var showsThreadSummary = false
    @State private var showingThreadActions = false
    @State private var linkCopied = false
    @State private var messageCopied = false
    @State private var confirmingDelete = false

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

    private var authorSystemImage: String {
        switch message.author.type {
        case .user: "person.fill"
        case .agent: "cpu"
        case .webhook: "point.3.connected.trianglepath.dotted"
        }
    }

    private var canDelete: Bool {
        !isOptimistic && message.deletedAt == nil &&
            message.author.type == .user && message.author.id == currentUserID
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
        ConversationMessageLayout(
            authorImage: (message.author.type == .user || message.author.type == .agent)
                ? message.author.image
                : nil,
            profileName: message.author.type == .user ? message.author.name : nil,
            authorName: message.author.name,
            authorSystemImage: authorSystemImage,
            authorAccessorySystemImage: message.author.type == .agent
                ? "cpu"
                : message.author.type == .webhook
                    ? "point.3.connected.trianglepath.dotted"
                    : nil,
            timestamp: message.createdAt,
            accessibilityIdentifier: "channel-message-\(message.id.uuidString.lowercased())"
        ) {
            ChannelAlertMessageBody(
                locale: locale,
                mentionHandles: mentionHandles,
                message: message,
                messageBodyWithoutAttachments: messageBodyWithoutAttachments
            )
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
                            ChannelAttachmentCard(
                                attachment: attachment,
                                load: onLoadAttachment,
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
                        declining: decliningProposalID == proposal.id,
                        acceptanceInFlight: acceptingProposalID != nil ||
                            decliningProposalID != nil ||
                            approvingExecutionProposalID != nil ||
                            preparingExecutionProposalID != nil ||
                            approvingSkillExecutionProposalID != nil ||
                            preparingSkillExecutionProposalID != nil,
                        channel: channel,
                        executionProposal: message.executionProposal,
                        locale: locale,
                        onAccept: { projectID, execution in
                            await onAcceptProposal(proposal.id, projectID, execution)
                        },
                        onDecline: {
                            await onDeclineProposal(proposal.id)
                        },
                        onIssueOpen: onIssueOpen,
                        onPrepareExecution: { projectID in
                            await onPrepareCreateExecution(proposal.id, projectID)
                        },
                        openingExecution: preparingExecutionProposalID == proposal.id,
                        projects: projects,
                        proposal: proposal,
                        workers: workers
                    )
                    .padding(.top, 5)
                }
                if let proposal = message.executionProposal,
                   message.proposal?.payload?.executeAfterCreate != true {
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
                        onResultOpen: onSkillResultOpen,
                        onSessionOpen: onSkillSessionOpen,
                        proposal: proposal,
                        workers: workers
                    )
                    .padding(.top, 5)
                }
                if !isOptimistic, !message.reactions.isEmpty {
                    ChannelReactionBar(
                        currentUserID: currentUserID,
                        locale: locale,
                        message: message,
                        onToggleReaction: onToggleReaction,
                        quickEmojis: Self.quickReactionEmojis
                    )
                    .padding(.top, 4)
                }
        }
        if ChannelReplySummaryPresentation.isVisible(
            showsThreadSummary: showsThreadSummary,
            isOptimistic: isOptimistic,
            replyCount: message.replyCount
        ), let onOpenThread {
            ChannelReplySummary(
                countLabel: String(
                    format: L10n.text(.channelReplies, locale: locale),
                    message.replyCount
                ),
                lastReplyLabel: message.lastReplyAt.map {
                    String(
                        format: L10n.text(.channelLastReply, locale: locale),
                        L10n.relativeDate($0, locale: locale)
                    )
                },
                participants: ChannelReplySummaryPresentation.participants(
                    for: message
                ),
                identifier: "channel-thread-summary-\(message.id.uuidString.lowercased())",
                action: onOpenThread
            )
            .padding(.leading, 67)
            .padding(.trailing, 16)
            .padding(.bottom, 8)
        }
        }
        .contentShape(Rectangle())
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.45)
                .onEnded { _ in
                    guard !isOptimistic else { return }
                    showingThreadActions = true
                }
        )
        .sheet(isPresented: $showingThreadActions) {
            ChannelMessageActionsSheet(
                locale: locale,
                quickEmojis: message.deletedAt == nil ? Self.quickReactionEmojis : [],
                onToggleReaction: { emoji in
                    showingThreadActions = false
                    Task { await onToggleReaction(emoji) }
                },
                onCopyLink: {
                    showingThreadActions = false
                    let url = BriarShareLinks.channelShareURL(
                        organizationID: channel.organizationId,
                        channelID: channel.id,
                        messageID: message.id,
                        rootMessageID: message.parentMessageId ?? message.id,
                        origin: BriarShareLinks.defaultOrigin
                    )
                    ClipboardService.copy(url.absoluteString)
                    linkCopied = true
                },
                onCopyText: message.deletedAt == nil ? {
                    showingThreadActions = false
                    let copyText = messageBodyWithoutAttachments.isEmpty
                        ? message.body.trimmingCharacters(in: .whitespacesAndNewlines)
                        : messageBodyWithoutAttachments
                    ClipboardService.copy(copyText)
                    messageCopied = true
                } : nil,
                onDelete: canDelete ? {
                    showingThreadActions = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        confirmingDelete = true
                    }
                } : nil,
                onStartThread: onOpenThread.map { openThread in
                    {
                        showingThreadActions = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                            openThread()
                        }
                    }
                }
            )
            .presentationDetents([.height(onOpenThread == nil ? 290 : 370)])
            .presentationDragIndicator(.visible)
            .presentationBackground(.regularMaterial)
        }
        .companionToast(
            isPresented: $linkCopied,
            message: L10n.text(.linkCopied, locale: locale)
        )
        .companionToast(
            isPresented: $messageCopied,
            message: L10n.text(.messageCopied, locale: locale)
        )
        .alert(
            L10n.text(.channelDeleteMessage, locale: locale),
            isPresented: $confirmingDelete
        ) {
            Button(L10n.text(.channelDeleteMessage, locale: locale), role: .destructive) {
                Task { await onDelete() }
            }
            Button(L10n.text("취소", locale: locale), role: .cancel) {}
        } message: {
            Text(L10n.text(.channelDeleteMessageConfirm, locale: locale))
        }
    }
}

private struct ChannelReplySummary: View {
    let countLabel: String
    let lastReplyLabel: String?
    let participants: [ChannelMessage.Author]
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if participants.isEmpty {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.caption.weight(.semibold))
                } else {
                    HStack(spacing: -6) {
                        ForEach(Array(participants.prefix(3).enumerated()), id: \.offset) {
                            _,
                            author in
                            ProfileImageView(
                                image: (author.type == .user || author.type == .agent)
                                    ? author.image
                                    : nil,
                                name: author.name,
                                systemImage: author.type == .agent ? "cpu" : "person.fill",
                                size: 22
                            )
                            .overlay {
                                Circle().stroke(Color(.systemBackground), lineWidth: 1.5)
                            }
                        }
                    }
                }
                Text(countLabel)
                    .font(.caption.weight(.bold))
                if let lastReplyLabel {
                    Text("·")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(lastReplyLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.accentColor)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(countLabel)
    }
}

private struct ChannelMessageActionsSheet: View {
    let locale: CompanionLocale
    let quickEmojis: [String]
    let onToggleReaction: (String) -> Void
    let onCopyLink: () -> Void
    let onCopyText: (() -> Void)?
    let onDelete: (() -> Void)?
    let onStartThread: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                ForEach(quickEmojis, id: \.self) { emoji in
                    Button {
                        onToggleReaction(emoji)
                    } label: {
                        Text(emoji)
                            .font(.system(size: 28))
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(
                                Color(.secondarySystemBackground),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        String(
                            format: L10n.text(.channelReactWith, locale: locale),
                            emoji
                        )
                    )
                    .accessibilityIdentifier("channel-quick-reaction-\(emoji)")
                }
            }

            if let onStartThread {
                actionButton(
                    title: L10n.text(.channelStartThread, locale: locale),
                    systemImage: "bubble.left.and.bubble.right",
                    identifier: "channel-start-thread-action",
                    action: onStartThread
                )
            }

            actionButton(
                title: L10n.text(.copyLink, locale: locale),
                systemImage: "link",
                identifier: "channel-copy-link-action",
                action: onCopyLink
            )

            if let onCopyText {
                actionButton(
                    title: L10n.text(.channelCopyText, locale: locale),
                    systemImage: "doc.on.doc",
                    identifier: "channel-copy-text-action",
                    action: onCopyText
                )
            }

            if let onDelete {
                actionButton(
                    title: L10n.text(.channelDeleteMessage, locale: locale),
                    systemImage: "trash",
                    identifier: "channel-delete-message-action",
                    role: .destructive,
                    action: onDelete
                )
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
    }

    private func actionButton(
        title: String,
        systemImage: String,
        identifier: String,
        role: ButtonRole? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .frame(height: 58)
                .background(
                    Color(.secondarySystemBackground),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

private struct ChannelAttachmentCard: View {
    let attachment: ChannelMessageAttachment
    let load: @MainActor (ChannelMessageAttachment) async throws -> URL
    let open: @MainActor (URL) -> Void

    var body: some View {
        Group {
            if IssueAttachmentMedia.isHTML(
                contentType: attachment.contentType,
                filename: attachment.filename
            ) {
                AuthenticatedHTMLArtifactPreview(
                    filename: attachment.filename,
                    byteSize: attachment.byteSize,
                    accessibilityID: "channel-message-html-\(attachment.id.uuidString.lowercased())",
                    load: { try await load(attachment) }
                )
            } else {
                AuthenticatedImagePreview(
                    sourceID: attachment.url,
                    filename: attachment.filename,
                    detail: ByteCountFormatter.string(
                        fromByteCount: Int64(attachment.byteSize),
                        countStyle: .file
                    ),
                    accessibilityID: "channel-message-attachment-\(attachment.id.uuidString.lowercased())",
                    load: { try await load(attachment) },
                    open: open
                )
            }
        }
        .padding(10)
        .background(
            Color(.secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L10n.format("%@ 크게 보기", attachment.filename))
        .accessibilityIdentifier(
            "channel-attachment-card-\(attachment.id.uuidString.lowercased())"
        )
    }
}

private enum ChannelWebhookBlockFormatting {
    static func slackMarkdown(_ value: String) -> String {
        value
            .replacing(
                #"<((?:https?://|mailto:)[^>|]+)\|([^>]+)>"#,
                with: "[$2]($1)"
            )
            .replacing(
                #"<((?:https?://|mailto:)[^>]+)>"#,
                with: "$1"
            )
            .replacing(#"(?<!\*)\*([^*\n]+)\*(?!\*)"#, with: "**$1**")
            .replacing(#"(?<!~)~([^~\n]+)~(?!~)"#, with: "~~$1~~")
    }

    static func richMarkdown(_ element: ChannelRichTextElement) -> String {
        switch element.type {
        case .section:
            return inlineMarkdown(element.elements ?? [])
        case .quote:
            return inlineMarkdown(element.elements ?? [])
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map { "> \($0)" }
                .joined(separator: "\n")
        case .preformatted:
            return "```\n\(inlinePlainText(element.elements ?? []))\n```"
        case .list:
            let indentation = String(repeating: "  ", count: element.indent ?? 0)
            return (element.sections ?? []).enumerated().map { index, section in
                let marker = element.style == "ordered"
                    ? "\((element.offset ?? 0) + index + 1)."
                    : "-"
                return "\(indentation)\(marker) \(inlineMarkdown(section.elements))"
            }.joined(separator: "\n")
        }
    }

    private static func inlineMarkdown(_ elements: [ChannelRichTextInline]) -> String {
        elements.map { element in
            var value: String
            switch element.type {
            case .text:
                value = element.text ?? ""
            case .link:
                let url = element.url ?? ""
                value = "[\(element.text ?? url)](\(url))"
            case .emoji:
                value = ":\(element.name ?? "emoji"):"
            }
            if element.style?.code == true { value = "`\(value)`" }
            if element.style?.bold == true { value = "**\(value)**" }
            if element.style?.italic == true { value = "_\(value)_" }
            if element.style?.strike == true { value = "~~\(value)~~" }
            return value
        }.joined()
    }

    private static func inlinePlainText(_ elements: [ChannelRichTextInline]) -> String {
        elements.map { element in
            switch element.type {
            case .text:
                return element.text ?? ""
            case .link:
                return element.text ?? element.url ?? ""
            case .emoji:
                return ":\(element.name ?? "emoji"):"
            }
        }.joined()
    }
}

private extension String {
    func replacing(_ pattern: String, with template: String) -> String {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return self }
        return expression.stringByReplacingMatches(
            in: self,
            range: NSRange(startIndex..<endIndex, in: self),
            withTemplate: template
        )
    }
}

private struct ChannelWebhookBlocksView: View {
    let blocks: [ChannelMessageBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block.type {
                case .header:
                    SelectableText(block.textObject?.text ?? "", style: .title3Bold)
                case .section:
                    if let text = block.textObject {
                        if text.type == .markdown {
                            MarkdownText(
                                markdown: ChannelWebhookBlockFormatting.slackMarkdown(text.text)
                            )
                        } else {
                            SelectableText(text.text)
                        }
                    }
                case .markdown:
                    MarkdownText(markdown: block.markdownText ?? "")
                case .divider:
                    Divider()
                case .context:
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array((block.contextElements ?? []).enumerated()), id: \.offset) { _, text in
                            if text.type == .markdown {
                                MarkdownText(
                                    markdown: ChannelWebhookBlockFormatting.slackMarkdown(text.text)
                                )
                            } else {
                                SelectableText(text.text, style: .secondaryCaption)
                            }
                        }
                    }
                case .richText:
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array((block.richTextElements ?? []).enumerated()), id: \.offset) { _, element in
                            MarkdownText(
                                markdown: ChannelWebhookBlockFormatting.richMarkdown(element)
                            )
                        }
                    }
                }
            }
        }
    }
}

private struct ChannelAlertMessageBody: View {
    let locale: CompanionLocale
    let mentionHandles: Set<String>
    let message: ChannelMessage
    let messageBodyWithoutAttachments: String

    @ViewBuilder
    var body: some View {
        if message.deletedAt != nil {
            Text(L10n.text(.channelDeletedMessage, locale: locale))
                .font(.body.italic())
                .foregroundStyle(.secondary)
        } else if let blocks = message.blocks, !blocks.isEmpty {
            ChannelWebhookBlocksView(blocks: blocks)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            MentionText(text: messageBodyWithoutAttachments, handles: mentionHandles)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
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
    @State private var approvalContext: ChannelsStore.ExecutionApprovalContext?

    let accepting: Bool
    let declining: Bool
    let acceptanceInFlight: Bool
    let channel: ChannelSummary
    let executionProposal: IssueExecutionProposal?
    let locale: CompanionLocale
    let onAccept: (
        UUID,
        AcceptIssueExecutionProposalRequest?
    ) async -> AcceptChannelProposalResponse?
    let onDecline: () async -> Bool
    let onIssueOpen: (UUID, UUID) async -> Void
    let onPrepareExecution: (
        UUID
    ) async -> ChannelsStore.ExecutionApprovalContext?
    let openingExecution: Bool
    let projects: [Project]
    let proposal: ChannelMessage.Proposal
    let workers: [DashboardWorker]

    private var availableProjects: [Project] {
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

    private var requestsExecution: Bool {
        proposal.payload?.executeAfterCreate == true
    }

    private var initialExecutionRequest: AcceptIssueExecutionProposalRequest? {
        guard let executionProposal else { return nil }
        return AcceptIssueExecutionProposalRequest(
            provider: executionProposal.requestedProvider ?? .codex,
            model: executionProposal.requestedModel,
            effort: executionProposal.requestedEffort,
            workerId: executionProposal.requestedWorkerId
        )
    }

    private var createApprovalEnabled: Bool {
        channelProposalApprovalIsEnabled(
            acceptanceInFlight: acceptanceInFlight,
            channelArchived: channel.archivedAt != nil,
            targetProjectID: targetProjectID,
            issue: proposal.payload?.issue,
            batch: proposal.payload?.batch
        )
    }

    private var declineEnabled: Bool {
        !acceptanceInFlight && channel.archivedAt == nil
    }

    private var proposalStatusKey: L10n.Key {
        switch proposal.status {
        case .accepted: .channelIssueProposalAccepted
        case .declined: .channelIssueProposalDeclined
        case .pending: .channelIssueProposalPending
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.text(.channelIssueProposal, locale: locale))
                    .font(.caption.weight(.bold))
                Text(
                    L10n.text(proposalStatusKey, locale: locale)
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

            if let batch = proposal.payload?.batch {
                VStack(alignment: .leading, spacing: 7) {
                    Text(
                        String(
                            format: L10n.text(.channelIssueBatchCount, locale: locale),
                            batch.items.count
                        )
                    )
                    .font(.caption.weight(.semibold))
                    ForEach(batch.items, id: \.key) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(item.key)
                                    .font(.caption2.monospaced().weight(.bold))
                                    .foregroundStyle(Color.accentColor)
                                Text(item.issue.title)
                                    .font(.caption.weight(.medium))
                            }
                            if let result = proposal.resultItems.first(where: {
                                $0.localKey == item.key
                            }) {
                                Text(result.runId.uuidString.lowercased())
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
                    }
                    if !batch.dependencies.isEmpty {
                        Text(L10n.text(.channelIssueBatchDependencies, locale: locale))
                            .font(.caption2.weight(.semibold))
                        ForEach(batch.dependencies, id: \.self) { dependency in
                            Text("\(dependency.prerequisiteKey) → \(dependency.dependentKey)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityIdentifier(
                    "channel-batch-proposal-details-\(proposal.id.uuidString.lowercased())"
                )
            }

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
                L10n.text(
                    proposal.payload?.batch != nil
                        ? .channelIssueBatchSafety
                        : requestsExecution
                            ? .channelIssueCreationAndExecutionSafety
                            : .channelIssueCreationSafety,
                    locale: locale
                ),
                systemImage: requestsExecution ? "checkmark.shield" : "tray"
            )
            .font(.caption2)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            if proposal.status == .pending,
               proposal.projectId == nil,
               channel.defaultProjectId == nil {
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

            if requestsExecution, proposal.status != .declined {
                if executionProposal?.status == .accepted {
                    combinedExecutionSummary
                } else if proposal.status == .accepted {
                    Button {
                        guard let targetProjectID else { return }
                        Task {
                            approvalContext = await onPrepareExecution(targetProjectID)
                        }
                    } label: {
                        if accepting || openingExecution {
                            ProgressView().controlSize(.small)
                        } else {
                            Label(
                                L10n.text(.channelRetryExecution, locale: locale),
                                systemImage: "slider.horizontal.3"
                            )
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(
                        !channelProposalApprovalIsEnabled(
                            acceptanceInFlight: acceptanceInFlight,
                            channelArchived: channel.archivedAt != nil,
                            targetProjectID: targetProjectID,
                            issue: proposal.payload?.issue,
                            batch: proposal.payload?.batch
                        )
                    )
                    .accessibilityIdentifier(
                        "accept-channel-create-execution-\(proposal.id.uuidString.lowercased())"
                    )
                } else {
                    HStack(spacing: 7) {
                        Button(L10n.text(.channelCreateIssue, locale: locale)) {
                            guard let targetProjectID else { return }
                            Task { _ = await onAccept(targetProjectID, nil) }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier(
                            "accept-channel-proposal-\(proposal.id.uuidString.lowercased())"
                        )
                        .disabled(!createApprovalEnabled)

                        Button {
                            guard let targetProjectID else { return }
                            Task {
                                approvalContext = await onPrepareExecution(targetProjectID)
                            }
                        } label: {
                            if accepting || openingExecution {
                                ProgressView().controlSize(.small)
                            } else {
                                Text(L10n.text(.channelCreateAndExecute, locale: locale))
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier(
                            "accept-channel-create-execution-\(proposal.id.uuidString.lowercased())"
                        )
                        .disabled(!createApprovalEnabled)

                        Button(
                            L10n.text(
                                declining
                                    ? .channelDecliningProposal
                                    : .channelDeclineProposal,
                                locale: locale
                            ),
                            role: .destructive
                        ) {
                            Task { _ = await onDecline() }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier(
                            "decline-channel-proposal-\(proposal.id.uuidString.lowercased())"
                        )
                        .disabled(!declineEnabled)
                    }
                    .controlSize(.small)
                }
            } else if proposal.status == .pending {
                HStack(spacing: 7) {
                    Button {
                        guard let targetProjectID else { return }
                        Task {
                            if let result = await onAccept(targetProjectID, nil),
                               result.executionProposal == nil,
                               proposal.payload?.batch == nil {
                                await onIssueOpen(result.projectId, result.resultRunId)
                            }
                        }
                    } label: {
                        if accepting {
                            ProgressView().controlSize(.small)
                        } else if let batch = proposal.payload?.batch {
                            Text(
                                String(
                                    format: L10n.text(
                                        .channelCreateIssueBatch,
                                        locale: locale
                                    ),
                                    batch.items.count
                                )
                            )
                        } else {
                            Text(L10n.text(.channelCreateIssue, locale: locale))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier(
                        "accept-channel-proposal-\(proposal.id.uuidString.lowercased())"
                    )
                    .disabled(!createApprovalEnabled)

                    Button(
                        L10n.text(
                            declining
                                ? .channelDecliningProposal
                                : .channelDeclineProposal,
                            locale: locale
                        ),
                        role: .destructive
                    ) {
                        Task { _ = await onDecline() }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier(
                        "decline-channel-proposal-\(proposal.id.uuidString.lowercased())"
                    )
                    .disabled(!declineEnabled)
                }
                .controlSize(.small)
            }
            if proposal.status == .accepted,
               proposal.payload?.batch == nil,
               let projectID = proposal.projectId,
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
        .sheet(item: $approvalContext) { context in
            ExecutionProposalApprovalSheet(
                targetTitle: proposal.payload?.issue?.title ??
                    L10n.text("새 이슈", locale: locale),
                providers: context.snapshot.organizationProviders ?? [],
                workers: context.snapshot.workers ?? [],
                policy: context.snapshot.executionPolicy,
                locale: locale,
                createsIssue: true,
                initialRequest: initialExecutionRequest,
                approve: { request in
                    guard let targetProjectID,
                          let response = await onAccept(targetProjectID, request),
                          response.executionProposal?.status == .accepted,
                          response.dispatch != nil
                    else {
                        throw ChannelExecutionApprovalError(
                            message: L10n.text(
                                "이슈 생성·실행 요청을 처리하지 못했습니다.",
                                locale: locale
                            )
                        )
                    }
                    return true
                }
            )
        }
        .onChange(of: channel.archivedAt) { _, archivedAt in
            if archivedAt != nil { approvalContext = nil }
        }
        .onChange(of: proposal.id) { _, _ in approvalContext = nil }
        .onChange(of: executionProposal?.status) { _, status in
            if status == .accepted { approvalContext = nil }
        }
    }

    @ViewBuilder
    private var combinedExecutionSummary: some View {
        if let provider = executionProposal?.requestedProvider {
            let components = [
                provider.displayName,
                executionProposal?.requestedModel,
                executionProposal?.requestedEffort?.rawValue,
            ].compactMap { $0 }
            Label(components.joined(separator: " · "), systemImage: "cpu")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        if let workerID = executionProposal?.requestedWorkerId {
            let label = workers.first(where: { $0.id == workerID })?.label ?? workerID
            Label(label, systemImage: "desktopcomputer")
                .font(.caption2)
                .foregroundStyle(.secondary)
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
    let projects: [Project]
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
    let onResultOpen: (UUID) -> Void
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
                        ? L10n.text(proposal.executionStatus == .completed
                            ? "Skill 실행을 완료했습니다."
                            : proposal.executionStatus == .failed
                            ? "Skill 실행이 실패했습니다."
                            : "Skill을 실행 중입니다.", locale: locale)
                        : L10n.text(proposal.executionMode == .conversation
                            ? "승인하면 이 대화에서 바로 이어서 실행합니다."
                            : "정확한 Worker를 선택하고 명시적으로 승인해야 실행됩니다.",
                            locale: locale)
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
                            L10n.text(
                                proposal.executionMode == .conversation
                                    ? "검토 및 승인" : "Worker 선택",
                                locale: locale
                            ),
                            systemImage: proposal.executionMode == .conversation
                                ? "checkmark.shield" : "desktopcomputer"
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
                if proposal.executionMode == .task, let workerLabel {
                    Label(workerLabel, systemImage: "desktopcomputer")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if proposal.executionMode == .task,
                   let sessionID = proposal.resultSessionId {
                    Button(L10n.text("Agent 세션 보기", locale: locale)) {
                        onSessionOpen(proposal.projectId, sessionID)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .accessibilityIdentifier(
                        "open-channel-skill-session-\(proposal.id.uuidString.lowercased())"
                    )
                }
                if let resultMessageID = proposal.resultMessageId,
                   proposal.executionStatus == .completed ||
                    proposal.executionStatus == .failed {
                    Button(L10n.text("결과 보기", locale: locale)) {
                        onResultOpen(resultMessageID)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityIdentifier(
                        "open-channel-skill-result-\(proposal.id.uuidString.lowercased())"
                    )
                }
                if let error = proposal.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
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
    let sending: Bool
    let candidates: [ChannelMentionTarget]
    let placeholder: String
    let locale: CompanionLocale
    let send: (String, [ChannelMentionTarget], [PendingIssueAttachment]) async -> Void

    var body: some View {
        ConversationComposer(
            draft: $draft,
            mentions: $mentions,
            attachments: $attachments,
            sending: sending,
            candidates: candidates,
            placeholder: placeholder,
            replyLabel: nil,
            allowsImagePaste: false,
            locale: locale,
            accessibility: ConversationComposerAccessibility(
                attachment: "channel-composer-attach",
                field: "channel-composer-field",
                send: "channel-composer-send",
                mentionMenu: "channel-mention-menu",
                mentionItemPrefix: "channel-mention"
            ),
            cancelReply: nil,
            send: { body, mentions, attachments in
                await send(body, mentions, attachments)
                return true
            }
        )
    }
}
