import SwiftUI

@main
struct BriarCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                UITestDashboardView()
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

private struct UITestDashboardView: View {
    private let project = ProjectsResponse.Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_775_260_800)
    )

    var body: some View {
        NavigationStack {
            DashboardContentView(
                projects: [project],
                selectedProjectID: .constant(project.id),
                snapshot: DashboardSnapshot(
                    project: project,
                    runs: [DashboardRun(
                        id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                        title: "iOS Native Dashboard 동기화",
                        status: .running,
                        detail: "snapshot과 delta를 안전하게 병합하는 중",
                        updatedAt: Date(timeIntervalSince1970: 1_775_264_400)
                    )],
                    cursor: 41,
                    generatedAt: Date(timeIntervalSince1970: 1_775_264_400)
                ),
                isRefreshing: false,
                errorMessage: nil,
                refresh: {},
                signOut: {}
            )
            .navigationTitle("Dashboard")
        }
    }
}
