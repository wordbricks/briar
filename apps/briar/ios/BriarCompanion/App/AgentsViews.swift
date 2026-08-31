import SwiftUI

struct AgentsHomeView<ToolbarContentType: ToolbarContent>: View {
    @Binding var path: NavigationPath
    @ObservedObject var agents: AgentsStore
    @ObservedObject var navigation: CompanionNavigationModel
    let project: Project
    let token: String
    let api: any AuthenticatedDownloadClientProtocol
    let services: AuthenticatedMobileServices
    let realtimeClient: (any MobileRealtimeClientProtocol)?
    let snapshot: DashboardSnapshot?
    let issueConversationView: IssueConversationViewTracker?
    let refreshDashboard: () async -> Void
    @ToolbarContentBuilder let toolbarContent: () -> ToolbarContentType

    var body: some View {
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
                        L10n.text("표시할 Agent 없음"),
                        systemImage: "cpu",
                        description: Text(L10n.text("프로젝트에 연결된 Agent가 여기에 표시됩니다."))
                    )
                } else {
                    ForEach(agents.agents) { agent in
                        NavigationLink(value: AgentRoute.agent(agent.id)) {
                            AgentRow(agent: agent, sessionCount: agents.sessions(for: agent.id).count)
                        }
                        .accessibilityIdentifier("agent-row-\(agent.id.uuidString.lowercased())")
                    }
                }
            }

            Section(L10n.text("세션")) {
                let sessions = agents.sessions
                if sessions.isEmpty {
                    Text(L10n.text("아직 동기화된 세션이 없습니다."))
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
                Section(L10n.text("실행 Worker")) {
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
                            Text(L10n.format("%d 실행 중", worker.activeSessions))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Agents")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent() }
        .navigationDestination(for: AgentRoute.self) { route in
            switch route {
            case let .agent(id):
                if let agent = agents.agent(id: id) {
                    AgentDetailView(
                        agent: agent,
                        sessions: agents.sessions(for: id),
                        workers: snapshot?.workers ?? [],
                        onRun: { skill, request, workerID in
                            _ = try await agents.run(
                                agent: agent,
                                skill: skill,
                                request: request,
                                workerID: workerID
                            )
                        },
                        onOpenSession: { path.append(AgentRoute.session($0)) }
                    )
                } else {
                    ContentUnavailableView(L10n.text("Agent를 찾을 수 없음"), systemImage: "cpu")
                }
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
                        services: services,
                        realtimeClient: realtimeClient,
                        snapshot: snapshot,
                        issueConversationView: issueConversationView,
                        refreshDashboard: refreshDashboard,
                        onSkillSessionMaterialized: { agents.materialize($0) },
                        onSkillSessionOpen: { projectID, sessionID in
                            navigation.open(
                                .session(projectID: projectID, sessionID: sessionID)
                            )
                        }
                    )
                } else {
                    ContentUnavailableView(L10n.text("세션을 찾을 수 없음"), systemImage: "list.bullet.rectangle")
                }
            }
        }
        .refreshable {
            await agents.refresh()
            await refreshDashboard()
        }
        .overlay {
            if agents.isRefreshing && agents.agents.isEmpty {
                ProgressView(L10n.text("Agent를 불러오는 중…"))
            }
        }
        .alert(
            L10n.text("Agent 실행"),
            isPresented: Binding(
                get: { agents.executionError != nil },
                set: { isPresented in
                    if !isPresented { agents.clearExecutionError() }
                }
            )
        ) {
            Button(L10n.text("확인")) { agents.clearExecutionError() }
        } message: {
            Text(L10n.text(agents.executionError ?? "실행 요청을 처리하지 못했습니다."))
        }
        .onChange(of: snapshot) { _, nextSnapshot in
            guard let nextSnapshot else { return }
            Task { await agents.reconcile(runs: nextSnapshot.runs) }
        }
    }

    private func runAgent(_ agent: ProjectAgent) {
        Task {
            do {
                _ = try await agents.run(agent: agent, runs: snapshot?.runs ?? [])
                await refreshDashboard()
            } catch {
                // AgentsStore exposes a localized error for the alert above.
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
                Text(agent.summary)
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
    let onRun: (ProjectAgent.Skill, String, String) async throws -> Void
    let onOpenSession: (String) -> Void

    @State private var showingRun = false

    private var readyWorkers: [DashboardWorker] {
        workers.filter { $0.readiness == "available" && $0.acceptingWork }
    }

    private var sortedSkills: [ProjectAgent.Skill] {
        agent.skills.sorted { left, right in
            if left.position != right.position { return left.position < right.position }
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        }
    }

    private func runtimeLabel(for skill: ProjectAgent.Skill) -> String {
        var components = [skill.provider.displayName]
        if let model = skill.model { components.append(model) }
        if let effort = skill.effort { components.append(effort.rawValue) }
        return components.joined(separator: " · ")
    }

    private func workerSupports(_ skill: ProjectAgent.Skill) -> Bool {
        readyWorkers.contains { workerCanRunAgentSkill($0, provider: skill.provider) }
    }

    var body: some View {
        List {
            Section(L10n.text("프로필")) {
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
                            Text(L10n.text("등록된 프로필 사진 없음"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
                .accessibilityIdentifier("agent-profile-photo")
            }
            Section(L10n.text("개요")) {
                LabeledContent("Provider", value: agent.provider.rawValue)
                if let model = agent.model {
                    LabeledContent("Model", value: model)
                }
                LabeledContent(L10n.text("색상"), value: agent.calendarColor)
                if let description = agent.displayDescription {
                    LabeledContent(L10n.text("설명"), value: description)
                }
                LabeledContent(
                    L10n.text("책임"),
                    value: agent.responsibility
                )
            }
            Section("Skills") {
                if sortedSkills.isEmpty {
                    Text(L10n.text("등록된 Skill이 없습니다."))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedSkills) { skill in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(skill.name)
                                    .font(.headline)
                                Spacer()
                                Text(runtimeLabel(for: skill))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            MarkdownText(markdown: skill.instructions)
                            if !workerSupports(skill) {
                                Label(L10n.text("현재 실행 가능한 Worker 없음"), systemImage: "exclamationmark.triangle")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                        }
                        .padding(.vertical, 3)
                        .accessibilityIdentifier("agent-skill-\(skill.id.uuidString.lowercased())")
                    }
                }
            }
            Section(L10n.text("세션")) {
                if sessions.isEmpty {
                    Text(L10n.text("이 Agent의 세션이 아직 없습니다."))
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
                    Label(L10n.text("Agent 실행"), systemImage: "play.fill")
                }
                .disabled(agent.skills.isEmpty)
                .accessibilityIdentifier("agent-run-button")
            }
        }
        .sheet(isPresented: $showingRun) {
            AgentRunSheet(
                agent: agent,
                workers: readyWorkers,
                onRun: onRun
            )
        }
    }
}

private struct AgentRunSheet: View {
    @Environment(\.dismiss) private var dismiss
    let agent: ProjectAgent
    let workers: [DashboardWorker]
    let onRun: (ProjectAgent.Skill, String, String) async throws -> Void

    @State private var selectedSkillID: UUID?
    @State private var request: String
    @State private var selectedWorkerID: String
    @State private var isRunning = false
    @State private var errorMessage: String?

    init(
        agent: ProjectAgent,
        workers: [DashboardWorker],
        onRun: @escaping (ProjectAgent.Skill, String, String) async throws -> Void
    ) {
        self.agent = agent
        self.workers = workers
        self.onRun = onRun
        _selectedSkillID = State(initialValue: nil)
        _request = State(initialValue: "")
        _selectedWorkerID = State(initialValue: "")
    }

    private var sortedSkills: [ProjectAgent.Skill] {
        agent.skills.sorted { left, right in
            if left.position != right.position { return left.position < right.position }
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        }
    }

    private var selectedSkill: ProjectAgent.Skill? {
        guard let selectedSkillID else { return nil }
        return agent.skills.first { $0.id == selectedSkillID }
    }

    private var availableWorkers: [DashboardWorker] {
        guard let selectedSkill else { return [] }
        return workers.filter { workerCanRunAgentSkill($0, provider: selectedSkill.provider) }
    }

    private var selectedWorker: DashboardWorker? {
        availableWorkers.first { $0.id == selectedWorkerID }
    }

    private var selectedRuntimeDescription: String? {
        guard let selectedSkill else { return nil }
        var components = [selectedSkill.provider.displayName]
        if let model = selectedSkill.model { components.append(model) }
        if let effort = selectedSkill.effort { components.append(effort.rawValue) }
        return components.joined(separator: " · ")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Skill") {
                    Picker("Skill", selection: $selectedSkillID) {
                        Text(L10n.text("Skill을 선택해 주세요"))
                            .tag(nil as UUID?)
                        ForEach(sortedSkills) { skill in
                            Text(skill.name)
                                .tag(Optional(skill.id))
                                .accessibilityIdentifier(
                                    "agent-run-skill-\(skill.id.uuidString.lowercased())"
                                )
                        }
                    }
                    .disabled(isRunning)
                    .accessibilityIdentifier("agent-run-skill-picker")

                    if let selectedRuntimeDescription {
                        LabeledContent(L10n.text("실행 설정"), value: selectedRuntimeDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section(L10n.text("작업 요청")) {
                    TextEditor(text: $request)
                        .frame(minHeight: 130)
                        .disabled(selectedSkill == nil || isRunning)
                        .accessibilityLabel(L10n.text("에이전트 작업 요청"))
                        .accessibilityIdentifier("agent-run-request")
                }

                Section(L10n.text("실행 호스트")) {
                    if selectedSkill == nil {
                        Text(L10n.text("먼저 실행할 Skill을 선택해 주세요."))
                            .foregroundStyle(.secondary)
                    } else if availableWorkers.isEmpty {
                        Label(
                            L10n.text("선택한 Skill을 실행할 수 있는 Worker가 없습니다."),
                            systemImage: "exclamationmark.triangle"
                        )
                        .foregroundStyle(.orange)
                    } else {
                        Picker("Worker", selection: $selectedWorkerID) {
                            ForEach(availableWorkers) { worker in
                                Text(worker.label).tag(worker.id)
                            }
                        }
                        .disabled(isRunning)
                        .accessibilityIdentifier("agent-run-worker-picker")
                        .accessibilityValue(selectedWorker?.label ?? "")
                        if let worker = selectedWorker {
                            Label(
                                worker.readinessDetail ?? L10n.text("실행 가능"),
                                systemImage: "checkmark.circle.fill"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(L10n.text("Agent 실행"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("취소")) { dismiss() }
                        .disabled(isRunning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isRunning {
                            ProgressView()
                        } else {
                            Text(L10n.text("실행"))
                        }
                    }
                    .disabled(
                        isRunning ||
                            selectedSkill == nil ||
                            request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            !availableWorkers.contains(where: { $0.id == selectedWorkerID })
                    )
                    .accessibilityIdentifier("agent-run-submit")
                }
            }
        }
        .onAppear(perform: resetSelection)
        .onChange(of: selectedSkillID) { _, _ in
            applySelectedSkill()
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(isRunning)
    }

    private func submit() async {
        let trimmed = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let selectedSkill,
            !trimmed.isEmpty,
            availableWorkers.contains(where: { $0.id == selectedWorkerID }),
            !isRunning
        else { return }
        isRunning = true
        errorMessage = nil
        do {
            try await onRun(selectedSkill, trimmed, selectedWorkerID)
            dismiss()
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
        isRunning = false
    }

    private func resetSelection() {
        selectedSkillID = nil
        request = ""
        selectedWorkerID = ""
        errorMessage = nil
    }

    private func applySelectedSkill() {
        guard let selectedSkill else {
            request = ""
            selectedWorkerID = ""
            return
        }
        request = selectedSkill.instructions
        selectedWorkerID = availableWorkers.first?.id ?? ""
        errorMessage = nil
    }
}

func workerCanRunAgentSkill(_ worker: DashboardWorker, provider: AgentProvider) -> Bool {
    guard worker.readiness == "available", worker.acceptingWork else { return false }
    let providers = worker.providers ?? worker.agentProvider.map { [$0] } ?? []
    return providers.contains(provider)
}

struct SessionDetailView: View {
    let session: ProjectAgentSession
    let agent: ProjectAgent?
    let projectAgents: [ProjectAgent]
    let project: Project
    let token: String
    let api: any AuthenticatedDownloadClientProtocol
    let services: AuthenticatedMobileServices
    let realtimeClient: (any MobileRealtimeClientProtocol)?
    let snapshot: DashboardSnapshot?
    let issueConversationView: IssueConversationViewTracker?
    let refreshDashboard: () async -> Void
    let onRelatedMessageOpen: (RelatedMessageReference) -> Void
    let onSkillSessionMaterialized: SkillSessionMaterializedHandler
    let onSkillSessionOpen: SkillSessionOpenHandler

    init(
        session: ProjectAgentSession,
        agent: ProjectAgent?,
        projectAgents: [ProjectAgent] = [],
        project: Project,
        token: String,
        api: any AuthenticatedDownloadClientProtocol,
        services: AuthenticatedMobileServices,
        realtimeClient: (any MobileRealtimeClientProtocol)? = nil,
        snapshot: DashboardSnapshot?,
        issueConversationView: IssueConversationViewTracker? = nil,
        refreshDashboard: @escaping () async -> Void,
        onRelatedMessageOpen: @escaping (RelatedMessageReference) -> Void = { _ in },
        onSkillSessionMaterialized: @escaping SkillSessionMaterializedHandler = { _ in },
        onSkillSessionOpen: @escaping SkillSessionOpenHandler = { _, _ in }
    ) {
        self.session = session
        self.agent = agent
        self.projectAgents = projectAgents
        self.project = project
        self.token = token
        self.api = api
        self.services = services
        self.realtimeClient = realtimeClient
        self.snapshot = snapshot
        self.issueConversationView = issueConversationView
        self.refreshDashboard = refreshDashboard
        self.onRelatedMessageOpen = onRelatedMessageOpen
        self.onSkillSessionMaterialized = onSkillSessionMaterialized
        self.onSkillSessionOpen = onSkillSessionOpen
    }

    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @State private var copied = false

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        List {
            Section(L10n.text("상태")) {
                LabeledContent(L10n.text("상태"), value: session.status.displayName(locale: locale))
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
                    LabeledContent(L10n.text("트리거"), value: trigger.rawValue)
                }
                if let type = session.sessionType {
                    LabeledContent(L10n.text("유형"), value: type.rawValue)
                }
                if let workerLabel = Self.workerLabel(
                    for: session,
                    workers: snapshot?.workers ?? []
                ) {
                    LabeledContent(L10n.text("실행 Worker"), value: workerLabel)
                }
                LabeledContent(L10n.text("시작"), value: L10n.dateTime(session.startedAt, locale: locale))
                if let completedAt = session.completedAt {
                    LabeledContent(L10n.text("완료"), value: L10n.dateTime(completedAt, locale: locale))
                }
            }

            if let request = session.request, !request.isEmpty {
                Section(L10n.text("요청")) { Text(request) }
            }
            if let summary = session.summary, !summary.isEmpty {
                Section(L10n.text("요약")) { MarkdownText(markdown: summary) }
            }
            if let error = session.error, !error.isEmpty {
                Section(L10n.text("오류")) {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section(L10n.text("이슈")) {
                if session.issues.isEmpty {
                    Text(L10n.text("연결된 이슈 없음")).foregroundStyle(.secondary)
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
                                    services: services,
                                    realtimeClient: realtimeClient,
                                    allRuns: snapshot?.runs ?? [],
                                    projectAgents: projectAgents,
                                    workers: snapshot?.workers ?? [],
                                    providers: snapshot?.organizationProviders ?? [],
                                    issueConversationView: issueConversationView,
                                    refresh: refreshDashboard,
                                    onRelatedMessageOpen: onRelatedMessageOpen,
                                    onSkillSessionMaterialized: onSkillSessionMaterialized,
                                    onSkillSessionOpen: onSkillSessionOpen
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
                Section(L10n.text("이벤트")) {
                    ForEach(events) { event in
                        HStack {
                            Text(event.type.rawValue)
                            Spacer()
                            Text(L10n.relativeDate(event.occurredAt, locale: locale))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(L10n.text("세션"))
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
                        Label(L10n.text("세션 공유"), systemImage: "square.and.arrow.up")
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

    static func workerLabel(
        for session: ProjectAgentSession,
        workers: [DashboardWorker]
    ) -> String? {
        guard let workerID = session.workerId ?? session.requestedWorkerId else { return nil }
        return workers.first { $0.id == workerID }?.label ?? workerID
    }

    private func issueLabel(_ issue: ProjectAgentSession.Issue) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(project.issueKey(runNumber: issue.runNumber)) \(issue.title)")
                .font(.headline)
            Text(issue.outcome.displayName(locale: locale))
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
