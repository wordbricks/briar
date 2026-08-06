import SwiftUI

@main
struct BriarCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                UITestCompanionFlow(
                    offline: ProcessInfo.processInfo.arguments.contains("--ui-testing-offline")
                )
            } else {
                CompanionRootView(api: MobileAPIClient(baseURL: Self.apiBaseURL))
            }
        }
        .handlesExternalEvents(matching: Set(arrayLiteral: "*"))
    }

    private static var apiBaseURL: URL {
        let configured = ProcessInfo.processInfo.environment["BRIAR_API_URL"] ??
            "https://briar-api.wbai.workers.dev"
        return URL(string: configured)!
    }
}

private struct UITestCompanionFlow: View {
    @State private var signedIn = false
    @State private var selectedProjectID: UUID?
    @State private var projectSelected = false
    @State private var createdRunStatus: DashboardRun.Status?
    @State private var dependencyAdded = false
    @StateObject private var navigation = CompanionNavigationModel()
    @StateObject private var agents: AgentsStore
    @StateObject private var inbox = InboxStore()
    @StateObject private var notifications = LocalNotificationService()

    let offline: Bool
    private let api = UITestAPIClient()
    private let project = ProjectsResponse.Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_800)
    )
    private let alternateProject = ProjectsResponse.Project(
        id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
        name: "Briar Mobile",
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_900)
    )

    init(offline: Bool) {
        self.offline = offline
        _selectedProjectID = State(initialValue: project.id)
        _agents = StateObject(wrappedValue: AgentsStore(api: UITestAPIClient()))
    }

    var body: some View {
        if offline {
            NavigationStack {
                OfflineStateView(
                    message: "네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.",
                    refresh: {}
                )
                .navigationTitle("Tasks")
                .navigationBarTitleDisplayMode(.inline)
            }
        } else if !signedIn {
            CompanionLoginView(signingIn: false, errorMessage: nil) { signedIn = true }
        } else if !projectSelected {
            ProjectSelectionView(
                projects: [project, alternateProject],
                selectedProjectID: $selectedProjectID,
                continueAction: { projectSelected = true },
                signOut: { signedIn = false }
            )
        } else {
            CompanionShellView(
                navigation: navigation,
                agents: agents,
                inbox: inbox,
                notifications: notifications,
                projects: [project, alternateProject],
                project: selectedProject,
                snapshot: snapshot,
                isRefreshing: false,
                errorMessage: nil,
                token: "ui-test-token",
                api: api,
                ideas: IdeasStore(api: api),
                user: CurrentUserResponse.User(
                    id: "fixture-user",
                    username: "briar_user",
                    name: "Briar User",
                    email: "user@example.com",
                    image: nil
                ),
                refresh: { await refreshSnapshot() },
                selectProject: { selectedProjectID = $0 },
                signOut: {
                    projectSelected = false
                    signedIn = false
                }
            )
            .task {
                agents.select(projectID: selectedProject.id, token: "ui-test-token", locale: "ko")
                inbox.update(snapshot: snapshot, sessions: agents.sessions, project: selectedProject)
            }
        }
    }

    private var selectedProject: ProjectsResponse.Project {
        [project, alternateProject].first(where: { $0.id == selectedProjectID }) ?? project
    }

    private var snapshot: DashboardSnapshot {
        var runs = [
            DashboardRun(
                id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                runNumber: 3832,
                title: "iOS Native Companion 읽기 경험",
                status: .running,
                workflowStage: "implementing",
                progress: 45,
                detail: "앱 셸과 작업 상세를 구현하는 중",
                issueDescription: "## 목표\n로그인부터 상세까지 안전하게 읽습니다.",
                attachments: [IssueAttachment(
                    id: UUID(uuidString: "aaaaaaaa-1111-4111-8111-111111111111")!,
                    filename: "issue-design.png",
                    contentType: "image/png",
                    byteSize: 68,
                    url: "/ui-test/issue-design.png"
                )],
                resultSummary: nil,
                updatedAt: Date(timeIntervalSince1970: 1_775_264_400)
            ),
            DashboardRun(
                id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
                title: "공유 API 계약 검증",
                status: .completed,
                workflowStage: "merged",
                detail: "iOS와 Android 계약 통과",
                resultSummary: "공유 계약이 검증되었습니다.",
                workerId: "worker-1",
                updatedAt: Date(timeIntervalSince1970: 1_775_264_300),
                completedAt: Date(timeIntervalSince1970: 1_775_264_300)
            ),
            DashboardRun(
                id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
                title: "오프라인 복구 확인",
                status: .blocked,
                detail: "네트워크 확인 필요",
                updatedAt: Date(timeIntervalSince1970: 1_775_264_200)
            ),
            DashboardRun(
                id: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
                title: "실패 상태 예시",
                status: .failed,
                detail: "재시도 가능",
                updatedAt: Date(timeIntervalSince1970: 1_775_264_100)
            ),
            DashboardRun(
                id: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
                runNumber: 3834,
                title: "의존성 연결 대상",
                status: .queued,
                detail: "선행 이슈를 선택할 수 있습니다.",
                prerequisites: dependencyAdded ? [IssueDependencyReference(
                    id: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
                    runNumber: 3835,
                    title: "의존성 후보: API 준비",
                    status: .completed
                )] : nil,
                updatedAt: Date(timeIntervalSince1970: 1_775_264_350)
            ),
            DashboardRun(
                id: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
                runNumber: 3835,
                title: "의존성 후보: API 준비",
                status: .completed,
                detail: "검색으로 선택할 선행 이슈",
                updatedAt: Date(timeIntervalSince1970: 1_775_264_250),
                completedAt: Date(timeIntervalSince1970: 1_775_264_250)
            ),
        ]
        if let createdRunStatus {
            runs.insert(DashboardRun(
                id: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
                runNumber: 3833,
                title: "모바일 쓰기 흐름 확인",
                status: createdRunStatus,
                workflowStage: createdRunStatus == .running ? "analyzing" : nil,
                workflow: AutoHuntWorkflow(
                    version: 1,
                    stages: [
                        .init(id: "analyzing", label: "분석", required: true),
                        .init(id: "implementing", label: "구현", required: true),
                    ]
                ),
                detail: createdRunStatus == .running ? "Worker가 실행을 시작했습니다." : nil,
                updatedAt: Date(timeIntervalSince1970: 1_775_264_500)
            ), at: 0)
        }
        return DashboardSnapshot(
            project: selectedProject,
            runs: runs,
            workers: [DashboardWorker(
                id: "worker-1",
                label: "Mac Studio",
                icon: .init(type: .emoji, value: "🍋"),
                agentProvider: .codex,
                providers: [.codex],
                readiness: "available",
                readinessDetail: "작업 수신 가능",
                activeSessions: 1,
                availableSessions: 2
            )],
            organizationProviders: [.codex],
            conversationNotifications: [],
            cursor: 41,
            generatedAt: Date(timeIntervalSince1970: 1_775_264_400)
        )
    }

    private func refreshSnapshot() async {
        createdRunStatus = await api.createdIssueStatus()
        dependencyAdded = await api.createdDependencyAdded()
    }
}

