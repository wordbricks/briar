import SwiftUI

@main
struct BriarCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-shell") {
                UITestCompanionFlowView(startAtShell: true)
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-offline") {
                UITestOfflineView()
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                UITestCompanionFlowView()
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

private struct UITestCompanionFlowView: View {
    @State private var signedIn: Bool
    @State private var selectedProjectID: UUID?

    init(startAtShell: Bool = false) {
        _signedIn = State(initialValue: startAtShell)
        _selectedProjectID = State(initialValue: startAtShell
            ? UUID(uuidString: "11111111-1111-4111-8111-111111111111")
            : nil)
    }

    private let project = ProjectsResponse.Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_800)
    )

    private var snapshot: DashboardSnapshot {
        DashboardSnapshot(
            project: project,
            runs: [
                DashboardRun(
                    id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                    runNumber: 3832,
                    title: "Companion 읽기 흐름",
                    status: .running,
                    workflowStage: "implementing",
                    detail: "검색에서 상세 화면으로 이동하는 중",
                    issueDescription: "## 목표\n로그인부터 상세까지 안전하게 읽습니다.",
                    updatedAt: Date(timeIntervalSince1970: 1_775_264_400)
                ),
                DashboardRun(
                    id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
                    runNumber: 3831,
                    title: "오프라인 복구 확인",
                    status: .blocked,
                    detail: "네트워크 연결 필요",
                    updatedAt: Date(timeIntervalSince1970: 1_775_264_300)
                ),
                DashboardRun(
                    id: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
                    runNumber: 3830,
                    title: "모바일 계약 검증",
                    status: .completed,
                    resultSummary: "iOS와 Android 읽기 계약을 확인했습니다.",
                    updatedAt: Date(timeIntervalSince1970: 1_775_264_200)
                ),
            ],
            cursor: 41,
            generatedAt: Date(timeIntervalSince1970: 1_775_264_400)
        )
    }

    var body: some View {
        if !signedIn {
            VStack(spacing: 20) {
                Image(systemName: "leaf.fill").font(.system(size: 52)).foregroundStyle(.green)
                Text("Briar Companion").font(.largeTitle.bold()).accessibilityIdentifier("login-title")
                Text("프로젝트 진행 상황을 안전하게 확인하세요.").foregroundStyle(.secondary)
                Button("Briar로 로그인") { signedIn = true }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("login-button")
            }
            .padding()
        } else if selectedProjectID == nil {
            NavigationStack {
                List {
                    Section("조직 및 프로젝트") {
                        Button {
                            selectedProjectID = project.id
                        } label: {
                            Label("Wordbricks · Briar", systemImage: "folder.fill")
                        }
                        .accessibilityIdentifier("project-option-\(project.id.uuidString)")
                    }
                }
                .navigationTitle("프로젝트 선택")
                .accessibilityIdentifier("project-selection")
            }
        } else {
            CompanionShellView(
                projects: [project],
                selectedProjectID: $selectedProjectID,
                snapshot: snapshot,
                isRefreshing: false,
                errorMessage: nil,
                token: "ui-test-token",
                api: UITestAPIClient(),
                refresh: {},
                signOut: {
                    selectedProjectID = nil
                    signedIn = false
                }
            )
        }
    }
}

private struct UITestOfflineView: View {
    var body: some View {
        ContentUnavailableView {
            Label("오프라인", systemImage: "wifi.exclamationmark")
        } description: {
            Text("네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.")
        } actions: {
            Button("다시 시도") {}
                .accessibilityIdentifier("offline-retry")
        }
        .accessibilityIdentifier("offline-state")
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
        let json: String
        if path.hasSuffix("/events") { json = #"{"events":[]}"# }
        else if path.hasSuffix("/evidence") { json = #"{"evidence":[]}"# }
        else if path.hasSuffix("/messages") { json = #"{"messages":[]}"# }
        else { throw MobileAPIError.httpStatus(404, "UI test route not found") }
        return try JSONDecoder.mobileContract.decode(responseType, from: Data(json.utf8))
    }

    func download(_ path: String, token: String) async throws -> Data { Data() }
}
