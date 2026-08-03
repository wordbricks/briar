import SwiftUI

struct CompanionRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var session: SessionStore
    @StateObject private var companion: CompanionStore
    @StateObject private var dashboard: DashboardStore
    @StateObject private var ideas: IdeasStore
    @State private var signingIn = false
    @State private var authError: String?

    private let authorization: DeviceAuthorizationService
    private let presenter: any WebAuthenticationPresenting

    @MainActor
    init(
        api: any MobileAPIClientProtocol,
        session: SessionStore = SessionStore(),
        presenter: any WebAuthenticationPresenting = ASWebAuthenticationPresenter()
    ) {
        _session = StateObject(wrappedValue: session)
        _companion = StateObject(wrappedValue: CompanionStore(api: api))
        _dashboard = StateObject(wrappedValue: DashboardStore(api: api))
        _ideas = StateObject(wrappedValue: IdeasStore(api: api))
        authorization = DeviceAuthorizationService(api: api)
        self.presenter = presenter
    }

    var body: some View {
        Group {
            if session.token == nil {
                loginView
            } else if companion.loading && companion.user == nil {
                ProgressView("계정을 불러오는 중…")
            } else if let token = session.token, companion.user != nil {
                dashboardView(token: token)
            } else {
                recoveryView
            }
        }
        .task(id: session.token) {
            guard let token = session.token else {
                companion.clear()
                dashboard.select(projectID: nil, token: nil)
                ideas.select(projectID: nil, token: nil)
                return
            }
            do {
                try await companion.load(token: token)
            } catch let MobileAPIError.httpStatus(status, _) where status == 401 {
                try? session.signOut()
            } catch {
                // The recovery screen owns retries for transport failures.
            }
        }
        .onChange(of: companion.selectedProjectID, initial: true) { _, projectID in
            dashboard.select(projectID: projectID, token: session.token)
            ideas.select(projectID: projectID, token: session.token)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: dashboard.applicationDidBecomeActive()
            case .background: dashboard.applicationDidEnterBackground()
            default: break
            }
        }
    }

    private var loginView: some View {
        VStack(spacing: 22) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 54, weight: .semibold))
                .foregroundStyle(.green)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Briar Companion")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("login-title")
                Text("프로젝트 진행 상황을 iPhone에서 안전하게 확인하세요.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await signIn() }
            } label: {
                if signingIn {
                    ProgressView().tint(.white)
                } else {
                    Text("Briar로 로그인")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(signingIn)
            .accessibilityIdentifier("login-button")
            if let authError {
                Text(authError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
    }

    private func dashboardView(token: String) -> some View {
        TabView {
            NavigationStack {
                DashboardContentView(
                    projects: companion.projects,
                    selectedProjectID: $companion.selectedProjectID,
                    snapshot: dashboard.snapshot,
                    isRefreshing: dashboard.isRefreshing,
                    errorMessage: dashboard.errorMessage,
                    refresh: { await dashboard.refresh(forceSnapshot: true) },
                    signOut: {
                        dashboard.select(projectID: nil, token: nil)
                        ideas.select(projectID: nil, token: nil)
                        companion.clear()
                        try? session.signOut()
                    }
                )
                .navigationTitle("Dashboard")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Text(companion.user?.email ?? "")
                            Button("로그아웃", role: .destructive) {
                                dashboard.select(projectID: nil, token: nil)
                                ideas.select(projectID: nil, token: nil)
                                companion.clear()
                                try? session.signOut()
                            }
                        } label: {
                            Image(systemName: "person.crop.circle")
                        }
                    }
                }
            }
            .tabItem { Label("실행", systemImage: "list.bullet.rectangle") }

            NavigationStack {
                IdeasNativeView(
                    store: ideas,
                    projectID: companion.selectedProjectID,
                    token: token
                )
            }
            .tabItem { Label("아이디어", systemImage: "lightbulb") }
        }
    }

    private var recoveryView: some View {
        ContentUnavailableView {
            Label("연결할 수 없음", systemImage: "wifi.exclamationmark")
        } description: {
            Text(companion.errorMessage ?? "계정 정보를 불러오지 못했습니다.")
        } actions: {
            Button("다시 시도") {
                guard let token = session.token else { return }
                Task { try? await companion.load(token: token) }
            }
            Button("로그아웃", role: .destructive) { try? session.signOut() }
        }
    }

    private func signIn() async {
        signingIn = true
        authError = nil
        defer { signingIn = false }
        do {
            let token = try await authorization.authorize(using: presenter)
            try session.signIn(token: token)
        } catch DeviceAuthorizationError.cancelled {
            return
        } catch {
            authError = "로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
    }
}

struct DashboardContentView: View {
    let projects: [ProjectsResponse.Project]
    @Binding var selectedProjectID: UUID?
    let snapshot: DashboardSnapshot?
    let isRefreshing: Bool
    let errorMessage: String?
    let refresh: () async -> Void
    let signOut: () -> Void

    var body: some View {
        List {
            Section {
                Picker("프로젝트", selection: $selectedProjectID) {
                    ForEach(projects, id: \.id) { project in
                        Text("\(project.organizationName) · \(project.name)")
                            .tag(Optional(project.id))
                    }
                }
                .accessibilityIdentifier("project-picker")
            }
            if let errorMessage, !errorMessage.isEmpty {
                Section {
                    Label(errorMessage, systemImage: "wifi.exclamationmark")
                        .foregroundStyle(.orange)
                }
            }
            Section("실행") {
                if let snapshot, snapshot.runs.isEmpty {
                    ContentUnavailableView("실행 없음", systemImage: "tray")
                } else if let snapshot {
                    ForEach(snapshot.runs) { run in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(run.title).font(.headline)
                                Spacer()
                                Text(run.status.displayName)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(color(for: run.status))
                            }
                            if let detail = run.detail, !detail.isEmpty {
                                Text(detail)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .accessibilityIdentifier("dashboard-run-\(run.id.uuidString)")
                    }
                } else {
                    HStack {
                        Spacer()
                        ProgressView("Dashboard 동기화 중…")
                        Spacer()
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
        .refreshable { await refresh() }
        .overlay(alignment: .top) {
            if isRefreshing { ProgressView().padding(.top, 8) }
        }
        .accessibilityIdentifier("dashboard-list")
    }

    private func color(for status: DashboardRun.Status) -> Color {
        switch status {
        case .completed: .green
        case .failed, .blocked: .red
        case .running: .blue
        default: .secondary
        }
    }
}