private actor UITestAPIClient: MobileAPIClientProtocol {
    private var issueStatus: DashboardRun.Status?
    private var dependencyAdded = false

    func createdIssueStatus() -> DashboardRun.Status? { issueStatus }
    func createdDependencyAdded() -> Bool { dependencyAdded }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let payload: String
        if path.hasSuffix("/issues") && method == "POST" {
            issueStatus = .queued
            payload = #"{"runId":"77777777-7777-4777-8777-777777777777","sourceKey":"briar-issue:ui-test","stage":"queued","status":"queued","attachments":[]}"#
        } else if path.hasSuffix("/dispatch") && method == "POST" {
            issueStatus = .running
            payload = #"{"runId":"77777777-7777-4777-8777-777777777777","agentId":null,"provider":"codex","model":null,"effort":null,"requestedWorkerId":null,"requestedByUserId":"fixture-user","dispatchMode":"any","dispatchedAt":"2026-08-02T01:01:00Z","outcome":"dispatched"}"#
        } else if path.hasSuffix("/retry") && method == "POST" {
            payload = #"{"runId":"66666666-6666-4666-8666-666666666666","outcome":"retried","attempt":2,"stage":"queued"}"#
        } else if path.hasSuffix("/cancel") && method == "POST" {
            payload = #"{"runId":"66666666-6666-4666-8666-666666666666","outcome":"cancelled","attempt":1,"stage":"cancelled"}"#
        } else if path.hasSuffix("/status") {
            payload = #"{"runId":"66666666-6666-4666-8666-666666666666","outcome":"moved","status":"queued","workflowStage":null}"#
        } else if path.hasSuffix("/preferences") {
            payload = #"{"runId":"66666666-6666-4666-8666-666666666666","provider":"codex","model":"gpt-5.6-sol","effort":"high"}"#
        } else if path.hasSuffix("/result-reviews") {
            payload = #"{"userId":"fixture-user","name":"Briar User","username":"briar_user","image":null,"completedAt":"2026-08-02T01:01:00Z"}"#
        } else if path.contains("/dependencies/") && method == "PUT" {
            dependencyAdded = true
            payload = #"{"prerequisiteRunId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","dependentRunId":"99999999-9999-4999-8999-999999999999","outcome":"created"}"#
        } else if path.hasSuffix("/messages") && method == "POST" {
            payload = #"{"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"77777777-7777-4777-8777-777777777777","parentMessageId":null,"body":"모바일에서 확인했습니다","author":{"id":"fixture-user","name":"Briar User","image":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","provider":null},"replyCount":0,"createdAt":"2026-08-02T01:02:00Z","updatedAt":"2026-08-02T01:02:00Z"},"agentReply":null}"#
        } else if path.hasSuffix("/events") {
            payload = #"{"events":[]}"#
        } else if path.hasSuffix("/messages") {
            payload = #"{"messages":[]}"#
        } else if path.hasSuffix("/evidence") {
            payload = #"{"evidence":[{"key":"ui-test:evidence:image","attempt":1,"revision":1,"stage":"reviewing","type":"review findings","status":"passed","detail":"완성 화면","url":null,"actor":"codex","observedAt":"2026-08-02T01:03:00Z","images":[{"id":"bbbbbbbb-2222-4222-8222-222222222222","filename":"result-screen.png","contentType":"image/png","byteSize":68,"url":"/ui-test/result-screen.png"}],"canonical":true}]}"#
        } else if path.contains("/agents") {
            payload = ##"""
            {"agents":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","name":"Issue processing agent","avatar":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","codexPet":null,"provider":"codex","model":"gpt-5.4","responsibility":"Process every queued issue.","skill":"# Issue processing agent","calendarColor":"#3275d5","createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"}]}
            """##
        } else if path.contains("/agent-sessions") {
            payload = ##"""
            {"sessions":[{"id":"session-fixture-1","projectId":"11111111-1111-4111-8111-111111111111","dispatchGroupId":"dispatch-1","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","sessionType":"task","trigger":"manual","scheduleId":null,"scheduleRunId":null,"parentSessionId":null,"request":"Complete native inbox work","status":"completed","issues":[{"runId":"33333333-3333-4333-8333-333333333333","runNumber":3832,"sourceKey":"briar-issue:ui-test","title":"iOS Native Companion","outcome":"completed","summary":"Done"}],"startedAt":"2026-08-02T01:00:00Z","completedAt":"2026-08-02T01:05:00Z","conversationId":null,"workspaceRoot":null,"summary":"Completed","error":null,"events":[{"id":"event-1","type":"started","occurredAt":"2026-08-02T01:00:00Z"},{"id":"event-2","type":"completed","occurredAt":"2026-08-02T01:05:00Z"}],"dispatchEvents":[],"workers":[],"updatedAt":"2026-08-02T01:05:00Z"}]}
            """##
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }

    func sendVoid(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?
    ) async throws {}

    func download(_ path: String, token: String, to destination: URL) async throws -> URL {
        guard path.hasPrefix("/ui-test/") else { throw MobileAPIError.invalidDownload }
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try png.write(to: destination, options: .atomic)
        return destination
    }
}
