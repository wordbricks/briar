import SwiftUI

struct CompanionShellView: View {
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @State private var selectedTab = Tab.tasks
    @State private var showingSettings = false

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let ideas: IdeasStore
    let refresh: () async -> Void
    let changeProject: () -> Void
    let signOut: () -> Void

    enum Tab: Hashable {
        case tasks
        case agents
        case search
        case inbox
        case ideas
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                TaskListView(
                    project: project,
                    snapshot: snapshot,
                    isRefreshing: isRefreshing,
                    errorMessage: errorMessage,
                    token: token,
                    api: api,
                    refresh: refresh
                )
                .navigationTitle("Tasks")
                .toolbar { companionToolbar }
            }
            .tabItem { Label("Tasks", systemImage: "checklist") }
            .tag(Tab.tasks)

            NavigationStack {
                AgentsView(snapshot: snapshot, refresh: refresh)
                    .navigationTitle("Agents")
                    .toolbar { companionToolbar }
            }
            .tabItem { Label("Agents", systemImage: "cpu") }
            .tag(Tab.agents)

            NavigationStack {
                TaskSearchView(
                    project: project,
                    runs: snapshot?.runs ?? [],
                    token: token,
                    api: api
                )
                .navigationTitle("Search")
                .toolbar { companionToolbar }
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }
            .tag(Tab.search)

            NavigationStack {
                InboxView(
                    project: project,
                    snapshot: snapshot,
                    token: token,
                    api: api,
                    refresh: refresh
                )
                .navigationTitle("Inbox")
                .toolbar { companionToolbar }
            }
            .tabItem { Label("Inbox", systemImage: "tray") }
            .tag(Tab.inbox)

