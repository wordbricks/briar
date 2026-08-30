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
                    delaysChannelLoad: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-delayed-channel-load"
                    ),
                    hasChannelHistory: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-channel-history"
                    ),
                    showsBatchProposal: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-batch-proposal"
                    )
                )
            } else {
                CompanionRootView(api: MobileHTTPClient(baseURL: Self.apiBaseURL))
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
    private let project = Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        issueKeyPrefix: "AH",
        scheduleTabEnabled: true,
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_800)
    )
    private let alternateProject = Project(
        id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
        name: "Briar Mobile",
        issueKeyPrefix: "AH",
        scheduleTabEnabled: true,
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
        delaysChannelLoad: Bool,
        hasChannelHistory: Bool,
        showsBatchProposal: Bool
    ) {
        self.offline = offline
        self.locale = locale
        api = UITestAPIClient(delaysMessageSend: delaysMessageSend)
        UserDefaults.standard.set(locale.rawValue, forKey: "companion-locale")
        _selectedProjectID = State(initialValue: project.id)
        _agents = StateObject(wrappedValue: AgentsStore(api: UITestAPIClient()))
        _channels = StateObject(wrappedValue: ChannelsStore(
            api: UITestAPIClient(
                delaysChannelLoad: delaysChannelLoad,
                hasChannelHistory: hasChannelHistory,
                showsBatchProposal: showsBatchProposal
            )
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
                user: CurrentUser(
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

    private var selectedProject: Project {
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

private actor UITestAPIClient: MobileHTTPClientProtocol {
    private var issueStatus: DashboardRun.Status?
    private var dependencyAdded = false
    private let delaysMessageSend: Bool
    private let delaysChannelLoad: Bool
    private let hasChannelHistory: Bool
    private let showsBatchProposal: Bool

    init(
        delaysMessageSend: Bool = false,
        delaysChannelLoad: Bool = false,
        hasChannelHistory: Bool = false,
        showsBatchProposal: Bool = false
    ) {
        self.delaysMessageSend = delaysMessageSend
        self.delaysChannelLoad = delaysChannelLoad
        self.hasChannelHistory = hasChannelHistory
        self.showsBatchProposal = showsBatchProposal
    }

    func createdIssueStatus() -> DashboardRun.Status? { issueStatus }
    func createdDependencyAdded() -> Bool { dependencyAdded }

    func listOrganizationAgents(
        organizationID: UUID,
        token: String
    ) async throws -> [ChannelAgentSummary] {
        [ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: nil,
            provider: "codex",
            model: "gpt-5.4",
            projectId: nil,
            description: "제품 작업을 돕는 Organization Agent",
            responsibility: "제품 작업 지원",
            createdAt: Date(timeIntervalSince1970: 1_775_260_800)
        )]
    }

    func listProjectAgents(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgent] {
        let agentID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let createdAt = Date(timeIntervalSince1970: 1_775_260_800)
        return [ProjectAgent(
            id: agentID,
            projectId: projectID,
            name: "Issue processing agent",
            avatar: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            codexPet: nil,
            provider: .codex,
            model: "gpt-5.4",
            effort: nil,
            description: nil,
            responsibility: "Owns the project's development and code-related work.",
            skill: "# Issue processing agent",
            skills: [
                ProjectAgent.Skill(
                    id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
                    agentId: agentID,
                    name: "Issue processing",
                    instructions: "Owns the project's development and code-related work.",
                    provider: .codex,
                    model: "gpt-5.4",
                    effort: .high,
                    kind: .issueProcessing,
                    position: 0,
                    createdAt: createdAt,
                    updatedAt: createdAt
                ),
                ProjectAgent.Skill(
                    id: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
                    agentId: agentID,
                    name: "iOS release",
                    instructions: "Release the iOS app.",
                    provider: .claude,
                    model: "sonnet",
                    effort: .high,
                    kind: .custom,
                    position: 1,
                    createdAt: createdAt,
                    updatedAt: createdAt
                ),
            ],
            calendarColor: "#3275d5",
            createdAt: createdAt,
            updatedAt: createdAt
        )]
    }

    func listProjectAgentSessions(
        projectID: UUID,
        token: String
    ) async throws -> [ProjectAgentSession] {
        let startedAt = Date(timeIntervalSince1970: 1_775_260_800)
        let completedAt = startedAt.addingTimeInterval(300)
        return [ProjectAgentSession(
            id: "session-fixture-1",
            projectId: projectID,
            dispatchGroupId: "dispatch-1",
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            agentName: "Briar Agent",
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: "Complete native inbox work",
            status: .completed,
            issues: [.init(
                runId: "33333333-3333-4333-8333-333333333333",
                runNumber: 3832,
                sourceKey: "briar-issue:ui-test",
                title: "iOS Native Companion",
                outcome: .completed,
                summary: "Done"
            )],
            startedAt: startedAt,
            completedAt: completedAt,
            conversationId: nil,
            workspaceRoot: nil,
            summary: "Completed",
            error: nil,
            events: [
                .init(id: "event-1", type: .started, occurredAt: startedAt),
                .init(id: "event-2", type: .completed, occurredAt: completedAt),
            ],
            updatedAt: completedAt
        )]
    }

    func putProjectAgentSession(
        _ session: ProjectAgentSession,
        projectID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        session
    }

    func runProjectAgentTask(
        projectID: UUID,
        agentID: UUID,
        skillID: UUID,
        request: String,
        workerID: String,
        requestID: UUID,
        token: String
    ) async throws -> ProjectAgentSession {
        let startedAt = Date(timeIntervalSince1970: 1_775_261_400)
        return ProjectAgentSession(
            id: requestID.uuidString.lowercased(),
            projectId: projectID,
            dispatchGroupId: requestID.uuidString.lowercased(),
            agentId: agentID,
            agentName: "Briar Agent",
            skillId: skillID,
            sessionType: .task,
            trigger: .manual,
            scheduleId: nil,
            scheduleRunId: nil,
            parentSessionId: nil,
            request: request,
            status: .running,
            issues: [],
            startedAt: startedAt,
            completedAt: nil,
            conversationId: nil,
            workspaceRoot: nil,
            requestedWorkerId: workerID,
            workerId: workerID,
            summary: nil,
            error: nil,
            events: [.init(id: "event-direct-1", type: .started, occurredAt: startedAt)],
            updatedAt: startedAt
        )
    }

    func listChannels(
        organizationID: UUID,
        token: String
    ) async throws -> ChannelsResponse {
        ChannelsResponse(channels: Self.channelSummaries, cursor: 1)
    }

    func syncChannels(
        organizationID: UUID,
        cursor: Int,
        token: String
    ) async throws -> ChannelDeltaResponse {
        ChannelDeltaResponse(
            cursor: cursor,
            hasMore: false,
            channels: [],
            removedChannelIds: [],
            messages: [],
            removedMessageIds: []
        )
    }

    func listDirectMessageRecipients(
        organizationID: UUID,
        token: String
    ) async throws -> DirectMessageRecipients {
        DirectMessageRecipients(
            members: Self.directMessageMembers,
            agents: try await listOrganizationAgents(
                organizationID: organizationID,
                token: token
            )
        )
    }

    func createDirectMessage(
        organizationID: UUID,
        memberIDs: [String],
        agentIDs: [UUID],
        token: String
    ) async throws -> ChannelSummary {
        Self.newDirectMessageChannel
    }

    func getChannel(
        organizationID: UUID,
        channelID: UUID,
        messageLimit: Int?,
        token: String
    ) async throws -> ChannelDetailResponse {
        if delaysChannelLoad {
            try await Task.sleep(for: .seconds(5))
        }
        switch channelID {
        case Self.designChannelID where hasChannelHistory:
            return Self.channelHistory
        case Self.designChannelID where showsBatchProposal:
            return Self.batchProposalChannel
        case Self.designChannelID:
            return Self.designChannel
        case Self.honeyChannelID:
            return Self.honeyChannel
        default:
            throw MobileAPIError.invalidRequest
        }
    }

    func markChannelRead(
        organizationID: UUID,
        channelID: UUID,
        lastReadAt: Date?,
        token: String
    ) async throws -> ChannelSummary {
        guard let channel = Self.channelSummaries.first(where: { $0.id == channelID }) else {
            throw MobileAPIError.invalidRequest
        }
        return channel
    }

    func listChannelMessages(
        organizationID: UUID,
        channelID: UUID,
        parentMessageID: UUID?,
        cursor: UUID?,
        limit: Int?,
        token: String
    ) async throws -> ChannelMessagesResponse {
        if hasChannelHistory, channelID == Self.designChannelID, cursor != nil {
            return Self.earlierChannelHistory
        }
        if channelID == Self.designChannelID,
           parentMessageID == Self.designRootMessageID {
            return Self.designThread
        }
        return ChannelMessagesResponse(messages: [], nextCursor: nil)
    }

    func createChannelMessage(
        organizationID: UUID,
        channelID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [UUID],
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateChannelMessageResponse {
        if delaysMessageSend {
            try await Task.sleep(for: .seconds(2))
        }
        return CreateChannelMessageResponse(message: ChannelMessage(
            id: clientMessageID,
            channelId: channelID,
            parentMessageId: parentMessageID,
            body: body,
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil
            ),
            mentionedUserIds: mentionedUserIDs,
            mentionedAgentIds: mentionedAgentIDs,
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_264_520)
        ))
    }

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
            payload = #"{"runId":"77777777-7777-4777-8777-777777777777","sourceKey":"briar-issue:ui-test","stage":"queued","status":"queued","difficulty":"normal","attachments":[],"createdByUserId":"fixture-user"}"#
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
        } else if path.hasSuffix("/messages") {
            payload = #"{"messages":[]}"#
        } else if path.hasSuffix("/evidence") {
            payload = #"{"evidence":[{"key":"ui-test:evidence:image","attempt":1,"revision":1,"stage":"reviewing","type":"review findings","status":"passed","detail":"완성 화면","url":null,"actor":"codex","observedAt":"2026-08-02T01:03:00Z","images":[{"id":"bbbbbbbb-2222-4222-8222-222222222222","filename":"result-screen.png","contentType":"image/png","byteSize":68,"url":"/ui-test/result-screen.png"}],"canonical":true}]}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }

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

    private static let organizationID = UUID(
        uuidString: "22222222-2222-4222-8222-222222222222"
    )!
    private static let projectID = UUID(
        uuidString: "11111111-1111-4111-8111-111111111111"
    )!
    private static let designChannelID = UUID(
        uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    )!
    private static let honeyChannelID = UUID(
        uuidString: "12121212-1212-4212-8212-121212121212"
    )!
    private static let designRootMessageID = UUID(
        uuidString: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    )!

    private static var designChannelSummary: ChannelSummary {
        ChannelSummary(
            id: designChannelID,
            organizationId: organizationID,
            slug: "design",
            name: "design",
            topic: "Mobile product design",
            visibility: .org,
            defaultProjectId: projectID,
            archivedAt: nil,
            memberCount: 4,
            agentCount: 3,
            createdAt: Date(timeIntervalSince1970: 1_775_260_800),
            updatedAt: Date(timeIntervalSince1970: 1_775_260_800),
            kind: .channel
        )
    }

    private static func directMessageSummary(
        id: String,
        slug: String,
        name: String,
        agentID: String,
        lastMessageAt: TimeInterval,
        lastMessagePreview: String,
        hasUnread: Bool
    ) -> ChannelSummary {
        ChannelSummary(
            id: UUID(uuidString: id)!,
            organizationId: organizationID,
            slug: slug,
            name: name,
            topic: nil,
            visibility: .restricted,
            defaultProjectId: nil,
            archivedAt: nil,
            memberCount: 1,
            agentCount: 1,
            createdAt: Date(timeIntervalSince1970: lastMessageAt - 86_400),
            updatedAt: Date(timeIntervalSince1970: lastMessageAt),
            kind: .directMessage,
            lastMessageAt: Date(timeIntervalSince1970: lastMessageAt),
            lastMessagePreview: lastMessagePreview,
            lastReadAt: hasUnread
                ? Date(timeIntervalSince1970: lastMessageAt - 1_440)
                : Date(timeIntervalSince1970: lastMessageAt),
            hasUnread: hasUnread,
            dmParticipants: [
                DirectMessageParticipant(
                    type: .user,
                    id: "fixture-user",
                    name: "Briar User",
                    image: nil
                ),
                DirectMessageParticipant(
                    type: .agent,
                    id: agentID,
                    name: name,
                    image: nil
                ),
            ]
        )
    }

    private static var honeyChannelSummary: ChannelSummary {
        directMessageSummary(
            id: "12121212-1212-4212-8212-121212121212",
            slug: "dm-honey",
            name: "Honey",
            agentID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            lastMessageAt: 1_777_105_440,
            lastMessagePreview: "iOS DM 화면 시안을 준비했습니다.",
            hasUnread: true
        )
    }

    private static var channelSummaries: [ChannelSummary] {
        [
            designChannelSummary,
            honeyChannelSummary,
            directMessageSummary(
                id: "13131313-1313-4313-8313-131313131313",
                slug: "dm-growth",
                name: "Growth Marketer",
                agentID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                lastMessageAt: 1_777_101_920,
                lastMessagePreview: "A/B 카피 두 가지를 검토해 주세요.",
                hasUnread: false
            ),
            directMessageSummary(
                id: "14141414-1414-4414-8414-141414141414",
                slug: "dm-support",
                name: "Customer Support",
                agentID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                lastMessageAt: 1_777_010_700,
                lastMessagePreview: "문의 12건을 해결했고 2건을 전달했습니다.",
                hasUnread: false
            ),
        ]
    }

    private static var directMessageMembers: [OrganizationMember] {
        let createdAt = Date(timeIntervalSince1970: 1_775_260_800)
        return [
            OrganizationMember(
                userId: "fixture-user",
                name: "Briar User",
                email: "user@example.com",
                image: nil,
                role: "owner",
                createdAt: createdAt
            ),
            OrganizationMember(
                userId: "teammate-user",
                name: "Alex Kim",
                email: "alex@example.com",
                image: nil,
                role: "member",
                createdAt: createdAt
            ),
        ]
    }

    private static var newDirectMessageChannel: ChannelSummary {
        var channel = directMessageSummary(
            id: "15151515-1515-4515-8515-151515151515",
            slug: "dm-new",
            name: "Honey",
            agentID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            lastMessageAt: 1_777_105_800,
            lastMessagePreview: "",
            hasUnread: false
        )
        channel.lastMessageAt = nil
        channel.lastMessagePreview = nil
        channel.lastReadAt = nil
        return channel
    }

    private static var designRootMessage: ChannelMessage {
        ChannelMessage(
            id: designRootMessageID,
            channelId: designChannelID,
            parentMessageId: nil,
            body: "상단 헤더 디자인을 함께 확인해 주세요.",
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil
            ),
            attachments: [ChannelMessageAttachment(
                id: UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
                filename: "channel-card.png",
                contentType: "image/png",
                byteSize: 68,
                url: "/ui-test/channel-card.png"
            )],
            replyCount: 1,
            lastReplyAt: Date(timeIntervalSince1970: 1_775_260_980),
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_260_920)
        )
    }

    private static var designChannel: ChannelDetailResponse {
        ChannelDetailResponse(
            channel: designChannelSummary,
            members: [],
            agents: [ChannelAgentSummary(
                agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
                name: "Issue processing agent",
                avatar: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                provider: "codex",
                model: "gpt-5.4",
                projectId: projectID,
                description: nil,
                responsibility: "Owns the project's development and code-related work.",
                createdAt: Date(timeIntervalSince1970: 1_775_260_800)
            )],
            messages: [designRootMessage]
        )
    }

    private static var honeyChannel: ChannelDetailResponse {
        let root = ChannelMessage(
            id: UUID(uuidString: "16161616-1616-4616-8616-161616161616")!,
            channelId: honeyChannelID,
            parentMessageId: nil,
            body: "iOS DM 화면을 검토해 주세요.",
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil,
                id: "fixture-user"
            ),
            replyCount: 1,
            lastReplyAt: Date(timeIntervalSince1970: 1_777_105_440),
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_777_105_380)
        )
        let reply = ChannelMessage(
            id: UUID(uuidString: "17171717-1717-4717-8717-171717171717")!,
            channelId: honeyChannelID,
            parentMessageId: root.id,
            body: "검토를 마쳤습니다.",
            author: ChannelMessage.Author(
                type: .agent,
                name: "Honey",
                image: nil,
                provider: "codex",
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            ),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_777_105_440)
        )
        return ChannelDetailResponse(
            channel: honeyChannelSummary,
            members: [],
            agents: [ChannelAgentSummary(
                agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
                name: "Honey",
                avatar: nil,
                provider: "codex",
                model: "gpt-5.4",
                projectId: nil,
                description: nil,
                responsibility: "Review mobile product work.",
                createdAt: Date(timeIntervalSince1970: 1_777_012_400)
            )],
            messages: [root, reply]
        )
    }

    private static var designThread: ChannelMessagesResponse {
        ChannelMessagesResponse(
            messages: [
                designRootMessage,
                ChannelMessage(
                    id: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
                    channelId: designChannelID,
                    parentMessageId: designRootMessageID,
                    body: "스레드에서 확인했습니다.",
                    author: ChannelMessage.Author(
                        type: .agent,
                        name: "Briar Agent",
                        image: nil,
                        provider: "codex",
                        id: "agent-ui-test"
                    ),
                    replyCount: 0,
                    lastReplyAt: nil,
                    document: nil,
                    proposal: nil,
                    createdAt: Date(timeIntervalSince1970: 1_775_260_980)
                ),
            ],
            nextCursor: nil
        )
    }

    private static var batchProposalChannel: ChannelDetailResponse {
        typealias Proposal = ChannelMessage.Proposal
        typealias Issue = Proposal.Payload.Issue
        let batch = Proposal.Payload.Batch(
            items: [
                .init(
                    key: "api",
                    issue: Issue(
                        title: "승인 API 확장",
                        description: "배치 승인을 처리합니다.",
                        priority: 1,
                        status: .backlog
                    )
                ),
                .init(
                    key: "web",
                    issue: Issue(
                        title: "채널 결과 UI",
                        description: "생성 결과를 표시합니다.",
                        priority: 2,
                        status: .backlog
                    )
                ),
                .init(
                    key: "qa",
                    issue: Issue(
                        title: "원자성 검증",
                        description: "롤백과 재시도를 확인합니다.",
                        priority: 2,
                        status: .backlog
                    )
                ),
            ],
            dependencies: [
                .init(prerequisiteKey: "api", dependentKey: "web"),
                .init(prerequisiteKey: "web", dependentKey: "qa"),
            ]
        )
        let proposal = Proposal(
            id: UUID(uuidString: "18181818-1818-4818-8818-181818181818")!,
            actionType: .createIssue,
            status: .accepted,
            projectId: projectID,
            payload: .init(batch: batch, executeAfterCreate: false),
            resultRunId: UUID(uuidString: "31313131-3131-4131-8131-313131313131")!,
            resultItems: [
                .init(
                    localKey: "api",
                    runId: UUID(uuidString: "31313131-3131-4131-8131-313131313131")!
                ),
                .init(
                    localKey: "web",
                    runId: UUID(uuidString: "32323232-3232-4232-8232-323232323232")!
                ),
                .init(
                    localKey: "qa",
                    runId: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
                ),
            ]
        )
        return ChannelDetailResponse(
            channel: designChannelSummary,
            members: [],
            agents: [],
            messages: [ChannelMessage(
                id: UUID(uuidString: "19191919-1919-4919-8919-191919191919")!,
                channelId: designChannelID,
                parentMessageId: nil,
                body: "백로그 이슈 3개와 의존성을 한 번에 만들었습니다.",
                author: ChannelMessage.Author(
                    type: .agent,
                    name: "Issue processing agent",
                    image: nil,
                    provider: "codex",
                    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                ),
                replyCount: 0,
                lastReplyAt: nil,
                document: nil,
                proposal: proposal,
                createdAt: Date(timeIntervalSince1970: 1_777_250_580)
            )]
        )
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
