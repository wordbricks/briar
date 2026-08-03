import QuickLook
import SwiftUI

enum CompanionTab: String, CaseIterable, Identifiable {
    case tasks = "작업"
    case agents = "Agents"
    case search = "검색"
    case inbox = "Inbox"

    var id: Self { self }

    var icon: String {
        switch self {
        case .tasks: "checklist"
        case .agents: "sparkles"
        case .search: "magnifyingglass"
        case .inbox: "tray"
        }
    }
}

enum CompanionTheme: String, CaseIterable, Identifiable {
    case system = "시스템"
    case light = "라이트"
    case dark = "다크"

    var id: Self { self }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct CompanionShellView: View {
    let projects: [ProjectsResponse.Project]
    @Binding var selectedProjectID: UUID?
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void
    let signOut: () -> Void

    @State private var tab: CompanionTab = .tasks
    @State private var filter: RunFilter = .all
    @State private var query = ""
    @AppStorage("companion-theme") private var themeName = CompanionTheme.system.rawValue

    private var runs: [DashboardRun] { snapshot?.runs ?? [] }
    private var theme: CompanionTheme { CompanionTheme(rawValue: themeName) ?? .system }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                TaskListView(
                    runs: runs,
                    filter: $filter,
                    snapshotAvailable: snapshot != nil,
                    isRefreshing: isRefreshing,
                    errorMessage: errorMessage,
                    projectID: selectedProjectID,
                    token: token,
                    api: api,
                    refresh: refresh
                )
                .navigationTitle("작업")
                .companionToolbar(
                    projects: projects,
                    selectedProjectID: $selectedProjectID,
                    themeName: $themeName,
                    isRefreshing: isRefreshing,
                    refresh: refresh,
                    signOut: signOut
                )
            }
            .tabItem { Label(CompanionTab.tasks.rawValue, systemImage: CompanionTab.tasks.icon) }
            .tag(CompanionTab.tasks)

            NavigationStack {
                AgentScaffoldView(runs: runs)
                    .navigationTitle("Agents")
                    .companionToolbar(
                        projects: projects,
                        selectedProjectID: $selectedProjectID,
                        themeName: $themeName,
                        isRefreshing: isRefreshing,
                        refresh: refresh,
                        signOut: signOut
                    )
            }
            .tabItem { Label(CompanionTab.agents.rawValue, systemImage: CompanionTab.agents.icon) }
            .tag(CompanionTab.agents)

            NavigationStack {
                SearchRunsView(
                    runs: runs,
                    query: $query,
                    projectID: selectedProjectID,
                    token: token,
                    api: api
                )
                .navigationTitle("검색")
                .companionToolbar(
                    projects: projects,
                    selectedProjectID: $selectedProjectID,
                    themeName: $themeName,
                    isRefreshing: isRefreshing,
                    refresh: refresh,
                    signOut: signOut
                )
            }
            .tabItem { Label(CompanionTab.search.rawValue, systemImage: CompanionTab.search.icon) }
            .tag(CompanionTab.search)

            NavigationStack {
                InboxScaffoldView(runs: runs)
                    .navigationTitle("Inbox")
                    .companionToolbar(
                        projects: projects,
                        selectedProjectID: $selectedProjectID,
                        themeName: $themeName,
                        isRefreshing: isRefreshing,
                        refresh: refresh,
                        signOut: signOut
                    )
            }
            .tabItem { Label(CompanionTab.inbox.rawValue, systemImage: CompanionTab.inbox.icon) }
            .tag(CompanionTab.inbox)
        }
        .preferredColorScheme(theme.colorScheme)
        .accessibilityIdentifier("companion-shell")
    }
}

private extension View {
    func companionToolbar(
        projects: [ProjectsResponse.Project],
        selectedProjectID: Binding<UUID?>,
        themeName: Binding<String>,
        isRefreshing: Bool,
        refresh: @escaping () async -> Void,
        signOut: @escaping () -> Void
    ) -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("프로젝트", selection: selectedProjectID) {
                        ForEach(projects, id: \.id) { project in
                            Text("\(project.organizationName) · \(project.name)")
                                .tag(Optional(project.id))
                        }
                    }
                } label: {
                    Label(
                        projects.first(where: { $0.id == selectedProjectID.wrappedValue })?.name ?? "프로젝트",
                        systemImage: "chevron.up.chevron.down"
                    )
                    .font(.subheadline.weight(.semibold))
                }
                .accessibilityIdentifier("project-menu")
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    if isRefreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .disabled(isRefreshing)
                .accessibilityLabel("새로 고침")
                Menu {
                    Picker("테마", selection: themeName) {
                        ForEach(CompanionTheme.allCases) { theme in
                            Text(theme.rawValue).tag(theme.rawValue)
                        }
                    }
                    Divider()
                    Button("로그아웃", role: .destructive, action: signOut)
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("계정 및 테마")
            }
        }
    }
}

