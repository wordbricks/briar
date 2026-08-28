import SwiftUI

func issueProposalAcceptanceSystemImage(
    for type: IssueProposedAction.ActionType
) -> String {
    type == .create ? "plus.circle.fill" : "play.fill"
}

private enum CompanionDirectMessagesRoute: Hashable {
    case session(String)
}

struct CompanionShellView: View {
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingSettings = false
    @State private var taskPath = NavigationPath()
    @State private var homePath = NavigationPath()
    @State private var directMessagesPath = NavigationPath()
    @State private var pendingIssueResolutionCount = 0

    @ObservedObject var navigation: CompanionNavigationModel
    @ObservedObject var agents: AgentsStore
    @ObservedObject var inbox: InboxStore
    @ObservedObject var notifications: LocalNotificationService
    @ObservedObject var channels: ChannelsStore
    let issueConversationView: IssueConversationViewTracker

    let projects: [Project]
    let project: Project
    let snapshot: DashboardSnapshot?
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let user: CurrentUserResponse.User?
    let refresh: () async -> Void
    let ensureIssueAvailable: (UUID, UUID) async -> Bool
    let selectProject: (UUID) -> Void
    let signOut: () -> Void

    private var companionLocale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private func openRelatedMessage(_ reference: RelatedMessageReference) {
        navigation.open(
            .channel(
                organizationID: reference.organizationId,
                channelID: reference.channelId,
                messageID: reference.messageId,
                rootMessageID: reference.rootMessageId
            )
        )
        if navigation.pendingProjectID == nil,
           let targetProject = projects.first(where: {
               $0.organizationId == reference.organizationId
           }) {
            navigation.pendingProjectID = targetProject.id
        }
        if let pendingProjectID = navigation.pendingProjectID {
            selectProject(pendingProjectID)
        }
    }

    var body: some View {
        TabView(selection: $navigation.selectedTab) {
            NavigationStack(path: $homePath) {
                ChannelsHomeView(
                    channels: channels,
                    navigation: navigation,
                    activeProjectID: project.id,
                    currentUserID: user?.id,
                    projects: projects,
                    providers: snapshot?.organizationProviders ?? [],
                    workers: snapshot?.workers ?? [],
                    onIssueOpen: { projectID, runID, sourceIsCurrent in
                        await navigation.openIssueWhenAvailable(
                            projectID: projectID,
                            runID: runID,
                            ensureAvailable: { targetProjectID, targetRunID in
                                await ensureIssueAvailable(
                                    targetProjectID,
                                    targetRunID
                                )
                            },
                            sourceIsCurrent: sourceIsCurrent
                        )
                    },
                    onSkillSessionMaterialized: { agents.materialize($0) },
                    onSkillSessionOpen: { projectID, sessionID in
                        navigation.open(.session(projectID: projectID, sessionID: sessionID))
                    }
                )
                .navigationTitle(L10n.text(.channelHome, locale: companionLocale))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { companionToolbar(showsProjectMenu: true) }
            }
            .tabItem { Label(L10n.text(.channelHome, locale: companionLocale), systemImage: "house") }
            .tag(CompanionNavigationModel.Tab.home)

            NavigationStack(path: $taskPath) {
                TaskListView(
                    project: project,
                    projects: projects,
                    projectAgents: agents.agents.filter { $0.projectId == project.id },
                    snapshot: snapshot,
                    errorMessage: errorMessage,
                    token: token,
                    api: api,
                    currentUserID: user?.id,
                    issueConversationView: issueConversationView,
                    refresh: refresh,
                    onRelatedMessageOpen: openRelatedMessage,
                    onSkillSessionMaterialized: { agents.materialize($0) },
                    onSkillSessionOpen: { projectID, sessionID in
                        navigation.open(.session(projectID: projectID, sessionID: sessionID))
                    }
                )
                .id(project.id)
                .navigationTitle(L10n.text("Tasks", locale: companionLocale))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { companionToolbar(showsProjectMenu: true) }
                .navigationDestination(for: UUID.self) { runID in
                    issueDetailDestination(runID: runID)
                }
                .navigationDestination(for: CompanionIssueNavigationRoute.self) { route in
                    issueDetailDestination(
                        runID: route.runID,
                        initialTab: route.initialTab
                    )
                }
            }
            .tabItem { Label(L10n.text("Tasks", locale: companionLocale), systemImage: "checklist") }
            .tag(CompanionNavigationModel.Tab.tasks)

            NavigationStack(path: $directMessagesPath) {
                DirectMessagesHomeView(
                    channels: channels,
                    navigation: navigation,
                    currentUserID: user?.id,
                    projects: projects,
                    providers: snapshot?.organizationProviders ?? [],
                    workers: snapshot?.workers ?? [],
                    onIssueOpen: { projectID, runID, sourceIsCurrent in
                        await navigation.openIssueWhenAvailable(
                            projectID: projectID,
                            runID: runID,
                            ensureAvailable: { targetProjectID, targetRunID in
                                await ensureIssueAvailable(targetProjectID, targetRunID)
                            },
                            sourceIsCurrent: sourceIsCurrent
                        )
                    },
                    onSkillSessionMaterialized: { agents.materialize($0) },
                    onSkillSessionOpen: { projectID, sessionID in
                        navigation.open(.session(projectID: projectID, sessionID: sessionID))
                    },
                    onChannelCreated: { directMessagesPath.append($0) }
                )
                .toolbar { companionToolbar(showsProjectMenu: true) }
                .navigationDestination(for: CompanionDirectMessagesRoute.self) { route in
                    switch route {
                    case let .session(id):
                        if let session = agents.session(id: id) {
                            SessionDetailView(
                                session: session,
                                agent: session.agentId.flatMap { agents.agent(id: $0) },
                                projectAgents: agents.agents.filter {
                                    $0.projectId == project.id
                                },
                                project: project,
                                token: token,
                                api: api,
                                snapshot: snapshot,
                                issueConversationView: issueConversationView,
                                refreshDashboard: refresh,
                                onRelatedMessageOpen: openRelatedMessage,
                                onSkillSessionMaterialized: { agents.materialize($0) },
                                onSkillSessionOpen: { projectID, sessionID in
                                    navigation.open(
                                        .session(projectID: projectID, sessionID: sessionID)
                                    )
                                }
                            )
                        } else {
                            ContentUnavailableView(
                                L10n.text("세션을 찾을 수 없음"),
                                systemImage: "list.bullet.rectangle"
                            )
                        }
                    }
                }
            }
            .tabItem { Label("DMs", systemImage: "bubble.left.and.bubble.right") }
            .tag(CompanionNavigationModel.Tab.directMessages)
            .badge(channels.channels.filter { $0.isDirectMessage && $0.hasUnread == true }.count)

            NavigationStack {
                InboxHomeView(
                    inbox: inbox,
                    navigation: navigation,
                    project: project,
                    snapshot: snapshot,
                    token: token,
                    api: api,
                    refresh: refresh
                )
                .toolbar { companionToolbar(showsProjectMenu: true) }
            }
            .tabItem { Label(L10n.text("Inbox", locale: companionLocale), systemImage: "tray") }
            .tag(CompanionNavigationModel.Tab.inbox)
            .badge(inbox.unreadCount)

        }
        .overlay {
            if navigation.preparingIssue || pendingIssueResolutionCount > 0 {
                ProgressView()
                    .padding(14)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .allowsHitTesting(false)
                    .accessibilityIdentifier("issue-navigation-loading")
            }
        }
        .environmentObject(inbox)
        .sheet(isPresented: $showingSettings) {
            CompanionSettingsView(
                appearance: $appearance,
                localeRaw: $localeRaw,
                notifications: notifications,
                user: user,
                onDismiss: { showingSettings = false }
            )
            .presentationDetents([.large, .medium])
        }
        .onChange(of: navigation.pathChannelToken) { _, _ in
            guard navigation.pendingProjectID == nil ||
                    navigation.pendingProjectID == project.id else { return }
            Task { await openPendingChannel() }
        }
        .onChange(of: project.id) { _, _ in
            taskPath = NavigationPath()
            directMessagesPath = NavigationPath()
        }
        .onChange(of: snapshot) { _, _ in
            guard navigation.pendingIssueID != nil else { return }
            Task { await resolvePendingIssue(forceRefresh: false) }
        }
        .onChange(of: navigation.selectedTab) { _, tab in
            if tab != .tasks,
               navigation.pendingIssueID != nil || navigation.preparingIssue {
                navigation.cancelPendingIssue()
            }
        }
        .task(id: "\(project.id.uuidString):\(navigation.pathIssueToken)") {
            await resolvePendingIssue(forceRefresh: true)
        }
        .task(id: "\(project.id.uuidString):\(navigation.pathChannelToken)") {
            guard navigation.pendingProjectID == nil ||
                    navigation.pendingProjectID == project.id else { return }
            await openPendingChannel()
        }
        .onChange(of: navigation.pathSessionToken) { _, _ in
            guard navigation.pendingProjectID == project.id else { return }
            if let sessionID = navigation.consumePendingSession() {
                directMessagesPath.append(CompanionDirectMessagesRoute.session(sessionID))
            }
        }
        .task(id: "\(project.id.uuidString):\(navigation.pathSessionToken)") {
            guard navigation.pendingProjectID == project.id else { return }
            if let sessionID = navigation.pendingSessionID {
                _ = navigation.consumePendingSession()
                directMessagesPath.append(CompanionDirectMessagesRoute.session(sessionID))
            }
        }
    }

    @ViewBuilder
    private func issueDetailDestination(
        runID: UUID,
        initialTab: RunDetailTab? = nil
    ) -> some View {
        if let run = snapshot?.runs.first(where: { $0.id == runID }) {
            RunDetailView(
                run: run,
                projectID: project.id,
                issueKeyPrefix: project.effectiveIssueKeyPrefix,
                token: token,
                api: api,
                projects: projects,
                allRuns: snapshot?.runs ?? [],
                projectAgents: agents.agents.filter { $0.projectId == project.id },
                workers: snapshot?.workers ?? [],
                providers: snapshot?.organizationProviders ?? [],
                members: snapshot?.members ?? [],
                currentUserID: user?.id,
                initialTab: initialTab,
                issueConversationView: issueConversationView,
                refresh: refresh,
                onRelatedMessageOpen: openRelatedMessage,
                onSkillSessionMaterialized: { agents.materialize($0) },
                onSkillSessionOpen: { projectID, sessionID in
                    navigation.open(
                        .session(projectID: projectID, sessionID: sessionID)
                    )
                }
            )
        } else {
            ContentUnavailableView(L10n.text("이슈를 찾을 수 없음"), systemImage: "checklist")
        }
    }

    @MainActor
    private func resolvePendingIssue(forceRefresh: Bool) async {
        guard
            navigation.selectedTab == .tasks,
            navigation.pendingProjectID == project.id,
            let runID = navigation.pendingIssueID
        else { return }
        let pathToken = navigation.pathIssueToken
        let alreadyAvailable = snapshot?.project.id == project.id &&
            snapshot?.runs.contains(where: { $0.id == runID }) == true
        pendingIssueResolutionCount += 1
        defer {
            pendingIssueResolutionCount = max(0, pendingIssueResolutionCount - 1)
        }
        var available = alreadyAvailable
        if !available, forceRefresh {
            available = await ensureIssueAvailable(project.id, runID)
        }
        guard available else {
            if forceRefresh {
                navigation.failPendingNavigation(
                    "요청한 이슈가 없거나 접근 권한이 없습니다."
                )
            }
            return
        }
        guard let route = navigation.consumePendingIssueNavigation(
            projectID: project.id,
            runID: runID,
            pathToken: pathToken
        ) else { return }
        taskPath.append(route)
    }

