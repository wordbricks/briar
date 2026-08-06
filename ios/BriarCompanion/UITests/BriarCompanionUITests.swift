import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLoginProjectSelectionSearchAndDetailFlow() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["login-title"].waitForExistence(timeout: 5))
        app.buttons["login-button"].tap()
        XCTAssertTrue(app.navigationBars["프로젝트 선택"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["organization-picker"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["project-picker"].exists)
        app.buttons["project-continue-button"].tap()

        let projectMenu = app.buttons["project-menu"]
        XCTAssertTrue(projectMenu.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Tasks"].exists)
        projectMenu.tap()
        let alternateProject = app.buttons[
            "project-option-88888888-8888-4888-8888-888888888888"
        ]
        XCTAssertTrue(alternateProject.waitForExistence(timeout: 5))
        alternateProject.tap()
        XCTAssertTrue(app.buttons["project-menu"].label.contains("Briar Mobile"))

        XCTAssertTrue(app.tabBars.buttons["Search"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Search"].tap()
        let searchField = app.searchFields["작업 검색"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Companion")

        let result = app.descendants(matching: .any)[
            "search-result-33333333-3333-4333-8333-333333333333"
        ]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["iOS Native Companion 읽기 경험"].exists)
        XCTAssertTrue(app.buttons["issue-actions-menu"].exists)
        for tab in ["이슈", "제어", "대화", "결과", "로그", "상태"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 5), "\(tab) 탭이 표시되어야 합니다.")
        }
        XCTAssertTrue(app.descendants(matching: .any)[
            "issue-attachment-image-aaaaaaaa-1111-4111-8111-111111111111"
        ].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-search-detail")
    }

    func testRepresentativeRunStatesAndFilters() {
        let app = launchInsideCompanion()

        XCTAssertTrue(app.staticTexts["진행 중"].exists)
        XCTAssertTrue(app.staticTexts["완료"].exists)
        XCTAssertTrue(app.staticTexts["확인 필요"].exists)
        XCTAssertTrue(app.staticTexts["실패"].exists)
        captureScreenshot(named: "companion-task-icons")

        app.segmentedControls.buttons["Attention"].tap()
        XCTAssertTrue(app.staticTexts["오프라인 복구 확인"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["실패 상태 예시"].exists)
        // Completed rows leave the Tasks list for the Attention filter.
        let completed = app.cells.staticTexts["공유 API 계약 검증"]
        XCTAssertFalse(completed.exists && completed.isHittable)
        captureScreenshot(named: "companion-attention-filter")
    }

    func testCompletedIssueOpensResultTabFirst() {
        let app = launchInsideCompanion()

        app.segmentedControls.buttons["Completed"].tap()
        let completed = app.staticTexts["공유 API 계약 검증"]
        XCTAssertTrue(completed.waitForExistence(timeout: 5))
        completed.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))
        // Completed issues should land on the Result tab (Android React parity).
        let resultTab = app.buttons["run-detail-tab-result"]
        XCTAssertTrue(
            resultTab.waitForExistence(timeout: 5) && resultTab.isSelected,
            "완료된 이슈는 결과 탭이 먼저 보여야 합니다."
        )
        XCTAssertTrue(app.staticTexts["공유 계약이 검증되었습니다."].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-completed-result-tab")
    }

    func testDependencyPickerSearchesAndAddsPrerequisite() {
        let app = launchInsideCompanion()

        app.tabBars.buttons["Search"].tap()
        let searchField = app.searchFields["작업 검색"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("의존성 연결 대상")

        let result = app.descendants(matching: .any)[
            "search-result-99999999-9999-4999-8999-999999999999"
        ]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))

        app.buttons["run-detail-tab-control"].tap()
        let addDependency = app.buttons["add-dependency-button"]
        XCTAssertTrue(addDependency.waitForExistence(timeout: 5))
        addDependency.tap()

        XCTAssertTrue(app.navigationBars["의존성 추가"].waitForExistence(timeout: 5))
        let dependencySearch = app.searchFields["이슈 검색"]
        XCTAssertTrue(dependencySearch.waitForExistence(timeout: 5))
        dependencySearch.tap()
        dependencySearch.typeText("API 준비")
        app.keyboards.buttons["Search"].tap()
        let candidate = app.buttons[
            "dependency-option-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        ]
        XCTAssertTrue(candidate.waitForExistence(timeout: 5))
        candidate.tap()

        XCTAssertTrue(app.collectionViews["dependency-picker"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons[
            "remove-dependency-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        ].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-dependency-picker")
    }

    func testOfflineErrorAndRetryScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-offline"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["offline-state"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["오프라인"].exists)
        XCTAssertTrue(app.buttons["다시 시도"].exists)
        captureScreenshot(named: "companion-offline-retry")
    }

    func testAccessibilityAndLargestDynamicTypeLayout() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
        ]
        app.launch()

        let title = app.descendants(matching: .any)["login-title"]
        let login = app.buttons["login-button"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(login.exists)
        XCTAssertTrue(login.isHittable)
        try app.performAccessibilityAudit(for: [
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
        ])
        captureScreenshot(named: "companion-accessibility-xxxl")

        app.buttons["login-button"].tap()
        XCTAssertTrue(app.buttons["project-continue-button"].waitForExistence(timeout: 5))
        app.buttons["project-continue-button"].tap()
        XCTAssertTrue(app.buttons["project-menu"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["iOS Native Companion 읽기 경험"].exists)
        try app.performAccessibilityAudit(for: [.textClipped])
        captureScreenshot(named: "companion-task-list-accessibility-xxxl")
    }

    func testAgentsInboxAndSettingsSurface() {
        let app = launchInsideCompanion()

        XCTAssertTrue(app.tabBars.buttons["Agents"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Agents"].tap()
        XCTAssertTrue(app.navigationBars["Agents"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-agents")

        app.tabBars.buttons["Inbox"].tap()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["inbox-importance-filters"].exists)
        for category in ["urgent", "action_required", "important", "activity"] {
            XCTAssertTrue(
                app.buttons["inbox-filter-\(category)"].exists,
                "\(category) 필터 칩이 표시되어야 합니다."
            )
        }
        // Turning off the activity filter hides routine updates, keeping attention rows.
        app.buttons["inbox-filter-activity"].tap()
        XCTAssertTrue(app.staticTexts["오프라인 복구 확인"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts["공유 API 계약 검증"].waitForNonExistence(timeout: 5),
            "최근 활동 메시지는 활동 필터를 끄면 사라져야 합니다."
        )
        captureScreenshot(named: "companion-inbox")

        app.buttons["account-menu"].tap()
        let settingsButton = app.buttons["설정"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 5))
        settingsButton.tap()
        XCTAssertTrue(app.navigationBars["Companion 설정"].waitForExistence(timeout: 5))
        // Settings sheet exposes profile, theme, language, icons, and notification toggles.
        XCTAssertTrue(app.staticTexts["계정"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches.count > 0 || app.buttons["완료"].exists)
        captureScreenshot(named: "companion-settings-icons")
    }

    func testCreateRunStateAndMessageFlow() {
        let app = launchInsideCompanion()

        app.buttons["create-issue-button"].tap()
        let title = app.textFields["create-issue-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["create-issue-paste-attachment"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["새 이슈"].exists)
        title.tap()
        title.typeText("모바일 쓰기 흐름 확인")
        let submit = app.buttons["create-issue-submit"]
        submit.tap()
        XCTAssertFalse(title.waitForExistence(timeout: 5))

        let createdIssue = app.staticTexts["모바일 쓰기 흐름 확인"]
        XCTAssertTrue(createdIssue.waitForExistence(timeout: 5))
        let createdRow = app.descendants(matching: .any)[
            "task-row-77777777-7777-4777-8777-777777777777"
        ]
        XCTAssertTrue(createdRow.waitForExistence(timeout: 5))
        createdRow.swipeLeft()
        let shortcut = app.buttons[
            "task-process-now-77777777-7777-4777-8777-777777777777"
        ]
        XCTAssertTrue(shortcut.waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-task-process-shortcut")
        shortcut.tap()
        let dispatch = app.buttons["dispatch-issue-submit"]
        XCTAssertTrue(dispatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["바로 처리"].exists)
        captureScreenshot(named: "companion-task-process-sheet")
        dispatch.tap()

        XCTAssertTrue(createdIssue.waitForExistence(timeout: 5))
        createdIssue.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))
        app.buttons["대화"].tap()
        let message = app.textFields["issue-message-field"]
        for _ in 0..<8 where !message.exists { app.swipeUp() }
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("모바일에서 확인했습니다")
        app.buttons["issue-message-send"].tap()
        XCTAssertTrue(app.staticTexts["모바일에서 확인했습니다"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-native-write-flow")
    }

    private func launchInsideCompanion() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["login-button"].waitForExistence(timeout: 5))
        app.buttons["login-button"].tap()
        XCTAssertTrue(app.buttons["project-continue-button"].waitForExistence(timeout: 5))
        app.buttons["project-continue-button"].tap()
        XCTAssertTrue(app.buttons["project-menu"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 5))
        return app
    }

    private func captureScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
