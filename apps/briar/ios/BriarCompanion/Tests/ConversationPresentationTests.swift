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

    func testFocusedMessageWinsOverBottomAnchorWhenPresent() {
        let focused = UUID()
        XCTAssertTrue(
            ConversationScrollPresentation.shouldScrollToFocusedMessage(
                focusedMessageID: focused,
                messageIDs: [UUID(), focused]
            )
        )
        XCTAssertFalse(
            ConversationScrollPresentation.shouldScrollToFocusedMessage(
                focusedMessageID: focused,
                messageIDs: [UUID()]
            )
        )
        XCTAssertFalse(
            ConversationScrollPresentation.shouldScrollToFocusedMessage(
                focusedMessageID: Optional<UUID>.none,
                messageIDs: [focused]
            )
        )
    }

    func testScrollToBottomControlAppearsOnlyBeyondThreshold() {
        XCTAssertFalse(
            ConversationScrollPresentation.isAwayFromBottom(
                bottomMaxY: 700,
                viewportHeight: 640
            )
        )
        XCTAssertFalse(
            ConversationScrollPresentation.isAwayFromBottom(
                bottomMaxY: 720,
                viewportHeight: 640
            )
        )
        XCTAssertTrue(
            ConversationScrollPresentation.isAwayFromBottom(
                bottomMaxY: 721,
                viewportHeight: 640
            )
        )
    }

    func testProgrammaticScrollDoesNotDismissComposerKeyboard() {
        XCTAssertTrue(
            ConversationScrollPresentation.dismissesKeyboardInteractively(
                programmaticScrollActive: false
            )
        )
        XCTAssertFalse(
            ConversationScrollPresentation.dismissesKeyboardInteractively(
                programmaticScrollActive: true
            )
        )
    }

    func testInitialPositionWaitsForLastRowLayoutAndRunsOnce() {
        XCTAssertFalse(ConversationScrollPresentation.shouldPositionInitially(
            hasMessages: false,
            lastRowLaidOut: true,
            positioning: false,
            positioned: false
        ))
        XCTAssertFalse(ConversationScrollPresentation.shouldPositionInitially(
            hasMessages: true,
            lastRowLaidOut: false,
            positioning: false,
            positioned: false
        ))
        XCTAssertTrue(ConversationScrollPresentation.shouldPositionInitially(
            hasMessages: true,
            lastRowLaidOut: true,
            positioning: false,
            positioned: false
        ))
        XCTAssertFalse(ConversationScrollPresentation.shouldPositionInitially(
            hasMessages: true,
            lastRowLaidOut: true,
            positioning: true,
            positioned: false
        ))
        XCTAssertFalse(ConversationScrollPresentation.shouldPositionInitially(
            hasMessages: true,
            lastRowLaidOut: true,
            positioning: false,
            positioned: true
        ))
    }

    func testAdjacentBatchPartsShareChromeWithoutCrossingUserMessage() {
        let first = message(id: UUID(), authorID: "agent-1", batchID: "batch-1", sequence: 1)
        let second = message(id: UUID(), authorID: "agent-1", batchID: "batch-1", sequence: 2)
        XCTAssertEqual(
            ChannelMessageBatchPresentation.position(at: 0, in: [first, second]),
            .first
        )
        XCTAssertEqual(
            ChannelMessageBatchPresentation.position(at: 1, in: [first, second]),
            .last
        )

        let user = message(id: UUID(), authorID: "user-1", batchID: nil, sequence: 0)
        XCTAssertEqual(
            ChannelMessageBatchPresentation.position(at: 0, in: [first, user, second]),
            .single
        )
        XCTAssertEqual(
            ChannelMessageBatchPresentation.position(at: 2, in: [first, user, second]),
            .single
        )
    }

    @MainActor
    func testDurableMessagesUseServerSequenceAndKeepLegacyBoundary() {
        let second = message(id: UUID(), authorID: "agent-1", batchID: "batch-1", sequence: 2)
        let first = message(id: UUID(), authorID: "agent-1", batchID: "batch-1", sequence: 1)
        let legacy = message(id: UUID(), authorID: "user-1", batchID: nil, sequence: 0,
                             createdAt: Date(timeIntervalSince1970: 21))
        let third = message(id: UUID(), authorID: "agent-1", batchID: "batch-2", sequence: 3,
                            createdAt: Date(timeIntervalSince1970: 22))
        XCTAssertEqual(ChannelsStore.sortMessagesForDisplay([third, second, legacy, first]).map(\.id),
                       [first.id, second.id, legacy.id, third.id])

        let letterBatch = message(id: UUID(), authorID: "agent-1", batchID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1)
        let letterLegacy = message(id: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
                                   authorID: "user-1", batchID: nil, sequence: 0)
        XCTAssertEqual(ChannelsStore.sortMessagesForDisplay([letterLegacy, letterBatch]).map(\.id),
                       [letterBatch.id, letterLegacy.id])
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

private func message(
    id: UUID,
    authorID: String,
    batchID: String?,
    sequence: Int,
    body: String = "Part",
    createdAt: Date = Date(timeIntervalSince1970: 20)
) -> ChannelMessage {
    ChannelMessage(
        id: id,
        channelId: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        parentMessageId: nil,
        body: body,
        author: .init(
            type: authorID.hasPrefix("agent") ? .agent : .user,
            name: authorID.hasPrefix("agent") ? "Agent" : "User",
            image: nil,
            provider: authorID.hasPrefix("agent") ? "codex" : nil,
            id: authorID
        ),
        replyCount: 0,
        lastReplyAt: nil,
        document: nil,
        proposal: nil,
        dmMetadata: batchID.map {
            .init(
                batchId: $0,
                partIndex: max(sequence - 1, 0),
                conversationSequence: max(sequence, 1),
                purpose: .progress
            )
        },
        createdAt: createdAt
    )
}

@MainActor
private final class ConversationComposerDraftBox {
    var body = ""
    var mentions: [ChannelMentionTarget] = []
    var attachments: [PendingIssueAttachment] = []
}