    @MainActor
    private func openPendingChannel() async {
        guard let target = navigation.consumePendingChannel() else { return }
        let expectedToken = navigation.pathChannelToken
        navigation.pendingChannelThread = nil
        if !channels.channels.contains(where: { $0.id == target.channelID }) {
            await channels.refresh()
        }
        guard let channel = channels.channels.first(where: { $0.id == target.channelID }) else {
            return
        }
        if channel.isDirectMessage {
            navigation.selectedTab = .directMessages
            directMessagesPath = NavigationPath()
            directMessagesPath.append(channel)
        } else {
            navigation.selectedTab = .home
            homePath = NavigationPath()
            homePath.append(channel)
        }
        await channels.openChannel(target.channelID)
        _ = await channels.loadRootMessageForNavigation(
            channelID: target.channelID,
            messageID: target.rootMessageID
        )
        guard navigation.pathChannelToken == expectedToken else { return }
        navigation.pendingChannelThread = ChannelInboxNavigation.threadRoute(
            isDirectMessage: channel.isDirectMessage,
            channelID: target.channelID,
            messageID: target.messageID,
            rootMessageID: target.rootMessageID
        )
    }

    @ToolbarContentBuilder
    private func companionToolbar(
        showsProjectMenu: Bool = false
    ) -> some ToolbarContent {
        if showsProjectMenu {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    ForEach(
                        projects.sorted {
                            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                        },
                        id: \.id
                    ) { candidate in
                        Button {
                            navigation.cancelPendingIssue()
                            selectProject(candidate.id)
                        } label: {
                            if candidate.id == project.id {
                                Label(
                                    "\(candidate.name) · \(candidate.organizationName)",
                                    systemImage: "checkmark"
                                )
                            } else {
                                Text("\(candidate.name) · \(candidate.organizationName)")
                            }
                        }
                        .accessibilityIdentifier(
                            "project-option-\(candidate.id.uuidString.lowercased())"
                        )
                    }
                } label: {
                    if dynamicTypeSize.isAccessibilitySize {
                        Image(systemName: "folder")
                            .imageScale(.large)
                    } else {
                        HStack(spacing: 4) {
                            Text(project.name)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityLabel(L10n.format("프로젝트, %@", project.name))
                .accessibilityIdentifier("project-menu")
            }
        } else {
            ToolbarItem(placement: .automatic) {
                Text(project.name).font(.subheadline.weight(.semibold))
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button(L10n.text("설정")) { showingSettings = true }
                Divider()
                Button(L10n.text("로그아웃"), role: .destructive, action: signOut)
            } label: {
                ProfileImageView(
                    image: user?.image,
                    name: user?.name,
                    systemImage: "person.fill",
                    size: 28
                )
            }
            .accessibilityLabel(L10n.text("계정 메뉴"))
            .accessibilityIdentifier("account-menu")
        }
    }
}

struct TaskListView: View {
    @State private var filter = TaskFilter.all
    @State private var showingCreateIssue = false
    @State private var dispatchRun: DashboardRun?
    @StateObject private var mutations: IssueMutationStore

    let project: Project
    let projects: [Project]
    let projectAgents: [ProjectAgent]
    let snapshot: DashboardSnapshot?
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let currentUserID: String?
    let issueConversationView: IssueConversationViewTracker?
    let refresh: () async -> Void
    let onRelatedMessageOpen: (RelatedMessageReference) -> Void
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler

    @MainActor
    init(
        project: Project,
        projects: [Project] = [],
        projectAgents: [ProjectAgent] = [],
        snapshot: DashboardSnapshot?,
        errorMessage: String?,
        token: String,
        api: any MobileAPIClientProtocol,
        currentUserID: String? = nil,
        issueConversationView: IssueConversationViewTracker? = nil,
        refresh: @escaping () async -> Void,
        onRelatedMessageOpen: @escaping (RelatedMessageReference) -> Void = { _ in },
        onSkillSessionMaterialized: @escaping SkillSessionMaterializedHandler = { _ in },
        onSkillSessionOpen: @escaping SkillSessionOpenHandler = { _, _ in }
    ) {
        self.project = project
        self.projects = projects
        self.projectAgents = projectAgents
        self.snapshot = snapshot
        self.errorMessage = errorMessage
        self.token = token
        self.api = api
        self.currentUserID = currentUserID
        self.issueConversationView = issueConversationView
        self.refresh = refresh
        self.onRelatedMessageOpen = onRelatedMessageOpen
        self.onSkillSessionMaterialized = onSkillSessionMaterialized
        self.onSkillSessionOpen = onSkillSessionOpen
        _mutations = StateObject(wrappedValue: IssueMutationStore(
            api: api,
            projectID: project.id,
            token: token
        ))
    }

