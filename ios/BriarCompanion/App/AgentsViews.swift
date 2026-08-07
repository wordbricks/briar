import SwiftUI

struct AgentsHomeView: View {
    @ObservedObject var agents: AgentsStore
    @ObservedObject var navigation: CompanionNavigationModel
    let project: ProjectsResponse.Project
    let token: String
    let api: any MobileAPIClientProtocol
    let snapshot: DashboardSnapshot?
    let refreshDashboard: () async -> Void

    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let errorMessage = agents.errorMessage, agents.agents.isEmpty {
                    Section {
                        Label(errorMessage, systemImage: "wifi.exclamationmark")
                            .foregroundStyle(.orange)
                    }
                }

                Section("Agents") {
                    if agents.agents.isEmpty {
                        ContentUnavailableView(
                            "표시할 Agent 없음",
                            systemImage: "cpu",
                            description: Text("프로젝트에 연결된 Agent가 여기에 표시됩니다.")
                        )
                    } else {
                        ForEach(agents.agents) { agent in
                            NavigationLink(value: AgentRoute.agent(agent.id)) {
                                AgentRow(agent: agent, sessionCount: agents.sessions(for: agent.id).count)
                            }
                            .accessibilityIdentifier("agent-row-\(agent.id.uuidString)")
                        }
                    }
                }

                Section("세션") {
                    let sessions = agents.sessions
                    if sessions.isEmpty {
                        Text("아직 동기화된 세션이 없습니다.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(sessions.prefix(30)) { session in
                            NavigationLink(value: AgentRoute.session(session.id)) {
                                let agent = session.agentId.flatMap { agents.agent(id: $0) }
                                SessionRow(
                                    session: session,
                                    agentName: agent?.name,
                                    agentAvatar: agent?.avatar
                                )
                            }
                            .accessibilityIdentifier("session-row-\(session.id)")
                        }
                    }
                }

                if let workers = snapshot?.workers, !workers.isEmpty {
                    Section("실행 Worker") {
                        ForEach(workers) { worker in
                            HStack(spacing: 12) {
                                Image(systemName: "desktopcomputer")
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
                    }
                }
            }
            .navigationTitle("Agents")
            .navigationDestination(for: AgentRoute.self) { route in
                switch route {
                case let .agent(id):
                    if let agent = agents.agent(id: id) {
                        AgentDetailView(
                            agent: agent,
                            sessions: agents.sessions(for: id),
                            workers: snapshot?.workers ?? [],
                            onRun: { request, workerID in
                                _ = try await agents.run(
                                    agent: agent,
                                    request: request,
                                    workerID: workerID
                                )
                            },
                            onOpenSession: { path.append(AgentRoute.session($0)) }
                        )
                    } else {
                        ContentUnavailableView("Agent를 찾을 수 없음", systemImage: "cpu")
                    }
                case let .session(id):
                    if let session = agents.session(id: id) {
                        SessionDetailView(
                            session: session,
                            agent: session.agentId.flatMap { agents.agent(id: $0) },
                            project: project,
                            token: token,
                            api: api,
                            snapshot: snapshot,
                            refreshDashboard: refreshDashboard
                        )
                    } else {
                        ContentUnavailableView("세션을 찾을 수 없음", systemImage: "list.bullet.rectangle")
                    }
                }
            }
            .refreshable {
                await agents.refresh()
                await refreshDashboard()
            }
            .overlay {
                if agents.isRefreshing && agents.agents.isEmpty {
                    ProgressView("Agent를 불러오는 중…")
                }
            }
        }
        .onChange(of: navigation.pathSessionToken) { _, _ in
            if let sessionID = navigation.consumePendingSession() {
                path.append(AgentRoute.session(sessionID))
            }
        }
        .task(id: navigation.pathSessionToken) {
            if let sessionID = navigation.pendingSessionID {
                _ = navigation.consumePendingSession()
                path.append(AgentRoute.session(sessionID))
            }
        }
    }
}

private enum AgentRoute: Hashable {
    case agent(UUID)
    case session(String)
}