            NavigationStack {
                IdeasNativeView(store: ideas, projectID: project.id, token: token)
                    .navigationTitle("아이디어")
                    .toolbar { companionToolbar }
            }
            .tabItem { Label("아이디어", systemImage: "lightbulb") }
            .tag(Tab.ideas)
        }
        .sheet(isPresented: $showingSettings) {
            NavigationStack {
                Form {
                    Section("테마") {
                        Picker("화면 모드", selection: $appearance) {
                            ForEach(CompanionAppearance.allCases) { option in
                                Text(option.title).tag(option.rawValue)
                            }
                        }
                    }
                    Section("접근 권한") {
                        Label("읽기 전용", systemImage: "eye")
                        Text("작업 생성, 상태 변경, 메시지 작성 기능은 제공하지 않습니다.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .navigationTitle("Companion 설정")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("완료") { showingSettings = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    @ToolbarContentBuilder
    private var companionToolbar: some ToolbarContent {
        ToolbarItem(placement: .automatic) {
            Text(project.name).font(.subheadline.weight(.semibold))
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("프로젝트 변경", action: changeProject)
                Button("테마 및 권한") { showingSettings = true }
                Divider()
                Button("로그아웃", role: .destructive, action: signOut)
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityLabel("계정 메뉴")
        }
    }
}

struct TaskListView: View {
    @State private var filter = TaskFilter.all

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

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
                                RunDetailView(run: run, projectID: project.id, token: token, api: api)
                            } label: {
                                RunRow(run: run)
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
    }
}

struct RunRow: View {
    let run: DashboardRun

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
                        RunDetailView(run: run, projectID: project.id, token: token, api: api)
                    } label: {
                        RunRow(run: run)
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

struct AgentsView: View {
    let snapshot: DashboardSnapshot?
    let refresh: () async -> Void

    var body: some View {
        List {
            if let workers = snapshot?.workers, !workers.isEmpty {
                ForEach(workers) { worker in
                    HStack(spacing: 12) {
                        Image(systemName: "cpu")
                            .foregroundStyle(worker.readiness == "available" ? Color.green : Color.secondary)
                        VStack(alignment: .leading) {
                            Text(worker.label).font(.headline)
                            Text(worker.readinessDetail ?? worker.readiness)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(worker.activeSessions) 실행 중")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                ContentUnavailableView(
                    "표시할 Agent 없음",
                    systemImage: "cpu",
                    description: Text("연결된 실행 Agent가 여기에 읽기 전용으로 표시됩니다.")
                )
            }
        }
        .refreshable { await refresh() }
    }
}

struct InboxView: View {
    private static let pageSize = 50

    let project: ProjectsResponse.Project
    let snapshot: DashboardSnapshot?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    @State private var visibleCount = InboxView.pageSize

    private var notifications: [ConversationNotification] {
        snapshot?.conversationNotifications ?? []
    }

    private var visibleNotifications: [ConversationNotification] {
        Array(notifications.prefix(visibleCount))
    }

    private var hasMore: Bool {
        visibleNotifications.count < notifications.count
    }

    var body: some View {
        List {
            if !visibleNotifications.isEmpty {
                ForEach(visibleNotifications) { notification in
                    if let run = snapshot?.runs.first(where: { $0.id == notification.runId }) {
                        NavigationLink {
                            RunDetailView(run: run, projectID: project.id, token: token, api: api)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(notification.runTitle).font(.headline)
                                Text(notification.body).lineLimit(3)
                                HStack {
                                    Text(notification.author.name)
                                    Spacer()
                                    Text(notification.createdAt, style: .relative)
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                        .onAppear {
                            guard hasMore, notification.id == visibleNotifications.last?.id else {
                                return
                            }
                            visibleCount = min(
                                visibleCount + Self.pageSize,
                                notifications.count
                            )
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "새 알림 없음",
                    systemImage: "tray",
                    description: Text("멘션과 대화 답글을 이곳에서 확인할 수 있습니다.")
                )
            }
        }
        .refreshable {
            visibleCount = Self.pageSize
            await refresh()
        }
        .onChange(of: notifications.map(\.id)) { _, _ in
            visibleCount = Self.pageSize
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

struct RunDetailView: View {
    let run: DashboardRun
    @StateObject private var detail: RunDetailStore
    @State private var previewFile: PreviewFile?
    @State private var previewError: String?

    @MainActor
    init(
        run: DashboardRun,
        projectID: UUID,
        token: String,
        api: any MobileAPIClientProtocol
    ) {
        self.run = run
        _detail = StateObject(wrappedValue: RunDetailStore(
            api: api,
            projectID: projectID,
            runID: run.id,
            token: token
        ))
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        StatusBadge(status: run.status)
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
                }
            }

            if let description = run.issueDescription, !description.isEmpty {
                Section("설명") { MarkdownText(markdown: description) }
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
                        Label {
                            VStack(alignment: .leading) {
                                Text(review.name)
                                Text(review.completedAt, format: .dateTime)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                        }
                    }
                }
            }

            if let attachments = run.attachments, !attachments.isEmpty {
                Section("첨부") {
                    ForEach(attachments) { attachment in
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
                                Image(systemName: attachment.contentType.hasPrefix("image/") ? "photo" : "doc")
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
                                Button {
                                    Task { await open(path: image.url, filename: image.filename) }
                                } label: {
                                    Label(image.filename, systemImage: "photo")
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
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(message.author.name).font(.headline)
                                Spacer()
                                Text(message.createdAt, style: .relative)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            MarkdownText(markdown: message.body)
                        }
                    }
                }
            }

            Section("읽기 전용") {
                Label("이 화면에서는 작업이나 메시지를 변경할 수 없습니다.", systemImage: "lock")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(run.title)
        .task { await detail.load() }
        .refreshable { await detail.load() }
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
        .accessibilityIdentifier("run-detail")
    }

    private func open(path: String, filename: String) async {
        do {
            previewFile = PreviewFile(url: try await detail.download(path: path, filename: filename))
        } catch {
            previewError = CompanionStore.message(for: error)
        }
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