    private var runs: [DashboardRun] {
        TaskOrdering.byMostRecentlyUpdated(
            (snapshot?.runs ?? []).filter(filter.includes)
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker(L10n.text("작업 필터"), selection: $filter) {
                ForEach(TaskFilter.allCases) { option in
                    Text(option.title).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .accessibilityIdentifier("task-filter")

            if let errorMessage, snapshot == nil {
                OfflineStateView(message: errorMessage, refresh: refresh)
            } else {
                List {
                    if let errorMessage, !errorMessage.isEmpty {
                        Section {
                            Label(errorMessage, systemImage: "wifi.exclamationmark")
                                .foregroundStyle(.orange)
                        }
                    }
                    if snapshot == nil {
                        HStack {
                            Spacer()
                            ProgressView(L10n.text("작업을 불러오는 중…"))
                            Spacer()
                        }
                    } else if runs.isEmpty {
                        ContentUnavailableView(
                            L10n.text(filter == .all ? "작업 없음" : "필터 결과 없음"),
                            systemImage: "tray"
                        )
                    } else {
                        ForEach(runs) { run in
                            NavigationLink {
                                RunDetailView(
                                    run: run,
                                    projectID: project.id,
                                    issueKeyPrefix: project.effectiveIssueKeyPrefix,
                                    token: token,
                                    api: api,
                                    projects: projects,
                                    allRuns: snapshot?.runs ?? [],
                                    projectAgents: projectAgents,
                                    workers: snapshot?.workers ?? [],
                                    providers: snapshot?.organizationProviders ?? [],
                                    members: snapshot?.members ?? [],
                                    currentUserID: currentUserID,
                                    issueConversationView: issueConversationView,
                                    refresh: refresh,
                                    onRelatedMessageOpen: onRelatedMessageOpen,
                                    onSkillSessionMaterialized: onSkillSessionMaterialized,
                                    onSkillSessionOpen: onSkillSessionOpen
                                )
                            } label: {
                                RunRow(
                                    run: run,
                                    issueKeyPrefix: project.effectiveIssueKeyPrefix,
                                    assignee: snapshot?.members?.first {
                                        $0.userId == run.assigneeUserId
                                    },
                                    worker: RunRow.worker(
                                        for: run,
                                        workers: snapshot?.workers ?? []
                                    )
                                )
                            }
                            .accessibilityIdentifier("task-row-\(run.id.uuidString)")
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if run.status == .backlog || run.status == .queued {
                                    Button {
                                        dispatchRun = run
                                    } label: {
                                        Label(L10n.text("바로 처리"), systemImage: "play.fill")
                                    }
                                    .tint(.blue)
                                    .disabled((run.waitingOnPrerequisiteCount ?? 0) > 0)
                                    .accessibilityLabel(L10n.format("%@ 바로 처리", run.title))
                                    .accessibilityIdentifier(
                                        "task-process-now-\(run.id.uuidString.lowercased())"
                                    )
                                }
                            }
                        }
                    }
                    if let generatedAt = snapshot?.generatedAt {
                        Section {
                            Text(L10n.format("마지막 동기화 %@", L10n.time(generatedAt)))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("dashboard-synced-at")
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await refresh() }
                .accessibilityIdentifier("task-list")
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showingCreateIssue = true } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(L10n.text("새 이슈"))
                .accessibilityIdentifier("create-issue-button")
            }
        }
        .sheet(isPresented: $showingCreateIssue) {
            CreateIssueSheet(
                mutations: mutations,
                members: snapshot?.members ?? [],
                providers: snapshot?.organizationProviders ?? [],
                capabilities: AgentProviderCapabilityCatalog(workers: snapshot?.workers ?? []),
                refresh: refresh
            )
        }
        .sheet(item: $dispatchRun) { run in
            DispatchIssueSheet(
                run: run,
                reassign: false,
                providers: snapshot?.organizationProviders ?? [],
                workers: snapshot?.workers ?? [],
                mutations: mutations,
                refresh: refresh
            )
        }
    }
}

struct RunRow: View {
    let run: DashboardRun
    let issueKeyPrefix: String
    let assignee: OrganizationMember?
    let worker: DashboardWorker?

    init(
        run: DashboardRun,
        issueKeyPrefix: String = "AH",
        assignee: OrganizationMember? = nil,
        worker: DashboardWorker? = nil
    ) {
        self.run = run
        self.issueKeyPrefix = issueKeyPrefix
        self.assignee = assignee
        self.worker = worker
    }

    static func worker(for run: DashboardRun, workers: [DashboardWorker]) -> DashboardWorker? {
        let workerID = run.workerId ?? run.requestedWorkerId
        guard let workerID else { return nil }
        return workers.first { $0.id == workerID }
    }

    private var workerLabel: String? {
        worker?.label ?? run.workerId ?? run.requestedWorkerId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top) {
                Text(run.title)
                    .font(.headline)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                StatusBadge(
                    status: run.status,
                    reviewed: !(run.resultReviews ?? []).isEmpty
                )
                .fixedSize(horizontal: true, vertical: false)
            }
            if let detail = run.detail, !detail.isEmpty {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    identityMetadata
                    Spacer(minLength: 4)
                    updatedMetadata
                }
                VStack(alignment: .leading, spacing: 6) {
                    identityMetadata
                    updatedMetadata
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var identityMetadata: some View {
        HStack(spacing: 10) {
            if let runNumber = run.runNumber {
                Text(verbatim: "\(issueKeyPrefix)-\(runNumber)")
                    .fixedSize(horizontal: true, vertical: false)
            }
            if let difficulty = run.difficulty {
                IssueDifficultyBadge(difficulty: difficulty)
            }
            if let assignee {
                ProfileImageView(
                    image: assignee.image,
                    name: assignee.name,
                    size: 20
                )
                .accessibilityLabel(L10n.format("담당자 %@", assignee.name))
            }
            if let workerLabel {
                RunWorkerIconView(worker: worker, label: workerLabel)
            }
            if run.fullAuto == true {
                FullAutoModeBadge()
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var updatedMetadata: some View {
        Text(L10n.relativeDate(run.updatedAt))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }
}

private struct IssueDifficultyBadge: View {
    let difficulty: IssueDifficulty

    private var label: String {
        L10n.format("난이도 %@", difficulty.displayName)
    }

    var body: some View {
        Image(systemName: difficulty.systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(difficulty == .hard ? Color.red : Color.accentColor)
            .frame(width: 20, height: 20)
            .background(Color.secondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .help(label)
            .accessibilityLabel(label)
    }
}

private struct RunWorkerIconView: View {
    let worker: DashboardWorker?
    let label: String

    var body: some View {
        ZStack {
            switch worker?.icon?.type {
            case .emoji:
                Text(worker?.icon?.value ?? "")
                    .font(.system(size: 12))
                    .frame(width: 20, height: 20)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            case .image:
                ProfileImageView(
                    image: worker?.icon?.value,
                    systemImage: "desktopcomputer",
                    size: 20,
                    cornerRadius: 6
                )
            case nil:
                Image(systemName: "desktopcomputer")
                    .font(.caption.weight(.medium))
                    .frame(width: 20, height: 20)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.format("실행 Worker %@", label))
        .help(label)
    }
}

private struct FullAutoModeBadge: View {
    var body: some View {
        Image(systemName: "rocket.fill")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Color.orange)
            .frame(width: 20, height: 20)
            .background(Color.orange.opacity(0.12))
            .clipShape(Circle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L10n.text("Full Auto"))
            .help(L10n.text("모든 체크포인트를 건너뛰고 중단 없이 처리합니다."))
    }
}

struct StatusBadge: View {
    let status: DashboardRun.Status
    var reviewed: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            if reviewed {
                Image(systemName: "checkmark.seal.fill")
                    .font(.caption2.weight(.bold))
                    .accessibilityHidden(true)
            }
            Text(status.displayName)
                .font(.caption2.weight(.bold))
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .foregroundStyle(color)
        .background(color.opacity(0.12), in: Capsule())
        .accessibilityLabel(
            reviewed
                ? L10n.format("%@ · 검수 완료됨", status.displayName)
                : status.displayName
        )
    }

    private var color: Color {
        switch status {
        case .completed: .green
        case .failed, .blocked: .red
        case .running: .blue
        case .queued: .orange
        default: .secondary
        }
    }
}

struct OfflineStateView: View {
    let message: String
    let refresh: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label(L10n.text("오프라인"), systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button(L10n.text("다시 시도")) { Task { await refresh() } }
                .accessibilityIdentifier("dashboard-retry-button")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("offline-state")
    }
}

enum RunDetailTab: String, CaseIterable, Identifiable, Hashable {
    case issue
    case control
    case conversation
    case result
    case logs
    case status

    var id: String { rawValue }

    var title: String { title(locale: .current) }

    func title(locale: CompanionLocale) -> String {
        switch self {
        case .issue: L10n.text("이슈", locale: locale)
        case .control: L10n.text("제어", locale: locale)
        case .conversation: L10n.text("대화", locale: locale)
        case .result: L10n.text("결과", locale: locale)
        case .logs: L10n.text("로그", locale: locale)
        case .status: L10n.text("상태", locale: locale)
        }
    }
}

private struct IssueExecutionApprovalPresentation: Identifiable {
    let proposal: IssueExecutionProposal
    let snapshot: DashboardSnapshot

    var id: UUID { proposal.id }
}

private struct SkillExecutionApprovalPresentation: Identifiable {
    let proposal: AgentSkillExecutionProposal
    let snapshot: DashboardSnapshot

    var id: UUID { proposal.id }
}

struct RunDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var inbox: InboxStore
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    let run: DashboardRun
    @StateObject private var detail: RunDetailStore
    @StateObject private var mutations: IssueMutationStore
    @State private var previewFile: PreviewFile?
    @State private var previewError: String?
    @State private var actionError: String?
    @State private var showingEdit = false
    @State private var showingDispatch = false
    @State private var reassigning = false
    @State private var confirmingDelete = false
    @State private var showingTransfer = false
    @State private var showingDependencyPicker = false
    @State private var executionApprovalPresentation: IssueExecutionApprovalPresentation?
    @State private var preparingExecutionProposalID: UUID?
    @State private var skillExecutionApprovalPresentation:
        SkillExecutionApprovalPresentation?
    @State private var preparingSkillExecutionProposalID: UUID?
    @State private var transferTargetProjectID: UUID?
    @State private var localStatus: DashboardRun.Status
    @State private var localWorkflowStage: String?
    @State private var dependencyIDs: Set<UUID>
    @State private var preferences: IssueExecutionPreferences
    @State private var messageText = ""
    @State private var messageMentions: [ChannelMentionTarget] = []
    @State private var messageAttachments: [PendingIssueAttachment] = []
    @State private var replyTo: IssueMessage?
    @State private var reviewCompleted = false
    @State private var linkCopied = false
    @State private var subscribers: [IssueSubscriber]
    @State private var selectedTab: RunDetailTab

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private let projectID: UUID
    private let issueKeyPrefix: String
    private let projects: [Project]
    private let allRuns: [DashboardRun]
    private let projectAgents: [ProjectAgent]
    private let workers: [DashboardWorker]
    private let providers: [AgentProvider]
    private let members: [OrganizationMember]
    private let currentUserID: String?
    private let issueConversationView: IssueConversationViewTracker?
    private let refresh: () async -> Void
    private let onRelatedMessageOpen: (RelatedMessageReference) -> Void
    private let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    private let onSkillSessionOpen: SkillSessionOpenHandler
    private let token: String
    private let api: any MobileAPIClientProtocol

    private var issueMentionCandidates: [ChannelMentionTarget] {
        MessageMentions.issueCandidates(
            members: members,
            agents: projectAgents,
            currentUserId: currentUserID
        )
    }

    private var providerCapabilities: AgentProviderCapabilityCatalog {
        AgentProviderCapabilityCatalog(workers: workers)
    }

    private var issueMentionHandles: Set<String> {
        MessageMentions.issueHandles(members: members, agents: projectAgents)
    }

    private var transferDestinations: [Project] {
        let currentOrganization = projects.first(where: { $0.id == projectID })?.organizationId
        return projects.filter { project in
            project.id != projectID &&
                (currentOrganization == nil || project.organizationId == currentOrganization)
        }
    }

    private var proposalMutationInFlight: Bool {
        mutations.activeActions.contains { action in
            action.hasPrefix("issue-proposal-") ||
                action.hasPrefix("issue-execution-proposal-") ||
                action.hasPrefix("agent-skill-execution-proposal-")
        }
    }

    private var proposalApprovalPresentationInFlight: Bool {
        proposalMutationInFlight ||
            preparingExecutionProposalID != nil ||
            executionApprovalPresentation != nil ||
            preparingSkillExecutionProposalID != nil ||
            skillExecutionApprovalPresentation != nil
    }

    @MainActor
    init(
        run: DashboardRun,
        projectID: UUID,
        issueKeyPrefix: String = "AH",
        token: String,
        api: any MobileAPIClientProtocol,
        projects: [Project] = [],
        allRuns: [DashboardRun] = [],
        projectAgents: [ProjectAgent] = [],
        workers: [DashboardWorker] = [],
        providers: [AgentProvider] = [],
        members: [OrganizationMember] = [],
        currentUserID: String? = nil,
        initialTab: RunDetailTab? = nil,
        issueConversationView: IssueConversationViewTracker? = nil,
        refresh: @escaping () async -> Void = {},
        onRelatedMessageOpen: @escaping (RelatedMessageReference) -> Void = { _ in },
        onSkillSessionMaterialized: @escaping SkillSessionMaterializedHandler = { _ in },
        onSkillSessionOpen: @escaping SkillSessionOpenHandler = { _, _ in }
    ) {
        self.run = run
        self.projectID = projectID
        self.issueKeyPrefix = issueKeyPrefix
        self.projects = projects
        self.allRuns = allRuns
        self.projectAgents = projectAgents
        self.workers = workers
        self.providers = providers
        self.members = members
        self.currentUserID = currentUserID
        self.issueConversationView = issueConversationView
        self.refresh = refresh
        self.onRelatedMessageOpen = onRelatedMessageOpen
        self.onSkillSessionMaterialized = onSkillSessionMaterialized
        self.onSkillSessionOpen = onSkillSessionOpen
        self.token = token
        self.api = api
        _detail = StateObject(wrappedValue: RunDetailStore(
            api: api,
            projectID: projectID,
            runID: run.id,
            token: token
        ))
        _mutations = StateObject(wrappedValue: IssueMutationStore(
            api: api,
            projectID: projectID,
            token: token
        ))
        _localStatus = State(initialValue: run.status)
        _localWorkflowStage = State(initialValue: run.workflowStage)
        _dependencyIDs = State(initialValue: Set((run.prerequisites ?? []).map(\.id)))
        _preferences = State(initialValue: IssueExecutionPreferences(
            provider: run.preferredProvider,
            model: run.preferredModel,
            effort: run.preferredEffort
        ))
        _reviewCompleted = State(initialValue: !(run.resultReviews ?? []).isEmpty)
        _subscribers = State(initialValue: run.subscribers ?? [])
        _transferTargetProjectID = State(initialValue: projects.first(where: {
            $0.id != projectID &&
                (projects.first(where: { $0.id == projectID })?.organizationId == nil ||
                    $0.organizationId == projects.first(where: { $0.id == projectID })?.organizationId)
        })?.id)
        // Match shared React RunPage: completed/paused open on Result.
        _selectedTab = State(
            initialValue: initialTab ??
                (run.status.prefersResultDetailTab ? .result : .issue)
        )
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            lifecycleContent
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(L10n.text("이슈 상세", locale: locale))
                .accessibilityIdentifier("run-detail")
        }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
                .ignoresSafeArea()
        }
        .modifier(PreviewErrorAlertModifier(message: $previewError))
        .alert(L10n.text("이슈를 삭제할까요?", locale: locale), isPresented: $confirmingDelete) {
            Button(L10n.text("삭제", locale: locale), role: .destructive) { Task { await deleteIssue() } }
            Button(L10n.text("취소", locale: locale), role: .cancel) {}
        } message: {
            Text(L10n.text("활동 기록, 대화와 첨부가 영구적으로 삭제됩니다.", locale: locale))
        }
        .confirmationDialog(
            L10n.text("다른 프로젝트로 이동", locale: locale),
            isPresented: $showingTransfer,
            titleVisibility: .visible
        ) {
            ForEach(transferDestinations, id: \.id) { project in
                Button(project.name) {
                    transferTargetProjectID = project.id
                    Task { await transferIssue(to: project.id) }
                }
            }
            Button(L10n.text("취소", locale: locale), role: .cancel) {}
        } message: {
            Text(L10n.text("선택한 프로젝트로 이슈와 대화·첨부·활동 기록이 함께 이동합니다. 의존성은 해제됩니다.", locale: locale))
        }
        .sheet(isPresented: $showingEdit) {
            EditIssueSheet(
                run: run,
                members: members,
                mutations: mutations,
                refresh: refresh
            )
        }
        .sheet(isPresented: $showingDispatch) {
            DispatchIssueSheet(
                run: run,
                reassign: reassigning,
                providers: providers,
                workers: workers,
                mutations: mutations,
                refresh: refresh
            )
        }
        .sheet(isPresented: $showingDependencyPicker) {
            DependencyPickerSheet(
                selectedIDs: $dependencyIDs,
                candidates: dependencyCandidates,
                issueKeyPrefix: issueKeyPrefix,
                onAdd: { prerequisiteID in
                    try await changeDependency(prerequisiteID, enabled: true)
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $executionApprovalPresentation) { presentation in
            ExecutionProposalApprovalSheet(
                targetTitle: presentation.snapshot.runs.first(where: {
                    $0.id == presentation.proposal.runId
                })?.title ?? presentation.proposal.title,
                providers: presentation.snapshot.organizationProviders ?? [],
                workers: presentation.snapshot.workers ?? [],
                policy: presentation.snapshot.executionPolicy,
                locale: locale,
                delegationNotice: issueExecutionDelegationNotice(
                    agentName: presentation.proposal.delegatedByAgentName,
                    locale: locale
                ),
                approve: { request in
                    try await approveExecutionProposal(
                        presentation.proposal,
                        request: request
                    )
                }
            )
        }
        .sheet(item: $skillExecutionApprovalPresentation) { presentation in
            AgentSkillExecutionApprovalSheet(
                proposal: presentation.proposal,
                workers: presentation.snapshot.workers ?? [],
                policy: presentation.snapshot.executionPolicy,
                locale: locale,
                approve: { request in
                    try await approveSkillExecutionProposal(
                        presentation.proposal,
                        request: request
                    )
                }
            )
        }
    }

    private var lifecycleContent: some View {
        detailContent
            .navigationTitle(run.title)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        let shareURL = BriarShareLinks.issueShareURL(
                            projectID: projectID,
                            runID: run.id,
                            origin: BriarShareLinks.defaultOrigin
                        )
                        ShareLink(item: shareURL) {
                            Label(L10n.text("이슈 공유", locale: locale), systemImage: "square.and.arrow.up")
                        }
                        Button {
                            ClipboardService.copy(shareURL.absoluteString)
                            linkCopied = true
                        } label: {
                            Label(L10n.text(.copyLink, locale: locale), systemImage: "doc.on.doc")
                        }
                        .accessibilityIdentifier("issue-copy-link")
                        Divider()
                        Button(L10n.text("수정", locale: locale)) { showingEdit = true }
                        if !transferDestinations.isEmpty {
                            Button(L10n.text("다른 프로젝트로 이동", locale: locale)) {
                                transferTargetProjectID = transferDestinations.first?.id
                                showingTransfer = true
                            }
                        }
                        Button(L10n.text("삭제", locale: locale), role: .destructive) { confirmingDelete = true }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("issue-actions-menu")
                }
            }
            .companionToast(
                isPresented: $linkCopied,
                message: L10n.text(.linkCopied, locale: locale)
            )
            .task {
                inbox.markIssueRead(runID: run.id)
                detail.startActivitySynchronization()
                await detail.load()
            }
            .refreshable { await detail.load() }
            .onChange(of: inbox.messages) { _, _ in
                inbox.markIssueRead(runID: run.id)
            }
            .onChange(of: selectedTab, initial: true) { _, tab in
                if tab == .conversation {
                    issueConversationView?.view(runID: run.id) {
                        await detail.load(queueIfLoading: true)
                    }
                } else {
                    issueConversationView?.leave(runID: run.id)
                }
            }
            .onChange(of: run.status) { _, status in
                localStatus = status
                // Keep parity with shared React RunPage: status transitions reselect the default tab.
                selectedTab = status.prefersResultDetailTab ? .result : .issue
            }
            .onChange(of: run.workflowStage) { _, stage in localWorkflowStage = stage }
            .onChange(of: run.prerequisites) { _, prerequisites in
                dependencyIDs = Set((prerequisites ?? []).map(\.id))
            }
            .onChange(of: run.subscribers) { _, updatedSubscribers in
                subscribers = updatedSubscribers ?? []
            }
            .onDisappear {
                issueConversationView?.leave(runID: run.id)
                executionApprovalPresentation = nil
                preparingExecutionProposalID = nil
                skillExecutionApprovalPresentation = nil
                preparingSkillExecutionProposalID = nil
                detail.close()
            }
            .onChange(of: detail.messages) { _, messages in
                if let proposalID = executionApprovalPresentation?.proposal.id,
                   !messages.contains(where: {
                       $0.executionProposal?.id == proposalID &&
                           $0.executionProposal?.status == .pending
                   }) {
                    executionApprovalPresentation = nil
                }
                if let proposal = skillExecutionApprovalPresentation?.proposal,
                   !messages.contains(where: {
                       guard let current = $0.skillExecutionProposal else { return false }
                       return current.status == .pending &&
                           agentSkillExecutionImmutableFieldsMatch(current, proposal)
                   }) {
                    skillExecutionApprovalPresentation = nil
                }
            }
            .onChange(of: pendingExecutionTargetSignatures) { previous, current in
                guard pendingIssueExecutionTargetChanged(
                    from: previous,
                    to: current
                ) else { return }
                executionApprovalPresentation = nil
                Task { await detail.load(queueIfLoading: true) }
            }
    }

    private var detailContent: some View {
        VStack(spacing: 0) {
            Picker(L10n.text("이슈 상세 탭", locale: locale), selection: $selectedTab) {
                ForEach(RunDetailTab.allCases) { tab in
                    Text(tab.title(locale: locale))
                        .tag(tab)
                        .accessibilityIdentifier("run-detail-tab-\(tab.rawValue)")
                }
            }
            .pickerStyle(.segmented)
            .controlSize(.small)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(Color(uiColor: .systemGroupedBackground))
            .accessibilityIdentifier("run-detail-tabs")

            if selectedTab == .conversation {
                conversationTabContent
            } else {
                List { selectedTabContent }
                    .accessibilityIdentifier("run-detail-\(selectedTab.rawValue)-panel")
            }
        }
    }

    @ViewBuilder
    private var selectedTabContent: some View {
        switch selectedTab {
        case .issue: issueTabContent
        case .control: controlTabContent
        case .conversation: EmptyView()
        case .result: resultTabContent
        case .logs: logsTabContent
        case .status: statusTabContent
        }

        if let actionError {
            Section {
                Label(actionError, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private var issueTabContent: some View {
        let attachments = run.attachments ?? []
        let embeddedReferences = IssueAttachmentMedia.embeddedReferences(in: run.issueDescription)
        let remainingAttachments = attachments.filter {
            !embeddedReferences.contains($0.id.uuidString.lowercased())
        }

        if let relatedMessage = run.relatedMessage {
            Section(L10n.text("속성", locale: locale)) {
                Button {
                    onRelatedMessageOpen(relatedMessage)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(L10n.text("관련 메시지", locale: locale))
                            Text(L10n.text("관련 메시지로 돌아가기", locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "message")
                    }
                }
                .accessibilityIdentifier("run-related-message")
            }
        }

        if let description = run.issueDescription, !description.isEmpty {
            Section(L10n.text("설명", locale: locale)) {
                IssueDescriptionView(
                    markdown: description,
                    attachments: attachments,
                    download: { attachment in
                        try await detail.download(
                            path: attachment.url,
                            filename: attachment.filename
                        )
                    },
                    open: { previewFile = PreviewFile(url: $0) }
                )
            }
        }

        if !remainingAttachments.isEmpty {
            Section(L10n.text("첨부", locale: locale)) {
                ForEach(remainingAttachments) { attachment in
                    attachmentRow(attachment)
                }
            }
        }

        if run.issueDescription?.isEmpty != false, attachments.isEmpty {
            Section { ContentUnavailableView(L10n.text("이슈 내용 없음", locale: locale), systemImage: "doc.text") }
        }
    }

    @ViewBuilder
    private func attachmentRow(_ attachment: IssueAttachment) -> some View {
        if IssueAttachmentMedia.isImage(
            contentType: attachment.contentType,
            filename: attachment.filename
        ) {
            AuthenticatedImagePreview(
                sourceID: attachment.url,
                filename: attachment.filename,
                detail: ByteCountFormatter.string(
                    fromByteCount: Int64(attachment.byteSize),
                    countStyle: .file
                ),
                accessibilityID: "issue-attachment-image-\(attachment.id.uuidString.lowercased())",
                load: {
                    try await detail.download(
                        path: attachment.url,
                        filename: attachment.filename
                    )
                },
                open: { previewFile = PreviewFile(url: $0) }
            )
        } else {
            Button {
                Task { await open(path: attachment.url, filename: attachment.filename) }
            } label: {
                Label {
                    VStack(alignment: .leading) {
                        Text(attachment.filename)
                        Text(ByteCountFormatter.string(
                            fromByteCount: Int64(attachment.byteSize),
                            countStyle: .file
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "doc")
                }
            }
        }
    }

    @ViewBuilder
    private var controlTabContent: some View {
        if localStatus == .paused, run.resumeRequestedAt != nil {
            Section(L10n.text("검토 대기", locale: locale)) {
                Label(L10n.text("일시정지 상태를 유지하며 워커를 재할당하고 있습니다.", locale: locale),
                      systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(.secondary)
                ProgressView().frame(maxWidth: .infinity)
            }
        } else if localStatus == .paused, let checkpoint = run.checkpoint {
            checkpointControl(checkpoint)
        }

        Section(L10n.text("실행 제어", locale: locale)) {
            Picker(L10n.text("상태 이동", locale: locale), selection: placementBinding) {
                ForEach(availablePlacements) { placement in
                    Text(placement.label).tag(placement)
                }
            }
            .disabled(mutations.isActive("move-\(run.id)"))
            .accessibilityIdentifier("run-status-picker")

            if localStatus == .backlog || localStatus == .queued {
                Button(L10n.text("바로 처리", locale: locale)) {
                    reassigning = false
                    showingDispatch = true
                }
                .disabled((run.waitingOnPrerequisiteCount ?? 0) > 0)
                .accessibilityIdentifier("process-now-button")
            }
            if localStatus == .running {
                Button(L10n.text("Worker 다시 배정", locale: locale)) {
                    reassigning = true
                    showingDispatch = true
                }
            }
            if localStatus == .blocked || localStatus == .failed {
                Button(L10n.text("재시도", locale: locale)) { Task { await recover(action: "retry") } }
                    .accessibilityIdentifier("retry-run-button")
            }
            if localStatus != .completed && localStatus != .cancelled {
                Button(L10n.text("실행 취소", locale: locale), role: .destructive) {
                    Task { await recover(action: "cancel") }
                }
                .accessibilityIdentifier("cancel-run-button")
            }
            if localStatus == .completed && !reviewCompleted {
                Button(L10n.text("결과 검수 완료", locale: locale)) { Task { await completeReview() } }
                    .accessibilityIdentifier("complete-review-button")
            } else if reviewCompleted {
                Label(L10n.text("결과 검수 완료", locale: locale), systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
            }
        }

        Section(L10n.text("실행 설정", locale: locale)) {
            Picker(L10n.text("프로바이더", locale: locale), selection: providerSelection) {
                Text(L10n.text("기본값", locale: locale)).tag(AgentProvider?.none)
                ForEach(providers.isEmpty ? AgentProvider.allCases : providers) {
                    Text($0.displayName).tag(AgentProvider?.some($0))
                }
            }
            .disabled(mutations.isActive("preferences-\(run.id)"))
            .accessibilityIdentifier("execution-provider-picker")
            Picker(L10n.text("모델", locale: locale), selection: modelSelection) {
                Text(L10n.text("기본값", locale: locale)).tag(String?.none)
                ForEach(providerCapabilities.models(for: preferences.provider)) {
                    Text($0.label).tag(String?.some($0.id))
                }
            }
            .disabled(
                preferences.provider == nil ||
                    mutations.isActive("preferences-\(run.id)")
            )
            .accessibilityIdentifier("execution-model-picker")
            Picker(L10n.text("Effort", locale: locale), selection: effortSelection) {
                Text(L10n.text("기본값", locale: locale)).tag(ModelEffort?.none)
                ForEach(providerCapabilities.efforts(
                    for: preferences.provider,
                    model: preferences.model
                )) {
                    Text($0.label).tag(ModelEffort?.some(ModelEffort(rawValue: $0.id)))
                }
            }
            .disabled(
                preferences.model == nil ||
                    mutations.isActive("preferences-\(run.id)")
            )
            .accessibilityIdentifier("execution-effort-picker")
        }

        if localStatus == .backlog || localStatus == .queued {
            dependenciesControl
        }
    }

    private func checkpointControl(_ checkpoint: WorkflowCheckpoint) -> some View {
        Section(L10n.text("검토 대기", locale: locale)) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(checkpoint.position == .before
                         ? L10n.format("%@ 시작 전 확인", locale: locale, checkpoint.stageLabel)
                         : L10n.format("%@ 완료 후 확인", locale: locale, checkpoint.stageLabel))
                        .font(.headline)
                    Text(L10n.format("리비전 %d", locale: locale, checkpoint.revision))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(checkpoint.terminalReviewOnly
                         ? L10n.text("마지막 단계를 반복하지 않고 최종 검토 후 완료합니다.", locale: locale)
                         : L10n.format(
                            "재개 후 %@부터 자동 진행합니다.",
                            locale: locale,
                            checkpoint.nextStageLabel ?? checkpoint.nextStage ?? checkpoint.stageLabel
                        ))
                        .font(.subheadline)
                }
            } icon: {
                Image(systemName: "pause.circle.fill").foregroundStyle(.purple)
            }
            Button {
                Task { await resume(checkpoint: checkpoint) }
            } label: {
                if mutations.isActive("resume-\(run.id)") {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Label(L10n.text("자동화 재개", locale: locale), systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(mutations.isActive("resume-\(run.id)"))
            .accessibilityLabel(
                L10n.format(
                    "%@ 체크포인트 승인 후 자동화 재개",
                    locale: locale,
                    checkpoint.stageLabel
                )
            )
            .accessibilityIdentifier("resume-run-button")
        }
    }

    @ViewBuilder
    private var dependenciesControl: some View {
        Section(L10n.text("의존성", locale: locale)) {
            if selectedDependencyReferences.isEmpty {
                Text(L10n.text("선행 이슈가 없습니다.", locale: locale))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(selectedDependencyReferences) { dependency in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(dependency.title)
                            Text(verbatim: "\(issueKeyPrefix)-\(dependency.runNumber) · \(dependency.status.displayName(locale: locale))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            Task { try? await changeDependency(dependency.id, enabled: false) }
                        } label: {
                            if mutations.isActive("dependency-\(run.id)-\(dependency.id)") {
                                ProgressView()
                            } else {
                                Image(systemName: "minus.circle")
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(mutations.isActive("dependency-\(run.id)-\(dependency.id)"))
                        .accessibilityLabel(
                            L10n.format("%@ 의존성 제거", locale: locale, dependency.title)
                        )
                        .accessibilityIdentifier(
                            "remove-dependency-\(dependency.id.uuidString.lowercased())"
                        )
                    }
                }
            }

            Button {
                showingDependencyPicker = true
            } label: {
                Label(L10n.text("의존성 추가", locale: locale), systemImage: "plus.circle")
            }
            .disabled(dependencyCandidates.isEmpty)
            .accessibilityIdentifier("add-dependency-button")
        }
    }

    private var dependencyCandidates: [DashboardRun] {
        allRuns
            .filter { $0.id != run.id && $0.status != .cancelled }
            .sorted { left, right in
                switch (left.runNumber, right.runNumber) {
                case let (leftNumber?, rightNumber?):
                    return leftNumber < rightNumber
                case (_?, nil): return true
                case (nil, _?): return false
                default:
                    return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
                }
            }
    }

    private var selectedDependencyReferences: [IssueDependencyReference] {
        let loadedReferences = Dictionary(
            uniqueKeysWithValues: allRuns.map { candidate in
                (
                    candidate.id,
                    IssueDependencyReference(
                        id: candidate.id,
                        runNumber: candidate.runNumber ?? 0,
                        title: candidate.title,
                        status: candidate.status
                    )
                )
            }
        )
        let existingReferences = Dictionary(
            uniqueKeysWithValues: (run.prerequisites ?? []).map { ($0.id, $0) }
        )
        return dependencyIDs.compactMap { dependencyID in
            loadedReferences[dependencyID] ?? existingReferences[dependencyID]
        }.sorted { left, right in
            if left.runNumber != right.runNumber { return left.runNumber < right.runNumber }
            return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
        }
    }

    private func changeDependency(_ prerequisiteID: UUID, enabled: Bool) async throws {
        do {
            try await mutations.setDependency(
                runID: run.id,
                prerequisiteID: prerequisiteID,
                enabled: enabled
            )
            if enabled {
                dependencyIDs.insert(prerequisiteID)
            } else {
                dependencyIDs.remove(prerequisiteID)
            }
            actionError = nil
            await refresh()
        } catch {
            actionError = error.localizedDescription
            throw error
        }
    }

    private var conversationTabContent: some View {
        VStack(spacing: 0) {
            conversationHeader
            Divider()

            if detail.loading {
                ProgressView(L10n.text("상세 기록을 불러오는 중…", locale: locale))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = detail.errorMessage {
                ContentUnavailableView {
                    Label(L10n.text("대화를 불러오지 못했습니다.", locale: locale), systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button(L10n.text("상세 다시 시도", locale: locale)) {
                        Task { await detail.load() }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if detail.messages.isEmpty {
                ContentUnavailableView(
                    L10n.text("대화 없음", locale: locale),
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text(
                        L10n.text("이 이슈에 첫 메시지를 남겨보세요.", locale: locale)
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ConversationTimeline(
                    messages: detail.messages,
                    locale: locale,
                    accessibilityIdentifier: "issue-message-timeline",
                    timestamp: \.createdAt
                ) { message in
                    messageRow(message)
                }
            }

            if let actionError {
                Label(actionError, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
            }

            ConversationComposer(
                draft: $messageText,
                mentions: $messageMentions,
                attachments: $messageAttachments,
                sending: mutations.isActive("message-\(run.id)"),
                candidates: issueMentionCandidates,
                placeholder: L10n.text("메시지 또는 @Agent 질문", locale: locale),
                replyLabel: replyTo.map {
                    L10n.format("%@에게 답글", locale: locale, $0.author.name)
                },
                allowsImagePaste: true,
                locale: locale,
                accessibility: ConversationComposerAccessibility(
                    attachment: "issue-message-attach",
                    field: "issue-message-field",
                    send: "issue-message-send",
                    mentionMenu: "issue-mention-menu",
                    mentionItemPrefix: "issue-mention"
                ),
                cancelReply: { replyTo = nil },
                send: sendMessage
            )
        }
        .background(Color(uiColor: .systemBackground))
    }

    private var conversationHeader: some View {
        HStack(spacing: 8) {
            Text(L10n.text("대화", locale: locale))
                .font(.subheadline.weight(.bold))
            if !detail.loading {
                Text("\(detail.messages.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if !subscriberMembers.isEmpty {
                HStack(spacing: -6) {
                    ForEach(Array(subscriberMembers.prefix(4)), id: \.userId) { member in
                        ProfileImageView(
                            image: member.image,
                            name: member.name,
                            systemImage: "person.fill",
                            size: 24
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
                    Task { await toggleSubscription() }
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
                .disabled(
                    mutations.isActive("subscription-\(run.id)") ||
                        (isSubscribed && assigneeSubscriptionRequired)
                )
                .accessibilityIdentifier("issue-subscribe-button")
                .help(
                    assigneeSubscriptionRequired
                        ? L10n.text("담당자는 이 이슈를 항상 구독합니다.", locale: locale)
                        : isSubscribed
                            ? L10n.text("구독 해제", locale: locale)
                            : L10n.text("구독", locale: locale)
                )
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    private func messageRow(_ message: IssueMessage) -> some View {
        let isOptimistic = detail.isMessageOptimistic(message.id)
        return ConversationMessageLayout(
            authorImage: message.author.image,
            profileName: message.author.provider == nil ? message.author.name : nil,
            authorName: message.author.name,
            authorSystemImage: message.author.provider == nil ? "person.fill" : "cpu",
            authorAccessorySystemImage: message.author.provider == nil ? nil : "cpu",
            timestamp: message.createdAt,
            accessibilityIdentifier: "issue-message-\(message.id.uuidString.lowercased())"
        ) {
                if let parent = detail.messages.first(where: { $0.id == message.parentMessageId }) {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "arrowshape.turn.up.left")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        MentionText(
                            text: conversationMessageText(parent.body),
                            handles: issueMentionHandles,
                            allowsRangeSelection: false
                        )
                        .font(.caption)
                        .lineLimit(2)
                        .foregroundStyle(.secondary)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                }
                let visibleBody = conversationMessageText(message.body)
                if !visibleBody.isEmpty {
                    MarkdownText(
                        markdown: MessageMentions.markdownWithLinks(
                            visibleBody,
                            handles: issueMentionHandles
                        )
                    )
                }
                ForEach(message.attachments ?? []) { attachment in
                    AuthenticatedImagePreview(
                        sourceID: attachment.url,
                        filename: attachment.filename,
                        detail: ByteCountFormatter.string(
                            fromByteCount: Int64(attachment.byteSize),
                            countStyle: .file
                        ),
                        accessibilityID: "issue-message-image-\(attachment.id.uuidString.lowercased())",
                        load: {
                            try await detail.download(
                                path: attachment.url,
                                filename: attachment.filename
                            )
                        },
                        open: { previewFile = PreviewFile(url: $0) }
                    )
                }
                if let proposal = message.proposedAction {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            proposal.type == .rework
                                ? L10n.text("Briar 재작업 제안", locale: locale)
                                : proposal.type == .update
                                    ? L10n.text("현재 이슈 수정 제안", locale: locale)
                                    : L10n.text("새 이슈 생성 제안", locale: locale)
                        )
                            .font(.subheadline.weight(.semibold))
                        if proposal.type == .rework {
                            Text(L10n.format("%@부터 개정", locale: locale, proposal.workflowStage ?? ""))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(proposal.reason ?? "")
                                .font(.subheadline)
                        } else if proposal.type == .update {
                            if proposal.changedFields?.contains("title") == true {
                                LabeledContent(L10n.text("제목", locale: locale), value: proposal.changes?.title ?? "")
                            }
                            if proposal.changedFields?.contains("description") == true {
                                LabeledContent(
                                    L10n.text("설명", locale: locale),
                                    value: proposal.changes?.description ?? L10n.text("설정 안 함", locale: locale)
                                )
                            }
                            if proposal.changedFields?.contains("priority") == true {
                                LabeledContent(
                                    L10n.text("우선순위", locale: locale),
                                    value: proposal.changes?.priority.map { "P\($0)" }
                                        ?? L10n.text("설정 안 함", locale: locale)
                                )
                            }
                        } else if let issue = proposal.issue {
                            Text(issue.title).font(.subheadline.weight(.semibold))
                            if let description = issue.description, !description.isEmpty {
                                Text(description).font(.subheadline)
                            }
                            let issuePriority = issue.priority.map { "P\($0)" }
                                ?? L10n.text("우선순위 없음", locale: locale)
                            Text(issuePriority)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Label(
                                L10n.text(.channelIssueCreationSafety, locale: locale),
                                systemImage: "tray"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            if proposal.executeAfterCreate == true {
                                Label(
                                    L10n.text(
                                        "생성 승인 후에도 자동 실행되지 않습니다. 별도의 실행 승인 카드가 이어서 표시됩니다.",
                                        locale: locale
                                    ),
                                    systemImage: "checkmark.shield"
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                        if proposal.status == .accepted {
                            Label(
                                proposal.type == .rework
                                    ? L10n.format(
                                        "리비전 %@ 개정이 시작되었습니다.",
                                        locale: locale,
                                        proposal.appliedRevision.map(String.init) ?? ""
                                    )
                                    : proposal.type == .update
                                        ? L10n.text("이슈 내용이 수정되었습니다.", locale: locale)
                                        : L10n.text("새 이슈가 생성되었습니다.", locale: locale),
                                systemImage: "checkmark.seal.fill"
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tint)
                            if proposal.type == .create,
                               let resultRunId = proposal.resultRunId,
                               resultRunId != run.id {
                                if allRuns.contains(where: { $0.id == resultRunId }) {
                                    NavigationLink(value: resultRunId) {
                                        Label(
                                            L10n.text(.channelViewIssue, locale: locale),
                                            systemImage: "arrow.right.circle"
                                        )
                                    }
                                    .buttonStyle(.bordered)
                                    .accessibilityIdentifier(
                                        "open-issue-create-result-\(proposal.id.uuidString.lowercased())"
                                    )
                                } else {
                                    Link(
                                        destination: BriarShareLinks.issueShareURL(
                                            projectID: projectID,
                                            runID: resultRunId,
                                            origin: BriarShareLinks.defaultOrigin
                                        )
                                    ) {
                                        Label(
                                            L10n.text(.channelViewIssue, locale: locale),
                                            systemImage: "arrow.up.right.circle"
                                        )
                                    }
                                    .buttonStyle(.bordered)
                                    .accessibilityIdentifier(
                                        "open-issue-create-result-\(proposal.id.uuidString.lowercased())"
                                    )
                                }
                            }
                        } else {
                            Button {
                                Task { await acceptIssueProposal(proposal) }
                            } label: {
                                if mutations.isActive("issue-proposal-\(proposal.id)") {
                                    ProgressView()
                                } else {
                                    Label(
                                        proposal.type == .rework
                                            ? L10n.text("수락하고 개정 시작", locale: locale)
                                            : proposal.type == .update
                                                ? L10n.text("수락하고 이슈 수정", locale: locale)
                                                : L10n.text("수락하고 이슈 만들기", locale: locale),
                                        systemImage: issueProposalAcceptanceSystemImage(
                                            for: proposal.type
                                        )
                                    )
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(proposalApprovalPresentationInFlight)
                            .accessibilityIdentifier("accept-issue-proposal-\(proposal.id.uuidString.lowercased())")
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.accentColor.opacity(0.25))
                    }
                }
                if let proposal = message.executionProposal {
                    issueExecutionProposalCard(proposal)
                }
                if let proposal = message.skillExecutionProposal {
                    issueSkillExecutionProposalCard(proposal)
                }
                if !isOptimistic {
                    Button(L10n.text("답글", locale: locale)) { replyTo = message }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(.tint)
                    ForEach(detail.typingStatuses(parentMessageID: message.id)) { status in
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text(
                                status.activity.map {
                                    "Agent · \($0.displayHeadline)"
                                } ?? L10n.text(
                                    "Agent가 답변을 작성하고 있습니다…",
                                    locale: locale
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
        }
    }

    @ViewBuilder
    private func issueExecutionProposalCard(_ proposal: IssueExecutionProposal) -> some View {
        let target = executionTarget(proposal)
        let isFreshBacklog = issueExecutionApprovalUnavailable(
            run: target,
            targetRunID: proposal.runId
        ) == nil
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.text("이슈 실행 제안", locale: locale))
                .font(.subheadline.weight(.semibold))
            Text(target?.title ?? proposal.title)
                .font(.subheadline.weight(.semibold))
            if let notice = issueExecutionDelegationNotice(
                agentName: proposal.delegatedByAgentName,
                locale: locale
            ) {
                Label(notice, systemImage: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if proposal.status == .accepted {
                Label(
                    L10n.text("승인되어 실행을 요청했습니다.", locale: locale),
                    systemImage: "checkmark.seal.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tint)
                executionProposalSummary(proposal)
                if proposal.runId != run.id {
                    if proposal.projectId == projectID, target != nil {
                        NavigationLink(value: proposal.runId) {
                            Label(
                                L10n.text(.channelViewIssue, locale: locale),
                                systemImage: "arrow.right.circle"
                            )
                        }
                        .buttonStyle(.bordered)
                    } else {
                        Link(
                            destination: BriarShareLinks.issueShareURL(
                                projectID: proposal.projectId,
                                runID: proposal.runId,
                                origin: BriarShareLinks.defaultOrigin
                            )
                        ) {
                            Label(
                                L10n.text(.channelViewIssue, locale: locale),
                                systemImage: "arrow.up.right.circle"
                            )
                        }
                        .buttonStyle(.bordered)
                    }
                }
            } else {
                Label(
                    isFreshBacklog
                        ? L10n.text(
                            "승인 시점에도 fresh backlog 상태인지 다시 확인합니다.",
                            locale: locale
                        )
                        : L10n.text(
                            "최신 스냅샷에서 fresh backlog 상태를 확인한 뒤 승인할 수 있습니다.",
                            locale: locale
                        ),
                    systemImage: isFreshBacklog ? "checkmark.shield" : "arrow.clockwise"
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                Button {
                    Task { await prepareIssueExecutionApproval(proposal) }
                } label: {
                    if preparingExecutionProposalID == proposal.id {
                        ProgressView()
                    } else {
                        Label(
                            L10n.text(
                                isFreshBacklog ? "실행 설정 선택" : "최신 상태 확인",
                                locale: locale
                            ),
                            systemImage: isFreshBacklog
                                ? "slider.horizontal.3"
                                : "arrow.clockwise"
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    proposalMutationInFlight ||
                        preparingExecutionProposalID != nil ||
                        executionApprovalPresentation != nil ||
                        preparingSkillExecutionProposalID != nil ||
                        skillExecutionApprovalPresentation != nil
                )
                .accessibilityIdentifier(
                    "configure-issue-execution-proposal-\(proposal.id.uuidString.lowercased())"
                )
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.orange.opacity(0.35))
        }
        .accessibilityIdentifier(
            "issue-execution-proposal-\(proposal.id.uuidString.lowercased())"
        )
    }

    @ViewBuilder
    private func issueSkillExecutionProposalCard(
        _ proposal: AgentSkillExecutionProposal
    ) -> some View {
        let runtime = [
            proposal.provider.displayName,
            proposal.model,
            proposal.effort?.rawValue,
        ].compactMap { $0 }.joined(separator: " · ")
        let workerLabel = proposal.requestedWorkerLabel ?? proposal.requestedWorkerId.flatMap {
            workerID in workers.first(where: { $0.id == workerID })?.label ?? workerID
        }

        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.text("Agent Skill 실행 제안", locale: locale))
                .font(.subheadline.weight(.semibold))
            Text(
                proposal.status == .accepted
                    ? L10n.text(proposal.executionStatus == .completed
                        ? "Skill 실행을 완료했습니다."
                        : proposal.executionStatus == .failed
                        ? "Skill 실행이 실패했습니다."
                        : "Skill을 실행 중입니다.", locale: locale)
                    : L10n.text(
                        "정확한 Worker를 선택하고 명시적으로 승인해야 실행됩니다.",
                        locale: locale
                    )
            )
            .font(.caption)
            .foregroundStyle(.secondary)

            LabeledContent("Agent", value: proposal.agentName)
                .font(.caption)
            LabeledContent(L10n.text("Skill", locale: locale), value: proposal.skillName)
                .font(.caption)
            Label(runtime, systemImage: "cpu")
                .font(.caption)
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
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if proposal.status == .accepted {
                Label(
                    L10n.text("Skill 실행을 승인했습니다.", locale: locale),
                    systemImage: "checkmark.seal.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tint)
                if proposal.executionMode == .task, let workerLabel {
                    Label(workerLabel, systemImage: "desktopcomputer")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if proposal.executionMode == .task,
                   let sessionID = proposal.resultSessionId {
                    Button {
                        onSkillSessionOpen(proposal.projectId, sessionID)
                    } label: {
                        Label(
                            L10n.text("Agent 세션 보기", locale: locale),
                            systemImage: "arrow.right.circle"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier(
                        "open-issue-skill-session-\(proposal.id.uuidString.lowercased())"
                    )
                }
                if let error = proposal.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } else {
                Label(
                    L10n.text(
                        "Agent, Skill, 요청과 런타임은 승인 화면에서 변경할 수 없습니다.",
                        locale: locale
                    ),
                    systemImage: "lock.shield"
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                Button {
                    Task { await prepareSkillExecutionApproval(proposal) }
                } label: {
                    if preparingSkillExecutionProposalID == proposal.id {
                        ProgressView()
                    } else {
                        Label(
                            L10n.text("Worker 선택", locale: locale),
                            systemImage: "desktopcomputer"
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    proposalMutationInFlight ||
                        preparingSkillExecutionProposalID != nil ||
                        skillExecutionApprovalPresentation != nil ||
                        preparingExecutionProposalID != nil ||
                        executionApprovalPresentation != nil
                )
                .accessibilityIdentifier(
                    "configure-issue-skill-execution-proposal-\(proposal.id.uuidString.lowercased())"
                )
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.purple.opacity(0.35))
        }
        .accessibilityIdentifier(
            "issue-skill-execution-proposal-\(proposal.id.uuidString.lowercased())"
        )
    }

    @ViewBuilder
    private func executionProposalSummary(_ proposal: IssueExecutionProposal) -> some View {
        if let provider = proposal.requestedProvider {
            let values = [
                provider.displayName,
                proposal.requestedModel,
                proposal.requestedEffort?.rawValue,
            ].compactMap { $0 }
            Label(values.joined(separator: " · "), systemImage: "cpu")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if let workerID = proposal.requestedWorkerId {
            let label = workers.first(where: { $0.id == workerID })?.label ?? workerID
            Label(label, systemImage: "desktopcomputer")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func executionTarget(_ proposal: IssueExecutionProposal) -> DashboardRun? {
        if proposal.runId == run.id { return run }
        return allRuns.first(where: { $0.id == proposal.runId })
    }

    private var pendingExecutionTargetSignatures: [PendingIssueExecutionTargetSignature] {
        detail.messages.compactMap { message in
            guard let proposal = message.executionProposal,
                  proposal.status == .pending
            else { return nil }
            return PendingIssueExecutionTargetSignature(
                proposalID: proposal.id,
                targetSignature: issueExecutionSignature(executionTarget(proposal))
            )
        }
        .sorted { $0.proposalID.uuidString < $1.proposalID.uuidString }
    }

    @MainActor
    private func prepareIssueExecutionApproval(_ proposal: IssueExecutionProposal) async {
        guard preparingExecutionProposalID == nil,
              executionApprovalPresentation == nil,
              preparingSkillExecutionProposalID == nil,
              skillExecutionApprovalPresentation == nil,
              !proposalMutationInFlight,
              let context = detail.captureExecutionProposal(proposalID: proposal.id)
        else { return }
        preparingExecutionProposalID = proposal.id
        defer {
            if preparingExecutionProposalID == proposal.id {
                preparingExecutionProposalID = nil
            }
        }
        do {
            let snapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard detail.executionProposalIsCurrent(context) else { return }
            _ = try validateIssueExecutionApproval(
                snapshot: snapshot,
                proposal: proposal
            )
            actionError = nil
            executionApprovalPresentation = IssueExecutionApprovalPresentation(
                proposal: proposal,
                snapshot: snapshot
            )
        } catch {
            guard detail.executionProposalIsCurrent(context) else { return }
            actionError = error.localizedDescription
        }
    }

    @MainActor
    private func approveExecutionProposal(
        _ proposal: IssueExecutionProposal,
        request: AcceptIssueExecutionProposalRequest
    ) async throws -> Bool {
        guard let context = detail.captureExecutionProposal(proposalID: proposal.id) else {
            return false
        }
        do {
            let preflight: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard detail.executionProposalIsCurrent(context) else { return false }
            _ = try validateIssueExecutionApproval(
                snapshot: preflight,
                proposal: proposal,
                request: request
            )
            let response = try await mutations.acceptIssueExecutionProposal(
                conversationRunID: run.id,
                proposalID: proposal.id,
                request: request
            )
            guard detail.executionProposalIsCurrent(context) else { return false }
            guard response.projectId == proposal.projectId,
                  response.runId == proposal.runId,
                  issueExecutionApprovalResponseMatches(
                      proposal: response.proposal,
                      projectID: response.projectId,
                      runID: response.runId,
                      dispatch: response.dispatch,
                      expectedProposalID: proposal.id,
                      request: request
                  )
            else { throw MobileAPIError.invalidResponse }
            let acceptedSnapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard detail.executionProposalIsCurrent(context) else { return false }
            guard issueExecutionApprovalAcceptedStateMatches(
                run: acceptedSnapshot.runs.first(where: { $0.id == proposal.runId }),
                request: request
            ) else { throw IssueExecutionApprovalError.stateChanged }
            detail.updateExecutionProposal(response.proposal)
            actionError = nil
            await refresh()
            return true
        } catch {
            await detail.load()
            guard detail.executionProposalIsCurrent(context) else { return false }
            throw error
        }
    }

    @MainActor
    private func prepareSkillExecutionApproval(
        _ proposal: AgentSkillExecutionProposal
    ) async {
        guard preparingSkillExecutionProposalID == nil,
              skillExecutionApprovalPresentation == nil,
              preparingExecutionProposalID == nil,
              executionApprovalPresentation == nil,
              !proposalMutationInFlight,
              let context = detail.captureSkillExecutionProposal(proposalID: proposal.id)
        else { return }
        preparingSkillExecutionProposalID = proposal.id
        defer {
            if preparingSkillExecutionProposalID == proposal.id {
                preparingSkillExecutionProposalID = nil
            }
        }

        do {
            let snapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard detail.skillExecutionProposalIsCurrent(context) else { return }
            _ = try validateAgentSkillExecutionApproval(
                snapshot: snapshot,
                proposal: proposal
            )
            actionError = nil
            skillExecutionApprovalPresentation = SkillExecutionApprovalPresentation(
                proposal: proposal,
                snapshot: snapshot
            )
        } catch {
            guard detail.skillExecutionProposalIsCurrent(context) else { return }
            actionError = error.localizedDescription
        }
    }

    @MainActor
    private func approveSkillExecutionProposal(
        _ proposal: AgentSkillExecutionProposal,
        request: AcceptAgentSkillExecutionProposalRequest
    ) async throws -> Bool {
        guard let context = detail.captureSkillExecutionProposal(
            proposalID: proposal.id
        ) else { return false }

        do {
            let preflight: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard detail.skillExecutionProposalIsCurrent(context) else { return false }
            _ = try validateAgentSkillExecutionApproval(
                snapshot: preflight,
                proposal: proposal,
                request: request
            )
            let response = try await mutations.acceptAgentSkillExecutionProposal(
                conversationRunID: run.id,
                proposalID: proposal.id,
                request: request
            )
            guard detail.skillExecutionProposalIsCurrent(context) else { return false }
            guard agentSkillExecutionApprovalResponseMatches(
                response: response,
                expected: proposal,
                request: request
            ) else { throw MobileAPIError.invalidResponse }

            detail.updateSkillExecutionProposal(response.proposal)
            if let session = response.session {
                onSkillSessionMaterialized(session)
            }
            actionError = nil
            await refresh()
            return true
        } catch {
            await detail.load()
            guard detail.skillExecutionProposalIsCurrent(context) else { return false }
            throw error
        }
    }

    @ViewBuilder
    private var resultTabContent: some View {
        detailLoadingContent

        if let summary = run.structuredResult?.summary ?? run.resultSummary, !summary.isEmpty {
            Section(L10n.text("결과", locale: locale)) {
                MarkdownText(markdown: summary)
                if let result = run.structuredResult {
                    LabeledContent(L10n.text("결과 상태", locale: locale), value: result.outcome)
                    if let nextAction = result.nextAction, !nextAction.isEmpty {
                        LabeledContent(L10n.text("다음 조치", locale: locale), value: nextAction)
                    }
                }
            }
        }

        if let reviews = run.resultReviews, !reviews.isEmpty {
            Section(L10n.text("결과 리뷰", locale: locale)) {
                ForEach(reviews) { review in
                    HStack(spacing: 12) {
                        ProfileImageView(
                            image: review.image,
                            name: review.name,
                            systemImage: "checkmark.seal.fill",
                            size: 32
                        )
                        VStack(alignment: .leading) {
                            Text(review.name)
                            Text(L10n.dateTime(review.completedAt, locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                    }
                }
            }
        }

        if !detail.evidence.isEmpty {
            Section(L10n.text("증빙", locale: locale)) {
                ForEach(detail.evidence) { evidence in evidenceRow(evidence) }
            }
        }

        if resultIsEmpty, !detail.loading, detail.errorMessage == nil {
            Section { ContentUnavailableView(L10n.text("결과 없음", locale: locale), systemImage: "checkmark.seal") }
        }
    }

    private var resultIsEmpty: Bool {
        let summary = run.structuredResult?.summary ?? run.resultSummary
        return summary?.isEmpty != false &&
            run.resultReviews?.isEmpty != false &&
            detail.evidence.isEmpty
    }

    private func evidenceRow(_ evidence: RunEvidence) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                let passed = evidence.status == .passed
                Image(systemName: passed ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(passed ? Color.green : Color.secondary)
                Text(evidence.type).font(.headline)
                if !evidence.canonical { Text(L10n.text("이전 버전", locale: locale)).font(.caption2) }
            }
            if let evidenceDetail = evidence.detail, !evidenceDetail.isEmpty {
                Text(evidenceDetail).font(.subheadline)
            }
            ForEach(evidence.images ?? []) { image in
                if IssueAttachmentMedia.isImage(
                    contentType: image.contentType,
                    filename: image.filename
                ) {
                    AuthenticatedImagePreview(
                        sourceID: image.url,
                        filename: image.filename,
                        detail: ByteCountFormatter.string(
                            fromByteCount: Int64(image.byteSize),
                            countStyle: .file
                        ),
                        accessibilityID: "evidence-image-\(image.id.uuidString.lowercased())",
                        load: {
                            try await detail.download(
                                path: image.url,
                                filename: image.filename
                            )
                        },
                        open: { previewFile = PreviewFile(url: $0) }
                    )
                } else {
                    Button {
                        Task { await open(path: image.url, filename: image.filename) }
                    } label: {
                        Label(image.filename, systemImage: "doc")
                    }
                }
            }
            if let url = evidence.url {
                Link(L10n.text("연결된 결과 열기", locale: locale), destination: url)
            }
        }
    }

    @ViewBuilder
    private var logsTabContent: some View {
        detailLoadingContent
        if detail.events.isEmpty, !detail.loading, detail.errorMessage == nil {
            Section { ContentUnavailableView(L10n.text("로그 없음", locale: locale), systemImage: "text.alignleft") }
        } else if !detail.events.isEmpty {
            Section(L10n.text("실행 로그", locale: locale)) {
                ForEach(detail.events) { event in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            StatusBadge(status: event.status, reviewed: false)
                            if let stage = event.workflowStage { Text(stage).font(.caption) }
                            Spacer()
                            Text(L10n.relativeDate(event.occurredAt, locale: locale)).font(.caption)
                        }
                        if let eventDetail = event.detail, !eventDetail.isEmpty {
                            Text(eventDetail).font(.subheadline)
                        }
                        Text(event.actorName ?? event.actor).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var detailLoadingContent: some View {
        if detail.loading {
            Section { ProgressView(L10n.text("상세 기록을 불러오는 중…", locale: locale)) }
        }
        if let error = detail.errorMessage {
            Section {
                Label(error, systemImage: "wifi.exclamationmark").foregroundStyle(.orange)
                Button(L10n.text("상세 다시 시도", locale: locale)) { Task { await detail.load() } }
            }
        }
    }

    private var statusTabContent: some View {
        Section(L10n.text("현재 상태", locale: locale)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    StatusBadge(
                        status: localStatus,
                        reviewed: !(run.resultReviews ?? []).isEmpty
                    )
                    if let runNumber = run.runNumber {
                        Text(verbatim: "\(issueKeyPrefix)-\(runNumber)")
                    }
                    Spacer()
                    Text(L10n.relativeDate(run.updatedAt, locale: locale))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let detailText = run.detail, !detailText.isEmpty {
                    Text(detailText).foregroundStyle(.secondary)
                }
                if let progress = run.progress {
                    ProgressView(value: progress, total: 100)
                }
                LabeledContent(
                    L10n.text("담당자", locale: locale),
                    value: members.first { $0.userId == run.assigneeUserId }?.name
                        ?? L10n.text("미배정", locale: locale)
                )
                LabeledContent(
                    L10n.text("등록자", locale: locale),
                    value: members.first { $0.userId == run.createdByUserId }?.name
                        ?? L10n.text("알 수 없음", locale: locale)
                )
                LabeledContent(L10n.text("실행 Worker", locale: locale), value: assignedWorkerLabel)
            }
        }
    }

    private var assignedWorkerLabel: String {
        let workerID = run.workerId ?? run.requestedWorkerId
        guard let workerID else { return L10n.text("자동 배정") }
        if let worker = workers.first(where: { $0.id == workerID }) {
            return worker.label
        }
        return workerID
    }

    private var subscriberMembers: [OrganizationMember] {
        subscribers.compactMap { subscriber in
            members.first { $0.userId == subscriber.userId }
        }
    }

    private var isSubscribed: Bool {
        guard let currentUserID else { return false }
        return run.assigneeUserId == currentUserID ||
            subscribers.contains { $0.userId == currentUserID }
    }

    private var assigneeSubscriptionRequired: Bool {
        currentUserID != nil && run.assigneeUserId == currentUserID
    }

    private func toggleSubscription() async {
        guard currentUserID != nil else { return }
        do {
            let response = try await mutations.setSubscription(
                runID: run.id,
                subscribed: !isSubscribed
            )
            subscribers = response.subscribers
            actionError = nil
            await refresh()
        } catch {
            actionError = CompanionStore.message(for: error)
        }
    }

    private func open(path: String, filename: String) async {
        do {
            previewFile = PreviewFile(url: try await detail.download(path: path, filename: filename))
        } catch {
            previewError = CompanionStore.message(for: error)
        }
    }

    private var availablePlacements: [RunPlacement] {
        let statuses = DashboardRun.Status.allCases
            .filter { $0 != .running && $0 != .paused }
            .map { RunPlacement(status: $0, workflowStage: nil, label: $0.displayName) }
        var stages = (run.workflow?.stages ?? []).map {
            RunPlacement(status: .running, workflowStage: $0.id, label: $0.label)
        }
        if localStatus == .running,
           let localWorkflowStage,
           !stages.contains(where: { $0.workflowStage == localWorkflowStage }) {
            stages.insert(RunPlacement(
                status: .running,
                workflowStage: localWorkflowStage,
                label: localWorkflowStage
            ), at: 0)
        }
        return statuses + stages
    }

    private var placementBinding: Binding<RunPlacement> {
        Binding(
            get: {
                availablePlacements.first {
                    $0.status == localStatus && $0.workflowStage == localWorkflowStage
                } ?? RunPlacement(
                    status: localStatus,
                    workflowStage: localWorkflowStage,
                    label: localWorkflowStage ?? localStatus.displayName
                )
            },
            set: { placement in
                guard placement.status != localStatus ||
                        placement.workflowStage != localWorkflowStage else { return }
                Task { await move(to: placement.status, workflowStage: placement.workflowStage) }
            }
        )
    }

    private func move(to status: DashboardRun.Status, workflowStage: String?) async {
        do {
            try await mutations.move(
                runID: run.id,
                status: status,
                workflowStage: workflowStage
            )
            localStatus = status
            localWorkflowStage = workflowStage
            actionError = nil
            await refresh()
        } catch {
            actionError = CompanionStore.message(for: error)
        }
    }

    private func recover(action: String) async {
        do {
            try await mutations.recover(runID: run.id, action: action)
            localStatus = action == "retry" ? .queued : .cancelled
            localWorkflowStage = nil
            actionError = nil
            await refresh()
        } catch { actionError = error.localizedDescription }
    }

    private func resume(checkpoint: WorkflowCheckpoint) async {
        do {
            try await mutations.resume(runID: run.id, checkpoint: checkpoint)
            actionError = nil
            await refresh()
        } catch let error as MobileAPIError where error.statusCode == 409 {
            actionError = L10n.text("대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.", locale: locale)
            await refresh()
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Provider change clears model/effort (same cascade as web/Android) and saves immediately.
    private var providerSelection: Binding<AgentProvider?> {
        Binding(
            get: { preferences.provider },
            set: { newProvider in
                guard newProvider != preferences.provider else { return }
                let next = IssueExecutionPreferences(
                    provider: newProvider,
                    model: nil,
                    effort: nil
                )
                preferences = next
                Task { await savePreferences(next) }
            }
        )
    }

    /// Model change clears effort and saves immediately.
    private var modelSelection: Binding<String?> {
        Binding(
            get: { preferences.model },
            set: { newModel in
                guard let provider = preferences.provider else { return }
                guard newModel != preferences.model else { return }
                let next = IssueExecutionPreferences(
                    provider: provider,
                    model: newModel,
                    effort: nil
                )
                preferences = next
                Task { await savePreferences(next) }
            }
        )
    }

    /// Effort change saves immediately without altering provider/model.
    private var effortSelection: Binding<ModelEffort?> {
        Binding(
            get: { preferences.effort },
            set: { newEffort in
                guard let provider = preferences.provider, let model = preferences.model else {
                    return
                }
                guard newEffort != preferences.effort else { return }
                let next = IssueExecutionPreferences(
                    provider: provider,
                    model: model,
                    effort: newEffort
                )
                preferences = next
                Task { await savePreferences(next) }
            }
        )
    }

    private func savePreferences(_ next: IssueExecutionPreferences? = nil) async {
        let payload = next ?? preferences
        guard payload.isValid else { return }
        do {
            _ = try await mutations.savePreferences(runID: run.id, preferences: payload)
            actionError = nil
            await refresh()
        } catch IssueMutationError.duplicateAction {
            // Pickers are disabled while a save is active; ignore rare races.
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func completeReview() async {
        do {
            _ = try await mutations.completeReview(runID: run.id)
            reviewCompleted = true
            actionError = nil
            await refresh()
        } catch { actionError = error.localizedDescription }
    }

    private func acceptIssueProposal(_ proposal: IssueProposedAction) async {
        guard !proposalApprovalPresentationInFlight else { return }
        do {
            let accepted = try await mutations.acceptIssueProposal(
                runID: run.id,
                proposal: proposal
            )
            if let acceptedProposal = accepted.proposal {
                detail.updateIssueProposal(
                    acceptedProposal,
                    executionProposal: accepted.executionProposal
                )
            }
            actionError = nil
            await refresh()
            if accepted.requiresAuthoritativeReload ||
                (proposal.type == .create && proposal.executeAfterCreate == true) {
                await detail.load()
            }
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func sendMessage(
        body: String,
        mentions: [ChannelMentionTarget],
        attachments: [PendingIssueAttachment]
    ) async -> Bool {
        let mentionedUserIds = mentions.compactMap {
            $0.kind == .user ? $0.recipientId : nil
        }
        let mentionedAgentIds = mentions.compactMap {
            $0.kind == .agent ? $0.recipientId : nil
        }
        let clientMessageID = UUID()
        let attachmentReferences = attachments.map { _ in
            UUID().uuidString.lowercased()
        }
        let optimisticBody = (try? AttachmentMessagePayload(
            body: body.trimmingCharacters(in: .whitespacesAndNewlines),
            attachments: attachments,
            references: attachmentReferences
        ))?.body ?? body
        let currentMember = members.first { $0.userId == currentUserID }
        let createdAt = Date()
        detail.appendOptimisticMessage(IssueMessage(
            id: clientMessageID,
            runId: run.id,
            parentMessageId: replyTo?.id,
            body: optimisticBody,
            attachments: nil,
            author: IssueMessage.Author(
                id: currentUserID,
                name: currentMember?.name ?? L10n.text("나", locale: locale),
                image: currentMember?.image,
                provider: nil
            ),
            replyCount: 0,
            createdAt: createdAt,
            updatedAt: createdAt
        ))
        do {
            let sent = try await mutations.sendMessage(
                runID: run.id,
                body: body,
                clientMessageID: clientMessageID,
                parentMessageID: replyTo?.id,
                mentionedUserIds: mentionedUserIds,
                mentionedAgentIds: mentionedAgentIds,
                attachments: attachments,
                attachmentReferences: attachmentReferences,
                onCreated: { message in
                    detail.appendMessages([message])
                },
                onAgentReplyChanged: { reply in
                    detail.updateAgentReply(reply)
                }
            )
            detail.appendMessages(sent)
            replyTo = nil
            actionError = nil
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            if case IssueMutationError.agentReplyTimedOut = error {
                replyTo = nil
                await detail.load()
                await refresh()
                return true
            } else if case IssueMutationError.agentReplyPollingFailed = error {
                replyTo = nil
                await detail.load()
                await refresh()
                return true
            } else if case IssueMutationError.agentReplyFailed = error {
                replyTo = nil
                await detail.load()
                await refresh()
                return true
            }
            detail.removeOptimisticMessage(clientMessageID)
            return false
        }
    }

    private func conversationMessageText(_ body: String) -> String {
        body
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.contains("](briar-attachment://") }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func deleteIssue() async {
        do {
            try await mutations.deleteIssue(runID: run.id)
            actionError = nil
            await refresh()
            dismiss()
        } catch { actionError = error.localizedDescription }
    }

    private func transferIssue(to targetProjectID: UUID) async {
        do {
            _ = try await mutations.transferIssue(
                runID: run.id,
                targetProjectID: targetProjectID
            )
            actionError = nil
            await refresh()
            dismiss()
        } catch { actionError = error.localizedDescription }
    }

    private struct RunPlacement: Hashable, Identifiable {
        let status: DashboardRun.Status
        let workflowStage: String?
        let label: String

        var id: String { "\(status.rawValue):\(workflowStage ?? "none")" }
    }
}

private struct PreviewErrorAlertModifier: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.alert(
            L10n.text("미리보기를 열 수 없음"),
            isPresented: Binding(
                get: { message != nil },
                set: { if !$0 { message = nil } }
            )
        ) {
            Button(L10n.text("확인"), role: .cancel) { message = nil }
        } message: {
            Text(message ?? "")
        }
    }
}

struct DependencyPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedIDs: Set<UUID>
    @State private var query = ""
    @State private var addingID: UUID?
    @State private var errorMessage: String?

    let candidates: [DashboardRun]
    let issueKeyPrefix: String
    let onAdd: (UUID) async throws -> Void

    private var filteredCandidates: [DashboardRun] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidates.filter { candidate in
            guard !selectedIDs.contains(candidate.id) else { return false }
            guard !normalizedQuery.isEmpty else { return true }
            let searchableText = [
                candidate.title,
                candidate.detail ?? "",
                candidate.runNumber.map { "\(issueKeyPrefix)-\($0)" } ?? "",
                candidate.status.displayName,
            ].joined(separator: " ")
            return searchableText.localizedCaseInsensitiveContains(normalizedQuery)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }

                if filteredCandidates.isEmpty {
                    ContentUnavailableView(
                        L10n.text(query.isEmpty ? "추가할 수 있는 이슈가 없습니다." : "검색 결과 없음"),
                        systemImage: query.isEmpty ? "checklist" : "magnifyingglass",
                        description: query.isEmpty
                            ? Text(L10n.text("이미 추가했거나 추가할 수 없는 이슈만 남았습니다."))
                            : Text(L10n.text("다른 제목이나 이슈 번호로 검색해 보세요."))
                    )
                } else {
                    Section(L10n.text("선행 이슈 선택")) {
                        ForEach(filteredCandidates) { candidate in
                            Button {
                                Task { @MainActor in await add(candidate) }
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(candidate.title)
                                            .foregroundStyle(.primary)
                                        HStack(spacing: 6) {
                                            if let number = candidate.runNumber {
                                                Text(verbatim: "\(issueKeyPrefix)-\(number)")
                                            }
                                            Text(candidate.status.displayName)
                                        }
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    if addingID == candidate.id {
                                        ProgressView()
                                    } else {
                                        Image(systemName: "plus.circle.fill")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                            .buttonStyle(.borderless)
                            .disabled(addingID != nil)
                            .accessibilityLabel(L10n.format("%@ 의존성 추가", candidate.title))
                            .accessibilityIdentifier(
                                "dependency-option-\(candidate.id.uuidString.lowercased())"
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(L10n.text("의존성 추가"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: L10n.text("이슈 검색"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("닫기")) { dismiss() }
                        .accessibilityIdentifier("dependency-picker-close")
                }
            }
            .accessibilityIdentifier("dependency-picker")
        }
    }

    private func add(_ candidate: DashboardRun) async {
        guard addingID == nil else { return }
        addingID = candidate.id
        errorMessage = nil
        defer { addingID = nil }
        do {
            try await onAdd(candidate.id)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct MarkdownText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownDocument.parse(markdown).enumerated()), id: \.offset) { _, block in
                switch block {
                case let .heading(level, content):
                    inlineText(content, style: headingStyle(level))
                        .padding(.top, level == 1 ? 4 : 2)
                case let .paragraph(content):
                    inlineText(content)
                case let .unorderedList(items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: item.checked.map { $0 ? "checkmark.square.fill" : "square" } ?? "circle.fill")
                                    .font(.system(size: item.checked == nil ? 5 : 14))
                                    .foregroundStyle(item.checked == true ? Color.accentColor : Color.secondary)
                                    .frame(width: 16)
                                inlineText(item.content)
                            }
                        }
                    }
                    .padding(.leading, 2)
                case let .orderedList(items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(index + 1).")
                                    .foregroundStyle(.secondary)
                                    .frame(minWidth: 20, alignment: .trailing)
                                inlineText(item)
                            }
                        }
                    }
                    .padding(.leading, 2)
                case let .blockquote(content):
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color.secondary.opacity(0.45))
                            .frame(width: 3)
                        inlineText(content, style: .secondaryBody)
                    }
                case let .code(language, content):
                    VStack(alignment: .leading, spacing: 6) {
                        if let language, !language.isEmpty {
                            Text(language.uppercased())
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        ScrollView(.horizontal) {
                            Text(content)
                                .font(.system(.footnote, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                case .divider:
                    Divider()
                }
            }
        }
    }

    @ViewBuilder
    private func inlineText(
        _ value: String,
        style: SelectableTextStyle = .body
    ) -> some View {
        SelectableText(markdown: value, style: style)
    }

    private func headingStyle(_ level: Int) -> SelectableTextStyle {
        switch level {
        case 1: .title2Bold
        case 2: .title3Bold
        default: .headline
        }
    }
}

/// Renders issue description markdown and loads `briar-attachment://` images with auth.
struct IssueDescriptionView: View {
    let markdown: String
    let attachments: [IssueAttachment]
    let download: @MainActor (IssueAttachment) async throws -> URL
    let open: @MainActor (URL) -> Void

    var body: some View {
        let blocks = IdentifiedIssueDescriptionBlock.parse(markdown)
        if blocks.isEmpty {
            MarkdownText(markdown: markdown)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(blocks) { item in
                    switch item.block {
                    case let .markdown(text):
                        MarkdownText(markdown: text)
                    case let .attachment(reference, alt):
                        if let attachment = attachments.first(where: {
                            $0.id.uuidString.lowercased() == reference.lowercased()
                        }),
                        IssueAttachmentMedia.isImage(
                            contentType: attachment.contentType,
                            filename: attachment.filename
                        ) {
                            AuthenticatedImagePreview(
                                sourceID: attachment.url,
                                filename: alt.isEmpty ? attachment.filename : alt,
                                detail: ByteCountFormatter.string(
                                    fromByteCount: Int64(attachment.byteSize),
                                    countStyle: .file
                                ),
                                accessibilityID: "issue-inline-image-\(attachment.id.uuidString.lowercased())",
                                load: { try await download(attachment) },
                                open: open
                            )
                        } else {
                            Label {
                                Text(alt.isEmpty ? L10n.text("첨부 이미지") : alt)
                            } icon: {
                                Image(systemName: "photo.badge.exclamationmark")
                            }
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(
                                L10n.format(
                                    "%@ 이미지를 불러올 수 없음",
                                    alt.isEmpty ? L10n.text("첨부 이미지") : alt
                                )
                            )
                        }
                    }
                }
            }
        }
    }
}
