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
                                SessionRow(
                                    session: session,
                                    agentName: session.agentId.flatMap { agents.agent(id: $0)?.name }
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
            Circle()
                .fill(Color(hex: agent.calendarColor) ?? .accentColor)
                .frame(width: 12, height: 12)
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

    var body: some View {
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
        .padding(.vertical, 2)
    }
}

struct AgentDetailView: View {
    let agent: ProjectAgent
    let sessions: [ProjectAgentSession]
    let onOpenSession: (String) -> Void

    var body: some View {
        List {
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

    @State private var copied = false

    var body: some View {
        List {
            Section("상태") {
                LabeledContent("상태", value: session.status.displayName)
                if let agent {
                    LabeledContent("Agent", value: agent.name)
                }
                if let trigger = session.trigger {
                    LabeledContent("트리거", value: trigger.rawValue)
                }
                if let type = session.sessionType {
                    LabeledContent("유형", value: type.rawValue)
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
                        Label(copied ? "복사됨" : "링크 복사", systemImage: "doc.on.doc")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func issueLabel(_ issue: ProjectAgentSession.Issue) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("#\(issue.runNumber) \(issue.title)").font(.headline)
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
