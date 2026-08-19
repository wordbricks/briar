import UIKit
import XCTest
@testable import BriarCompanion

@MainActor
final class SelectableTextTests: XCTestCase {
    func testTextViewAllowsRangeSelectionWithoutEditing() {
        let view = SelectableTextRendering.makeTextView()

        XCTAssertTrue(view.isSelectable)
        XCTAssertFalse(view.isEditable)
        XCTAssertFalse(view.isScrollEnabled)
        XCTAssertEqual(view.textContainerInset, .zero)
        XCTAssertEqual(view.textContainer.lineFragmentPadding, 0)
        XCTAssertEqual(view.dataDetectorTypes, [])
    }

    func testAttributedStringKeepsMentionLinksAndAppliesDefaultFont() {
        let attributed = MessageMentions.attributed(
            "Ask @Honey to copy this range.",
            handles: ["Honey"]
        )
        let rendered = SelectableTextRendering.nsAttributed(
            attributed,
            font: .preferredFont(forTextStyle: .body),
            color: .label
        )

        XCTAssertEqual(rendered.string, "Ask @Honey to copy this range.")
        var foundLink = false
        rendered.enumerateAttribute(
            .link,
            in: NSRange(location: 0, length: rendered.length)
        ) { value, range, _ in
            guard let url = value as? URL else { return }
            foundLink = true
            XCTAssertEqual(url.scheme, "briar-mention")
            XCTAssertEqual((rendered.string as NSString).substring(with: range), "@Honey")
        }
        XCTAssertTrue(foundLink)

        let firstFont = rendered.attribute(
            .font,
            at: 0,
            effectiveRange: nil
        ) as? UIFont
        XCTAssertEqual(
            firstFont?.pointSize,
            UIFont.preferredFont(forTextStyle: .body).pointSize
        )
    }

    func testMarkdownStripsMarkersAndKeepsVisibleText() {
        let rendered = SelectableTextRendering.nsAttributed(
            SelectableTextRendering.parseMarkdown("Copy **only this** phrase"),
            font: .preferredFont(forTextStyle: .body),
            color: .label
        )

        XCTAssertEqual(rendered.string, "Copy only this phrase")
        XCTAssertFalse(rendered.string.contains("**"))
    }

    func testEmptyMarkdownDoesNotCreateATextViewPayload() {
        XCTAssertTrue(SelectableTextRendering.parseMarkdown("").characters.isEmpty)
    }

    func testAttributedConversionAndMeasuredHeightAreReused() {
        SelectableTextRendering.clearCaches()
        let attributed = MessageMentions.attributed(
            "Ask @Honey once.",
            handles: ["Honey"]
        )
        let sourceKey = MessageMentions.renderingCacheKey(
            "Ask @Honey once.",
            handles: ["Honey"]
        )
        let renderingKey = SelectableTextRendering.renderingKey(
            sourceKey: sourceKey,
            style: .body
        )
        let first = SelectableTextRendering.nsAttributed(
            attributed,
            font: .preferredFont(forTextStyle: .body),
            color: .label,
            cacheKey: renderingKey
        )
        let second = SelectableTextRendering.nsAttributed(
            attributed,
            font: .preferredFont(forTextStyle: .body),
            color: .label,
            cacheKey: renderingKey
        )

        XCTAssertTrue(first === second)
        SelectableTextRendering.storeHeight(42, for: renderingKey, width: 320)
        XCTAssertEqual(
            SelectableTextRendering.cachedHeight(for: renderingKey, width: 320),
            42
        )
        XCTAssertNil(
            SelectableTextRendering.cachedHeight(for: renderingKey, width: 321)
        )
    }
}
