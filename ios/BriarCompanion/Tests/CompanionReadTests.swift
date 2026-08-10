import XCTest
@testable import BriarCompanion

final class CompanionReadTests: XCTestCase {
    private let older = Date(timeIntervalSince1970: 1_700_000_000)
    private let middle = Date(timeIntervalSince1970: 1_700_000_100)
    private let newer = Date(timeIntervalSince1970: 1_700_000_200)

    func testCompanionLocalesMatchTheSharedMobileLocaleContract() {
        XCTAssertEqual(CompanionLocale.allCases.map(\.rawValue), ["ko", "en", "zh"])
        XCTAssertEqual(
            CompanionLocale.allCases.map(\.foundationIdentifier),
            ["ko-KR", "en-US", "zh-CN"]
        )
    }

    private var runs: [DashboardRun] {
        [
            DashboardRun(
                id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
                title: "Active native shell",
                status: .running,
                detail: "Implement tabs",
                issueDescription: "Searchable Markdown description",
                updatedAt: middle
            ),
            DashboardRun(
                id: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
                runNumber: 2,
                title: "Offline recovery",
                status: .blocked,
                detail: "Needs network attention",
                updatedAt: older
            ),
            DashboardRun(
                id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
                title: "Finished contract",
                status: .completed,
                resultSummary: "Android and iOS fixture passed",
                updatedAt: newer
            ),
        ]
    }

    func testAllActiveAttentionAndCompletedFilters() {
        XCTAssertEqual(runs.filter(TaskFilter.all.includes).count, 3)
        XCTAssertEqual(runs.filter(TaskFilter.active.includes).map(\.status), [.running, .blocked])
        XCTAssertEqual(runs.filter(TaskFilter.attention.includes).map(\.status), [.blocked])
        XCTAssertEqual(runs.filter(TaskFilter.completed.includes).map(\.status), [.completed])
    }

    func testTasksListOrdersByMostRecentlyUpdated() {
        // Input order is middle, older, newer (status-mixed); display must be newest first.
        let ordered = TaskOrdering.byMostRecentlyUpdated(runs.filter(TaskFilter.all.includes))
        XCTAssertEqual(ordered.map(\.title), [
            "Finished contract",
            "Active native shell",
            "Offline recovery",
        ])
        XCTAssertEqual(ordered.map(\.updatedAt), ordered.map(\.updatedAt).sorted(by: >))

        // Completed-only filter still respects update recency among matches.
        let completed = TaskOrdering.byMostRecentlyUpdated(runs.filter(TaskFilter.completed.includes))
        XCTAssertEqual(completed.map(\.title), ["Finished contract"])
    }

    func testSearchCoversTitleDescriptionDetailAndResult() {
        XCTAssertEqual(TaskSearch.results(in: runs, query: "native").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Markdown").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "network").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Android").count, 1)
        XCTAssertEqual(
            TaskSearch.results(in: runs, query: "BR-2", issueKeyPrefix: "BR").count,
            1
        )
        XCTAssertEqual(TaskSearch.results(in: runs, query: "missing").count, 0)
    }

    func testSearchResultsOrderByMostRecentlyUpdated() {
        // All three fixtures contain "a"/"e" in title, detail, or result.
        let multi = TaskSearch.results(in: runs, query: "a")
        XCTAssertEqual(multi.count, 3)
        XCTAssertEqual(multi.map(\.title), [
            "Finished contract",
            "Active native shell",
            "Offline recovery",
        ])
        XCTAssertEqual(multi.map(\.updatedAt), multi.map(\.updatedAt).sorted(by: >))
    }

    func testCompletedAndPausedPreferResultDetailTab() {
        // Parity with shared React RunPage activeDetailTab default.
        XCTAssertTrue(DashboardRun.Status.completed.prefersResultDetailTab)
        XCTAssertTrue(DashboardRun.Status.paused.prefersResultDetailTab)
        for status in DashboardRun.Status.allCases where status != .completed && status != .paused {
            XCTAssertFalse(
                status.prefersResultDetailTab,
                "\(status.rawValue) should open on the Issue tab"
            )
        }
    }

    @MainActor
    func testRunRowResolvesAssignedAndRequestedWorker() {
        let assignedWorker = DashboardWorker(
            id: "worker-assigned",
            label: "Assigned Mac",
            icon: .init(type: .emoji, value: "🍋"),
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let requestedWorker = DashboardWorker(
            id: "worker-requested",
            label: "Requested Mac",
            icon: .init(type: .emoji, value: "🍏"),
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        let workers = [assignedWorker, requestedWorker]
        let assignedRun = DashboardRun(
            id: UUID(),
            title: "Assigned task",
            status: .completed,
            workflowStage: "merged",
            requestedWorkerId: requestedWorker.id,
            workerId: assignedWorker.id,
            updatedAt: newer
        )
        let requestedRun = DashboardRun(
            id: UUID(),
            title: "Requested task",
            status: .queued,
            requestedWorkerId: requestedWorker.id,
            updatedAt: newer
        )
        let unknownRun = DashboardRun(
            id: UUID(),
            title: "Unknown worker task",
            status: .completed,
            workerId: "worker-unknown",
            updatedAt: newer
        )

        XCTAssertEqual(RunRow.worker(for: assignedRun, workers: workers), assignedWorker)
        XCTAssertEqual(RunRow.worker(for: requestedRun, workers: workers), requestedWorker)
        XCTAssertNil(RunRow.worker(for: unknownRun, workers: workers))
    }

    func testAgentSkillWorkerEligibilityUsesAvailabilityAndHealthyProviders() {
        let pausedWorker = DashboardWorker(
            id: "worker-paused",
            label: "Paused Mac",
            agentProvider: .codex,
            providers: [.codex],
            readiness: "available",
            acceptingWork: false,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertFalse(workerCanRunAgentSkill(pausedWorker, provider: .codex))

        let providerOverride = DashboardWorker(
            id: "worker-provider-override",
            label: "Claude Mac",
            agentProvider: .codex,
            providers: [.claude],
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertFalse(workerCanRunAgentSkill(providerOverride, provider: .codex))
        XCTAssertTrue(workerCanRunAgentSkill(providerOverride, provider: .claude))

        let legacyProvider = DashboardWorker(
            id: "worker-legacy-provider",
            label: "Legacy Mac",
            agentProvider: .codex,
            readiness: "available",
            acceptingWork: true,
            readinessDetail: nil,
            activeSessions: 0,
            availableSessions: 1
        )
        XCTAssertTrue(workerCanRunAgentSkill(legacyProvider, provider: .codex))
    }
}
