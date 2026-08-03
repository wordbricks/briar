import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLoginProjectSearchAndOpenDetailFlow() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["login-title"].waitForExistence(timeout: 5))
        app.descendants(matching: .any)["login-button"].tap()

        XCTAssertTrue(app.navigationBars["프로젝트 선택"].waitForExistence(timeout: 5))
        app.descendants(matching: .any)["project-option-11111111-1111-4111-8111-111111111111"].tap()

        XCTAssertTrue(app.descendants(matching: .any)["companion-shell"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["진행 중"].exists)
        XCTAssertTrue(app.staticTexts["차단됨"].exists)
        XCTAssertTrue(app.staticTexts["완료"].exists)

        app.tabBars.buttons["검색"].tap()
        let searchField = app.searchFields["작업 검색"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Companion")

        let result = app.staticTexts["Companion 읽기 흐름"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "로그인부터 상세까지")
            ).firstMatch.exists
        )
    }

    func testOfflineRecoveryScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-offline"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["offline-state"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["오프라인"].exists)
        XCTAssertTrue(app.buttons["다시 시도"].exists)
    }
}
