import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    private let transitionTimeout: TimeInterval = 20

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLoginProjectSelectionAndDetailFlow() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["login-title"].waitForExistence(timeout: 5))
        app.buttons["login-button"].tap()

        // Project selection is skipped on load; the last used project is
        // auto-selected (first project of the first organization on first use).
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

        // Search was replaced by Home; reach a run from the Tasks list instead.
        XCTAssertTrue(app.tabBars.buttons["홈"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Tasks"].tap()
        let result = app.descendants(matching: .any)[
            "task-row-33333333-3333-4333-8333-333333333333"
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

    func testEnglishLocalizationSurface() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-english"]
        app.launch()

        let login = app.buttons["Sign in with Briar"]
        XCTAssertTrue(login.waitForExistence(timeout: 5))
        login.tap()
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 5))
        for tab in ["Home", "Tasks", "Agents", "Inbox"] {
            XCTAssertTrue(app.tabBars.buttons[tab].exists, "The English \(tab) tab should be visible.")
        }

        let completed = app.descendants(matching: .any)[
            "task-row-33333333-3333-4333-8333-333333333333"
        ]
        XCTAssertTrue(completed.waitForExistence(timeout: 5))
        completed.tap()
        XCTAssertTrue(app.descendants(matching: .any)["run-detail"].waitForExistence(timeout: 5))
        for tab in ["Issue", "Control", "Conversation", "Result", "Logs", "Status"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 5), "The English \(tab) tab should be visible.")
        }

        app.buttons["BackButton"].tap()
        app.buttons["account-menu"].tap()
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Companion settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Appearance"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-english-settings")
    }

    func testRepresentativeRunStatesAndFilters() {
        let app = launchInsideCompanion()

        XCTAssertTrue(app.staticTexts["진행 중"].exists)
        XCTAssertTrue(app.staticTexts["완료"].exists)
        XCTAssertTrue(app.staticTexts["차단"].exists)
        XCTAssertTrue(app.staticTexts["실패"].exists)
        let workerIcon = app.descendants(matching: .any)["실행 Worker Mac Studio"]
        XCTAssertTrue(workerIcon.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(workerIcon.frame.width, 24)
        XCTAssertLessThanOrEqual(workerIcon.frame.height, 24)
        captureScreenshot(named: "companion-task-icons")

        app.segmentedControls.buttons["Attention"].tap()
        XCTAssertTrue(app.staticTexts["오프라인 복구 확인"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["실패 상태 예시"].exists)
        // Completed rows leave the Tasks list for the Attention filter.
        let completed = app.cells.staticTexts["공유 API 계약 검증"]
        XCTAssertFalse(completed.exists && completed.isHittable)
        captureScreenshot(named: "companion-attention-filter")
    }

    func testChannelUsesNativeNavigationAndShowsParticipationCounts() {
        let app = launchInsideCompanion()

        app.tabBars.buttons["홈"].tap()
        let channel = app.buttons[
            "channel-row-cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        ]
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
        channel.tap()

        let navigationBar = app.navigationBars["design"]
        XCTAssertTrue(navigationBar.waitForExistence(timeout: 5))
        let identity = app.descendants(matching: .any)["channel-header-identity"]
        XCTAssertTrue(identity.waitForExistence(timeout: 5))
        XCTAssertTrue(identity.label.contains("design"))
        XCTAssertTrue(identity.label.contains("멤버 4명 • Agent 3개"))
        XCTAssertTrue(navigationBar.buttons.firstMatch.isHittable)
        captureScreenshot(named: "companion-channel-header")

        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let destination = app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: destination)
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
    }

    func testChannelComposerShowsAttachmentButton() {
        let app = launchInsideCompanion()

        app.tabBars.buttons["홈"].tap()
        let channel = app.buttons[
            "channel-row-cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        ]
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
        channel.tap()

        let attach = app.buttons["channel-composer-attach"]
        XCTAssertTrue(attach.waitForExistence(timeout: 5))
        let field = app.textFields["channel-composer-field"]
        XCTAssertTrue(field.exists)
        field.tap()
        field.typeText("Native input")
        XCTAssertTrue(app.buttons["channel-composer-send"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-channel-composer")
    }

    func testChannelThreadUsesReplyConversationWithoutNestedThreadSummaries() {
        let app = launchInsideCompanion()

        app.tabBars.buttons["홈"].tap()
        let channel = app.buttons[
            "channel-row-cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        ]
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
        channel.tap()

        let rootThreadLink = app.staticTexts["스레드에서 답글"]
        XCTAssertTrue(rootThreadLink.waitForExistence(timeout: 5))
        rootThreadLink.tap()

        XCTAssertTrue(app.navigationBars["스레드"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)[
            "channel-message-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        ].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["channel-composer-attach"].exists)
        XCTAssertFalse(app.staticTexts["답글 1개"].exists)
        captureScreenshot(named: "companion-channel-thread")
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

    func testDependencyPickerAddsPrerequisite() {
        let app = launchInsideCompanion()

        app.tabBars.buttons["Tasks"].tap()
        let result = app.descendants(matching: .any)[
            "task-row-99999999-9999-4999-8999-999999999999"
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
        try performAccessibilityAudit(on: app, for: [
            .hitRegion,
            .sufficientElementDescription,
            .textClipped,
        ])
        captureScreenshot(named: "companion-accessibility-xxxl")

        app.buttons["login-button"].tap()
        XCTAssertTrue(app.buttons["project-menu"].waitForExistence(timeout: transitionTimeout))
        XCTAssertTrue(app.staticTexts["iOS Native Companion 읽기 경험"].exists)
        try performAccessibilityAudit(on: app, for: [.textClipped])
        captureScreenshot(named: "companion-task-list-accessibility-xxxl")
    }

    func testAgentsInboxAndSettingsSurface() {
        let app = launchInsideCompanion()

        XCTAssertTrue(app.tabBars.buttons["Agents"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Agents"].tap()
        XCTAssertTrue(app.navigationBars["Agents"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-agents")

        let agentRow = app.descendants(matching: .any)[
            "agent-row-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        ]
        XCTAssertTrue(agentRow.waitForExistence(timeout: 5))
        agentRow.tap()
        XCTAssertTrue(app.navigationBars["Issue processing agent"].waitForExistence(timeout: 5))
        let runButton = app.buttons["agent-run-button"]
        XCTAssertTrue(runButton.waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-agent-run")
        runButton.tap()

        let skillPicker = app.descendants(matching: .any)["agent-run-skill-picker"]
        let submitRun = app.buttons["agent-run-submit"]
        XCTAssertTrue(skillPicker.waitForExistence(timeout: 5))
        XCTAssertTrue(submitRun.waitForExistence(timeout: 5))
        XCTAssertFalse(submitRun.isEnabled)

        skillPicker.tap()
        let releaseSkill = app.descendants(matching: .any)[
            "agent-run-skill-cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        ]
        XCTAssertTrue(releaseSkill.waitForExistence(timeout: 5))
        releaseSkill.tap()

        let requestEditor = app.textViews["agent-run-request"]
        XCTAssertTrue(requestEditor.waitForExistence(timeout: 5))
        XCTAssertEqual(requestEditor.value as? String, "Release the iOS app.")
        // The request editor has its own scroll view; scroll the surrounding
        // execution form so the worker picker below it becomes visible.
        app.swipeUp()
        let workerPicker = app.descendants(matching: .any)["agent-run-worker-picker"]
        XCTAssertTrue(workerPicker.waitForExistence(timeout: 5))
        XCTAssertEqual(workerPicker.value as? String, "Release Mac")
        XCTAssertTrue(submitRun.isEnabled)
        app.buttons["취소"].tap()
        XCTAssertTrue(skillPicker.waitForNonExistence(timeout: 5))

        app.navigationBars["Issue processing agent"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Agents"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Inbox"].tap()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.scrollViews["inbox-feed"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["inbox-mark-all-read"].exists)
        XCTAssertTrue(app.staticTexts["오프라인 복구 확인"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts["공유 API 계약 검증"].waitForExistence(timeout: 5),
            "모바일 인박스는 모든 중요도 메시지를 하나의 시간순 피드에 표시해야 합니다."
        )
        captureScreenshot(named: "companion-inbox")

        app.buttons["account-menu"].tap()
        let settingsButton = app.buttons["설정"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 5))
        settingsButton.tap()
        XCTAssertTrue(app.navigationBars["Companion 설정"].waitForExistence(timeout: 5))
        // Settings sheet exposes profile, theme, language, icons, and notification toggles.
        let settingsIdentifiers = [
            "account-profile-photo",
            "settings-theme-picker",
            "settings-locale-picker",
            "settings-app-icon-picker",
            "app-icon-purple",
            "app-icon-gray",
            "app-icon-pink",
            "app-icon-green",
            "notification-toggle-urgent",
            "notification-toggle-action_required",
            "notification-toggle-important",
            "notification-toggle-activity",
        ]
        for identifier in settingsIdentifiers {
            let element = app.descendants(matching: .any)[identifier]
            for _ in 0..<4 where !element.exists {
                app.swipeUp()
            }
            XCTAssertTrue(
                element.waitForExistence(timeout: 5),
                "설정 제어 \(identifier)가 표시되어야 합니다."
            )
        }
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
        XCTAssertTrue(app.buttons["login-button"].waitForExistence(timeout: transitionTimeout))
        app.buttons["login-button"].tap()
        XCTAssertTrue(app.buttons["project-menu"].waitForExistence(timeout: transitionTimeout))
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: transitionTimeout))
        return app
    }

    private func performAccessibilityAudit(
        on app: XCUIApplication,
        for auditTypes: XCUIAccessibilityAuditType
    ) throws {
        do {
            try app.performAccessibilityAudit(for: auditTypes)
        } catch {
            // Xcode 26 simulators can time out while creating an audit snapshot;
            // rerun once before treating it as a product accessibility failure.
            Thread.sleep(forTimeInterval: 1)
            try app.performAccessibilityAudit(for: auditTypes)
        }
    }

    private func captureScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
