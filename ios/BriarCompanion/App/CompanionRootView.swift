import SwiftUI

struct CompanionRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("companion-appearance") private var appearance = CompanionAppearance.system.rawValue
    @AppStorage("companion-locale") private var localeRaw = CompanionLocale.ko.rawValue
    @StateObject private var session: SessionStore
    @StateObject private var companion: CompanionStore
    @StateObject private var dashboard: DashboardStore
    @StateObject private var realtime: OrganizationRealtimeStore
    @StateObject private var channels: ChannelsStore
    @StateObject private var agents: AgentsStore
    @StateObject private var inbox: InboxStore
    @StateObject private var notifications: LocalNotificationService
    @StateObject private var issueConversationView = IssueConversationViewTracker()
    @StateObject private var navigation = CompanionNavigationModel()
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
        _realtime = StateObject(
            wrappedValue: OrganizationRealtimeStore(api: api)
        )
        _channels = StateObject(
            wrappedValue: ChannelsStore(api: api, managesRealtime: false)
        )
        _agents = StateObject(wrappedValue: AgentsStore(api: api))
        _inbox = StateObject(
            wrappedValue: InboxStore(api: api, pollInterval: .seconds(60))
        )
        _notifications = StateObject(wrappedValue: LocalNotificationService())
        authorization = DeviceAuthorizationService(api: api)
        self.presenter = presenter
    }

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        Group {
            if session.token == nil {
                CompanionLoginView(signingIn: signingIn, errorMessage: authError) {
                    Task { await signIn() }
                }
            } else if companion.loading && companion.user == nil {
                ProgressView(L10n.text("계정을 불러오는 중…", locale: locale))
            } else if companion.user != nil, !projectSelectionComplete {
                ProjectSelectionView(
                    projects: companion.projects,
                    selectedProjectID: $companion.selectedProjectID,
                    continueAction: {
                        projectSelectionComplete = true
                        applyPendingProjectIfNeeded()
                    },
                    signOut: signOut
                )
            } else if let token = session.token,
                      let projectID = companion.selectedProjectID,
                      let project = companion.projects.first(where: { $0.id == projectID }) {
                authenticatedContent(token: token, project: project)
            } else {
                recoveryView
            }
        }
        .preferredColorScheme(CompanionAppearance(rawValue: appearance)?.colorScheme)
        .task(id: session.token) {
            guard let token = session.token else {
                companion.clear()
                dashboard.select(projectID: nil, token: nil)
                realtime.select(organizationID: nil, token: nil)
                channels.select(organizationID: nil, token: nil)
                agents.select(projectID: nil, token: nil, locale: locale.rawValue)
                inbox.configure(token: nil, userID: nil)
                projectSelectionComplete = false
                return
            }
            do {
                try await companion.load(token: token)
                inbox.configure(
                    token: token,
                    userID: companion.user?.id,
                    organizationID: currentProject?.organizationId
                )
                applyPendingProjectIfNeeded()
                // Auto-select a project after load: CompanionStore restores the
                // last used project, or the first project of the first
                // organization on first use. The selection screen only appears
                // when the account has no projects at all.
                projectSelectionComplete = companion.selectedProjectID != nil
            } catch let MobileAPIError.httpStatus(status, _) where status == 401 {
                try? session.signOut()
            } catch {
                // The recovery screen owns transport retries.
            }
        }
        .onChange(of: companion.user?.id) { _, userID in
            inbox.configure(
                token: session.token,
                userID: userID,
                organizationID: currentProject?.organizationId
            )
        }
        .onChange(of: projectSelectionComplete, initial: true) { _, complete in
            updateProjectScopedStores(active: complete)
        }
        .onChange(of: companion.selectedProjectID) { _, _ in
            guard projectSelectionComplete else { return }
            updateProjectScopedStores(active: true)
        }
        .onChange(of: localeRaw) { _, _ in
            guard projectSelectionComplete else { return }
            updateProjectScopedStores(active: true)
        }
        .onChange(of: dashboard.snapshot) { _, snapshot in
            guard let project = currentProject else { return }
            inbox.update(snapshot: snapshot, sessions: agents.sessions, project: project)
        }
        .onChange(of: agents.sessions) { _, sessions in
            guard let project = currentProject else { return }
            inbox.update(snapshot: dashboard.snapshot, sessions: sessions, project: project)
        }
        .onChange(of: inbox.messages) { _, messages in
            // Empty lists are produced while account/organization scope is
            // being reset. Let the first populated snapshot establish that
            // scope's notification baseline instead of treating it as new.
            guard !messages.isEmpty else { return }
            let baselineID = inbox.notificationBaselineID
            Task {
                let viewingChannelID = scenePhase == .active
                    ? channels.viewingChannelID
                    : nil
                let viewingIssueConversationID = scenePhase == .active
                    ? issueConversationView.runID
                    : nil
                if viewingChannelID != nil {
                    await channels.refreshChanges()
                }
                if viewingIssueConversationID != nil {
                    await issueConversationView.refreshChanges()
                }
                await notifications.process(
                    messages: messages,
                    baselineID: baselineID,
                    viewingChannelID: viewingChannelID,
                    viewingIssueConversationID: viewingIssueConversationID
                )
            }
        }
        .onChange(of: inbox.feedReady) { _, ready in
            guard ready else { return }
            let baselineID = inbox.notificationBaselineID
            let messages = inbox.messages
            Task {
                let viewingChannelID = scenePhase == .active
                    ? channels.viewingChannelID
                    : nil
                let viewingIssueConversationID = scenePhase == .active
                    ? issueConversationView.runID
                    : nil
                if viewingChannelID != nil {
                    await channels.refreshChanges()
                }
                if viewingIssueConversationID != nil {
                    await issueConversationView.refreshChanges()
                }
                await notifications.process(
                    messages: messages,
                    baselineID: baselineID,
                    viewingChannelID: viewingChannelID,
                    viewingIssueConversationID: viewingIssueConversationID
                )
            }
        }
        .onChange(of: realtime.notificationSequence) { _, _ in
            guard let notification = realtime.latestNotification else { return }
            inbox.receiveRealtimeNotification(notification)
            Task {
                await channels.receiveRealtimeNotification(notification)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                dashboard.applicationDidBecomeActive()
                realtime.applicationDidBecomeActive()
                channels.applicationDidBecomeActive()
                agents.applicationDidBecomeActive()
                inbox.applicationDidBecomeActive()
            case .background:
                dashboard.applicationDidEnterBackground()
                realtime.applicationDidEnterBackground()
                channels.applicationDidEnterBackground()
                agents.applicationDidEnterBackground()
                inbox.applicationDidEnterBackground()
            default: break
            }
        }
        .onChange(of: navigation.pendingProjectID) { _, projectID in
            guard projectID != nil else { return }
            Task {
                await refreshAndApplyPendingProjectIfNeeded()
            }
        }
        .onOpenURL { url in
            handleIncomingURL(url)
        }
    }

    private func authenticatedContent(
        token: String,
        project: ProjectsResponse.Project
    ) -> some View {
        CompanionShellView(
            navigation: navigation,
            agents: agents,
            inbox: inbox,
            notifications: notifications,
            channels: channels,
            issueConversationView: issueConversationView,
            projects: companion.projects,
            project: project,
            snapshot: dashboard.snapshot,
            errorMessage: dashboard.errorMessage,
            token: token,
            api: api,
            user: companion.user,
            refresh: { await dashboard.refresh(forceSnapshot: true) },
            ensureIssueAvailable: { projectID, runID in
                guard let target = companion.projects.first(where: {
                    $0.id == projectID
                }) else { return false }
                // Keep the account selection and every project-scoped store
                // aligned before loading the canonical dashboard.
                companion.selectedProjectID = projectID
                dashboard.select(projectID: projectID, token: token)
                channels.select(
                    organizationID: target.organizationId,
                    token: token
                )
                agents.select(
                    projectID: projectID,
                    token: token,
                    locale: locale.rawValue
                )
                return await dashboard.ensureRunAvailable(
                    projectID: projectID,
                    runID: runID,
                    token: token
                )
            },
            selectProject: { companion.selectedProjectID = $0 },
            signOut: signOut
        )
    }

    private var currentProject: ProjectsResponse.Project? {
        guard let projectID = companion.selectedProjectID else { return nil }
        return companion.projects.first(where: { $0.id == projectID })
    }

    private var recoveryView: some View {
        ContentUnavailableView {
            Label(L10n.text("연결할 수 없음", locale: locale), systemImage: "wifi.exclamationmark")
        } description: {
            Text(L10n.text(companion.errorMessage ?? "계정 정보를 불러오지 못했습니다.", locale: locale))
        } actions: {
            Button(L10n.text("다시 시도", locale: locale)) {
                guard let token = session.token else { return }
                Task { try? await companion.load(token: token) }
            }
            .accessibilityIdentifier("account-retry-button")
            Button(L10n.text("로그아웃", locale: locale), role: .destructive) { signOut() }
        }
    }

    private func updateProjectScopedStores(active: Bool) {
        let projectID = active ? companion.selectedProjectID : nil
        let token = active ? session.token : nil
        let organizationID = projectID.flatMap { id in
            companion.projects.first(where: { $0.id == id })?.organizationId
        }
        dashboard.select(projectID: projectID, token: token)
        realtime.select(organizationID: organizationID, token: token)
        // Channels follow the selected project's organization, not the project.
        channels.select(
            organizationID: projectID.flatMap { id in
                companion.projects.first(where: { $0.id == id })?.organizationId
            },
            token: token
        )
        agents.select(
            projectID: projectID,
            token: token,
            locale: locale.rawValue
        )
        inbox.configure(
            token: token,
            userID: companion.user?.id,
            organizationID: organizationID
        )
    }

    private func applyPendingProjectIfNeeded() {
        guard let pending = navigation.pendingProjectID else { return }
        if companion.projects.contains(where: { $0.id == pending }) {
            companion.selectedProjectID = pending
            if session.token != nil {
                projectSelectionComplete = true
            }
        }
    }

    private func refreshAndApplyPendingProjectIfNeeded() async {
        guard let pending = navigation.pendingProjectID else { return }
        guard let token = session.token else { return }
        if !companion.projects.contains(where: { $0.id == pending }) {
            do {
                try await companion.refreshProjects(token: token)
            } catch {
                // Clear the routing key so another tap can trigger a fresh
                // catalog lookup instead of leaving navigation stuck forever.
                if navigation.pendingProjectID == pending {
                    navigation.pendingProjectID = nil
                }
                return
            }
        }
        guard navigation.pendingProjectID == pending else { return }
        applyPendingProjectIfNeeded()
        if companion.selectedProjectID != pending {
            // A successful refresh can still race eventual project creation.
            // Clear only this unresolved request so tapping the link again
            // performs a new catalog lookup.
            navigation.pendingProjectID = nil
        }
    }

    private func handleIncomingURL(_ url: URL) {
        // Device auth callback is handled by ASWebAuthenticationSession.
        if url.host == "auth-complete" { return }
        guard let target = BriarLinkParser.parse(url) else { return }
        navigation.open(target)
        if case let .channel(organizationID, _, _, _) = target,
           navigation.pendingProjectID == nil,
           let project = companion.projects.first(where: {
               $0.organizationId == organizationID
           }) {
            navigation.pendingProjectID = project.id
        }
        applyPendingProjectIfNeeded()
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
            authError = L10n.text("로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", locale: locale)
        }
    }

    private func signOut() {
        dashboard.select(projectID: nil, token: nil)
        channels.select(organizationID: nil, token: nil)
        agents.select(projectID: nil, token: nil, locale: locale.rawValue)
        inbox.configure(token: nil, userID: nil, organizationID: nil)
        companion.clear()
        projectSelectionComplete = false
        Task { await AppBadgeService.sync(count: 0) }
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
                Text(L10n.text("프로젝트 진행 상황을 iPhone에서 안전하게 확인하세요."))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Button(action: action) {
                if signingIn {
                    ProgressView().tint(.white)
                } else {
                    Text(L10n.text("Briar로 로그인"))
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
                Label(L10n.text("연결된 프로젝트 없음"), systemImage: "folder.badge.questionmark")
            } description: {
                Text(L10n.text("Briar Desktop에서 프로젝트와 저장소를 연결한 뒤 다시 확인해 주세요."))
            } actions: {
                Button(L10n.text("로그아웃"), role: .destructive, action: signOut)
            }
        } else {
            NavigationStack {
                Form {
                    Section(L10n.text("조직")) {
                        Picker(L10n.text("조직"), selection: organizationSelection) {
                            ForEach(organizations) { organization in
                                Text(organization.name).tag(Optional(organization.id))
                            }
                        }
                        .accessibilityIdentifier("organization-picker")
                    }
                    Section {
                        ForEach(visibleProjects, id: \.id) { project in
                            Button {
                                selectedProjectID = project.id
                            } label: {
                                HStack(spacing: 12) {
                                    ProjectIconView(icon: project.icon, size: 28)
                                    Text(project.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if project.id == selectedProjectID {
                                        Image(systemName: "checkmark")
                                            .font(.footnote.weight(.semibold))
                                            .foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(project.id == selectedProjectID ? .isSelected : [])
                            .accessibilityIdentifier("project-picker")
                        }
                    } header: {
                        Text(L10n.text("확인할 프로젝트"))
                    } footer: {
                        Text(L10n.text("Companion은 선택한 프로젝트의 정보를 읽기 전용으로 표시합니다."))
                    }
                    Section {
                        Button(L10n.text("계속")) { continueAction() }
                            .frame(maxWidth: .infinity)
                            .disabled(selectedProjectID == nil)
                            .accessibilityIdentifier("project-continue-button")
                    }
                }
                .navigationTitle(L10n.text("프로젝트 선택"))
            }
        }
    }
}

enum CompanionAppearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String { localizedTitle(locale: .current) }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
