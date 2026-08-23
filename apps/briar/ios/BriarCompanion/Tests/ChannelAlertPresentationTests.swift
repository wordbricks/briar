import XCTest
@testable import BriarCompanion

final class ChannelAlertPresentationTests: XCTestCase {
    func testPrettyPrintsJSONObjects() {
        let pretty = ChannelAlertPresentation.prettyJSON(#"{"error":"boom","level":"error"}"#)
        XCTAssertEqual(pretty?.contains("\n"), true)
        XCTAssertEqual(pretty?.contains("boom"), true)
        XCTAssertNil(ChannelAlertPresentation.prettyJSON("not json"))
    }

    func testClassifiesWebhookErrorsButNotCasualChat() {
        XCTAssertNil(ChannelAlertPresentation.tone(from: "this is an error lol", authorType: .user))
        XCTAssertEqual(
            ChannelAlertPresentation.tone(from: "Production deploy failed", authorType: .webhook),
            .error
        )
        XCTAssertEqual(
            ChannelAlertPresentation.tone(from: "Latency warning: p99 degraded", authorType: .webhook),
            .warning
        )
        XCTAssertEqual(
            ChannelAlertPresentation.tone(from: #"{"level":"error","message":"timeout"}"#),
            .error
        )
        XCTAssertEqual(
            ChannelAlertPresentation.tone(
                from: "Error: boom\n    at run (worker.ts:12:5)\n    at main (index.ts:4:1)"
            ),
            .error
        )
    }

    func testCollapsesLongDumpsAndHonorsExpand() {
        XCTAssertFalse(ChannelAlertPresentation.shouldCollapse("short"))
        XCTAssertTrue(ChannelAlertPresentation.shouldCollapse("short", expand: true))
        let stack = (0..<12).map { "    at frame\($0) (app.ts:\($0):1)" }.joined(separator: "\n")
        XCTAssertTrue(ChannelAlertPresentation.shouldCollapse("Error: boom\n\(stack)"))
        let preview = ChannelAlertPresentation.preview(stack)
        XCTAssertTrue(preview.collapsed)
        XCTAssertTrue(preview.preview.hasSuffix("…"))
    }
}
