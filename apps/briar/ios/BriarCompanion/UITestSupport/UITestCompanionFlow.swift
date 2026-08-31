import BriarContracts
import BriarContractsMocks
import Connect
import Foundation
import SwiftProtobuf
import SwiftUI

private extension ResponseMessage {
    static func success(_ output: Output) -> Self {
        .init(result: .success(output))
    }

    static func failure(_ error: Error) -> Self {
        .init(result: .failure(ConnectError(
            code: error is CancellationError ? .canceled : .internalError,
            message: error.localizedDescription,
            exception: error
        )))
    }
}

struct UITestCompanionFlow: View {
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
        let channelsAPI = UITestAPIClient(
            delaysChannelLoad: delaysChannelLoad,
            hasChannelHistory: hasChannelHistory,
            showsBatchProposal: showsBatchProposal
        )
        UserDefaults.standard.set(locale.rawValue, forKey: "companion-locale")
        _selectedProjectID = State(initialValue: project.id)
        _agents = StateObject(
            wrappedValue: AgentsStore(servicesFactory: UITestAPIClient())
        )
        _channels = StateObject(wrappedValue: ChannelsStore(
            api: channelsAPI,
            preparedUploadClient: channelsAPI,
            servicesFactory: channelsAPI
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
                services: api.authenticatedServices(token: "ui-test-token"),
                realtimeClient: nil,
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

private final class UITestAPIClient: AuthenticatedDownloadClientProtocol,
    PreparedUploadClientProtocol,
    AuthenticatedMobileServicesFactory,
    @unchecked Sendable
{
    func putPreparedUpload(
        _: URL,
        capability _: String,
        contentType _: String,
        data _: Data
    ) async throws {}

    private let scenario: Scenario
    private let services: AuthenticatedMobileServices

    init(
        delaysMessageSend: Bool = false,
        delaysChannelLoad: Bool = false,
        hasChannelHistory: Bool = false,
        showsBatchProposal: Bool = false
    ) {
        let scenario = Scenario(
            delaysMessageSend: delaysMessageSend,
            delaysChannelLoad: delaysChannelLoad,
            hasChannelHistory: hasChannelHistory,
            showsBatchProposal: showsBatchProposal
        )
        self.scenario = scenario
        services = AuthenticatedMobileServices(
            account: BriarAPI_AccountServiceClientMock(),
            project: BriarAPI_ProjectServiceClientMock(),
            dashboard: BriarAPI_DashboardServiceClientMock(),
            inbox: BriarAPI_InboxServiceClientMock(),
            issue: IssueServiceMock(scenario: scenario),
            channel: ChannelServiceMock(scenario: scenario),
            dmMemory: DmMemoryServiceMock(scenario: scenario),
            agent: AgentServiceMock(),
            realtime: BriarAPI_RealtimeServiceClientMock(),
            preparedUploadClient: UITestPreparedUploadClient()
        )
    }

    func authenticatedServices(token _: String) -> AuthenticatedMobileServices {
        services
    }

    func createdIssueStatus() async -> DashboardRun.Status? {
        await scenario.createdIssueStatus()
    }

    func createdDependencyAdded() async -> Bool {
        await scenario.createdDependencyAdded()
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

    private actor Scenario {
        private var issueStatus: DashboardRun.Status?
        private var dependencyAdded = false
        private var memoryVersion: UInt32 = 1
        private var memoryDeleted = false
        private let delaysMessageSend: Bool
        private let delaysChannelLoad: Bool
        private let hasChannelHistory: Bool
        private let showsBatchProposal: Bool

        init(
            delaysMessageSend: Bool,
            delaysChannelLoad: Bool,
            hasChannelHistory: Bool,
            showsBatchProposal: Bool
        ) {
            self.delaysMessageSend = delaysMessageSend
            self.delaysChannelLoad = delaysChannelLoad
            self.hasChannelHistory = hasChannelHistory
            self.showsBatchProposal = showsBatchProposal
        }

        func createdIssueStatus() -> DashboardRun.Status? { issueStatus }
        func createdDependencyAdded() -> Bool { dependencyAdded }

        func createIssue(
            _ request: BriarAPI_CreateIssueRequest
        ) -> BriarAPI_CreateIssueResponse {
            issueStatus = .queued
            return UITestAPIClient.createIssueResponse(request)
        }

        func dispatchRun(
            _ request: BriarAPI_DispatchRunRequest
        ) -> BriarAPI_DispatchRunResponse {
            issueStatus = .running
            return UITestAPIClient.dispatchRunResponse(request)
        }

        func setDependency(
            _ request: BriarAPI_SetIssueDependencyRequest
        ) -> BriarAPI_SetIssueDependencyResponse {
            dependencyAdded = request.enabled
            return UITestAPIClient.dependencyResponse(request)
        }

        func channel(
            _ request: BriarAPI_GetChannelRequest
        ) async throws -> BriarAPI_GetChannelResponse {
            if delaysChannelLoad {
                try await Task.sleep(for: .seconds(5))
            }
            return try UITestAPIClient.channelResponse(
                request,
                hasHistory: hasChannelHistory,
                showsBatchProposal: showsBatchProposal
            )
        }

        func channelMessages(
            _ request: BriarAPI_ListChannelMessagesRequest
        ) -> BriarAPI_ListChannelMessagesResponse {
            UITestAPIClient.channelMessagesResponse(
                request,
                hasHistory: hasChannelHistory
            )
        }

        func createChannelMessage(
            _ request: BriarAPI_CreateChannelMessageRequest
        ) async throws -> BriarAPI_CreateChannelMessageResponse {
            if delaysMessageSend {
                try await Task.sleep(for: .seconds(2))
            }
            return UITestAPIClient.createChannelMessageResponse(request)
        }

        func createIssueMessage(
            _ request: BriarAPI_CreateIssueMessageRequest
        ) async throws -> BriarAPI_CreateIssueMessageResponse {
            if delaysMessageSend {
                try await Task.sleep(for: .seconds(2))
            }
            return UITestAPIClient.createIssueMessageResponse(request)
        }

        private func memoryDocument(detail: Bool) -> BriarAPI_DmMemoryDocument {
            var document = BriarAPI_DmMemoryDocument()
            document.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            document.memorySpaceID = "99999999-9999-4999-8999-999999999999"
            document.kind = .observation
            document.title = "Synthetic memory"
            document.version = memoryVersion
            document.status = .active
            document.memoryClass = .profile
            document.evidenceType = .explicitUser
            document.protectedByUser = true
            document.sourceLanguage = "ko"
            document.createdAt = Google_Protobuf_Timestamp(
                date: Date(timeIntervalSince1970: 1_788_220_800)
            )
            document.updatedAt = document.createdAt
            document.indexState = .pending
            if detail {
                document.body = "합성 데이터: 설명은 결론부터 제시한다."
                var source = BriarAPI_DmMemorySource()
                source.type = .userEditEvent
                source.id = "fixture-edit"
                source.version = 1
                document.sources = [source]
            }
            return document
        }

        func listDmMemories() -> BriarAPI_ListDmMemoriesResponse {
            var response = BriarAPI_ListDmMemoriesResponse()
            response.eligible = true
            var capabilities = BriarAPI_DmMemoryCapabilities()
            capabilities.recall = false
            capabilities.automaticLearning = false
            response.capabilities = capabilities
            var space = BriarAPI_DmMemorySpace()
            space.id = "99999999-9999-4999-8999-999999999999"
            space.channelID = "12121212-1212-4212-8212-121212121212"
            space.agentID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            space.rosterEpoch = 1
            space.status = .active
            space.useEnabled = true
            space.memoryRevision = UInt64(memoryVersion)
            space.createdAt = Google_Protobuf_Timestamp(
                date: Date(timeIntervalSince1970: 1_788_220_800)
            )
            space.updatedAt = space.createdAt
            response.spaces = [space]
            response.selectedSpaceID = space.id
            response.documents = memoryDeleted ? [] : [memoryDocument(detail: false)]
            return response
        }

        func getDmMemoryDocument() -> BriarAPI_GetDmMemoryDocumentResponse {
            var response = BriarAPI_GetDmMemoryDocumentResponse()
            response.document = memoryDocument(detail: true)
            return response
        }

        func updateDmMemoryDocument() async throws -> BriarAPI_UpdateDmMemoryDocumentResponse {
            try await Task.sleep(for: .seconds(1))
            memoryVersion += 1
            var response = BriarAPI_UpdateDmMemoryDocumentResponse()
            response.documentID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            response.version = memoryVersion
            return response
        }

        func deleteDmMemoryDocument() -> BriarAPI_DeleteDmMemoryDocumentResponse {
            memoryDeleted = true
            var response = BriarAPI_DeleteDmMemoryDocumentResponse()
            response.deleted = true
            response.purgeState = "pending"
            return response
        }
    }

    private final class DmMemoryServiceMock: BriarAPI_DmMemoryServiceClientMock,
        @unchecked Sendable
    {
        private let scenario: Scenario

        init(scenario: Scenario) {
            self.scenario = scenario
            super.init()
        }

        override func listDmMemories(
            request _: BriarAPI_ListDmMemoriesRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListDmMemoriesResponse> {
            .success(await scenario.listDmMemories())
        }

        override func getDmMemoryDocument(
            request _: BriarAPI_GetDmMemoryDocumentRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_GetDmMemoryDocumentResponse> {
            .success(await scenario.getDmMemoryDocument())
        }

        override func updateDmMemoryDocument(
            request _: BriarAPI_UpdateDmMemoryDocumentRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_UpdateDmMemoryDocumentResponse> {
            do {
                return .success(try await scenario.updateDmMemoryDocument())
            } catch {
                return .failure(error)
            }
        }

        override func deleteDmMemoryDocument(
            request _: BriarAPI_DeleteDmMemoryDocumentRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_DeleteDmMemoryDocumentResponse> {
            .success(await scenario.deleteDmMemoryDocument())
        }
    }

    private final class AgentServiceMock: BriarAPI_AgentServiceClientMock,
        @unchecked Sendable
    {
        override func listOrganizationAgents(
            request _: BriarAPI_ListOrganizationAgentsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListOrganizationAgentsResponse> {
            .success(UITestAPIClient.organizationAgentsResponse())
        }

        override func listProjectAgents(
            request: BriarAPI_ListProjectAgentsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListProjectAgentsResponse> {
            .success(UITestAPIClient.projectAgentsResponse(projectID: request.projectID))
        }

        override func listProjectAgentSessions(
            request: BriarAPI_ListProjectAgentSessionsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListProjectAgentSessionsResponse> {
            .success(UITestAPIClient.agentSessionsResponse(projectID: request.projectID))
        }

        override func putProjectAgentSession(
            request: BriarAPI_PutProjectAgentSessionRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_PutProjectAgentSessionResponse> {
            .success(UITestAPIClient.putAgentSessionResponse(request))
        }

        override func runProjectAgentTask(
            request: BriarAPI_RunProjectAgentTaskRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_RunProjectAgentTaskResponse> {
            .success(UITestAPIClient.runAgentTaskResponse(request))
        }
    }

    private final class ChannelServiceMock: BriarAPI_ChannelServiceClientMock,
        @unchecked Sendable
    {
        private let scenario: Scenario

        init(scenario: Scenario) {
            self.scenario = scenario
            super.init()
        }

        override func listChannels(
            request _: BriarAPI_ListChannelsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListChannelsResponse> {
            .success(UITestAPIClient.channelsResponse())
        }

        override func syncChannels(
            request: BriarAPI_SyncChannelsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_SyncChannelsResponse> {
            var response = BriarAPI_SyncChannelsResponse()
            response.cursor = request.cursor
            return .success(response)
        }

        override func listDirectMessageRecipients(
            request _: BriarAPI_ListDirectMessageRecipientsRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListDirectMessageRecipientsResponse> {
            .success(UITestAPIClient.directMessageRecipientsResponse())
        }

        override func createDirectMessage(
            request _: BriarAPI_CreateDirectMessageRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CreateDirectMessageResponse> {
            .success(UITestAPIClient.createDirectMessageResponse())
        }

        override func getChannel(
            request: BriarAPI_GetChannelRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_GetChannelResponse> {
            do {
                return .success(try await scenario.channel(request))
            } catch {
                return .failure(error)
            }
        }

        override func markChannelRead(
            request: BriarAPI_MarkChannelReadRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_MarkChannelReadResponse> {
            .success(UITestAPIClient.markChannelReadResponse(request))
        }

        override func listChannelMessages(
            request: BriarAPI_ListChannelMessagesRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListChannelMessagesResponse> {
            .success(await scenario.channelMessages(request))
        }

        override func createChannelMessage(
            request: BriarAPI_CreateChannelMessageRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CreateChannelMessageResponse> {
            do {
                return .success(try await scenario.createChannelMessage(request))
            } catch {
                return .failure(error)
            }
        }
    }

    private final class IssueServiceMock: BriarAPI_IssueServiceClientMock,
        @unchecked Sendable
    {
        private let scenario: Scenario

        init(scenario: Scenario) {
            self.scenario = scenario
            super.init()
        }

        override func createIssue(
            request: BriarAPI_CreateIssueRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CreateIssueResponse> {
            .success(await scenario.createIssue(request))
        }

        override func setIssueDependency(
            request: BriarAPI_SetIssueDependencyRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_SetIssueDependencyResponse> {
            .success(await scenario.setDependency(request))
        }

        override func moveRun(
            request: BriarAPI_MoveRunRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_MoveRunResponse> {
            .success(UITestAPIClient.moveRunResponse(request))
        }

        override func retryRun(
            request: BriarAPI_RetryRunRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_RetryRunResponse> {
            .success(UITestAPIClient.retryRunResponse(request))
        }

        override func cancelRun(
            request: BriarAPI_CancelRunRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CancelRunResponse> {
            .success(UITestAPIClient.cancelRunResponse(request))
        }

        override func dispatchRun(
            request: BriarAPI_DispatchRunRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_DispatchRunResponse> {
            .success(await scenario.dispatchRun(request))
        }

        override func updateIssuePreferences(
            request: BriarAPI_UpdateIssuePreferencesRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_UpdateIssuePreferencesResponse> {
            .success(UITestAPIClient.issuePreferencesResponse(request))
        }

        override func completeResultReview(
            request _: BriarAPI_CompleteResultReviewRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CompleteResultReviewResponse> {
            .success(UITestAPIClient.resultReviewResponse())
        }

        override func listIssueMessages(
            request _: BriarAPI_ListIssueMessagesRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListIssueMessagesResponse> {
            .success(.init())
        }

        override func createIssueMessage(
            request: BriarAPI_CreateIssueMessageRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_CreateIssueMessageResponse> {
            do {
                return .success(try await scenario.createIssueMessage(request))
            } catch {
                return .failure(error)
            }
        }

        override func listRunEvidence(
            request: BriarAPI_ListRunEvidenceRequest,
            headers _: Connect.Headers = [:]
        ) async -> ResponseMessage<BriarAPI_ListRunEvidenceResponse> {
            .success(UITestAPIClient.runEvidenceResponse(request))
        }
    }

    private static func organizationAgentsResponse() -> BriarAPI_ListOrganizationAgentsResponse {
        var agent = BriarAPI_OrganizationAgent()
        agent.agentID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        agent.name = "Honey"
        agent.provider = .codex
        agent.model = "gpt-5.4"
        agent.description_p = "제품 작업을 돕는 Organization Agent"
        agent.responsibility = "제품 작업 지원"
        agent.createdAt = .init(date: Date(timeIntervalSince1970: 1_775_260_800))
        var response = BriarAPI_ListOrganizationAgentsResponse()
        response.agents = [agent]
        return response
    }

    private static func projectAgentsResponse(
        projectID: String
    ) -> BriarAPI_ListProjectAgentsResponse {
        let agentID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        let createdAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_775_260_800)
        )
        func skill(
            id: String,
            name: String,
            body: String,
            provider: BriarTypes_AgentProvider,
            model: String,
            kind: BriarAPI_AgentSkillKind,
            position: UInt32
        ) -> BriarAPI_ProjectAgentSkill {
            var value = BriarAPI_ProjectAgentSkill()
            value.id = id
            value.agentID = agentID
            value.name = name
            value.description_p = body
            value.body = body
            value.provider = provider
            value.model = model
            value.effort = "high"
            value.kind = kind
            value.executionMode = .task
            value.approvalPolicy = .explicit
            value.position = position
            value.createdAt = createdAt
            value.updatedAt = createdAt
            return value
        }
        var agent = BriarAPI_ProjectAgent()
        agent.id = agentID
        agent.projectID = projectID
        agent.name = "Issue processing agent"
        agent.avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        agent.provider = .codex
        agent.model = "gpt-5.4"
        agent.responsibility = "Owns the project's development and code-related work."
        agent.skill = "# Issue processing agent"
        agent.skills = [
            skill(
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                name: "Issue processing",
                body: "Owns the project's development and code-related work.",
                provider: .codex,
                model: "gpt-5.4",
                kind: .issueProcessing,
                position: 0
            ),
            skill(
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                name: "iOS release",
                body: "Release the iOS app.",
                provider: .claude,
                model: "sonnet",
                kind: .custom,
                position: 1
            ),
        ]
        agent.calendarColor = "#3275d5"
        agent.createdAt = createdAt
        agent.updatedAt = createdAt
        var response = BriarAPI_ListProjectAgentsResponse()
        response.agents = [agent]
        return response
    }

    private static func agentSessionsResponse(
        projectID: String
    ) -> BriarAPI_ListProjectAgentSessionsResponse {
        let startedAt = Date(timeIntervalSince1970: 1_775_260_800)
        let completedAt = startedAt.addingTimeInterval(300)
        var issue = BriarAPI_ProjectAgentSessionIssue()
        issue.runID = "33333333-3333-4333-8333-333333333333"
        issue.runNumber = 3832
        issue.sourceKey = "briar-issue:ui-test"
        issue.title = "iOS Native Companion"
        issue.outcome = .completed
        issue.summary = "Done"
        var started = BriarAPI_ProjectAgentSessionEvent()
        started.id = "event-1"
        started.type = .started
        started.occurredAt = .init(date: startedAt)
        var completed = BriarAPI_ProjectAgentSessionEvent()
        completed.id = "event-2"
        completed.type = .completed
        completed.occurredAt = .init(date: completedAt)
        var session = BriarAPI_ProjectAgentSession()
        session.id = "session-fixture-1"
        session.projectID = projectID
        session.dispatchGroupID = "dispatch-1"
        session.agentID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        session.agentName = "Briar Agent"
        session.sessionType = .task
        session.trigger = .manual
        session.request = "Complete native inbox work"
        session.status = .completed
        session.issues = [issue]
        session.startedAt = .init(date: startedAt)
        session.completedAt = .init(date: completedAt)
        session.summary = "Completed"
        session.events = [started, completed]
        session.updatedAt = .init(date: completedAt)
        var response = BriarAPI_ListProjectAgentSessionsResponse()
        response.sessions = [session]
        return response
    }

    private static func putAgentSessionResponse(
        _ request: BriarAPI_PutProjectAgentSessionRequest
    ) -> BriarAPI_PutProjectAgentSessionResponse {
        var session = BriarAPI_ProjectAgentSession()
        session.id = request.sessionID
        session.projectID = request.projectID
        session.dispatchGroupID = request.dispatchGroupID
        if request.hasAgentID { session.agentID = request.agentID }
        if request.hasAgentName { session.agentName = request.agentName }
        if request.hasSkillID { session.skillID = request.skillID }
        session.sessionType = request.sessionType
        if request.hasTrigger { session.trigger = request.trigger }
        if request.hasScheduleID { session.scheduleID = request.scheduleID }
        if request.hasScheduleRunID { session.scheduleRunID = request.scheduleRunID }
        if request.hasParentSessionID { session.parentSessionID = request.parentSessionID }
        if request.hasRequest { session.request = request.request }
        session.followUps = request.followUps
        session.status = request.status
        session.issues = request.issues
        if request.hasStartedAt { session.startedAt = request.startedAt }
        if request.hasCompletedAt { session.completedAt = request.completedAt }
        if request.hasConversationID { session.conversationID = request.conversationID }
        if request.hasRequestedWorkerID { session.requestedWorkerID = request.requestedWorkerID }
        if request.hasWorkerID { session.workerID = request.workerID }
        if request.hasSummary { session.summary = request.summary }
        if request.hasError { session.error = request.error }
        session.events = request.events
        if request.hasUpdatedAt { session.updatedAt = request.updatedAt }
        var response = BriarAPI_PutProjectAgentSessionResponse()
        response.session = session
        return response
    }

    private static func runAgentTaskResponse(
        _ request: BriarAPI_RunProjectAgentTaskRequest
    ) -> BriarAPI_RunProjectAgentTaskResponse {
        let startedAt = Date(timeIntervalSince1970: 1_775_261_400)
        var event = BriarAPI_ProjectAgentSessionEvent()
        event.id = "event-direct-1"
        event.type = .started
        event.occurredAt = .init(date: startedAt)
        var session = BriarAPI_ProjectAgentSession()
        session.id = request.requestID
        session.projectID = request.projectID
        session.dispatchGroupID = request.requestID
        session.agentID = request.agentID
        session.agentName = "Briar Agent"
        session.skillID = request.skillID
        session.sessionType = .task
        session.trigger = .manual
        session.request = request.request
        session.status = .running
        session.startedAt = .init(date: startedAt)
        session.requestedWorkerID = request.workerID
        session.workerID = request.workerID
        session.events = [event]
        session.updatedAt = .init(date: startedAt)
        var response = BriarAPI_RunProjectAgentTaskResponse()
        response.session = session
        return response
    }

    private static func createIssueResponse(
        _ request: BriarAPI_CreateIssueRequest
    ) -> BriarAPI_CreateIssueResponse {
        var response = BriarAPI_CreateIssueResponse()
        response.runID = request.clientIssueID
        response.sourceKey = "briar-issue:ui-test"
        response.status = .queued
        response.stage = "queued"
        response.createdByUserID = "fixture-user"
        response.difficulty = request.hasDifficulty ? request.difficulty : .normal
        return response
    }

    private static func dispatchRunResponse(
        _ request: BriarAPI_DispatchRunRequest
    ) -> BriarAPI_DispatchRunResponse {
        var dispatch = BriarAPI_IssueExecutionDispatch()
        dispatch.runID = request.runID
        if request.dispatch.hasAgentID { dispatch.agentID = request.dispatch.agentID }
        dispatch.provider = request.dispatch.provider
        if request.dispatch.hasModel { dispatch.model = request.dispatch.model }
        if request.dispatch.hasEffort { dispatch.effort = request.dispatch.effort }
        if request.dispatch.hasWorkerID {
            dispatch.requestedWorkerID = request.dispatch.workerID
            dispatch.dispatchMode = .specific
        } else {
            dispatch.dispatchMode = .any
        }
        dispatch.requestedByUserID = "fixture-user"
        dispatch.dispatchedAt = .init(date: Date(timeIntervalSince1970: 1_775_264_460))
        dispatch.outcome = .dispatched
        var response = BriarAPI_DispatchRunResponse()
        response.dispatch = dispatch
        return response
    }

    private static func dependencyResponse(
        _ request: BriarAPI_SetIssueDependencyRequest
    ) -> BriarAPI_SetIssueDependencyResponse {
        var response = BriarAPI_SetIssueDependencyResponse()
        response.prerequisiteRunID = request.prerequisiteRunID
        response.dependentRunID = request.runID
        response.outcome = request.enabled ? .created : .removed
        return response
    }

    private static func moveRunResponse(
        _ request: BriarAPI_MoveRunRequest
    ) -> BriarAPI_MoveRunResponse {
        var response = BriarAPI_MoveRunResponse()
        response.runID = request.runID
        response.outcome = .moved
        response.status = request.status
        if request.hasWorkflowStage { response.workflowStage = request.workflowStage }
        return response
    }

    private static func retryRunResponse(
        _ request: BriarAPI_RetryRunRequest
    ) -> BriarAPI_RetryRunResponse {
        var response = BriarAPI_RetryRunResponse()
        response.runID = request.runID
        response.outcome = .retried
        response.attempt = 2
        response.status = .queued
        return response
    }

    private static func cancelRunResponse(
        _ request: BriarAPI_CancelRunRequest
    ) -> BriarAPI_CancelRunResponse {
        var response = BriarAPI_CancelRunResponse()
        response.runID = request.runID
        response.outcome = .cancelled
        response.attempt = 1
        response.status = .cancelled
        return response
    }

    private static func issuePreferencesResponse(
        _ request: BriarAPI_UpdateIssuePreferencesRequest
    ) -> BriarAPI_UpdateIssuePreferencesResponse {
        var response = BriarAPI_UpdateIssuePreferencesResponse()
        response.runID = request.runID
        if request.hasProvider { response.provider = request.provider }
        if request.hasModel { response.model = request.model }
        if request.hasEffort { response.effort = request.effort }
        return response
    }

    private static func resultReviewResponse() -> BriarAPI_CompleteResultReviewResponse {
        var review = BriarAPI_ResultReview()
        review.userID = "fixture-user"
        review.name = "Briar User"
        review.username = "briar_user"
        review.completedAt = .init(date: Date(timeIntervalSince1970: 1_775_264_460))
        var response = BriarAPI_CompleteResultReviewResponse()
        response.review = review
        return response
    }

    private static func createIssueMessageResponse(
        _ request: BriarAPI_CreateIssueMessageRequest
    ) -> BriarAPI_CreateIssueMessageResponse {
        let createdAt = Date(timeIntervalSince1970: 1_775_264_520)
        var author = BriarAPI_MessageAuthor()
        author.id = "fixture-user"
        author.name = "Briar User"
        author.image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        var message = BriarAPI_IssueMessage()
        message.id = request.clientMessageID
        message.runID = request.runID
        if request.hasParentMessageID { message.parentMessageID = request.parentMessageID }
        message.body = request.body
        message.author = author
        message.replyCount = 0
        message.createdAt = .init(date: createdAt)
        message.updatedAt = .init(date: createdAt)
        var response = BriarAPI_CreateIssueMessageResponse()
        response.message = message
        return response
    }

    private static func runEvidenceResponse(
        _ request: BriarAPI_ListRunEvidenceRequest
    ) -> BriarAPI_ListRunEvidenceResponse {
        var image = BriarAPI_RunEvidenceImage()
        image.id = "bbbbbbbb-2222-4222-8222-222222222222"
        image.filename = "result-screen.png"
        image.contentType = "image/png"
        image.byteSize = 68
        image.url = "/ui-test/result-screen.png"
        var evidence = BriarAPI_RunEvidence()
        evidence.key = "ui-test:evidence:image"
        evidence.attempt = 1
        evidence.revision = 1
        evidence.stage = "reviewing"
        evidence.type = "review findings"
        evidence.status = .passed
        evidence.detail = "완성 화면"
        evidence.actor = "codex"
        let recordedAt = Date(timeIntervalSince1970: 1_775_264_580)
        evidence.observedAt = .init(date: recordedAt)
        evidence.recordedAt = .init(date: recordedAt)
        evidence.images = [image]
        evidence.canonical = true
        var response = BriarAPI_ListRunEvidenceResponse()
        response.evidence = [evidence]
        response.runID = request.runID
        response.attempt = 1
        response.revision = 1
        return response
    }

    private static func channelsResponse() -> BriarAPI_ListChannelsResponse {
        var response = BriarAPI_ListChannelsResponse()
        response.channels = channelSummaries.map(channelSummaryMessage)
        response.cursor = 1
        return response
    }

    private static func directMessageRecipientsResponse(
    ) -> BriarAPI_ListDirectMessageRecipientsResponse {
        var response = BriarAPI_ListDirectMessageRecipientsResponse()
        response.members = directMessageMembers.map(organizationMemberMessage)
        response.agents = organizationAgentsResponse().agents
        return response
    }

    private static func createDirectMessageResponse() -> BriarAPI_CreateDirectMessageResponse {
        var response = BriarAPI_CreateDirectMessageResponse()
        response.channel = channelSummaryMessage(newDirectMessageChannel)
        return response
    }

    private static func channelResponse(
        _ request: BriarAPI_GetChannelRequest,
        hasHistory: Bool,
        showsBatchProposal: Bool
    ) throws -> BriarAPI_GetChannelResponse {
        guard let channelID = UUID(uuidString: request.channelID) else {
            throw MobileAPIError.invalidRequest
        }
        switch channelID {
        case designChannelID where hasHistory:
            return channelHistoryResponse
        case designChannelID where showsBatchProposal:
            return batchProposalChannelResponse
        case designChannelID:
            return designChannelResponse
        case honeyChannelID:
            return honeyChannelResponse
        default:
            throw MobileAPIError.invalidRequest
        }
    }

    private static func markChannelReadResponse(
        _ request: BriarAPI_MarkChannelReadRequest
    ) -> BriarAPI_MarkChannelReadResponse {
        var response = BriarAPI_MarkChannelReadResponse()
        if let channel = channelSummaries.first(where: {
            $0.id.uuidString.caseInsensitiveCompare(request.channelID) == .orderedSame
        }) {
            response.channel = channelSummaryMessage(channel)
        }
        return response
    }

    private static func channelMessagesResponse(
        _ request: BriarAPI_ListChannelMessagesRequest,
        hasHistory: Bool
    ) -> BriarAPI_ListChannelMessagesResponse {
        let channelID = UUID(uuidString: request.channelID)
        if hasHistory, channelID == designChannelID, request.hasCursor {
            return earlierChannelHistoryResponse
        } else if channelID == designChannelID,
                  request.hasParentMessageID,
                  UUID(uuidString: request.parentMessageID) == designRootMessageID {
            return designThreadResponse
        }
        return BriarAPI_ListChannelMessagesResponse()
    }

    private static func getChannelResponse(
        channel: ChannelSummary,
        agents: [ChannelAgentSummary],
        messages: [ChannelMessage],
        nextCursor: UUID? = nil
    ) -> BriarAPI_GetChannelResponse {
        var response = BriarAPI_GetChannelResponse()
        response.channel = channelSummaryMessage(channel)
        response.agents = agents.map(organizationAgentMessage)
        response.messages = messages.map(channelMessageMessage)
        if let nextCursor {
            response.nextCursor = nextCursor.uuidString.lowercased()
        }
        return response
    }

    private static func channelMessagePage(
        messages: [ChannelMessage],
        nextCursor: UUID? = nil
    ) -> BriarAPI_ListChannelMessagesResponse {
        var response = BriarAPI_ListChannelMessagesResponse()
        response.messages = messages.map(channelMessageMessage)
        if let nextCursor {
            response.nextCursor = nextCursor.uuidString.lowercased()
        }
        return response
    }

    private static func createChannelMessageResponse(
        _ request: BriarAPI_CreateChannelMessageRequest
    ) -> BriarAPI_CreateChannelMessageResponse {
        let message = ChannelMessage(
            id: UUID(uuidString: request.clientMessageID) ?? UUID(),
            channelId: UUID(uuidString: request.channelID) ?? designChannelID,
            parentMessageId: request.hasParentMessageID
                ? UUID(uuidString: request.parentMessageID)
                : nil,
            body: request.body,
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil,
                id: "fixture-user"
            ),
            mentionedUserIds: request.mentionedUserIds,
            mentionedAgentIds: request.mentionedAgentIds.compactMap(UUID.init(uuidString:)),
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_775_264_520)
        )
        var response = BriarAPI_CreateChannelMessageResponse()
        response.message = channelMessageMessage(message)
        return response
    }

    private static func channelSummaryMessage(
        _ value: ChannelSummary
    ) -> BriarAPI_ChannelSummary {
        var message = BriarAPI_ChannelSummary()
        message.id = value.id.uuidString.lowercased()
        message.organizationID = value.organizationId.uuidString.lowercased()
        message.slug = value.slug
        message.name = value.name
        if let topic = value.topic { message.topic = topic }
        message.visibility = value.visibility == .org ? .public : .private
        if let projectID = value.defaultProjectId {
            message.defaultProjectID = projectID.uuidString.lowercased()
        }
        if let archivedAt = value.archivedAt { message.archivedAt = .init(date: archivedAt) }
        message.memberCount = UInt32(clamping: value.memberCount)
        message.agentCount = UInt32(clamping: value.agentCount)
        message.createdAt = .init(date: value.createdAt)
        message.updatedAt = .init(date: value.updatedAt)
        message.kind = value.kind == .directMessage ? .directMessage : .channel
        if let lastMessageAt = value.lastMessageAt {
            message.lastMessageAt = .init(date: lastMessageAt)
        }
        if let preview = value.lastMessagePreview { message.lastMessagePreview = preview }
        if let lastReadAt = value.lastReadAt { message.lastReadAt = .init(date: lastReadAt) }
        message.hasUnread_p = value.hasUnread
        message.directMessageParticipants = value.dmParticipants.map { participant in
            var item = BriarAPI_DirectMessageParticipant()
            item.kind = participant.type == .user ? .user : .agent
            item.id = participant.id
            item.name = participant.name
            if let image = participant.image { item.image = image }
            return item
        }
        return message
    }

    private static func organizationMemberMessage(
        _ value: OrganizationMember
    ) -> BriarAPI_OrganizationMember {
        var message = BriarAPI_OrganizationMember()
        message.userID = value.userId
        message.name = value.name
        message.email = value.email
        if let image = value.image { message.image = image }
        message.role = value.role == "owner" ? .owner : .viewer
        message.createdAt = .init(date: value.createdAt)
        return message
    }

    private static func channelMemberMessage(_ value: ChannelMember) throws -> BriarAPI_ChannelMember {
        var message = BriarAPI_ChannelMember()
        message.userID = value.userId
        message.name = value.name
        message.email = value.email
        if let image = value.image { message.image = image }
        switch value.role {
        case "owner": message.role = .owner
        case "member": message.role = .member
        default: throw MobileAPIError.invalidResponse
        }
        message.createdAt = .init(date: value.createdAt)
        return message
    }

    private static func organizationAgentMessage(
        _ value: ChannelAgentSummary
    ) -> BriarAPI_OrganizationAgent {
        var message = BriarAPI_OrganizationAgent()
        message.agentID = value.agentId.uuidString.lowercased()
        message.name = value.name
        if let avatar = value.avatar { message.avatar = avatar }
        message.provider = providerMessage(value.provider)
        if let model = value.model { message.model = model }
        if let projectID = value.projectId {
            message.projectID = projectID.uuidString.lowercased()
        }
        if let description = value.description { message.description_p = description }
        message.responsibility = value.responsibility
        message.createdAt = .init(date: value.createdAt)
        return message
    }

    private static func channelMessageMessage(_ value: ChannelMessage) -> BriarAPI_ChannelMessage {
        var message = BriarAPI_ChannelMessage()
        message.id = value.id.uuidString.lowercased()
        message.channelID = value.channelId.uuidString.lowercased()
        if let parentID = value.parentMessageId {
            message.parentMessageID = parentID.uuidString.lowercased()
        }
        message.body = value.body
        message.author = channelAuthorMessage(value.author)
        message.mentionedUserIds = value.mentionedUserIds
        message.mentionedAgentIds = value.mentionedAgentIds.map { $0.uuidString.lowercased() }
        message.attachments = value.attachments.map { attachment in
            var item = BriarAPI_IssueAttachment()
            item.id = attachment.id.uuidString.lowercased()
            item.filename = attachment.filename
            item.contentType = attachment.contentType
            item.byteSize = UInt64(clamping: attachment.byteSize)
            item.url = attachment.url
            return item
        }
        message.replyCount = UInt32(clamping: value.replyCount)
        if let lastReplyAt = value.lastReplyAt {
            message.lastReplyAt = .init(date: lastReplyAt)
        }
        message.replyAuthors = value.replyAuthors.map(channelAuthorMessage)
        if let proposal = value.proposal { message.proposal = channelProposalMessage(proposal) }
        message.createdAt = .init(date: value.createdAt)
        if let deletedAt = value.deletedAt { message.deletedAt = .init(date: deletedAt) }
        return message
    }

    private static func channelAuthorMessage(
        _ value: ChannelMessage.Author
    ) -> BriarAPI_ChannelMessageAuthor {
        var message = BriarAPI_ChannelMessageAuthor()
        switch value.type {
        case .user:
            guard let id = value.id else {
                preconditionFailure("User channel authors require an id")
            }
            var author = BriarAPI_ChannelMessageUserAuthor()
            author.id = id
            author.name = value.name
            author.email = "ui-test@briar.local"
            if let image = value.image { author.image = image }
            message.user = author
        case .agent:
            var author = BriarAPI_ChannelMessageAgentAuthor()
            if let id = value.id { author.id = id }
            author.name = value.name
            if let image = value.image { author.image = image }
            if let provider = value.provider { author.provider = providerMessage(provider) }
            message.agent = author
        case .webhook:
            var author = BriarAPI_ChannelMessageWebhookAuthor()
            if let id = value.id { author.id = id }
            author.name = value.name
            message.webhook = author
        }
        return message
    }

    private static func channelProposalMessage(
        _ value: ChannelMessage.Proposal
    ) -> BriarAPI_ChannelProposal {
        var message = BriarAPI_ChannelProposal()
        message.id = value.id.uuidString.lowercased()
        message.status = switch value.status {
        case .pending: .pending
        case .accepted: .accepted
        case .declined: .declined
        }
        if let projectID = value.projectId { message.projectID = projectID.uuidString.lowercased() }
        switch value.payload {
        case .batch(let batch):
            var payload = BriarAPI_ChannelIssueBatchProposalPayload()
            payload.items = batch.items.map { item in
                var result = BriarAPI_ChannelIssueBatchProposalItem()
                result.key = item.key
                result.issue = channelIssueMessage(item.issue)
                return result
            }
            payload.dependencies = batch.dependencies.map { dependency in
                var result = BriarAPI_ChannelIssueBatchProposalDependency()
                result.prerequisiteKey = dependency.prerequisiteKey
                result.dependentKey = dependency.dependentKey
                return result
            }
            message.payload = .batch(payload)
        case .issue(let issue, let executeAfterCreate):
            var payload = BriarAPI_ChannelIssueProposalPayload()
            payload.issue = channelIssueMessage(issue)
            payload.executeAfterCreate = executeAfterCreate
            message.payload = .issue(payload)
        }
        if let resultRunID = value.resultRunId {
            message.resultRunID = resultRunID.uuidString.lowercased()
        }
        message.resultItems = value.resultItems.map { item in
            var result = BriarAPI_ChannelIssueBatchResultItem()
            result.localKey = item.localKey
            result.runID = item.runId.uuidString.lowercased()
            return result
        }
        return message
    }

    private static func channelIssueMessage(
        _ value: ChannelMessage.Proposal.Payload.Issue
    ) -> BriarAPI_ChannelIssueProposal {
        var message = BriarAPI_ChannelIssueProposal()
        message.title = value.title
        if let description = value.description { message.description_p = description }
        if let priority = value.priority { message.priority = UInt32(clamping: priority) }
        return message
    }

    private static func providerMessage(_ value: String) -> BriarTypes_AgentProvider {
        switch value {
        case "claude": .claude
        case "cursor": .cursor
        case "opencode": .opencode
        case "grok": .grok
        case "agy": .agy
        default: .codex
        }
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
            kind: .channel,
            hasUnread: false,
            dmParticipants: []
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
                provider: nil,
                id: "fixture-user"
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

    private static var designChannelResponse: BriarAPI_GetChannelResponse {
        getChannelResponse(
            channel: designChannelSummary,
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

    private static var honeyChannelResponse: BriarAPI_GetChannelResponse {
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
        return getChannelResponse(
            channel: honeyChannelSummary,
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

    private static var designThreadResponse: BriarAPI_ListChannelMessagesResponse {
        channelMessagePage(
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

    private static var batchProposalChannelResponse: BriarAPI_GetChannelResponse {
        typealias Proposal = ChannelMessage.Proposal
        typealias Issue = Proposal.Payload.Issue
        let batch = Proposal.Payload.Batch(
            items: [
                .init(
                    key: "api",
                    issue: Issue(
                        title: "승인 API 확장",
                        description: "배치 승인을 처리합니다.",
                        priority: 1
                    )
                ),
                .init(
                    key: "web",
                    issue: Issue(
                        title: "채널 결과 UI",
                        description: "생성 결과를 표시합니다.",
                        priority: 2
                    )
                ),
                .init(
                    key: "qa",
                    issue: Issue(
                        title: "원자성 검증",
                        description: "롤백과 재시도를 확인합니다.",
                        priority: 2
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
            status: .accepted,
            projectId: projectID,
            payload: .batch(batch),
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
        return getChannelResponse(
            channel: designChannelSummary,
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

    private static var channelHistoryResponse: BriarAPI_GetChannelResponse {
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
            updatedAt: createdAt,
            kind: .channel,
            hasUnread: false,
            dmParticipants: []
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
                    provider: index.isMultiple(of: 2) ? "codex" : nil,
                    id: index.isMultiple(of: 2)
                        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                        : "fixture-user"
                ),
                replyCount: 0,
                lastReplyAt: nil,
                document: nil,
                proposal: nil,
                createdAt: createdAt.addingTimeInterval(TimeInterval(index * 60))
            )
        }
        return getChannelResponse(
            channel: channel,
            agents: [],
            messages: messages,
            nextCursor: UUID(uuidString: "20000000-0000-4000-8000-000000000001")
        )
    }

    private static let earlierChannelHistoryResponse = channelMessagePage(
        messages: [ChannelMessage(
            id: UUID(uuidString: "20000000-0000-4000-8000-000000000002")!,
            channelId: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            parentMessageId: nil,
            body: "초기 진입에서 자동으로 불러오면 안 되는 이전 메시지입니다.",
            author: ChannelMessage.Author(
                type: .user,
                name: "Briar User",
                image: nil,
                provider: nil,
                id: "fixture-user"
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

private struct UITestPreparedUploadClient: PreparedUploadClientProtocol {
    func putPreparedUpload(
        _: URL,
        capability _: String,
        contentType _: String,
        data _: Data
    ) async throws {}
}
