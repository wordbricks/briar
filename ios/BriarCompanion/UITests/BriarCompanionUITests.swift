import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testDashboardScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Dashboard"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["dashboard-list"].exists)
        XCTAssertTrue(app.staticTexts["iOS Native Dashboard 동기화"].exists)
        XCTAssertTrue(app.staticTexts["진행 중"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["dashboard-synced-at"].exists)
    }
}
