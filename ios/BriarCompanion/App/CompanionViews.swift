import SwiftUI

private enum BriarFeatureFlags {
    static let ideas: Bool = {
        let value = ProcessInfo.processInfo.environment["BRIAR_FEATURE_IDEAS"]
            ?? Bundle.main.object(forInfoDictionaryKey: "BriarFeatureIdeas") as? String
        let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized == "true" || normalized == "yes" || normalized == "1"
    }()
}

struct CompanionShellView: View {
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var showingSettings = false
    @State private var taskPath = NavigationPath()

    @ObservedObject var navigation: CompanionNavigationModel
    @ObservedObject var agents: AgentsStore
    @ObservedObject var inbox: InboxStore
    @ObservedObject var notifications: LocalNotificationService

    let projects: [ProjectsResponse.Project]
    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let ideas: IdeasStore
    let user: CurrentUserResponse.User?
    let refresh: () async -> Void
    let selectProject: (UUID) -> Void
    let signOut: () -> Void

    var body: some View {
        TabView(selection: $navigation.selectedTab) {
            NavigationStack(path: $taskPath) {
                TaskListView(
                    project: project,
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
                            token: token,
                            api: api,
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
                TaskSearchView(
                    project: project,
                    runs: snapshot?.runs ?? [],
                    members: snapshot?.members ?? [],
                    token: token,
                    api: api
                )
                .navigationTitle("Search")
                .toolbar { companionToolbar() }
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }
            .tag(CompanionNavigationModel.Tab.search)

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

            if BriarFeatureFlags.ideas {
                NavigationStack {
                    IdeasNativeView(store: ideas, projectID: project.id, token: token)
                        .navigationTitle("아이디어")
                        .toolbar { companionToolbar() }
                }
                .tabItem { Label("아이디어", systemImage: "lightbulb") }
                .tag(CompanionNavigationModel.Tab.ideas)
            }
        }
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
        .onChange(of: project.id) { _, _ in
            taskPath = NavigationPath()
        }
        .task(id: navigation.pathIssueToken) {
            if let runID = navigation.pendingIssueID {
                _ = navigation.consumePendingIssue()
                taskPath.append(runID)
            }
        }
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
    @StateObject private var mutations: IssueMutationStore

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    @MainActor
    init(
        project: ProjectsResponse.Project,
        snapshot: DashboardSnapshot?,
        isRefreshing: Bool,
        errorMessage: String?,
        token: String,
        api: any MobileAPIClientProtocol,
        refresh: @escaping () async -> Void
    ) {
        self.project = project
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
        (snapshot?.runs ?? []).filter(filter.includes)
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
                                    token: token,
                                    api: api,
                                    allRuns: snapshot?.runs ?? [],
                                    workers: snapshot?.workers ?? [],
                                    providers: snapshot?.organizationProviders ?? [],
                                    members: snapshot?.members ?? [],
                                    refresh: refresh
                                )
                            } label: {
                                RunRow(
                                    run: run,
                                    assignee: snapshot?.members?.first {
                                        $0.userId == run.assigneeUserId
                                    }
                                )
                            }
                            .accessibilityIdentifier("task-row-\(run.id.uuidString)")
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
                refresh: refresh
            )
        }
    }
}

struct RunRow: View {
    let run: DashboardRun
    let assignee: OrganizationMember?

