import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct CompanionShellView: View {
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var showingSettings = false
    @State private var taskPath = NavigationPath()
    @State private var homePath = NavigationPath()

    @ObservedObject var navigation: CompanionNavigationModel
    @ObservedObject var agents: AgentsStore
    @ObservedObject var inbox: InboxStore
    @ObservedObject var notifications: LocalNotificationService
    @ObservedObject var channels: ChannelsStore

    let projects: [ProjectsResponse.Project]
    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let user: CurrentUserResponse.User?
    let refresh: () async -> Void
    let selectProject: (UUID) -> Void
    let signOut: () -> Void

    private var companionLocale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        TabView(selection: $navigation.selectedTab) {
            NavigationStack(path: $homePath) {
                ChannelsHomeView(
                    channels: channels,
                    activeProjectID: project.id,
                    currentUserID: user?.id,
                    projects: projects,
                    onIssueOpen: { projectID, runID in
                        navigation.open(.issue(projectID: projectID, runID: runID))
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
                    snapshot: snapshot,
                    isRefreshing: isRefreshing,
                    errorMessage: errorMessage,
                    token: token,
                    api: api,
                    refresh: refresh
                )
                .id(project.id)
                .navigationTitle("Tasks")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { companionToolbar(showsProjectMenu: true) }
                .navigationDestination(for: UUID.self) { runID in
                    if let run = snapshot?.runs.first(where: { $0.id == runID }) {
                        RunDetailView(
                            run: run,
                            projectID: project.id,
                            issueKeyPrefix: project.effectiveIssueKeyPrefix,
                            token: token,
                            api: api,
                            projects: projects,
                            allRuns: snapshot?.runs ?? [],
                            workers: snapshot?.workers ?? [],
                            providers: snapshot?.organizationProviders ?? [],
                            members: snapshot?.members ?? [],
                            refresh: refresh
                        )
                    } else {
                        ContentUnavailableView("이슈를 찾을 수 없음", systemImage: "checklist")
                    }
                }
            }
            .tabItem { Label("Tasks", systemImage: "checklist") }
            .tag(CompanionNavigationModel.Tab.tasks)

            AgentsHomeView(
                agents: agents,
                navigation: navigation,
                project: project,
                token: token,
                api: api,
                snapshot: snapshot,
                refreshDashboard: refresh
            )
            .toolbar { companionToolbar() }
            .tabItem { Label("Agents", systemImage: "cpu") }
            .tag(CompanionNavigationModel.Tab.agents)
            .badge(agents.sessions.filter { $0.status == .running }.count)

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
            .tabItem { Label("Inbox", systemImage: "tray") }
            .tag(CompanionNavigationModel.Tab.inbox)
            .badge(inbox.unreadCount)

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
        .onChange(of: navigation.pathIssueToken) { _, _ in
            if let runID = navigation.consumePendingIssue() {
                taskPath.append(runID)
            }
        }
        .onChange(of: navigation.pathChannelToken) { _, _ in
            Task { await openPendingChannel() }
        }
        .onChange(of: project.id) { _, _ in
            taskPath = NavigationPath()
        }
        .task(id: navigation.pathIssueToken) {
            if let runID = navigation.pendingIssueID {
                _ = navigation.consumePendingIssue()
                taskPath.append(runID)
            }
        }
        .task(id: navigation.pathChannelToken) {
            await openPendingChannel()
        }
    }

    @MainActor
    private func openPendingChannel() async {
        guard let target = navigation.consumePendingChannel() else { return }
        if !channels.channels.contains(where: { $0.id == target.channelID }) {
            await channels.refresh()
        }
        guard let channel = channels.channels.first(where: { $0.id == target.channelID }) else {
            return
        }
        homePath = NavigationPath()
        homePath.append(channel)
        await channels.openChannel(target.channelID)
        guard let root = channels.messages.first(where: { $0.id == target.rootMessageID }) else {
            return
        }
        homePath.append(root)
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
                    HStack(spacing: 4) {
                        Text(project.name)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityLabel("프로젝트, \(project.name)")
                .accessibilityIdentifier("project-menu")
            }
        } else {
            ToolbarItem(placement: .automatic) {
                Text(project.name).font(.subheadline.weight(.semibold))
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("설정") { showingSettings = true }
                Divider()
                Button("로그아웃", role: .destructive, action: signOut)
            } label: {
                ProfileImageView(
                    image: user?.image,
                    name: user?.name,
                    systemImage: "person.fill",
                    size: 28
                )
            }
            .accessibilityLabel("계정 메뉴")
            .accessibilityIdentifier("account-menu")
        }
    }
}

