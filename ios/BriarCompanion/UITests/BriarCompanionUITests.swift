import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFoundationStatusScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.staticTexts["foundation-title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["foundation-title"].label, "Briar Companion")
        XCTAssertTrue(app.staticTexts["foundation-status"].exists)
        for identifier in [
            "capability-독립 앱",
            "capability-공유 API 계약",
            "capability-회귀 보호",
        ] {
            XCTAssertTrue(
                app.descendants(matching: .any)[identifier]
                    .waitForExistence(timeout: 2),
                "Missing capability row: \(identifier)"
            )
        }
    }
}
