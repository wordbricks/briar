import SwiftUI
import UIKit

enum SelectableTextStyle: String, Equatable {
    case body
    case title2Bold
    case title3Bold
    case headline
    case secondaryCaption
    case secondaryBody
    case footnoteMono

    var font: UIFont {
        switch self {
        case .body, .secondaryBody:
            return .preferredFont(forTextStyle: .body)
        case .title2Bold:
            return Self.boldFont(for: .title2)
        case .title3Bold:
            return Self.boldFont(for: .title3)
        case .headline:
            return .preferredFont(forTextStyle: .headline)
        case .secondaryCaption:
            return .preferredFont(forTextStyle: .caption1)
        case .footnoteMono:
            return .monospacedSystemFont(
                ofSize: UIFont.preferredFont(forTextStyle: .footnote).pointSize,
                weight: .medium
            )
        }
    }

    var color: UIColor {
        switch self {
        case .secondaryBody, .secondaryCaption:
            return .secondaryLabel
        case .body, .title2Bold, .title3Bold, .headline, .footnoteMono:
            return .label
        }
    }

    private static func boldFont(for textStyle: UIFont.TextStyle) -> UIFont {
        let base = UIFont.preferredFont(forTextStyle: textStyle)
        guard let descriptor = base.fontDescriptor.withSymbolicTraits(.traitBold) else {
            return base
        }
        return UIFont(descriptor: descriptor, size: base.pointSize)
    }
}

/// Non-editable UITextView so a long-press can drag a text range and copy.
struct SelectableText: View {
    let attributed: AttributedString
    var style: SelectableTextStyle = .body
    private let cacheKey: String?

    @Environment(\.openURL) private var openURL

    init(_ text: String, style: SelectableTextStyle = .body) {
        self.attributed = AttributedString(text)
        self.style = style
        cacheKey = nil
    }

    init(
        attributed: AttributedString,
        style: SelectableTextStyle = .body,
        cacheKey: String? = nil
    ) {
        self.attributed = attributed
        self.style = style
        self.cacheKey = cacheKey
    }

    init(markdown: String, style: SelectableTextStyle = .body) {
        self.attributed = SelectableTextRendering.parseMarkdown(markdown)
        self.style = style
        cacheKey = nil
    }

    var body: some View {
        if attributed.characters.isEmpty {
            EmptyView()
        } else {
            let renderingKey = cacheKey.map {
                SelectableTextRendering.renderingKey(
                    sourceKey: $0,
                    style: style
                )
            }
            SelectableTextRepresentable(
                attributedText: SelectableTextRendering.nsAttributed(
                    attributed,
                    font: style.font,
                    color: style.color,
                    cacheKey: renderingKey
                ),
                measurementKey: renderingKey,
                openURL: openURL
            )
        }
    }
}

@MainActor
enum SelectableTextRendering {
    private static let attributedCache: NSCache<NSString, NSAttributedString> = {
        let cache = NSCache<NSString, NSAttributedString>()
        cache.countLimit = 500
        cache.totalCostLimit = 4 * 1_024 * 1_024
        return cache
    }()
    private static let heightCache: NSCache<NSString, NSNumber> = {
        let cache = NSCache<NSString, NSNumber>()
        cache.countLimit = 1_000
        return cache
    }()

    static let mentionLinkColor = UIColor(
        red: 37 / 255,
        green: 99 / 255,
        blue: 235 / 255,
        alpha: 1
    )

    static func parseMarkdown(_ value: String) -> AttributedString {
        (try? AttributedString(
            markdown: value,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(value)
    }

    static func nsAttributed(
        _ value: AttributedString,
        font: UIFont,
        color: UIColor,
        cacheKey: String? = nil
    ) -> NSAttributedString {
        if let cacheKey,
           let cached = attributedCache.object(forKey: cacheKey as NSString) {
            return cached
        }
        let result = NSMutableAttributedString(attributedString: NSAttributedString(value))
        let fullRange = NSRange(location: 0, length: result.length)
        guard fullRange.length > 0 else { return result }
        result.enumerateAttributes(in: fullRange) { attributes, range, _ in
            var next = attributes
            if attributes[.font] == nil {
                next[.font] = font
            }
            if attributes[.foregroundColor] == nil {
                next[.foregroundColor] = color
            }
            result.setAttributes(next, range: range)
        }
        if let cacheKey {
            attributedCache.setObject(
                result,
                forKey: cacheKey as NSString,
                cost: result.length * MemoryLayout<UInt16>.size
            )
        }
        return result
    }

    static func renderingKey(sourceKey: String, style: SelectableTextStyle) -> String {
        let font = style.font
        return sourceKey + "\u{1D}" + style.rawValue + "\u{1D}" +
            font.fontName + "\u{1D}" + String(format: "%.2f", font.pointSize)
    }

    static func cachedHeight(for key: String, width: CGFloat) -> CGFloat? {
        guard let value = heightCache.object(
            forKey: heightKey(key, width: width)
        ) else { return nil }
        return CGFloat(value.doubleValue)
    }

    static func storeHeight(_ height: CGFloat, for key: String, width: CGFloat) {
        heightCache.setObject(
            NSNumber(value: height),
            forKey: heightKey(key, width: width)
        )
    }

    static func clearCaches() {
        attributedCache.removeAllObjects()
        heightCache.removeAllObjects()
    }

    private static func heightKey(_ key: String, width: CGFloat) -> NSString {
        (key + "\u{1D}" + String(format: "%.2f", width)) as NSString
    }

    @MainActor
    static func makeTextView() -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.bounces = false
        view.alwaysBounceVertical = false
        view.alwaysBounceHorizontal = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.dataDetectorTypes = []
        view.textDragInteraction?.isEnabled = false
        view.linkTextAttributes = [
            .foregroundColor: mentionLinkColor,
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.required, for: .vertical)
        return view
    }
}

private struct SelectableTextRepresentable: UIViewRepresentable {
    var attributedText: NSAttributedString
    var measurementKey: String?
    var openURL: OpenURLAction?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UITextView {
        let view = SelectableTextRendering.makeTextView()
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.openURL = openURL
        if uiView.attributedText != attributedText {
            uiView.attributedText = attributedText
        }
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        let width: CGFloat
        if let proposed = proposal.width, proposed.isFinite, proposed > 0 {
            width = proposed
        } else if uiView.bounds.width > 0 {
            width = uiView.bounds.width
        } else {
            width = 280
        }
        if let measurementKey,
           let cachedHeight = SelectableTextRendering.cachedHeight(
               for: measurementKey,
               width: width
           ) {
            return CGSize(width: width, height: cachedHeight)
        }
        let size = uiView.sizeThatFits(
            CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        )
        let height = ceil(size.height)
        if let measurementKey {
            SelectableTextRendering.storeHeight(
                height,
                for: measurementKey,
                width: width
            )
        }
        return CGSize(width: width, height: height)
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var openURL: OpenURLAction?

        func textView(
            _ textView: UITextView,
            primaryActionFor textItem: UITextItem,
            defaultAction: UIAction
        ) -> UIAction? {
            guard case let .link(url) = textItem.content else {
                return defaultAction
            }
            return UIAction { [openURL] _ in
                openURL?(url)
            }
        }
    }
}
