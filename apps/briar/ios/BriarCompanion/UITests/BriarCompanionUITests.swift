import XCTest

@MainActor
final class BriarCompanionUITests: XCTestCase {
    private let transitionTimeout: TimeInterval = 20
    private let channelTransitionTimeout: TimeInterval = 60
    private let accessibilityTransitionTimeout: TimeInterval = 60

    private func waitForKeyboardFocus(on element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hasKeyboardFocus == true"),
            object: element
        )
        return XCTWaiter().wait(for: [expectation], timeout: transitionTimeout) == .completed
    }

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
        XCTAssertTrue(projectMenu.waitForExistence(timeout: transitionTimeout))
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

        let channel = openHomeChannel(in: app)
        let navigationBar = app.navigationBars["design"]
        let identity = app.descendants(matching: .any)["channel-header-identity"]
        XCTAssertTrue(identity.waitForExistence(timeout: 5))
        XCTAssertTrue(identity.label.contains("design"))
        XCTAssertTrue(identity.label.contains("멤버 4명 • Agent 3개"))
        XCTAssertTrue(navigationBar.buttons.firstMatch.isHittable)
        captureScreenshot(named: "companion-channel-header")

        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let destination = app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: destination)
        XCTAssertTrue(channel.waitForExistence(timeout: transitionTimeout))

        channel.tap()
        let cachedMessage = app.descendants(matching: .any)[
            "상단 헤더 디자인을 함께 확인해 주세요."
        ]
        XCTAssertTrue(cachedMessage.waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-channel-reentry")
    }

    func testDirectMessageOpensItsBoundedTimeline() {
        let app = launchInsideCompanion()

        let directMessages = app.tabBars.buttons["DMs"]
        XCTAssertTrue(directMessages.waitForExistence(timeout: transitionTimeout))
        directMessages.tap()
        let conversation = app.buttons[
            "dm-row-12121212-1212-4212-8212-121212121212"
        ]
        XCTAssertTrue(conversation.waitForExistence(timeout: channelTransitionTimeout))
        conversation.tap()

        let identity = app.descendants(matching: .any)["channel-header-identity"]
        XCTAssertTrue(identity.waitForExistence(timeout: channelTransitionTimeout))
        XCTAssertTrue(identity.label.contains("Honey"))
        XCTAssertFalse(identity.label.contains("비공개 대화"))
        XCTAssertTrue(
            element(withLabel: "iOS DM 화면을 검토해 주세요.", in: app)
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(
            element(withLabel: "검토를 마쳤습니다.", in: app)
                .waitForExistence(timeout: 5)
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["channel-message-loading-spinner"].exists
        )
        captureScreenshot(named: "companion-direct-message-timeline")
        identity.tap()
        let profile = app.descendants(matching: .any)["conversation-profile-sheet"]
        XCTAssertTrue(profile.waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.descendants(matching: .any)["conversation-profile-name"].label.contains("Honey")
        )
        XCTAssertTrue(app.staticTexts["Review mobile product work."].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-direct-message-profile")
        app.buttons["conversation-profile-close"].tap()
        XCTAssertTrue(profile.waitForNonExistence(timeout: 5))

        let rootMessage = app.textViews[
            "channel-message-16161616-1616-4616-8616-161616161616"
        ]
        XCTAssertTrue(rootMessage.waitForExistence(timeout: 5))
        XCTAssertFalse(
            app.buttons["channel-react-16161616-1616-4616-8616-161616161616"].exists,
            "리액션이 없는 DM 메시지에는 단독 React 버튼이 보이지 않아야 합니다."
        )
        rootMessage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.7)
        XCTAssertTrue(app.buttons["channel-quick-reaction-👍"].waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-dm-reaction-actions")
    }

    func testChannelShowsLoadingSpinnerWhileMessagesLoad() {
        let app = launchInsideCompanion(
            additionalArguments: ["--ui-testing-delayed-channel-load"]
        )

        _ = openHomeChannel(in: app)

        let spinner = app.descendants(matching: .any)["channel-message-loading-spinner"]
        XCTAssertTrue(spinner.waitForExistence(timeout: channelTransitionTimeout))
        captureScreenshot(named: "companion-channel-message-loading-spinner")

        let message = app.descendants(matching: .any)[
            "상단 헤더 디자인을 함께 확인해 주세요."
        ]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertFalse(spinner.exists)
    }

    func testChannelWithHistoryShowsNewestMessageImmediately() {
        let app = launchInsideCompanion(
            additionalArguments: ["--ui-testing-channel-history"]
        )

        _ = openHomeChannel(in: app)

        let newestMessage = element(
            withLabel: "가변 높이 채널 메시지 20입니다.",
            in: app
        )
        XCTAssertTrue(newestMessage.waitForExistence(timeout: 5))
        captureScreenshot(named: "companion-channel-history-initial-position")
        let windowFrame = app.windows.firstMatch.frame
        XCTAssertTrue(
            newestMessage.frame.intersects(windowFrame),
            "메시지가 많은 채널도 스크롤 없이 최신 메시지를 화면에 표시해야 합니다. " +
                "message=\(newestMessage.frame), window=\(windowFrame)"
        )
        let earlierMessage = element(
            withLabel: "초기 진입에서 자동으로 불러오면 안 되는 이전 메시지입니다.",
            in: app
        )
        XCTAssertFalse(
            earlierMessage.waitForExistence(timeout: 1),
            "화면 상단에 도달하기 전에는 이전 메시지 페이지를 불러오면 안 됩니다."
        )

        let timeline = app.scrollViews["channel-message-timeline"]
        XCTAssertTrue(timeline.exists)
        for _ in 0 ..< 6 { timeline.swipeDown() }
        captureScreenshot(named: "companion-channel-history-scrolled-to-top")
        XCTAssertTrue(
            earlierMessage.waitForExistence(timeout: 5),
            "화면 상단에 도달하면 이전 메시지 페이지를 불러와야 합니다."
        )
    }

    func testChannelAttachmentCardOpensPreview() {
        let app = launchInsideCompanion()

        _ = openHomeChannel(in: app)

        let card = app.descendants(matching: .any)[
            "channel-attachment-card-abababab-abab-4bab-8bab-abababababab"
        ]
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertTrue(card.label.contains("channel-card.png"))
        captureScreenshot(named: "companion-channel-attachment-card")

        let previewButton = app.buttons["channel-card.png 크게 보기"]
        XCTAssertTrue(previewButton.waitForExistence(timeout: 5))
        previewButton.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["channel-attachment-preview"]
                .waitForExistence(timeout: 5)
        )
        captureScreenshot(named: "companion-channel-attachment-preview")
    }

    func testChannelSentMessageAppearsImmediatelyWithoutSendingLabel() {
        let app = launchInsideCompanion(
            additionalArguments: ["--ui-testing-delayed-message-send"]
        )

        _ = openHomeChannel(in: app)

        let field = app.textFields["channel-composer-field"]
        XCTAssertTrue(field.waitForExistence(timeout: transitionTimeout))
        field.tap()
        XCTAssertTrue(waitForKeyboardFocus(on: field))
        let sentBody = "채널에서 바로 보이는 메시지"
        field.typeText(sentBody)
        let send = app.buttons["channel-composer-send"]
        send.tap()

        let sentMessage = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", sentBody)
        ).firstMatch
        XCTAssertTrue(
            sentMessage.waitForExistence(timeout: 1),
            "서버 응답 전에도 채널 메시지가 즉시 표시되어야 합니다."
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["channel-message-sending"].exists,
            "낙관적으로 표시한 채널 메시지에는 보내는 중 문구가 없어야 합니다."
        )
        captureScreenshot(named: "companion-channel-optimistic-message")

        XCTAssertTrue(
            waitForKeyboardFocus(on: field),
            "채널 메시지를 보낸 뒤에도 입력창 키보드가 유지되어야 합니다."
        )
        captureScreenshot(named: "companion-channel-composer-stays-focused")
        XCTAssertTrue(
            send.waitForNonExistence(timeout: 5),
            "서버가 메시지를 확정하면 빈 입력창의 전송 버튼이 다시 숨겨져야 합니다."
        )
        XCTAssertTrue(
            waitForKeyboardFocus(on: field),
            "전송이 끝난 뒤에도 입력창 키보드가 내려가지 않아야 합니다."
        )
        XCTAssertEqual(
            app.descendants(matching: .any).matching(
                NSPredicate(format: "label == %@", sentBody)
            ).count,
            1
        )
    }

    func testDirectMessageKeepsComposerFocusedAfterSend() {
        let app = launchInsideCompanion(
            additionalArguments: ["--ui-testing-delayed-message-send"]
        )

        let directMessages = app.tabBars.buttons["DMs"]
        XCTAssertTrue(directMessages.waitForExistence(timeout: transitionTimeout))
        directMessages.tap()
        let conversation = app.buttons[
            "dm-row-12121212-1212-4212-8212-121212121212"
        ]
        XCTAssertTrue(conversation.waitForExistence(timeout: channelTransitionTimeout))
        conversation.tap()

        let field = app.textFields["channel-composer-field"]
        XCTAssertTrue(field.waitForExistence(timeout: channelTransitionTimeout))
        field.tap()
        XCTAssertTrue(waitForKeyboardFocus(on: field))
        let sentBody = "DM에서도 입력창이 유지됩니다"
        field.typeText(sentBody)
        let send = app.buttons["channel-composer-send"]
        send.tap()

        let sentMessage = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", sentBody)
        ).firstMatch
        XCTAssertTrue(
            sentMessage.waitForExistence(timeout: 1),
            "서버 응답 전에도 DM 메시지가 즉시 표시되어야 합니다."
        )
        XCTAssertTrue(
            waitForKeyboardFocus(on: field),
            "DM 메시지를 보낸 뒤에도 입력창 키보드가 유지되어야 합니다."
        )
        captureScreenshot(named: "companion-dm-composer-stays-focused")
        XCTAssertTrue(
            send.waitForNonExistence(timeout: 5),
            "서버가 메시지를 확정하면 빈 입력창의 전송 버튼이 다시 숨겨져야 합니다."
        )
        XCTAssertTrue(
            waitForKeyboardFocus(on: field),
            "DM 전송이 끝난 뒤에도 입력창 키보드가 내려가지 않아야 합니다."
        )
    }

    func testChannelMentionPickerDismissesAfterAgentSelection() {
        let app = launchInsideCompanion()

        _ = openHomeChannel(in: app)

        let field = app.textFields["channel-composer-field"]
        XCTAssertTrue(field.waitForExistence(timeout: transitionTimeout))
        field.tap()
        XCTAssertTrue(waitForKeyboardFocus(on: field))
        field.typeText("@")

        let menu = app.descendants(matching: .any)["channel-mention-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        let agent = app.buttons[
            "channel-mention-agent:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
        ]
        XCTAssertTrue(agent.waitForExistence(timeout: 5))
        agent.tap()

        XCTAssertTrue(
            menu.waitForNonExistence(timeout: 5),
            "Agent를 선택하면 멘션 자동완성 메뉴가 즉시 닫혀야 합니다."
        )
        XCTAssertEqual(field.value as? String, "@Issue processing agent ")
        captureScreenshot(named: "companion-channel-mention-selected")
    }

    func testChannelThreadUsesReplyConversationWithoutNestedThreadSummaries() {
        let app = launchInsideCompanion()

        _ = openHomeChannel(in: app)

        let rootMessageMatches = app.textViews
            .matching(identifier: "channel-message-dddddddd-dddd-4ddd-8ddd-dddddddddddd")
        XCTAssertGreaterThan(rootMessageMatches.count, 0)
        let rootMessage = rootMessageMatches.element(boundBy: 0)
        XCTAssertTrue(rootMessage.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["스레드에서 답글"].exists)
        XCTAssertFalse(
            app.buttons["channel-react-dddddddd-dddd-4ddd-8ddd-dddddddddddd"].exists,
            "리액션이 없는 채널 메시지에는 단독 React 버튼이 보이지 않아야 합니다."
        )
        rootMessage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.7)

        XCTAssertTrue(app.buttons["channel-quick-reaction-👍"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["channel-quick-reaction-❤️"].exists)
        XCTAssertTrue(app.buttons["channel-quick-reaction-😂"].exists)
        XCTAssertTrue(app.buttons["channel-quick-reaction-🎉"].exists)
        let startThread = app.buttons["channel-start-thread-action"]
        XCTAssertTrue(startThread.waitForExistence(timeout: 5))
        XCTAssertTrue(startThread.isHittable, "스레드 시작 버튼이 하단 시트 안에 보여야 합니다.")
        XCTAssertTrue(app.buttons["channel-copy-link-action"].exists)
        XCTAssertTrue(app.buttons["channel-copy-text-action"].exists)
        captureScreenshot(named: "companion-channel-message-actions")

        app.buttons["channel-copy-link-action"].tap()
        XCTAssertTrue(app.staticTexts["링크를 복사했습니다"].waitForExistence(timeout: 5))

        rootMessage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.7)
        XCTAssertTrue(app.buttons["channel-copy-text-action"].waitForExistence(timeout: 5))
        app.buttons["channel-copy-text-action"].tap()
        XCTAssertTrue(app.staticTexts["메시지를 복사했습니다"].waitForExistence(timeout: 5))

        rootMessage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.7)
        XCTAssertTrue(startThread.waitForExistence(timeout: 5))
        startThread.tap()

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
        XCTAssertTrue(element(withLabel: "공유 계약이 검증되었습니다.", in: app)
            .waitForExistence(timeout: 5))
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
        XCTAssertTrue(
            app.buttons["project-menu"].waitForExistence(timeout: accessibilityTransitionTimeout)
        )
        XCTAssertTrue(app.staticTexts["iOS Native Companion 읽기 경험"].exists)
        try performAccessibilityAudit(on: app, for: [.textClipped])
        captureScreenshot(named: "companion-task-list-accessibility-xxxl")
    }

    func testCreateRunStateAndMessageFlow() {
        let app = launchInsideCompanion(
            additionalArguments: ["--ui-testing-delayed-message-send"]
        )

        app.buttons["create-issue-button"].tap()
        let title = app.textFields["create-issue-title"]
        XCTAssertTrue(title.waitForExistence(timeout: transitionTimeout))
        XCTAssertTrue(
            app.buttons["create-issue-paste-attachment"].waitForExistence(timeout: transitionTimeout)
        )
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
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.isHittable, "이슈 대화 입력창은 스크롤 없이 화면 하단에 고정되어야 합니다.")
        XCTAssertGreaterThan(
            message.frame.midY,
            app.windows.firstMatch.frame.midY,
            "이슈 대화 입력창은 화면의 하반부에 표시되어야 합니다."
        )
        message.tap()
        let sentBody = "모바일에서 확인했습니다"
        message.typeText(sentBody)
        let send = app.buttons["issue-message-send"]
        send.tap()
        XCTAssertFalse(
            (message.value as? String ?? "").contains(sentBody),
            "서버 응답을 기다리기 전에 전송한 초안이 입력창에서 즉시 사라져야 합니다."
        )
        XCTAssertTrue(send.exists)
        XCTAssertFalse(send.isEnabled, "전송 중에는 중복 제출을 막아야 합니다.")
        XCTAssertTrue(
            element(withLabel: sentBody, in: app).waitForExistence(timeout: 5),
            "서버 응답 전에도 이슈 대화 메시지가 즉시 표시되어야 합니다."
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["issue-message-sending"].exists,
            "낙관적으로 표시한 이슈 메시지에는 보내는 중 문구가 없어야 합니다."
        )
        captureScreenshot(named: "companion-message-draft-cleared")
        XCTAssertTrue(
            waitForKeyboardFocus(on: message),
            "이슈 메시지를 보낸 뒤에도 입력창 키보드가 유지되어야 합니다."
        )
        XCTAssertTrue(
            send.waitForNonExistence(timeout: 5),
            "서버가 메시지를 확정하면 빈 입력창의 전송 버튼이 다시 숨겨져야 합니다."
        )
        XCTAssertEqual(
            app.descendants(matching: .any).matching(
                NSPredicate(format: "label == %@", sentBody)
            ).count,
            2
        )
        captureScreenshot(named: "companion-native-write-flow")
    }

    private func launchInsideCompanion(
        additionalArguments: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"] + additionalArguments
        app.launch()
        XCTAssertTrue(app.buttons["login-button"].waitForExistence(timeout: transitionTimeout))
        app.buttons["login-button"].tap()
        XCTAssertTrue(app.buttons["project-menu"].waitForExistence(timeout: transitionTimeout))
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: transitionTimeout))
        return app
    }

    @discardableResult
    private func openHomeChannel(in app: XCUIApplication) -> XCUIElement {
        let home = app.tabBars.buttons["홈"]
        XCTAssertTrue(home.waitForExistence(timeout: transitionTimeout))
        home.tap()

        let channel = app.buttons[
            "channel-row-cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        ]
        XCTAssertTrue(channel.waitForExistence(timeout: channelTransitionTimeout))
        channel.tap()
        XCTAssertTrue(
            app.navigationBars["design"].waitForExistence(timeout: channelTransitionTimeout)
        )
        return channel
    }

    private func element(withLabel label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label))
            .firstMatch
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