struct TaskListView: View {
    @State private var filter = TaskFilter.all
    @State private var showingCreateIssue = false
    @State private var dispatchRun: DashboardRun?
    @StateObject private var mutations: IssueMutationStore

    let project: ProjectsResponse.Project
    let projects: [ProjectsResponse.Project]
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    @MainActor
    init(
        project: ProjectsResponse.Project,
        projects: [ProjectsResponse.Project] = [],
        snapshot: DashboardSnapshot?,
        isRefreshing: Bool,
        errorMessage: String?,
        token: String,
        api: any MobileAPIClientProtocol,
        refresh: @escaping () async -> Void
    ) {
        self.project = project
        self.projects = projects
        self.snapshot = snapshot
        self.isRefreshing = isRefreshing
        self.errorMessage = errorMessage
        self.token = token
        self.api = api
        self.refresh = refresh
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
            Picker("작업 필터", selection: $filter) {
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
                            ProgressView("작업을 불러오는 중…")
                            Spacer()
                        }
                    } else if runs.isEmpty {
                        ContentUnavailableView(
                            filter == .all ? "작업 없음" : "필터 결과 없음",
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
                                    workers: snapshot?.workers ?? [],
                                    providers: snapshot?.organizationProviders ?? [],
                                    members: snapshot?.members ?? [],
                                    refresh: refresh
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
                                        Label("바로 처리", systemImage: "play.fill")
                                    }
                                    .tint(.blue)
                                    .disabled((run.waitingOnPrerequisiteCount ?? 0) > 0)
                                    .accessibilityLabel("\(run.title) 바로 처리")
                                    .accessibilityIdentifier(
                                        "task-process-now-\(run.id.uuidString.lowercased())"
                                    )
                                }
                            }
                        }
                    }
                    if let generatedAt = snapshot?.generatedAt {
                        Section {
                            Text("마지막 동기화 \(generatedAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("dashboard-synced-at")
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await refresh() }
                .overlay(alignment: .top) {
                    if isRefreshing { ProgressView().padding(.top, 6) }
                }
                .accessibilityIdentifier("task-list")
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showingCreateIssue = true } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("새 이슈")
                .accessibilityIdentifier("create-issue-button")
            }
        }
        .sheet(isPresented: $showingCreateIssue) {
            CreateIssueSheet(
                mutations: mutations,
                members: snapshot?.members ?? [],
                providers: snapshot?.organizationProviders ?? [],
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
            if let assignee {
                ProfileImageView(
                    image: assignee.image,
                    name: assignee.name,
                    size: 20
                )
                .accessibilityLabel("담당자 \(assignee.name)")
            }
            if let workerLabel {
                RunWorkerIconView(worker: worker, label: workerLabel)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var updatedMetadata: some View {
        Text(run.updatedAt, style: .relative)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
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
        .accessibilityLabel("실행 Worker \(label)")
        .help(label)
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
                ? "\(status.displayName) · 검수 완료됨"
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
            Label("오프라인", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("다시 시도") { Task { await refresh() } }
                .accessibilityIdentifier("dashboard-retry-button")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("offline-state")
    }
}

private enum RunDetailTab: String, CaseIterable, Identifiable {
    case issue
    case control
    case conversation
    case result
    case logs
    case status

    var id: String { rawValue }

    var title: String {
        switch self {
        case .issue: "이슈"
        case .control: "제어"
        case .conversation: "대화"
        case .result: "결과"
        case .logs: "로그"
        case .status: "상태"
        }
    }
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
    @State private var transferTargetProjectID: UUID?
    @State private var localStatus: DashboardRun.Status
    @State private var localWorkflowStage: String?
    @State private var dependencyIDs: Set<UUID>
    @State private var preferences: IssueExecutionPreferences
    @State private var messageText = ""
    @State private var messageAttachments: [PendingIssueAttachment] = []
    @State private var selectedMessagePhotos: [PhotosPickerItem] = []
    @State private var isLoadingMessagePhotos = false
    @State private var replyTo: IssueMessage?
    @State private var reviewCompleted = false
    @State private var linkCopied = false
    @State private var selectedTab: RunDetailTab

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    private let projectID: UUID
    private let issueKeyPrefix: String
    private let projects: [ProjectsResponse.Project]
    private let allRuns: [DashboardRun]
    private let workers: [DashboardWorker]
    private let providers: [AgentProvider]
    private let members: [OrganizationMember]
    private let refresh: () async -> Void

    private var transferDestinations: [ProjectsResponse.Project] {
        let currentOrganization = projects.first(where: { $0.id == projectID })?.organizationId
        return projects.filter { project in
            project.id != projectID &&
                (currentOrganization == nil || project.organizationId == currentOrganization)
        }
    }

    @MainActor
    init(
        run: DashboardRun,
        projectID: UUID,
        issueKeyPrefix: String = "AH",
        token: String,
        api: any MobileAPIClientProtocol,
        projects: [ProjectsResponse.Project] = [],
        allRuns: [DashboardRun] = [],
        workers: [DashboardWorker] = [],
        providers: [AgentProvider] = [],
        members: [OrganizationMember] = [],
        refresh: @escaping () async -> Void = {}
    ) {
        self.run = run
        self.projectID = projectID
        self.issueKeyPrefix = issueKeyPrefix
        self.projects = projects
        self.allRuns = allRuns
        self.workers = workers
        self.providers = providers
        self.members = members
        self.refresh = refresh
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
        _transferTargetProjectID = State(initialValue: projects.first(where: {
            $0.id != projectID &&
                (projects.first(where: { $0.id == projectID })?.organizationId == nil ||
                    $0.organizationId == projects.first(where: { $0.id == projectID })?.organizationId)
        })?.id)
        // Match shared React RunPage: completed/paused open on Result.
        _selectedTab = State(
            initialValue: run.status.prefersResultDetailTab ? .result : .issue
        )
    }

    var body: some View {
        lifecycleContent
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
                .ignoresSafeArea()
        }
        .modifier(PreviewErrorAlertModifier(message: $previewError))
        .alert("이슈를 삭제할까요?", isPresented: $confirmingDelete) {
            Button("삭제", role: .destructive) { Task { await deleteIssue() } }
            Button("취소", role: .cancel) {}
        } message: {
            Text("활동 기록, 대화와 첨부가 영구적으로 삭제됩니다.")
        }
        .confirmationDialog(
            "다른 프로젝트로 이동",
            isPresented: $showingTransfer,
            titleVisibility: .visible
        ) {
            ForEach(transferDestinations, id: \.id) { project in
                Button(project.name) {
                    transferTargetProjectID = project.id
                    Task { await transferIssue(to: project.id) }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("선택한 프로젝트로 이슈와 대화·첨부·활동 기록이 함께 이동합니다. 의존성은 해제됩니다.")
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
        .accessibilityIdentifier("run-detail")
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
                            Label("이슈 공유", systemImage: "square.and.arrow.up")
                        }
                        Button {
                            ClipboardService.copy(shareURL.absoluteString)
                            linkCopied = true
                        } label: {
                            Label(L10n.text(.copyLink, locale: locale), systemImage: "doc.on.doc")
                        }
                        .accessibilityIdentifier("issue-copy-link")
                        Divider()
                        Button("수정") { showingEdit = true }
                        if !transferDestinations.isEmpty {
                            Button("다른 프로젝트로 이동") {
                                transferTargetProjectID = transferDestinations.first?.id
                                showingTransfer = true
                            }
                        }
                        Button("삭제", role: .destructive) { confirmingDelete = true }
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
                await detail.load()
            }
            .refreshable { await detail.load() }
            .onChange(of: inbox.messages) { _, _ in
                inbox.markIssueRead(runID: run.id)
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
    }

    private var detailContent: some View {
        VStack(spacing: 0) {
            Picker("이슈 상세 탭", selection: $selectedTab) {
                ForEach(RunDetailTab.allCases) { tab in
                    Text(tab.title)
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

            List { selectedTabContent }
            .accessibilityIdentifier("run-detail-\(selectedTab.rawValue)-panel")
        }
    }

    @ViewBuilder
    private var selectedTabContent: some View {
        switch selectedTab {
        case .issue: issueTabContent
        case .control: controlTabContent
        case .conversation: conversationTabContent
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

        if let description = run.issueDescription, !description.isEmpty {
            Section("설명") {
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
            Section("첨부") {
                ForEach(remainingAttachments) { attachment in
                    attachmentRow(attachment)
                }
            }
        }

        if run.issueDescription?.isEmpty != false, attachments.isEmpty {
            Section { ContentUnavailableView("이슈 내용 없음", systemImage: "doc.text") }
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
            Section("검토 대기") {
                Label("일시정지 상태를 유지하며 워커를 재할당하고 있습니다.",
                      systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(.secondary)
                ProgressView().frame(maxWidth: .infinity)
            }
        } else if localStatus == .paused, let checkpoint = run.checkpoint {
            checkpointControl(checkpoint)
        }

        Section("실행 제어") {
            Picker("상태 이동", selection: placementBinding) {
                ForEach(availablePlacements) { placement in
                    Text(placement.label).tag(placement)
                }
            }
            .disabled(mutations.isActive("move-\(run.id)"))
            .accessibilityIdentifier("run-status-picker")

            if localStatus == .backlog || localStatus == .queued {
                Button("바로 처리") {
                    reassigning = false
                    showingDispatch = true
                }
                .disabled((run.waitingOnPrerequisiteCount ?? 0) > 0)
                .accessibilityIdentifier("process-now-button")
            }
            if localStatus == .running {
                Button("Worker 다시 배정") {
                    reassigning = true
                    showingDispatch = true
                }
            }
            if localStatus == .blocked || localStatus == .failed {
                Button("재시도") { Task { await recover(action: "retry") } }
                    .accessibilityIdentifier("retry-run-button")
            }
            if localStatus != .completed && localStatus != .cancelled {
                Button("실행 취소", role: .destructive) {
                    Task { await recover(action: "cancel") }
                }
                .accessibilityIdentifier("cancel-run-button")
            }
            if localStatus == .completed && !reviewCompleted {
                Button("결과 검수 완료") { Task { await completeReview() } }
                    .accessibilityIdentifier("complete-review-button")
            } else if reviewCompleted {
                Label("결과 검수 완료", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
            }
        }

        Section("실행 설정") {
            Picker("프로바이더", selection: providerSelection) {
                Text("기본값").tag(AgentProvider?.none)
                ForEach(providers.isEmpty ? AgentProvider.allCases : providers) {
                    Text($0.displayName).tag(AgentProvider?.some($0))
                }
            }
            .disabled(mutations.isActive("preferences-\(run.id)"))
            .accessibilityIdentifier("execution-provider-picker")
            Picker("모델", selection: modelSelection) {
                Text("기본값").tag(String?.none)
                ForEach(preferences.provider?.models ?? [], id: \.self) {
                    Text($0).tag(String?.some($0))
                }
            }
            .disabled(
                preferences.provider == nil ||
                    mutations.isActive("preferences-\(run.id)")
            )
            .accessibilityIdentifier("execution-model-picker")
            Picker("Effort", selection: effortSelection) {
                Text("기본값").tag(ModelEffort?.none)
                ForEach(preferences.provider?.efforts ?? []) {
                    Text($0.rawValue).tag(ModelEffort?.some($0))
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
        Section("검토 대기") {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(checkpoint.position == .before
                         ? "\(checkpoint.stageLabel) 시작 전 확인"
                         : "\(checkpoint.stageLabel) 완료 후 확인")
                        .font(.headline)
                    Text("리비전 \(checkpoint.revision)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(checkpoint.terminalReviewOnly
                         ? "마지막 단계를 반복하지 않고 최종 검토 후 완료합니다."
                         : "재개 후 \(checkpoint.nextStageLabel ?? checkpoint.nextStage ?? checkpoint.stageLabel)부터 자동 진행합니다.")
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
                    Label("자동화 재개", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(mutations.isActive("resume-\(run.id)"))
            .accessibilityLabel("\(checkpoint.stageLabel) 체크포인트 승인 후 자동화 재개")
            .accessibilityIdentifier("resume-run-button")
        }
    }

    @ViewBuilder
    private var dependenciesControl: some View {
        Section("의존성") {
            if selectedDependencyReferences.isEmpty {
                Text("선행 이슈가 없습니다.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(selectedDependencyReferences) { dependency in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(dependency.title)
                            Text(verbatim: "\(issueKeyPrefix)-\(dependency.runNumber) · \(dependency.status.displayName)")
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
                        .accessibilityLabel("\(dependency.title) 의존성 제거")
                        .accessibilityIdentifier(
                            "remove-dependency-\(dependency.id.uuidString.lowercased())"
                        )
                    }
                }
            }

            Button {
                showingDependencyPicker = true
            } label: {
                Label("의존성 추가", systemImage: "plus.circle")
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

    @ViewBuilder
    private var conversationTabContent: some View {
        detailLoadingContent

        if detail.messages.isEmpty, !detail.loading, detail.errorMessage == nil {
            Section {
                ContentUnavailableView("대화 없음", systemImage: "bubble.left.and.bubble.right")
            }
        } else if !detail.messages.isEmpty {
            Section("대화") {
                ForEach(detail.messages) { message in messageRow(message) }
            }
        }

        Section(replyTo == nil ? "메시지 보내기" : "\(replyTo?.author.name ?? "")에게 답글") {
            TextField("메시지 또는 @Briar 질문", text: $messageText, axis: .vertical)
                .lineLimit(2...6)
                .accessibilityIdentifier("issue-message-field")
            ForEach(messageAttachments) { attachment in
                HStack {
                    if let image = UIImage(data: attachment.data) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    Text(attachment.filename).lineLimit(1)
                    Spacer()
                    Button(role: .destructive) {
                        messageAttachments.removeAll { $0.id == attachment.id }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack {
                if replyTo != nil { Button("답글 취소") { replyTo = nil } }
                PhotosPicker(
                    selection: $selectedMessagePhotos,
                    maxSelectionCount: max(
                        1,
                        PendingIssueAttachment.maximumCount - messageAttachments.count
                    ),
                    matching: .images,
                    preferredItemEncoding: .compatible
                ) {
                    Label("갤러리", systemImage: "photo.on.rectangle")
                }
                .disabled(
                    isLoadingMessagePhotos ||
                        messageAttachments.count >= PendingIssueAttachment.maximumCount
                )
                Button {
                    pasteMessageImage()
                } label: {
                    Label("붙여넣기", systemImage: "doc.on.clipboard")
                }
                Spacer()
                Button("보내기") { Task { await sendMessage() } }
                    .disabled(
                        (messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                            messageAttachments.isEmpty) ||
                            mutations.isActive("message-\(run.id)")
                    )
                    .accessibilityIdentifier("issue-message-send")
            }
        }
        .onChange(of: selectedMessagePhotos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importMessagePhotos(items) }
        }
    }

    private func messageRow(_ message: IssueMessage) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ProfileImageView(
                image: message.author.image,
                name: message.author.name,
                systemImage: message.author.provider == nil ? "person.fill" : "cpu",
                size: 34,
                cornerRadius: 9
            )
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(message.author.name).font(.headline)
                    Spacer()
                    Text(message.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let parent = detail.messages.first(where: { $0.id == message.parentMessageId }) {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "arrowshape.turn.up.left").font(.caption2)
                        Text(conversationMessageText(parent.body)).font(.caption).lineLimit(2)
                    }
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                }
                let visibleBody = conversationMessageText(message.body)
                if !visibleBody.isEmpty {
                    MarkdownText(markdown: visibleBody)
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
                            proposal.type == .rework ? "Briar 재작업 제안" :
                                proposal.type == .update ? "현재 이슈 수정 제안" : "새 이슈 생성 제안"
                        )
                            .font(.subheadline.weight(.semibold))
                        if proposal.type == .rework {
                            Text("\(proposal.workflowStage ?? "")부터 개정")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(proposal.reason ?? "")
                                .font(.subheadline)
                        } else if proposal.type == .update {
                            if proposal.changedFields?.contains("title") == true {
                                LabeledContent("제목", value: proposal.changes?.title ?? "")
                            }
                            if proposal.changedFields?.contains("description") == true {
                                LabeledContent("설명", value: proposal.changes?.description ?? "설정 안 함")
                            }
                            if proposal.changedFields?.contains("priority") == true {
                                LabeledContent(
                                    "우선순위",
                                    value: proposal.changes?.priority.map { "P\($0)" } ?? "설정 안 함"
                                )
                            }
                        } else if let issue = proposal.issue {
                            Text(issue.title).font(.subheadline.weight(.semibold))
                            if let description = issue.description, !description.isEmpty {
                                Text(description).font(.subheadline)
                            }
                            Text("\(issue.priority.map { "P\($0)" } ?? "우선순위 없음") · \(issue.status)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if proposal.status == .accepted {
                            Label(
                                proposal.type == .rework
                                    ? "리비전 \(proposal.appliedRevision.map(String.init) ?? "") 개정이 시작되었습니다."
                                    : proposal.type == .update
                                        ? "이슈 내용이 수정되었습니다."
                                        : "새 이슈가 생성되었습니다.",
                                systemImage: "checkmark.seal.fill"
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tint)
                        } else {
                            Button {
                                Task { await acceptIssueProposal(proposal) }
                            } label: {
                                if mutations.isActive("issue-proposal-\(proposal.id)") {
                                    ProgressView()
                                } else {
                                    Label(
                                        proposal.type == .rework ? "수락하고 개정 시작" :
                                            proposal.type == .update ? "수락하고 이슈 수정" : "수락하고 이슈 만들기",
                                        systemImage: "play.fill"
                                    )
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(mutations.isActive("issue-proposal-\(proposal.id)"))
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
                Button("답글") { replyTo = message }.font(.caption)
            }
        }
    }

    @ViewBuilder
    private var resultTabContent: some View {
        detailLoadingContent

        if let summary = run.structuredResult?.summary ?? run.resultSummary, !summary.isEmpty {
            Section("결과") {
                MarkdownText(markdown: summary)
                if let result = run.structuredResult {
                    LabeledContent("결과 상태", value: result.outcome)
                    if let nextAction = result.nextAction, !nextAction.isEmpty {
                        LabeledContent("다음 조치", value: nextAction)
                    }
                }
            }
        }

        if let reviews = run.resultReviews, !reviews.isEmpty {
            Section("결과 리뷰") {
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
                            Text(review.completedAt, format: .dateTime)
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
            Section("증빙") {
                ForEach(detail.evidence) { evidence in evidenceRow(evidence) }
            }
        }

        if resultIsEmpty, !detail.loading, detail.errorMessage == nil {
            Section { ContentUnavailableView("결과 없음", systemImage: "checkmark.seal") }
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
                if !evidence.canonical { Text("이전 버전").font(.caption2) }
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
                Link("연결된 결과 열기", destination: url)
            }
        }
    }

    @ViewBuilder
    private var logsTabContent: some View {
        detailLoadingContent
        if detail.events.isEmpty, !detail.loading, detail.errorMessage == nil {
            Section { ContentUnavailableView("로그 없음", systemImage: "text.alignleft") }
        } else if !detail.events.isEmpty {
            Section("실행 로그") {
                ForEach(detail.events) { event in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            StatusBadge(status: event.status, reviewed: false)
                            if let stage = event.workflowStage { Text(stage).font(.caption) }
                            Spacer()
                            Text(event.occurredAt, style: .relative).font(.caption)
                        }
                        if let eventDetail = event.detail, !eventDetail.isEmpty {
                            Text(eventDetail).font(.subheadline)
                        }
                        Text(event.actor).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var detailLoadingContent: some View {
        if detail.loading {
            Section { ProgressView("상세 기록을 불러오는 중…") }
        }
        if let error = detail.errorMessage {
            Section {
                Label(error, systemImage: "wifi.exclamationmark").foregroundStyle(.orange)
                Button("상세 다시 시도") { Task { await detail.load() } }
            }
        }
    }

    private var statusTabContent: some View {
        Section("현재 상태") {
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
                    Text(run.updatedAt, style: .relative)
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
                    "담당자",
                    value: members.first { $0.userId == run.assigneeUserId }?.name ?? "미배정"
                )
                LabeledContent("실행 Worker", value: assignedWorkerLabel)
            }
        }
    }

    private var assignedWorkerLabel: String {
        let workerID = run.workerId ?? run.requestedWorkerId
        guard let workerID else { return "자동 배정" }
        if let worker = workers.first(where: { $0.id == workerID }) {
            return worker.label
        }
        return workerID
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
            actionError = "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다."
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
        do {
            let accepted = try await mutations.acceptIssueProposal(
                runID: run.id,
                proposal: proposal
            )
            detail.updateIssueProposal(accepted)
            actionError = nil
            await refresh()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func sendMessage() async {
        do {
            let sent = try await mutations.sendMessage(
                runID: run.id,
                body: messageText,
                parentMessageID: replyTo?.id,
                attachments: messageAttachments
            )
            detail.appendMessages(sent)
            messageText = ""
            messageAttachments = []
            replyTo = nil
            actionError = nil
            await refresh()
        } catch {
            actionError = error.localizedDescription
            if case IssueMutationError.agentReplyTimedOut = error {
                messageText = ""
                messageAttachments = []
                replyTo = nil
                await detail.load()
                await refresh()
            } else if case IssueMutationError.agentReplyPollingFailed = error {
                messageText = ""
                messageAttachments = []
                replyTo = nil
                await detail.load()
                await refresh()
            } else if case IssueMutationError.agentReplyFailed = error {
                messageText = ""
                messageAttachments = []
                replyTo = nil
                await detail.load()
                await refresh()
            }
        }
    }

    @MainActor
    private func importMessagePhotos(_ items: [PhotosPickerItem]) async {
        isLoadingMessagePhotos = true
        defer {
            isLoadingMessagePhotos = false
            selectedMessagePhotos = []
        }
        do {
            var loaded = messageAttachments
            for item in items.prefix(PendingIssueAttachment.maximumCount - loaded.count) {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw IssueMutationError.attachment("사진 앱에서 이미지를 읽지 못했습니다.")
                }
                let supportedType = item.supportedContentTypes.first { type in
                    guard type.conforms(to: .image),
                          let mimeType = type.preferredMIMEType else { return false }
                    return PendingIssueAttachment.allowedContentTypes.contains(mimeType)
                }
                if let supportedType,
                   let mimeType = supportedType.preferredMIMEType,
                   mimeType.hasPrefix("image/") {
                    loaded.append(PendingIssueAttachment(
                        filename: "image-\(UUID().uuidString).\(supportedType.preferredFilenameExtension ?? "bin")",
                        contentType: mimeType,
                        data: data
                    ))
                } else if let jpegData = UIImage(data: data)?.jpegData(compressionQuality: 0.9) {
                    loaded.append(PendingIssueAttachment(
                        filename: "image-\(UUID().uuidString).jpg",
                        contentType: "image/jpeg",
                        data: jpegData
                    ))
                } else {
                    throw IssueMutationError.attachment("선택한 이미지 형식을 첨부할 수 없습니다.")
                }
            }
            if let message = PendingIssueAttachment.validationMessage(for: loaded) {
                throw IssueMutationError.attachment(message)
            }
            messageAttachments = loaded
            actionError = nil
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func pasteMessageImage() {
        guard let image = UIPasteboard.general.image,
              let data = image.pngData() else {
            actionError = "클립보드에 붙여넣을 수 있는 이미지가 없습니다."
            return
        }
        let next = messageAttachments + [PendingIssueAttachment(
            filename: "pasted-image-\(UUID().uuidString).png",
            contentType: "image/png",
            data: data
        )]
        if let message = PendingIssueAttachment.validationMessage(for: next) {
            actionError = message
            return
        }
        messageAttachments = next
        actionError = nil
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
            "미리보기를 열 수 없음",
            isPresented: Binding(
                get: { message != nil },
                set: { if !$0 { message = nil } }
            )
        ) {
            Button("확인", role: .cancel) { message = nil }
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
                        query.isEmpty ? "추가할 수 있는 이슈가 없습니다." : "검색 결과 없음",
                        systemImage: query.isEmpty ? "checklist" : "magnifyingglass",
                        description: query.isEmpty
                            ? Text("이미 추가했거나 추가할 수 없는 이슈만 남았습니다.")
                            : Text("다른 제목이나 이슈 번호로 검색해 보세요.")
                    )
                } else {
                    Section("선행 이슈 선택") {
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
                            .accessibilityLabel("\(candidate.title) 의존성 추가")
                            .accessibilityIdentifier(
                                "dependency-option-\(candidate.id.uuidString.lowercased())"
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("의존성 추가")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "이슈 검색")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
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
                    inlineText(content)
                        .font(headingFont(level))
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
                        inlineText(content).foregroundStyle(.secondary)
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
        .textSelection(.enabled)
    }

    private func inlineText(_ value: String) -> Text {
        guard let attributed = try? AttributedString(
            markdown: value,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) else { return Text(value) }
        return Text(attributed)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.bold()
        case 2: .title3.bold()
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
                                Text(alt.isEmpty ? "첨부 이미지" : alt)
                            } icon: {
                                Image(systemName: "photo.badge.exclamationmark")
                            }
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("\(alt.isEmpty ? "첨부 이미지" : alt) 이미지를 불러올 수 없음")
                        }
                    }
                }
            }
        }
    }
}
