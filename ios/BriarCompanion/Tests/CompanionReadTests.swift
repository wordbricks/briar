import XCTest
@testable import BriarCompanion

final class CompanionReadTests: XCTestCase {
    private let older = Date(timeIntervalSince1970: 1_700_000_000)
    private let middle = Date(timeIntervalSince1970: 1_700_000_100)
    private let newer = Date(timeIntervalSince1970: 1_700_000_200)

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
}
