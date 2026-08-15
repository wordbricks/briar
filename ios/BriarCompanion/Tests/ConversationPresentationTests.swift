import SwiftUI
import XCTest
@testable import BriarCompanion

final class ConversationPresentationTests: XCTestCase {
    func testDateDividerStartsTimelineAndEachNewCalendarDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let dates = [
            Date(timeIntervalSince1970: 1_775_264_400),
            Date(timeIntervalSince1970: 1_775_264_700),
            Date(timeIntervalSince1970: 1_775_350_800),
        ]

        XCTAssertTrue(
            ConversationDatePresentation.startsNewDay(at: 0, in: dates, calendar: calendar)
        )
        XCTAssertFalse(
            ConversationDatePresentation.startsNewDay(at: 1, in: dates, calendar: calendar)
        )
        XCTAssertTrue(
            ConversationDatePresentation.startsNewDay(at: 2, in: dates, calendar: calendar)
        )
        XCTAssertFalse(
            ConversationDatePresentation.startsNewDay(at: 3, in: dates, calendar: calendar)
        )
    }

    func testLocalizedDateLabelOmitsCurrentYearAndIncludesDifferentYear() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let reference = calendar.date(from: DateComponents(year: 2026, month: 8, day: 14))!
        let currentYear = calendar.date(from: DateComponents(year: 2026, month: 8, day: 4))!
        let previousYear = calendar.date(from: DateComponents(year: 2025, month: 8, day: 4))!

        let currentLabel = ConversationDatePresentation.label(
            for: currentYear,
            relativeTo: reference,
            locale: .en
        )
        let previousLabel = ConversationDatePresentation.label(
            for: previousYear,
            relativeTo: reference,
            locale: .en
        )

        XCTAssertFalse(currentLabel.contains("2026"))
        XCTAssertTrue(previousLabel.contains("2025"))
    }

    @MainActor
    func testComposerClearsImmediatelyAndRestoresDraftAfterFailedSend() async throws {
        let draft = ConversationComposerDraftBox()
        draft.body = "@fixture 전송 중에는 숨겨져야 합니다"
        draft.mentions = [ChannelMentionTarget(
            kind: .user,
            recipientId: "fixture-user",
            handle: "fixture",
            label: "Fixture User",
            detail: "Member",
            image: nil
        )]
        draft.attachments = [PendingIssueAttachment(
            filename: "conversation.png",
            contentType: "image/png",
            data: Data([0x01])
        )]
        let expectedBody = draft.body
        let expectedMentions = draft.mentions
        let expectedAttachments = draft.attachments
        let submission = ConversationComposerSubmissionModel()

        let task = try XCTUnwrap(submission.submit(
            draft: Binding(
                get: { draft.body },
                set: { draft.body = $0 }
            ),
            mentions: Binding(
                get: { draft.mentions },
                set: { draft.mentions = $0 }
            ),
            attachments: Binding(
                get: { draft.attachments },
                set: { draft.attachments = $0 }
            ),
            send: { _, _, _ in false }
        ))

        XCTAssertTrue(submission.isSubmitting)
        XCTAssertEqual(draft.body, "")
        XCTAssertEqual(draft.mentions, [])
        XCTAssertEqual(draft.attachments, [])

        await task.value

        XCTAssertFalse(submission.isSubmitting)
        XCTAssertEqual(draft.body, expectedBody)
        XCTAssertEqual(draft.mentions, expectedMentions)
        XCTAssertEqual(draft.attachments, expectedAttachments)
    }
}

@MainActor
private final class ConversationComposerDraftBox {
    var body = ""
    var mentions: [ChannelMentionTarget] = []
    var attachments: [PendingIssueAttachment] = []
}
