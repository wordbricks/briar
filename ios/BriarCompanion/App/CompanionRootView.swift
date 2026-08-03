import SwiftUI

struct CompanionRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @StateObject private var session: SessionStore
    @StateObject private var companion: CompanionStore
    @StateObject private var dashboard: DashboardStore
    @StateObject private var ideas: IdeasStore
    @State private var signingIn = false
    @State private var authError: String?
    @State private var projectSelectionComplete = false

    private let api: any MobileAPIClientProtocol
    private let authorization: DeviceAuthorizationService
    private let presenter: any WebAuthenticationPresenting

    @MainActor
    init(api: any MobileAPIClientProtocol) {
        self.init(
            api: api,
            session: SessionStore(),
            presenter: ASWebAuthenticationPresenter()
        )
    }

    @MainActor
    init(
        api: any MobileAPIClientProtocol,
        session: SessionStore,
        presenter: any WebAuthenticationPresenting
    ) {
        self.api = api
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
                CompanionLoginView(signingIn: signingIn, errorMessage: authError) {
                    Task { await signIn() }
                }
            } else if companion.loading && companion.user == nil {
                ProgressView("계정을 불러오는 중…")
            } else if companion.user != nil, !projectSelectionComplete {
                ProjectSelectionView(
                    projects: companion.projects,
                    selectedProjectID: $companion.selectedProjectID,
                    continueAction: { projectSelectionComplete = true },
                    signOut: signOut
                )
            } else if let token = session.token,
                      let projectID = companion.selectedProjectID,
                      let project = companion.projects.first(where: { $0.id == projectID }) {
                CompanionShellView(
                    project: project,
                    snapshot: dashboard.snapshot,
                    isRefreshing: dashboard.isRefreshing,
                    errorMessage: dashboard.errorMessage,
                    token: token,
                    api: api,
                    ideas: ideas,
                    refresh: { await dashboard.refresh(forceSnapshot: true) },
                    changeProject: { projectSelectionComplete = false },
                    signOut: signOut
                )
            } else {
                recoveryView
            }
        }
        .preferredColorScheme(CompanionAppearance(rawValue: appearance)?.colorScheme)
        .task(id: session.token) {
            guard let token = session.token else {
                companion.clear()
                dashboard.select(projectID: nil, token: nil)
                ideas.select(projectID: nil, token: nil)
                projectSelectionComplete = false
                return
            }
            do {
                try await companion.load(token: token)
                projectSelectionComplete = false
            } catch let MobileAPIError.httpStatus(status, _) where status == 401 {
                try? session.signOut()
            } catch {
                // The recovery screen owns transport retries.
            }
        }
        .onChange(of: projectSelectionComplete, initial: true) { _, complete in
            dashboard.select(
                projectID: complete ? companion.selectedProjectID : nil,
                token: complete ? session.token : nil
            )
            ideas.select(
                projectID: complete ? companion.selectedProjectID : nil,
                token: complete ? session.token : nil
            )
        }
        .onChange(of: companion.selectedProjectID) { _, projectID in
            guard projectSelectionComplete else { return }
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
            .accessibilityIdentifier("account-retry-button")
            Button("로그아웃", role: .destructive) { signOut() }
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

    private func signOut() {
        dashboard.select(projectID: nil, token: nil)
        ideas.select(projectID: nil, token: nil)
        companion.clear()
        projectSelectionComplete = false
        try? session.signOut()
    }
}

struct CompanionLoginView: View {
    let signingIn: Bool
    let errorMessage: String?
    let action: () -> Void

    var body: some View {
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
            Button(action: action) {
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
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
    }
}

struct ProjectSelectionView: View {
    let projects: [ProjectsResponse.Project]
    @Binding var selectedProjectID: UUID?
    let continueAction: () -> Void
    let signOut: () -> Void

    private var organizations: [OrganizationSummary] {
        Dictionary(grouping: projects, by: \.organizationId)
            .compactMap { id, projects in
                projects.first.map { OrganizationSummary(id: id, name: $0.organizationName) }
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var selectedOrganizationID: UUID? {
        projects.first(where: { $0.id == selectedProjectID })?.organizationId ??
            organizations.first?.id
    }

    private var organizationSelection: Binding<UUID?> {
        Binding(
            get: { selectedOrganizationID },
            set: { organizationID in
                guard let organizationID else { return }
                if projects.first(where: { $0.id == selectedProjectID })?.organizationId != organizationID {
                    selectedProjectID = projects.first(where: {
                        $0.organizationId == organizationID
                    })?.id
                }
            }
        )
    }

    private var visibleProjects: [ProjectsResponse.Project] {
        guard let selectedOrganizationID else { return projects }
        return projects.filter { $0.organizationId == selectedOrganizationID }
    }

    var body: some View {
        if projects.isEmpty {
            ContentUnavailableView {
                Label("연결된 프로젝트 없음", systemImage: "folder.badge.questionmark")
            } description: {
                Text("Briar Desktop에서 프로젝트와 저장소를 연결한 뒤 다시 확인해 주세요.")
            } actions: {
                Button("로그아웃", role: .destructive, action: signOut)
            }
        } else {
            NavigationStack {
                Form {
                    Section("조직") {
                        Picker("조직", selection: organizationSelection) {
                            ForEach(organizations) { organization in
                                Text(organization.name).tag(Optional(organization.id))
                            }
                        }
                        .accessibilityIdentifier("organization-picker")
                    }
                    Section {
                        Picker("프로젝트", selection: $selectedProjectID) {
                            ForEach(visibleProjects, id: \.id) { project in
                                Text(project.name)
                                    .tag(Optional(project.id))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                        .accessibilityIdentifier("project-picker")
                    } header: {
                        Text("확인할 프로젝트")
                    } footer: {
                        Text("Companion은 선택한 프로젝트의 정보를 읽기 전용으로 표시합니다.")
                    }
                    Section {
                        Button("계속") { continueAction() }
                            .frame(maxWidth: .infinity)
                            .disabled(selectedProjectID == nil)
                            .accessibilityIdentifier("project-continue-button")
                    }
                }
                .navigationTitle("프로젝트 선택")
            }
        }
    }
}

enum CompanionAppearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "시스템"
        case .light: "라이트"
        case .dark: "다크"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
