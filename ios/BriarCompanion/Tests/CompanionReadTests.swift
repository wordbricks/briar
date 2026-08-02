import XCTest
@testable import BriarCompanion

final class CompanionReadTests: XCTestCase {
    private let runs = [
        DashboardRun(
            id: UUID(),
            title: "Active native shell",
            status: .running,
            detail: "Implement tabs",
            issueDescription: "Searchable Markdown description",
            updatedAt: .now
        ),
        DashboardRun(
            id: UUID(),
            title: "Offline recovery",
            status: .blocked,
            detail: "Needs network attention",
            updatedAt: .now
        ),
        DashboardRun(
            id: UUID(),
            title: "Finished contract",
            status: .completed,
            resultSummary: "Android and iOS fixture passed",
            updatedAt: .now
        ),
    ]

    func testAllActiveAttentionAndCompletedFilters() {
        XCTAssertEqual(runs.filter(TaskFilter.all.includes).count, 3)
        XCTAssertEqual(runs.filter(TaskFilter.active.includes).map(\.status), [.running, .blocked])
        XCTAssertEqual(runs.filter(TaskFilter.attention.includes).map(\.status), [.blocked])
        XCTAssertEqual(runs.filter(TaskFilter.completed.includes).map(\.status), [.completed])
    }

    func testSearchCoversTitleDescriptionDetailAndResult() {
        XCTAssertEqual(TaskSearch.results(in: runs, query: "native").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Markdown").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "network").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "Android").count, 1)
        XCTAssertEqual(TaskSearch.results(in: runs, query: "missing").count, 0)
    }
}
