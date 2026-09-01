import SwiftUI

struct DirectMessagesHomeView: View {
    @ObservedObject var channels: ChannelsStore
    @ObservedObject var navigation: CompanionNavigationModel
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var search = ""
    @State private var showingComposer = false

    let currentUserID: String?
    let projects: [Project]
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let onIssueOpen: ChannelIssueOpenHandler
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler
    let onChannelCreated: (ChannelSummary) -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var directMessages: [ChannelSummary] {
        DirectMessageOrdering.byMostRecent(channels.channels)
    }

    private var visibleDirectMessages: [ChannelSummary] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return directMessages }
        return directMessages.filter {
            $0.directMessageDisplayName(currentUserID: currentUserID)
                .localizedCaseInsensitiveContains(query)
        }
    }

    private var featuredConversations: [FeaturedDirectMessage] {
        var participantIDs = Set<String>()
        var result: [FeaturedDirectMessage] = []
        for channel in directMessages {
            guard let participant = channel
                .directMessageParticipants(excluding: currentUserID)
                .first(where: { $0.type == .agent })
                ?? channel.directMessageParticipants(excluding: currentUserID).first
            else { continue }
            let key = "\(participant.type.rawValue):\(participant.id)"
            guard participantIDs.insert(key).inserted else { continue }
            result.append(FeaturedDirectMessage(channel: channel, participant: participant))
            if result.count == 6 { break }
        }
        return result
    }

    var body: some View {
        List {
            if !featuredConversations.isEmpty && search.isEmpty {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 18) {
                            ForEach(featuredConversations) { featured in
                                NavigationLink(value: featured.channel) {
                                    VStack(spacing: 7) {
                                        ProfileImageView(
                                            image: featured.participant.image,
                                            name: featured.participant.name,
                                            systemImage: featured.participant.type == .agent
                                                ? "cpu.fill"
                                                : "person.fill",
                                            size: 58
                                        )
                                        Text(featured.participant.name)
                                            .font(.caption)
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                            .frame(width: 72)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier(
                                    "dm-featured-\(featured.participant.type.rawValue)-\(featured.participant.id)"
                                )
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
                }
            }

            Section {
                ForEach(visibleDirectMessages) { channel in
                    NavigationLink(value: channel) {
                        DirectMessageRow(
                            channel: channel,
                            currentUserID: currentUserID,
                            locale: locale
                        )
                    }
                    .accessibilityIdentifier(
                        "dm-row-\(channel.id.uuidString.lowercased())"
                    )
                }
            } header: {
                if !directMessages.isEmpty {
                    Text(L10n.text("최근 대화", locale: locale))
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("DMs")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $search,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: L10n.text("DM 검색", locale: locale)
        )
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingComposer = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(L10n.text("새 메시지", locale: locale))
                .accessibilityIdentifier("new-dm-button")
            }
        }
        .overlay {
            if directMessages.isEmpty {
                if channels.loading {
                    ProgressView(L10n.text("DM을 불러오는 중…", locale: locale))
                } else {
                    ContentUnavailableView {
                        Label(
                            L10n.text("아직 DM이 없습니다.", locale: locale),
                            systemImage: "bubble.left.and.bubble.right"
                        )
                    } description: {
                        Text(L10n.text("새 메시지를 눌러 대화를 시작해 보세요.", locale: locale))
                    } actions: {
                        Button(L10n.text("새 메시지", locale: locale)) {
                            showingComposer = true
                        }
                    }
                }
            } else if visibleDirectMessages.isEmpty {
                ContentUnavailableView.search(text: search)
            }
        }
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
        .sheet(isPresented: $showingComposer) {
            DirectMessageComposerView(
                channels: channels,
                currentUserID: currentUserID,
                onCreated: { channel in
                    showingComposer = false
                    onChannelCreated(channel)
                }
            )
        }
    }
}

private struct FeaturedDirectMessage: Identifiable {
    let channel: ChannelSummary
    let participant: DirectMessageParticipant

    var id: String { "\(participant.type.rawValue):\(participant.id)" }
}

private struct DirectMessageRow: View {
    let channel: ChannelSummary
    let currentUserID: String?
    let locale: CompanionLocale

    private var participants: [DirectMessageParticipant] {
        channel.directMessageParticipants(excluding: currentUserID)
    }

    private var timestamp: String {
        let date = channel.lastMessageAt ?? channel.createdAt
        if Calendar.current.isDateInToday(date) {
            return L10n.time(date, locale: locale)
        }
        if Calendar.current.isDateInYesterday(date) {
            return L10n.text("어제", locale: locale)
        }
        return date.formatted(
            Date.FormatStyle(date: .abbreviated, time: .omitted)
                .locale(Locale(identifier: locale.foundationIdentifier))
        )
    }

    var body: some View {
        HStack(spacing: 13) {
            DirectMessageAvatar(participants: participants, fallbackName: channel.name)

            VStack(alignment: .leading, spacing: 4) {
                Text(channel.directMessageDisplayName(currentUserID: currentUserID))
                    .font(.body.weight(channel.hasUnread == true ? .semibold : .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(channel.lastMessagePreview ?? L10n.text("아직 메시지가 없습니다.", locale: locale))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 8) {
                Text(timestamp)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 8, height: 8)
                    .opacity(channel.hasUnread == true ? 1 : 0)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct DirectMessageAvatar: View {
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
                    size: 48
                )
            } else {
                ForEach(Array(visible.enumerated()), id: \.offset) { index, participant in
                    ProfileImageView(
                        image: participant.image,
                        name: participant.name,
                        systemImage: participant.type == .agent ? "cpu.fill" : "person.fill",
                        size: visible.count == 1 ? 48 : 38
                    )
                    .overlay {
                        Circle().stroke(Color(.systemBackground), lineWidth: 2)
                    }
                    .offset(
                        x: visible.count == 1 ? 0 : CGFloat(index * 14 - 7),
                        y: visible.count == 1 ? 0 : CGFloat(index * 8 - 4)
                    )
                }
            }
        }
        .frame(width: 52, height: 52)
        .accessibilityHidden(true)
    }
}

private struct DirectMessageComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var channels: ChannelsStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var search = ""
    @State private var members: [OrganizationMember] = []
    @State private var agents: [ChannelAgentSummary] = []
    @State private var selectedIDs = Set<String>()
    @State private var loading = true
    @State private var submitting = false
    @State private var errorMessage: String?

    let currentUserID: String?
    let onCreated: (ChannelSummary) -> Void

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private var candidates: [DirectMessageCandidate] {
        let memberCandidates = members
            .filter { $0.userId != currentUserID }
            .map(DirectMessageCandidate.member)
        let agentCandidates = agents.map(DirectMessageCandidate.agent)
        let combined = agentCandidates + memberCandidates
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return combined }
        return combined.filter {
            "\($0.name) \($0.detail)".localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    HStack {
                        Spacer()
                        ProgressView(L10n.text("멤버와 Agent를 불러오는 중…", locale: locale))
                        Spacer()
                    }
                } else if candidates.isEmpty {
                    ContentUnavailableView.search(text: search)
                } else {
                    ForEach(candidates) { candidate in
                        Button {
                            if selectedIDs.contains(candidate.id) {
                                selectedIDs.remove(candidate.id)
                            } else {
                                selectedIDs.insert(candidate.id)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                ProfileImageView(
                                    image: candidate.image,
                                    name: candidate.name,
                                    systemImage: candidate.kind == .agent ? "cpu.fill" : "person.fill",
                                    size: 40
                                )
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(candidate.name)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(.primary)
                                    Text(candidate.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: selectedIDs.contains(candidate.id)
                                    ? "checkmark.circle.fill"
                                    : "circle")
                                    .foregroundStyle(selectedIDs.contains(candidate.id)
                                        ? Color.accentColor
                                        : Color.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("dm-recipient-\(candidate.id)")
                    }
                }
            }
            .navigationTitle(L10n.text("새 메시지", locale: locale))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: L10n.text("멤버 또는 Agent 검색", locale: locale))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("취소", locale: locale)) { dismiss() }
                        .disabled(submitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await createConversation() }
                    } label: {
                        if submitting {
                            ProgressView()
                        } else {
                            Text(L10n.text("대화 시작", locale: locale))
                        }
                    }
                    .disabled(selectedIDs.isEmpty || submitting)
                    .accessibilityIdentifier("start-dm-button")
                }
            }
            .task { await loadCandidates() }
            .alert(
                L10n.text("새 메시지", locale: locale),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button(L10n.text("확인", locale: locale)) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .interactiveDismissDisabled(submitting)
    }

    private func loadCandidates() async {
        loading = true
        defer { loading = false }
        do {
            let recipients = try await channels.loadDirectMessageRecipients()
            members = recipients.members
            agents = recipients.agents.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    private func createConversation() async {
        guard !submitting else { return }
        submitting = true
        defer { submitting = false }
        let selected = candidatesByID.filter { selectedIDs.contains($0.id) }
        do {
            let channel = try await channels.createDirectMessage(
                memberIDs: selected.compactMap { $0.kind == .member ? $0.rawID : nil },
                agentIDs: selected.compactMap {
                    $0.kind == .agent ? UUID(uuidString: $0.rawID) : nil
                }
            )
            onCreated(channel)
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    private var candidatesByID: [DirectMessageCandidate] {
        members
            .filter { $0.userId != currentUserID }
            .map(DirectMessageCandidate.member)
            + agents.map(DirectMessageCandidate.agent)
    }
}

private struct DirectMessageCandidate: Identifiable {
    enum Kind {
        case member
        case agent
    }

    let kind: Kind
    let rawID: String
    let name: String
    let detail: String
    let image: String?

    var id: String { "\(kind == .agent ? "agent" : "member"):\(rawID)" }

    static func member(_ member: OrganizationMember) -> Self {
        Self(
            kind: .member,
            rawID: member.userId,
            name: member.name,
            detail: member.email,
            image: member.image
        )
    }

    static func agent(_ agent: ChannelAgentSummary) -> Self {
        Self(
            kind: .agent,
            rawID: agent.agentId.uuidString.lowercased(),
            name: agent.name,
            detail: agent.description ?? agent.responsibility,
            image: agent.avatar
        )
    }
}
