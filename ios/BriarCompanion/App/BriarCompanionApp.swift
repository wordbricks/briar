import SwiftUI

@main
struct BriarCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                UITestCompanionFlow(
                    offline: ProcessInfo.processInfo.arguments.contains("--ui-testing-offline"),
                    locale: ProcessInfo.processInfo.arguments.contains("--ui-testing-english") ? .en : .ko,
                    delaysMessageSend: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-delayed-message-send"
                    ),
                    hasChannelHistory: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-channel-history"
                    )
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
    @State private var createdRunStatus: DashboardRun.Status?
    @State private var dependencyAdded = false
    @StateObject private var navigation = CompanionNavigationModel()
    @StateObject private var agents: AgentsStore
    @StateObject private var channels: ChannelsStore
    @StateObject private var inbox = InboxStore()
    @StateObject private var notifications = LocalNotificationService()
    @StateObject private var issueConversationView = IssueConversationViewTracker()

    let offline: Bool
    let locale: CompanionLocale
    private let api: UITestAPIClient
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

    init(
        offline: Bool,
        locale: CompanionLocale,
        delaysMessageSend: Bool,
        hasChannelHistory: Bool
    ) {
        self.offline = offline
        self.locale = locale
        api = UITestAPIClient(delaysMessageSend: delaysMessageSend)
        UserDefaults.standard.set(locale.rawValue, forKey: "companion-locale")
        _selectedProjectID = State(initialValue: project.id)
        _agents = StateObject(wrappedValue: AgentsStore(api: UITestAPIClient()))
        _channels = StateObject(wrappedValue: ChannelsStore(
            api: UITestAPIClient(hasChannelHistory: hasChannelHistory)
        ))
    }

    var body: some View {
        if offline {
            NavigationStack {
                OfflineStateView(
                    message: L10n.text("네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다."),
                    refresh: {}
                )
                .navigationTitle("Tasks")
                .navigationBarTitleDisplayMode(.inline)
            }
        } else if !signedIn {
            CompanionLoginView(signingIn: false, errorMessage: nil) { signedIn = true }
        } else {
            CompanionShellView(
                navigation: navigation,
                agents: agents,
                inbox: inbox,
                notifications: notifications,
                channels: channels,
                issueConversationView: issueConversationView,
                projects: [project, alternateProject],
                project: selectedProject,
                snapshot: snapshot,
                errorMessage: nil,
                token: "ui-test-token",
                api: api,
                user: CurrentUserResponse.User(
                    id: "fixture-user",
                    username: "briar_user",
                    name: "Briar User",
                    email: "user@example.com",
                    image: nil
                ),
                refresh: { await refreshSnapshot() },
                ensureIssueAvailable: { projectID, runID in
                    selectedProjectID = projectID
                    await refreshSnapshot()
                    return snapshot.project.id == projectID &&
                        snapshot.runs.contains(where: { $0.id == runID })
                },
                selectProject: { selectedProjectID = $0 },
                signOut: {
                    selectedProjectID = project.id
                    signedIn = false
                }
            )
            .task {
                agents.select(projectID: selectedProject.id, token: "ui-test-token", locale: locale.rawValue)
                channels.select(
                    organizationID: selectedProject.organizationId,
                    token: "ui-test-token"
                )
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
            workers: [
                DashboardWorker(
                    id: "worker-1",
                    label: "Mac Studio",
                    icon: .init(type: .emoji, value: "🍋"),
                    agentProvider: .codex,
                    providers: [.codex],
                    readiness: "available",
                    acceptingWork: true,
                    readinessDetail: "작업 수신 가능",
                    activeSessions: 1,
                    availableSessions: 2
                ),
                DashboardWorker(
                    id: "worker-claude",
                    label: "Release Mac",
                    icon: .init(type: .emoji, value: "🚀"),
                    agentProvider: .claude,
                    providers: [.claude],
                    readiness: "available",
                    acceptingWork: true,
                    readinessDetail: "릴리즈 작업 수신 가능",
                    activeSessions: 0,
                    availableSessions: 1
                ),
            ],
            organizationProviders: [.codex, .claude],
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
    private let delaysMessageSend: Bool
    private let hasChannelHistory: Bool

    init(delaysMessageSend: Bool = false, hasChannelHistory: Bool = false) {
        self.delaysMessageSend = delaysMessageSend
        self.hasChannelHistory = hasChannelHistory
    }

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
        if path.hasSuffix("/channels") && method == "GET" {
            payload = ##"""
            {"channels":[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","organizationId":"22222222-2222-4222-8222-222222222222","slug":"design","name":"design","topic":"Mobile product design","visibility":"public","defaultProjectId":"11111111-1111-4111-8111-111111111111","archivedAt":null,"memberCount":4,"agentCount":3,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"}]}
            """##
        } else if path.hasSuffix(
            "/channels/cccccccc-cccc-4ccc-8ccc-cccccccccccc?limit=20"
        ) && method == "GET" {
            if hasChannelHistory {
                payload = String(
                    decoding: try JSONEncoder.mobileContract.encode(Self.channelHistory),
                    as: UTF8.self
                )
            } else {
                payload = ##"""
                {"channel":{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","organizationId":"22222222-2222-4222-8222-222222222222","slug":"design","name":"design","topic":"Mobile product design","visibility":"public","defaultProjectId":"11111111-1111-4111-8111-111111111111","archivedAt":null,"memberCount":4,"agentCount":3,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"},"members":[],"agents":[],"messages":[{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","channelId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","parentMessageId":null,"body":"상단 헤더 디자인을 함께 확인해 주세요.","author":{"type":"user","name":"Briar User","image":null,"provider":null},"mentionedUserIds":[],"mentionedAgentIds":[],"replyCount":0,"lastReplyAt":null,"document":null,"proposal":null,"createdAt":"2026-08-02T01:02:00Z"}],"nextCursor":null}
                """##
            }
        } else if hasChannelHistory && path.contains(
            "/channels/cccccccc-cccc-4ccc-8ccc-cccccccccccc/messages?limit=20&cursor="
        ) && method == "GET" {
            payload = String(
                decoding: try JSONEncoder.mobileContract.encode(Self.earlierChannelHistory),
                as: UTF8.self
            )
        } else if path.contains("/channels/cccccccc-cccc-4ccc-8ccc-cccccccccccc/messages?parentMessageId=dddddddd-dddd-4ddd-8ddd-dddddddddddd") && method == "GET" {
            payload = ##"""
            {"messages":[{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","channelId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","parentMessageId":null,"body":"상단 헤더 디자인을 함께 확인해 주세요.","author":{"type":"user","name":"Briar User","image":null,"provider":null},"mentionedUserIds":[],"mentionedAgentIds":[],"replyCount":1,"lastReplyAt":"2026-08-02T01:03:00Z","document":null,"proposal":null,"createdAt":"2026-08-02T01:02:00Z"},{"id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","channelId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","parentMessageId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","body":"스레드에서 확인했습니다.","author":{"type":"agent","id":"agent-ui-test","name":"Briar Agent","provider":"codex"},"mentionedUserIds":[],"mentionedAgentIds":[],"replyCount":0,"lastReplyAt":null,"document":null,"proposal":null,"createdAt":"2026-08-02T01:03:00Z"}]}
            """##
        } else if path.hasSuffix("/issues") && method == "POST" {
            issueStatus = .queued
            payload = #"{"runId":"77777777-7777-4777-8777-777777777777","sourceKey":"briar-issue:ui-test","stage":"queued","status":"queued","attachments":[],"createdByUserId":"fixture-user"}"#
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
            if delaysMessageSend {
                try await Task.sleep(for: .seconds(2))
            }
            payload = #"{"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"77777777-7777-4777-8777-777777777777","parentMessageId":null,"body":"모바일에서 확인했습니다","author":{"id":"fixture-user","name":"Briar User","image":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","provider":null},"replyCount":0,"createdAt":"2026-08-02T01:02:00Z","updatedAt":"2026-08-02T01:02:00Z"},"agentReply":null}"#
        } else if path.hasSuffix("/events") {
            payload = #"{"events":[]}"#
        } else if path.hasSuffix("/messages") {
            payload = #"{"messages":[]}"#
        } else if path.hasSuffix("/evidence") {
            payload = #"{"evidence":[{"key":"ui-test:evidence:image","attempt":1,"revision":1,"stage":"reviewing","type":"review findings","status":"passed","detail":"완성 화면","url":null,"actor":"codex","observedAt":"2026-08-02T01:03:00Z","images":[{"id":"bbbbbbbb-2222-4222-8222-222222222222","filename":"result-screen.png","contentType":"image/png","byteSize":68,"url":"/ui-test/result-screen.png"}],"canonical":true}]}"#
        } else if path.hasSuffix("/agent-tasks") && method == "POST" {
            payload = ##"""
            {"session":{"id":"session-direct-1","projectId":"11111111-1111-4111-8111-111111111111","dispatchGroupId":"session-direct-1","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agentName":"Briar Agent","sessionType":"task","trigger":"manual","scheduleId":null,"scheduleRunId":null,"parentSessionId":null,"request":"Summarize the current repository status.","status":"running","issues":[],"startedAt":"2026-08-02T01:10:00Z","completedAt":null,"conversationId":null,"workspaceRoot":null,"requestedWorkerId":"worker-1","workerId":"worker-1","summary":null,"error":null,"events":[{"id":"event-direct-1","type":"started","occurredAt":"2026-08-02T01:10:00Z"}],"dispatchEvents":[],"workers":[],"updatedAt":"2026-08-02T01:10:00Z"}}
            """##
        } else if path.contains("/agents") {
            payload = ##"""
            {"agents":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","name":"Issue processing agent","avatar":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","codexPet":null,"provider":"codex","model":"gpt-5.4","responsibility":"Owns the project's development and code-related work.","skill":"# Issue processing agent","skills":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Issue processing","instructions":"Owns the project's development and code-related work.","provider":"codex","model":"gpt-5.4","effort":"high","kind":"issue_processing","position":0,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"},{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"iOS release","instructions":"Release the iOS app.","provider":"claude","model":"sonnet","effort":"high","kind":"custom","position":1,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"}],"calendarColor":"#3275d5","createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"}]}
            """##
        } else if path.contains("/agent-sessions") {
            payload = ##"""
            {"sessions":[{"id":"session-fixture-1","projectId":"11111111-1111-4111-8111-111111111111","dispatchGroupId":"dispatch-1","agentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agentName":"Briar Agent","sessionType":"task","trigger":"manual","scheduleId":null,"scheduleRunId":null,"parentSessionId":null,"request":"Complete native inbox work","status":"completed","issues":[{"runId":"33333333-3333-4333-8333-333333333333","runNumber":3832,"sourceKey":"briar-issue:ui-test","title":"iOS Native Companion","outcome":"completed","summary":"Done"}],"startedAt":"2026-08-02T01:00:00Z","completedAt":"2026-08-02T01:05:00Z","conversationId":null,"workspaceRoot":null,"summary":"Completed","error":null,"events":[{"id":"event-1","type":"started","occurredAt":"2026-08-02T01:00:00Z"},{"id":"event-2","type":"completed","occurredAt":"2026-08-02T01:05:00Z"}],"dispatchEvents":[],"workers":[],"updatedAt":"2026-08-02T01:05:00Z"}]}
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

    private static let channelHistory: ChannelDetailResponse = {
        let channelID = UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!
        let createdAt = Date(timeIntervalSince1970: 1_775_260_800)
        let channel = ChannelSummary(
            id: channelID,
            organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            slug: "design",
            name: "design",
            topic: "Mobile product design",
            visibility: .org,
            defaultProjectId: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            archivedAt: nil,
            memberCount: 4,
            agentCount: 3,
            createdAt: createdAt,
            updatedAt: createdAt
        )
        let messages = (1 ... 20).map { index in
            ChannelMessage(
                id: UUID(
                    uuidString: String(
                        format: "10000000-0000-4000-8000-%012d",
                        index
                    )
                )!,
                channelId: channelID,
                parentMessageId: nil,
                body: index.isMultiple(of: 3)
                    ? "가변 높이 채널 메시지 \(index)입니다.\n두 번째 줄도 함께 표시합니다."
                    : "가변 높이 채널 메시지 \(index)입니다.",
                author: ChannelMessage.Author(
                    type: index.isMultiple(of: 2) ? .agent : .user,
                    name: index.isMultiple(of: 2) ? "Briar Agent" : "Briar User",
                    image: nil,
                    provider: index.isMultiple(of: 2) ? "codex" : nil
                ),
                replyCount: 0,
                lastReplyAt: nil,
                document: nil,
                proposal: nil,
                createdAt: createdAt.addingTimeInterval(TimeInterval(index * 60))
            )
        }
        return ChannelDetailResponse(
            channel: channel,
            members: [],
            agents: [],
            messages: messages,
            nextCursor: UUID(uuidString: "20000000-0000-4000-8000-000000000001")
        )
    }()

    private static let earlierChannelHistory = ChannelMessagesResponse(
        messages: [ChannelMessage(
            id: UUID(uuidString: "20000000-0000-4000-8000-000000000002")!,
            channelId: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            parentMessageId: nil,
            body: "초기 진입에서 자동으로 불러오면 안 되는 이전 메시지입니다.",
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil
            ),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_700)
        )],
        nextCursor: nil
    )
}
