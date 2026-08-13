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
}