private struct TaskListView: View {
    let runs: [DashboardRun]
    @Binding var filter: RunFilter
    let snapshotAvailable: Bool
    let isRefreshing: Bool
    let errorMessage: String?
    let projectID: UUID?
    let token: String
    let api: any MobileAPIClientProtocol
    let refresh: () async -> Void

    private var filteredRuns: [DashboardRun] { RunCollection.filtered(runs, by: filter) }

    var body: some View {
        VStack(spacing: 0) {
            Picker("작업 필터", selection: $filter) {
                ForEach(RunFilter.allCases) { item in Text(item.rawValue).tag(item) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .accessibilityIdentifier("run-filter")

            if let errorMessage, !errorMessage.isEmpty, !snapshotAvailable {
                OfflineStateView(message: errorMessage, retry: refresh)
            } else if !snapshotAvailable {
                Spacer()
                ProgressView("작업을 불러오는 중…")
                Spacer()
            } else if filteredRuns.isEmpty {
                ContentUnavailableView(
                    filter == .all ? "작업 없음" : "조건에 맞는 작업 없음",
                    systemImage: filter == .attention ? "checkmark.circle" : "tray",
                    description: Text(filter == .attention ? "확인이 필요한 작업이 없습니다." : "다른 필터를 선택해 보세요.")
                )
            } else {
                List {
                    if let errorMessage, !errorMessage.isEmpty {
                        Section {
                            Label(errorMessage, systemImage: "wifi.exclamationmark")
                                .foregroundStyle(.orange)
                            Button("다시 시도") { Task { await refresh() } }
                        }
                    }
                    ForEach(filteredRuns) { run in
                        if let projectID {
                            NavigationLink {
                                RunDetailView(run: run, projectID: projectID, token: token, api: api)
                            } label: {
                                RunRow(run: run)
                            }
                            .accessibilityIdentifier("run-row-\(run.id.uuidString)")
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await refresh() }
            }
        }
        .overlay(alignment: .top) {
            if isRefreshing { ProgressView().padding(.top, 4) }
        }
    }
}

private struct SearchRunsView: View {
    let runs: [DashboardRun]
    @Binding var query: String
    let projectID: UUID?
    let token: String
    let api: any MobileAPIClientProtocol

    private var results: [DashboardRun] { RunCollection.filtered(runs, by: .all, query: query) }

    var body: some View {
        Group {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView("작업 검색", systemImage: "magnifyingglass", description: Text("제목, 설명, 결과에서 검색합니다."))
            } else if results.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                List(results) { run in
                    if let projectID {
                        NavigationLink {
                            RunDetailView(run: run, projectID: projectID, token: token, api: api)
                        } label: {
                            RunRow(run: run)
                        }
                        .accessibilityIdentifier("search-result-\(run.id.uuidString)")
                    }
                }
                .listStyle(.plain)
            }
        }
        .searchable(text: $query, prompt: "작업 검색")
        .accessibilityIdentifier("search-screen")
    }
}

private struct RunRow: View {
    let run: DashboardRun

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(run.title).font(.headline)
                Spacer(minLength: 12)
                StatusBadge(status: run.status)
            }
            if let detail = run.detail ?? run.issueDescription, !detail.isEmpty {
                Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 12) {
                if let runNumber = run.runNumber { Text("#\(runNumber)") }
                if !run.attachments.isEmpty { Label("\(run.attachments.count)", systemImage: "paperclip") }
                Text(run.updatedAt, style: .relative)
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 5)
    }
}

private struct StatusBadge: View {
    let status: DashboardRun.Status

    private var color: Color {
        switch status {
        case .running: .blue
        case .completed: .green
        case .blocked, .failed: .red
        case .queued: .orange
        default: .secondary
        }
    }

    var body: some View {
        Text(status.displayName)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }
}

private struct AgentScaffoldView: View {
    let runs: [DashboardRun]
    private var activeCount: Int { runs.filter { $0.status == .running }.count }

