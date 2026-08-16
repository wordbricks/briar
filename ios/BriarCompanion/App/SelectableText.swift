import SwiftUI
import UIKit

enum SelectableTextStyle: Equatable {
    case body
    case title2Bold
    case title3Bold
    case headline
    case secondaryCaption
    case secondaryBody

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
        }
    }

    var color: UIColor {
        switch self {
        case .secondaryBody, .secondaryCaption:
            return .secondaryLabel
        case .body, .title2Bold, .title3Bold, .headline:
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

    @Environment(\.openURL) private var openURL

    init(_ text: String, style: SelectableTextStyle = .body) {
        self.attributed = AttributedString(text)
        self.style = style
    }

    init(attributed: AttributedString, style: SelectableTextStyle = .body) {
        self.attributed = attributed
        self.style = style
    }

    init(markdown: String, style: SelectableTextStyle = .body) {
        self.attributed = SelectableTextRendering.parseMarkdown(markdown)
        self.style = style
    }

    var body: some View {
        if attributed.characters.isEmpty {
            EmptyView()
        } else {
            SelectableTextRepresentable(
                attributedText: SelectableTextRendering.nsAttributed(
                    attributed,
                    font: style.font,
                    color: style.color
                ),
                openURL: openURL
            )
        }
    }
}

enum SelectableTextRendering {
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
        color: UIColor
    ) -> NSAttributedString {
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
        return result
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
        let size = uiView.sizeThatFits(
            CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        )
        return CGSize(width: width, height: ceil(size.height))
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