    init(run: DashboardRun, assignee: OrganizationMember? = nil) {
        self.run = run
        self.assignee = assignee
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(run.title).font(.headline)
                Spacer(minLength: 8)
                StatusBadge(status: run.status)
            }
            if let detail = run.detail, !detail.isEmpty {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            HStack(spacing: 12) {
                if let runNumber = run.runNumber {
                    Text("#\(runNumber)")
                }
                if let workflowStage = run.workflowStage {
                    Text(workflowStage)
                }
                if let assignee { Label(assignee.name, systemImage: "person") }
                Text(run.updatedAt, style: .relative)
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

struct StatusBadge: View {
    let status: DashboardRun.Status

    var body: some View {
        Text(status.displayName)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
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

struct TaskSearchView: View {
    @State private var query = ""

    let project: ProjectsResponse.Project
    let runs: [DashboardRun]
    let members: [OrganizationMember]
    let token: String
    let api: any MobileAPIClientProtocol

    private var results: [DashboardRun] { TaskSearch.results(in: runs, query: query) }

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView(
                    "작업 검색",
                    systemImage: "magnifyingglass",
                    description: Text("제목, 설명, 진행 내용 또는 결과에서 검색합니다.")
                )
            } else if results.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                ForEach(results) { run in
                    NavigationLink {
                        RunDetailView(
                            run: run,
                            projectID: project.id,
                            token: token,
                            api: api,
                            members: members
                        )
                    } label: {
                        RunRow(
                            run: run,
                            assignee: members.first { $0.userId == run.assigneeUserId }
                        )
                    }
                    .accessibilityIdentifier("search-result-\(run.id.uuidString)")
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $query, prompt: "작업 검색")
        .accessibilityIdentifier("task-search-list")
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

struct RunDetailView: View {
    @Environment(\.dismiss) private var dismiss
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
    @State private var localStatus: DashboardRun.Status
    @State private var localWorkflowStage: String?
    @State private var dependencyIDs: Set<UUID>
    @State private var preferences: IssueExecutionPreferences
    @State private var messageText = ""
    @State private var replyTo: IssueMessage?
    @State private var reviewCompleted = false
    @State private var linkCopied = false

    private let projectID: UUID
    private let allRuns: [DashboardRun]
    private let workers: [DashboardWorker]
    private let providers: [AgentProvider]
    private let members: [OrganizationMember]
    private let refresh: () async -> Void

    @MainActor
    init(
        run: DashboardRun,
        projectID: UUID,
        token: String,
        api: any MobileAPIClientProtocol,
        allRuns: [DashboardRun] = [],
        workers: [DashboardWorker] = [],
        providers: [AgentProvider] = [],
        members: [OrganizationMember] = [],
        refresh: @escaping () async -> Void = {}
    ) {
        self.run = run
        self.projectID = projectID
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
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        StatusBadge(status: localStatus)
                        if let runNumber = run.runNumber { Text("#\(runNumber)") }
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
                }
            }

            if let description = run.issueDescription, !description.isEmpty {
                Section("설명") { MarkdownText(markdown: description) }
            }

            if localStatus == .paused, run.resumeRequestedAt != nil {
                Section("검토 대기") {
                    Label("일시정지 상태를 유지하며 워커를 재할당하고 있습니다.",
                          systemImage: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.secondary)
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }
            } else if localStatus == .paused, let checkpoint = run.checkpoint {
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
                        Image(systemName: "pause.circle.fill")
                            .foregroundStyle(.purple)
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

            if let attachments = run.attachments, !attachments.isEmpty {
                Section("첨부") {
                    ForEach(attachments) { attachment in
                        if attachment.contentType.hasPrefix("image/") {
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
                                        Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.byteSize), countStyle: .file))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "doc")
                                }
                            }
                        }
                    }
                }
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
                Section("의존성") {
                    let candidates = allRuns.filter {
                        $0.id != run.id && !($0.status == .cancelled)
                    }
                    if candidates.isEmpty {
                        Text("추가할 수 있는 선행 이슈가 없습니다.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(candidates) { candidate in
                            Toggle(isOn: dependencyBinding(candidate.id)) {
                                VStack(alignment: .leading) {
                                    Text(candidate.title)
                                    if let number = candidate.runNumber {
                                        Text("#\(number) · \(candidate.status.displayName)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if detail.loading && detail.events.isEmpty {
                Section { ProgressView("상세 기록을 불러오는 중…") }
            }

            if let error = detail.errorMessage {
                Section {
                    Label(error, systemImage: "wifi.exclamationmark")
                        .foregroundStyle(.orange)
                    Button("상세 다시 시도") { Task { await detail.load() } }
                }
            }

            if !detail.events.isEmpty {
                Section("이벤트") {
                    ForEach(detail.events) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                StatusBadge(status: event.status)
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

            if !detail.evidence.isEmpty {
                Section("증빙") {
                    ForEach(detail.evidence) { evidence in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Image(systemName: evidence.status == .passed ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(evidence.status == .passed ? Color.green : Color.secondary)
                                Text(evidence.type).font(.headline)
                                if !evidence.canonical { Text("이전 버전").font(.caption2) }
                            }
                            if let evidenceDetail = evidence.detail, !evidenceDetail.isEmpty {
                                Text(evidenceDetail).font(.subheadline)
                            }
                            ForEach(evidence.images ?? []) { image in
                                if image.contentType.hasPrefix("image/") {
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
                }
            }

            if !detail.messages.isEmpty {
                Section("메시지") {
                    ForEach(detail.messages) { message in
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
                                if let parent = detail.messages.first(where: {
                                    $0.id == message.parentMessageId
                                }) {
                                    HStack(alignment: .top, spacing: 6) {
                                        Image(systemName: "arrowshape.turn.up.left")
                                            .font(.caption2)
                                        Text(parent.body)
                                            .font(.caption)
                                            .lineLimit(2)
                                    }
                                    .foregroundStyle(.secondary)
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                                }
                                MarkdownText(markdown: message.body)
                                Button("답글") { replyTo = message }
                                    .font(.caption)
                            }
                        }
                    }
                }
            }

            Section(replyTo == nil ? "메시지 보내기" : "\(replyTo?.author.name ?? "")에게 답글") {
                TextField("메시지 또는 @Briar 질문", text: $messageText, axis: .vertical)
                    .lineLimit(2...6)
                    .accessibilityIdentifier("issue-message-field")
                HStack {
                    if replyTo != nil { Button("답글 취소") { replyTo = nil } }
                    Spacer()
                    Button("보내기") { Task { await sendMessage() } }
                        .disabled(
                            messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                mutations.isActive("message-\(run.id)")
                        )
                        .accessibilityIdentifier("issue-message-send")
                }
            }

            if let actionError {
                Section {
                    Label(actionError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
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
                        Label(linkCopied ? "링크 복사됨" : "링크 복사", systemImage: "doc.on.doc")
                    }
                    .accessibilityIdentifier("issue-copy-link")
                    Divider()
                    Button("수정") { showingEdit = true }
                    Button("삭제", role: .destructive) { confirmingDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityIdentifier("issue-actions-menu")
            }
        }
        .task { await detail.load() }
        .refreshable { await detail.load() }
        .onChange(of: run.status) { _, status in localStatus = status }
        .onChange(of: run.workflowStage) { _, stage in localWorkflowStage = stage }
        .onChange(of: run.prerequisites) { _, prerequisites in
            dependencyIDs = Set((prerequisites ?? []).map(\.id))
        }
        .sheet(item: $previewFile) { file in
            QuickLookPreview(fileURL: file.url)
                .ignoresSafeArea()
        }
        .alert("미리보기를 열 수 없음", isPresented: Binding(
            get: { previewError != nil },
            set: { if !$0 { previewError = nil } }
        )) {
            Button("확인", role: .cancel) { previewError = nil }
        } message: {
            Text(previewError ?? "")
        }
        .alert("이슈를 삭제할까요?", isPresented: $confirmingDelete) {
            Button("삭제", role: .destructive) { Task { await deleteIssue() } }
            Button("취소", role: .cancel) {}
        } message: {
            Text("활동 기록, 대화와 첨부가 영구적으로 삭제됩니다.")
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
        .accessibilityIdentifier("run-detail")
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
        } catch { actionError = error.localizedDescription }
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

    private func dependencyBinding(_ prerequisiteID: UUID) -> Binding<Bool> {
        Binding(
            get: { dependencyIDs.contains(prerequisiteID) },
            set: { enabled in
                Task {
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
                    } catch { actionError = error.localizedDescription }
                }
            }
        )
    }

    private func completeReview() async {
        do {
            _ = try await mutations.completeReview(runID: run.id)
            reviewCompleted = true
            actionError = nil
            await refresh()
        } catch { actionError = error.localizedDescription }
    }

    private func sendMessage() async {
        do {
            let sent = try await mutations.sendMessage(
                runID: run.id,
                body: messageText,
                parentMessageID: replyTo?.id
            )
            detail.appendMessages(sent)
            messageText = ""
            replyTo = nil
            actionError = nil
            await refresh()
        } catch {
            actionError = error.localizedDescription
            if case IssueMutationError.agentReplyTimedOut = error {
                messageText = ""
                replyTo = nil
                await detail.load()
                await refresh()
            } else if case IssueMutationError.agentReplyPollingFailed = error {
                messageText = ""
                replyTo = nil
                await detail.load()
                await refresh()
            } else if case IssueMutationError.agentReplyFailed = error {
                messageText = ""
                replyTo = nil
                await detail.load()
                await refresh()
            }
        }
    }

    private func deleteIssue() async {
        do {
            try await mutations.deleteIssue(runID: run.id)
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

struct MarkdownText: View {
    let markdown: String

    var body: some View {
        if let attributed = try? AttributedString(
            markdown: markdown,
            options: .init(interpretedSyntax: .full)
        ) {
            Text(attributed)
                .textSelection(.enabled)
        } else {
            Text(markdown).textSelection(.enabled)
        }
    }
}