    var body: some View {
        List {
            Section("현재 활동") {
                Label("진행 중인 작업 \(activeCount)개", systemImage: "bolt.fill")
                Label("작업별 담당 Agent는 상세 상태에서 확인", systemImage: "person.text.rectangle")
            }
            Section {
                Text("이 탭은 읽기 전용 셸입니다. Agent 생성·편집·실행 기능은 노출하지 않습니다.")
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("agents-screen")
    }
}

private struct InboxScaffoldView: View {
    let runs: [DashboardRun]

    var body: some View {
        List {
            Section("읽기 전용 Inbox") {
                Label("작업 상세의 메시지 탭에서 전체 대화를 확인할 수 있습니다.", systemImage: "bubble.left.and.bubble.right")
                Label("메시지 작성과 답장은 안전하게 비활성화됨", systemImage: "lock")
            }
            Section("대화가 있는 작업 찾기") {
                Text("검색 탭에서 작업을 연 뒤 메시지를 선택하세요. 현재 프로젝트에는 \(runs.count)개의 작업이 있습니다.")
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("inbox-screen")
    }
}

private struct OfflineStateView: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label("오프라인", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("다시 시도") { Task { await retry() } }
                .accessibilityIdentifier("offline-retry")
        }
        .accessibilityIdentifier("offline-state")
    }
}

struct RunDetailView: View {
    enum Section: String, CaseIterable, Identifiable {
        case issue = "설명"
        case result = "결과"
        case events = "이벤트"
        case evidence = "증빙"
        case messages = "메시지"
        var id: Self { self }
    }

    let run: DashboardRun
    let projectID: UUID
    let token: String
    let api: any MobileAPIClientProtocol

    @StateObject private var store: RunDetailStore
    @StateObject private var previewStore: AttachmentPreviewStore
    @State private var section: Section = .issue

    init(run: DashboardRun, projectID: UUID, token: String, api: any MobileAPIClientProtocol) {
        self.run = run
        self.projectID = projectID
        self.token = token
        self.api = api
        _store = StateObject(wrappedValue: RunDetailStore(api: api))
        _previewStore = StateObject(wrappedValue: AttachmentPreviewStore(api: api))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("상세 섹션", selection: $section) {
                ForEach(Section.allCases) { item in Text(item.rawValue).tag(item) }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .accessibilityIdentifier("detail-section-picker")

            if store.loading && section != .issue && section != .result {
                Spacer()
                ProgressView("상세 정보를 불러오는 중…")
                Spacer()
            } else if let error = store.errorMessage, section != .issue && section != .result {
                ContentUnavailableView {
                    Label("상세 정보를 불러올 수 없음", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                } description: {
                    Text(error)
                } actions: {
                    Button("다시 시도") { Task { await load() } }
                }
            } else {
                detailContent
            }
        }
        .navigationTitle(run.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $previewStore.preview) { file in QuickLookPreview(url: file.url) }
        .alert("미리보기를 열 수 없음", isPresented: Binding(
            get: { previewStore.errorMessage != nil },
            set: { if !$0 { previewStore.dismissError() } }
        )) {
            Button("확인", role: .cancel) {}
        } message: {
            Text(previewStore.errorMessage ?? "")
        }
        .accessibilityIdentifier("run-detail")
    }

    @ViewBuilder
    private var detailContent: some View {
        switch section {
        case .issue: IssueSection(run: run, token: token, previewStore: previewStore)
        case .result: ResultSection(run: run)
        case .events: EventSection(events: store.events)
        case .evidence: EvidenceSection(evidence: store.evidence, token: token, previewStore: previewStore)
        case .messages: MessageSection(messages: store.messages)
        }
    }

    private func load() async {
        await store.load(projectID: projectID, runID: run.id, token: token)
    }
}

private struct IssueSection: View {
    let run: DashboardRun
    let token: String
    @ObservedObject var previewStore: AttachmentPreviewStore

    var body: some View {
        List {
            Section {
                HStack { StatusBadge(status: run.status); Spacer(); Text("시도 \(run.currentAttempt) · 개정 \(run.currentRevision)").font(.caption).foregroundStyle(.secondary) }
            }
            Section("설명") {
                Text(markdown: run.issueDescription ?? "설명이 없습니다.")
                    .textSelection(.enabled)
            }
            if !run.attachments.isEmpty {
                Section("첨부 \(run.attachments.count)") {
                    ForEach(run.attachments) { attachment in
                        AttachmentButton(
                            id: attachment.id,
                            filename: attachment.filename,
                            byteSize: attachment.byteSize,
                            path: attachment.url,
                            token: token,
                            previewStore: previewStore
                        )
                    }
                }
            }
        }
    }
}

private struct ResultSection: View {
    let run: DashboardRun
    private var summary: String? { run.structuredResult?.summary ?? run.resultSummary }

    var body: some View {
        List {
            Section("결과") {
                if let summary, !summary.isEmpty { Text(markdown: summary).textSelection(.enabled) }
                else { Text("아직 기록된 결과가 없습니다.").foregroundStyle(.secondary) }
            }
            if let nextAction = run.structuredResult?.nextAction, !nextAction.isEmpty {
                Section("다음 조치") { Text(nextAction) }
            }
            Section("결과 리뷰") {
                if run.resultReviews.isEmpty { Text("아직 확인한 사람이 없습니다.").foregroundStyle(.secondary) }
                ForEach(run.resultReviews) { review in
                    Label {
                        VStack(alignment: .leading) {
                            Text(review.name)
                            Text(review.completedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "checkmark.seal.fill").foregroundStyle(.green) }
                }
                Text("이 앱에서는 결과 확인 상태를 변경할 수 없습니다.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !run.pullRequestURLs.isEmpty {
                Section("링크") {
                    ForEach(run.pullRequestURLs, id: \.absoluteString) { url in Link("Pull Request", destination: url) }
                }
            }
        }
    }
}

private struct EventSection: View {
    let events: [RunEvent]
    var body: some View {
        List {
            if events.isEmpty { ContentUnavailableView("이벤트 없음", systemImage: "clock") }
            ForEach(events) { event in
                VStack(alignment: .leading, spacing: 5) {
                    HStack { StatusBadge(status: event.status); Text(event.workflowStage ?? "상태 변경").font(.headline) }
                    if let detail = event.detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                    Text("\(event.actor) · \(event.occurredAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 3)
            }
        }
    }
}

private struct EvidenceSection: View {
    let evidence: [RunEvidence]
    let token: String
    @ObservedObject var previewStore: AttachmentPreviewStore

    var body: some View {
        List {
            if evidence.isEmpty { ContentUnavailableView("증빙 없음", systemImage: "doc.text.magnifyingglass") }
            ForEach(evidence) { item in
                Section(item.stage) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Label(item.type, systemImage: item.status == .passed ? "checkmark.circle.fill" : "circle")
                            Spacer()
                            Text(item.status.displayName).font(.caption.weight(.semibold))
                        }
                        if !item.canonical { Text("이전 개정의 증빙").font(.caption).foregroundStyle(.orange) }
                        if let detail = item.detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                    }
                    ForEach(item.images) { image in
                        AttachmentButton(
                            id: image.id,
                            filename: image.filename,
                            byteSize: image.byteSize,
                            path: image.url,
                            token: token,
                            previewStore: previewStore
                        )
                    }
                }
            }
        }
    }
}

private struct MessageSection: View {
    let messages: [IssueMessage]
    var body: some View {
        List {
            if messages.isEmpty { ContentUnavailableView("메시지 없음", systemImage: "bubble.left") }
            ForEach(messages) { message in
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text(message.author.name).font(.subheadline.weight(.semibold))
                        if message.parentMessageId != nil { Text("답글").font(.caption2).foregroundStyle(.secondary) }
                        Spacer()
                        Text(message.createdAt, style: .relative).font(.caption).foregroundStyle(.tertiary)
                    }
                    Text(markdown: message.body).textSelection(.enabled)
                }
                .padding(.leading, message.parentMessageId == nil ? 0 : 18)
                .padding(.vertical, 4)
            }
            Section { Label("읽기 전용 — 메시지 작성은 지원하지 않습니다.", systemImage: "lock").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

private struct AttachmentButton: View {
    let id: UUID
    let filename: String
    let byteSize: Int
    let path: String
    let token: String
    @ObservedObject var previewStore: AttachmentPreviewStore

    var body: some View {
        Button {
            Task { await previewStore.open(id: id, filename: filename, path: path, token: token) }
        } label: {
            HStack {
                Image(systemName: "doc")
                VStack(alignment: .leading) {
                    Text(filename).lineLimit(1)
                    Text(ByteCountFormatter.string(fromByteCount: Int64(byteSize), countStyle: .file))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if previewStore.loadingID == id { ProgressView() } else { Image(systemName: "eye") }
            }
        }
        .disabled(previewStore.loadingID != nil)
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}

private extension Text {
    init(markdown: String) {
        let attributed = (try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .full))) ?? AttributedString(markdown)
        self.init(attributed)
    }
}
