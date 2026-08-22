import Foundation

struct MarkdownListItem: Equatable {
    let content: String
    let checked: Bool?
}

enum MarkdownBlock: Equatable {
    case heading(level: Int, content: String)
    case paragraph(String)
    case unorderedList([MarkdownListItem])
    case orderedList([String])
    case blockquote(String)
    case code(language: String?, content: String)
    case divider
}

enum MarkdownDocument {
    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                index += 1
                continue
            }

            if let fence = codeFence(line) {
                let opening = line.trimmingCharacters(in: .whitespaces)
                let language = String(opening.dropFirst(fence.count)).trimmingCharacters(in: .whitespaces)
                index += 1
                var codeLines: [String] = []
                while index < lines.count,
                      lines[index].trimmingCharacters(in: .whitespaces) != fence {
                    codeLines.append(lines[index])
                    index += 1
                }
                if index < lines.count { index += 1 }
                blocks.append(.code(
                    language: language.isEmpty ? nil : language,
                    content: codeLines.joined(separator: "\n")
                ))
                continue
            }

            if let heading = heading(line) {
                blocks.append(.heading(level: heading.level, content: heading.content))
                index += 1
                continue
            }

            if isDivider(line) {
                blocks.append(.divider)
                index += 1
                continue
            }

            if unorderedItem(line) != nil {
                var items: [MarkdownListItem] = []
                while index < lines.count, let item = unorderedItem(lines[index]) {
                    items.append(item)
                    index += 1
                }
                blocks.append(.unorderedList(items))
                continue
            }

            if orderedItem(line) != nil {
                var items: [String] = []
                while index < lines.count, let item = orderedItem(lines[index]) {
                    items.append(item)
                    index += 1
                }
                blocks.append(.orderedList(items))
                continue
            }

            if blockquoteLine(line) != nil {
                var quoteLines: [String] = []
                while index < lines.count, let value = blockquoteLine(lines[index]) {
                    quoteLines.append(value)
                    index += 1
                }
                blocks.append(.blockquote(quoteLines.joined(separator: "\n")))
                continue
            }

            var paragraph: [String] = [line]
            index += 1
            while index < lines.count,
                  !lines[index].trimmingCharacters(in: .whitespaces).isEmpty,
                  !startsBlock(lines[index]) {
                paragraph.append(lines[index])
                index += 1
            }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        }

        return blocks
    }

    private static func startsBlock(_ line: String) -> Bool {
        codeFence(line) != nil || heading(line) != nil || isDivider(line) ||
            unorderedItem(line) != nil || orderedItem(line) != nil || blockquoteLine(line) != nil
    }

    private static func codeFence(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") { return "```" }
        if trimmed.hasPrefix("~~~") { return "~~~" }
        return nil
    }

    private static func heading(_ line: String) -> (level: Int, content: String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let level = trimmed.prefix(while: { $0 == "#" }).count
        guard (1...6).contains(level), trimmed.dropFirst(level).first == " " else { return nil }
        return (level, String(trimmed.dropFirst(level + 1)))
    }

    private static func isDivider(_ line: String) -> Bool {
        let compact = line.filter { !$0.isWhitespace }
        guard compact.count >= 3, let marker = compact.first, "-*_".contains(marker) else { return false }
        return compact.allSatisfy { $0 == marker }
    }

    private static func unorderedItem(_ line: String) -> MarkdownListItem? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2,
              let marker = trimmed.first,
              "-*+".contains(marker),
              trimmed.dropFirst().first == " " else { return nil }
        var content = String(trimmed.dropFirst(2))
        var checked: Bool?
        if content.hasPrefix("[ ] ") {
            checked = false
            content = String(content.dropFirst(4))
        } else if content.lowercased().hasPrefix("[x] ") {
            checked = true
            content = String(content.dropFirst(4))
        }
        return MarkdownListItem(content: content, checked: checked)
    }

    private static func orderedItem(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let digits = trimmed.prefix(while: { $0.isNumber })
        guard !digits.isEmpty else { return nil }
        let suffix = trimmed.dropFirst(digits.count)
        guard suffix.hasPrefix(". ") else { return nil }
        return String(suffix.dropFirst(2))
    }

    private static func blockquoteLine(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.first == ">" else { return nil }
        return String(trimmed.dropFirst().drop(while: { $0 == " " }))
    }
}
