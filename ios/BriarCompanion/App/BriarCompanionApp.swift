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

    init(offline: Bool) {
        self.offline = offline
        _selectedProjectID = State(initialValue: project.id)
    }

    var body: some View {
        if offline {
            NavigationStack {
                OfflineStateView(
                    message: "네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.",
                    refresh: {}
                )
                .navigationTitle("Tasks")
            }
        } else if !signedIn {
            CompanionLoginView(signingIn: false, errorMessage: nil) { signedIn = true }
        } else if !projectSelected {
            ProjectSelectionView(
                projects: [project],
                selectedProjectID: $selectedProjectID,
                continueAction: { projectSelected = true },
                signOut: { signedIn = false }
            )
        } else {
            CompanionShellView(
                project: project,
                snapshot: snapshot,
                isRefreshing: false,
                errorMessage: nil,
                token: "ui-test-token",
                api: api,
                refresh: {},
                changeProject: { projectSelected = false },
                signOut: {
                    projectSelected = false
                    signedIn = false
                }
            )
        }
    }

    private var snapshot: DashboardSnapshot {
        DashboardSnapshot(
            project: project,
            runs: [
                DashboardRun(
                    id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                    runNumber: 3832,
                    title: "iOS Native Companion 읽기 경험",
                    status: .running,
                    workflowStage: "implementing",
                    progress: 45,
                    detail: "앱 셸과 작업 상세를 구현하는 중",
                    issueDescription: "## 목표\n로그인부터 상세까지 안전하게 읽습니다.",
                    resultSummary: nil,
                    updatedAt: Date(timeIntervalSince1970: 1_775_264_400)
                ),
                DashboardRun(
                    id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
                    title: "공유 API 계약 검증",
                    status: .completed,
                    detail: "iOS와 Android 계약 통과",
                    resultSummary: "공유 계약이 검증되었습니다.",
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
            ],
            workers: [DashboardWorker(
                id: "worker-1",
                label: "Mac Studio",
                readiness: "available",
                readinessDetail: "작업 수신 가능",
                activeSessions: 1,
                availableSessions: 2
            )],
            conversationNotifications: [],
            cursor: 41,
            generatedAt: Date(timeIntervalSince1970: 1_775_264_400)
        )
    }
}

private struct UITestAPIClient: MobileAPIClientProtocol {
    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        let payload: String
        if path.hasSuffix("/events") {
            payload = #"{"events":[]}"#
        } else if path.hasSuffix("/messages") {
            payload = #"{"messages":[]}"#
        } else if path.hasSuffix("/evidence") {
            payload = #"{"evidence":[]}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}