private struct AgentRow: View {
    let agent: ProjectAgent
    let sessionCount: Int

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                ProfileImageView(
                    image: agent.avatar,
                    name: agent.name,
                    systemImage: "cpu",
                    size: 40,
                    cornerRadius: 10
                )
                Circle()
                    .fill(Color(hex: agent.calendarColor) ?? .accentColor)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 1.5))
                    .offset(x: 2, y: 2)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(agent.name).font(.headline)
                Text(agent.responsibility)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(agent.provider.rawValue.uppercased() + (agent.model.map { " · \($0)" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if sessionCount > 0 {
                Text("\(sessionCount)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct SessionRow: View {
    let session: ProjectAgentSession
    let agentName: String?
    var agentAvatar: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if agentName != nil || agentAvatar != nil {
                ProfileImageView(
                    image: agentAvatar,
                    name: agentName,
                    systemImage: "cpu",
                    size: 28,
                    cornerRadius: 8
                )
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(session.title)
                        .font(.headline)
                        .lineLimit(2)
                    Spacer()
                    Text(session.status.displayName)
                        .font(.caption)
                        .foregroundStyle(session.requiresAttention ? Color.orange : Color.secondary)
                }
                HStack {
                    if let agentName {
                        Text(agentName)
                    }
                    Spacer()
                    Text(session.displayTimestamp, style: .relative)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct AgentDetailView: View {
    let agent: ProjectAgent
    let sessions: [ProjectAgentSession]
    let workers: [DashboardWorker]
    let onRun: (String, String) async throws -> Void
    let onOpenSession: (String) -> Void

    @State private var showingRun = false

    private var availableWorkers: [DashboardWorker] {
        workers.filter { worker in
            guard worker.readiness == "available" else { return false }
            return worker.providers?.contains(agent.provider) == true ||
                worker.agentProvider == agent.provider
        }
    }

    var body: some View {
        List {
            Section("프로필") {
                HStack(spacing: 14) {
                    ProfileImageView(
                        image: agent.avatar,
                        name: agent.name,
                        systemImage: "cpu",
                        size: 64,
                        cornerRadius: 16
                    )
                    VStack(alignment: .leading, spacing: 4) {
                        Text(agent.name).font(.title3.weight(.semibold))
                        Text(agent.provider.rawValue.uppercased() + (agent.model.map { " · \($0)" } ?? ""))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if agent.avatar == nil {
                            Text("등록된 프로필 사진 없음")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
                .accessibilityIdentifier("agent-profile-photo")
            }
            Section("개요") {
                LabeledContent("Provider", value: agent.provider.rawValue)
                if let model = agent.model {
                    LabeledContent("Model", value: model)
                }
                LabeledContent("색상", value: agent.calendarColor)
                Text(agent.responsibility)
            }
            Section("책임 / Skill") {
                MarkdownText(markdown: agent.skill)
            }
            Section("세션") {
                if sessions.isEmpty {
                    Text("이 Agent의 세션이 아직 없습니다.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sessions) { session in
                        Button {
                            onOpenSession(session.id)
                        } label: {
                            SessionRow(session: session, agentName: nil)
                        }
                    }
                }
            }
        }
        .navigationTitle(agent.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingRun = true
                } label: {
                    Label("Agent 실행", systemImage: "play.fill")
                }
                .disabled(availableWorkers.isEmpty)
                .accessibilityIdentifier("agent-run-button")
            }
        }
        .sheet(isPresented: $showingRun) {
            AgentRunSheet(
                agent: agent,
                workers: availableWorkers,
                onRun: onRun
            )
        }
    }
}

private struct AgentRunSheet: View {
    @Environment(\.dismiss) private var dismiss
    let agent: ProjectAgent
    let workers: [DashboardWorker]
    let onRun: (String, String) async throws -> Void

    @State private var request: String
    @State private var selectedWorkerID: String
    @State private var isRunning = false
    @State private var errorMessage: String?

    init(
        agent: ProjectAgent,
        workers: [DashboardWorker],
        onRun: @escaping (String, String) async throws -> Void
    ) {
        self.agent = agent
        self.workers = workers
        self.onRun = onRun
        _request = State(initialValue: agent.responsibility)
        _selectedWorkerID = State(initialValue: workers.first?.id ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("작업 요청") {
                    TextEditor(text: $request)
                        .frame(minHeight: 130)
                        .accessibilityLabel("에이전트 작업 요청")
                        .accessibilityIdentifier("agent-run-request")
                }

                Section("실행 호스트") {
                    Picker("Worker", selection: $selectedWorkerID) {
                        ForEach(workers) { worker in
                            Text(worker.label).tag(worker.id)
                        }
                    }
                    .accessibilityIdentifier("agent-run-worker-picker")
                    if let worker = workers.first(where: { $0.id == selectedWorkerID }) {
                        Label(
                            worker.readinessDetail ?? "실행 가능",
                            systemImage: "checkmark.circle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Agent 실행")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                        .disabled(isRunning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isRunning {
                            ProgressView()
                        } else {
                            Text("실행")
                        }
                    }
                    .disabled(isRunning || request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedWorkerID.isEmpty)
                    .accessibilityIdentifier("agent-run-submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() async {
        let trimmed = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !selectedWorkerID.isEmpty, !isRunning else { return }
        isRunning = true
        errorMessage = nil
        do {
            try await onRun(trimmed, selectedWorkerID)
            dismiss()
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
        isRunning = false
    }
}

struct SessionDetailView: View {
    let session: ProjectAgentSession
    let agent: ProjectAgent?
    let project: ProjectsResponse.Project
    let token: String
    let api: any MobileAPIClientProtocol
    let snapshot: DashboardSnapshot?
    let refreshDashboard: () async -> Void

    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var copied = false

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        List {
            Section("상태") {
                LabeledContent("상태", value: session.status.displayName)
                if let agent {
                    HStack {
                        Text("Agent")
                        Spacer()
                        ProfileImageView(
                            image: agent.avatar,
                            name: agent.name,
                            systemImage: "cpu",
                            size: 24,
                            cornerRadius: 6
                        )
                        Text(agent.name)
                            .foregroundStyle(.secondary)
                    }
                }
                if let trigger = session.trigger {
                    LabeledContent("트리거", value: trigger.rawValue)
                }
                if let type = session.sessionType {
                    LabeledContent("유형", value: type.rawValue)
                }
                if let workerID = session.workerId ?? session.requestedWorkerId {
                    LabeledContent("실행 Worker", value: workerID)
                }
                LabeledContent("시작", value: session.startedAt.formatted())
                if let completedAt = session.completedAt {
                    LabeledContent("완료", value: completedAt.formatted())
                }
            }

            if let request = session.request, !request.isEmpty {
                Section("요청") { Text(request) }
            }
            if let summary = session.summary, !summary.isEmpty {
                Section("요약") { MarkdownText(markdown: summary) }
            }
            if let error = session.error, !error.isEmpty {
                Section("오류") {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section("이슈") {
                if session.issues.isEmpty {
                    Text("연결된 이슈 없음").foregroundStyle(.secondary)
                } else {
                    ForEach(session.issues) { issue in
                        if let runID = UUID(uuidString: issue.runId),
                           let run = snapshot?.runs.first(where: { $0.id == runID }) {
                            NavigationLink {
                                RunDetailView(
                                    run: run,
                                    projectID: project.id,
                                    issueKeyPrefix: project.effectiveIssueKeyPrefix,
                                    token: token,
                                    api: api,
                                    allRuns: snapshot?.runs ?? [],
                                    workers: snapshot?.workers ?? [],
                                    providers: snapshot?.organizationProviders ?? [],
                                    refresh: refreshDashboard
                                )
                            } label: {
                                issueLabel(issue)
                            }
                        } else {
                            issueLabel(issue)
                        }
                    }
                }
            }

            if let events = session.events, !events.isEmpty {
                Section("이벤트") {
                    ForEach(events) { event in
                        HStack {
                            Text(event.type.rawValue)
                            Spacer()
                            Text(event.occurredAt, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("세션")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    let shareURL = BriarShareLinks.sessionShareURL(
                        projectID: project.id,
                        sessionID: session.id,
                        origin: BriarShareLinks.defaultOrigin
                    )
                    ShareLink(item: shareURL) {
                        Label("세션 공유", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        ClipboardService.copy(shareURL.absoluteString)
                        copied = true
                    } label: {
                        Label(L10n.text(.copyLink, locale: locale), systemImage: "doc.on.doc")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .companionToast(
            isPresented: $copied,
            message: L10n.text(.linkCopied, locale: locale)
        )
    }

    private func issueLabel(_ issue: ProjectAgentSession.Issue) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(project.issueKey(runNumber: issue.runNumber)) \(issue.title)")
                .font(.headline)
            Text(issue.outcome.displayName)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let summary = issue.summary, !summary.isEmpty {
                Text(summary).font(.subheadline).lineLimit(3)
            }
        }
    }
}

private extension Color {
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let int = UInt64(value, radix: 16) else { return nil }
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
