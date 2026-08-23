import Foundation

enum ChannelAlertTone: String, Equatable, Sendable {
    case error
    case warning
}

enum ChannelAlertPresentation {
    private static let errorKeyword = try! NSRegularExpression(
        pattern: #"\b(?:error|errors|exception|fatal|panic|critical|fail(?:ed|ure)?|traceback|alarm|alert)\b|에러|오류|실패|알람|치명|错误|失败|告警|报警|致命"#,
        options: [.caseInsensitive]
    )
    private static let warningKeyword = try! NSRegularExpression(
        pattern: #"\b(?:warn(?:ing)?|degraded)\b|경고|警告"#,
        options: [.caseInsensitive]
    )
    private static let stackTrace = try! NSRegularExpression(
        pattern: #"traceback \(most recent call last\)|^\s*at \S+|^\s*File "[^"]+", line \d+"#,
        options: [.caseInsensitive, .anchorsMatchLines]
    )

    static func prettyJSON(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.first == "{" || trimmed.first == "[" else { return nil }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              JSONSerialization.isValidJSONObject(object),
              let pretty = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted]
              ),
              let text = String(data: pretty, encoding: .utf8)
        else { return nil }
        return text
    }

    static func formattedDump(_ value: String) -> String {
        prettyJSON(value) ?? value
    }

    static func isStackTrace(_ value: String) -> Bool {
        matches(stackTrace, value)
    }

    static func shouldCollapse(_ value: String, expand: Bool = false) -> Bool {
        if expand { return true }
        let lines = value.split(separator: "\n", omittingEmptySubsequences: false).count
        if prettyJSON(value) != nil && (lines > 2 || value.count > 120) { return true }
        if isStackTrace(value) { return true }
        return lines >= 8 || value.count >= 480
    }

    static func preview(
        _ value: String,
        maxLines: Int = 4,
        maxChars: Int = 280
    ) -> (preview: String, collapsed: Bool) {
        guard shouldCollapse(value) else { return (value, false) }
        let lines = value.split(separator: "\n", omittingEmptySubsequences: false)
        var preview = lines.prefix(maxLines).joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if preview.count > maxChars {
            preview = String(preview.prefix(maxChars)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
        } else if lines.count > maxLines || value.count > preview.count {
            preview += "…"
        }
        return (preview, true)
    }

    static func tone(from text: String, authorType: ChannelMessage.Author.Kind? = nil) -> ChannelAlertTone? {
        if let jsonTone = jsonTone(text) { return jsonTone }
        if isStackTrace(text) { return .error }
        guard let keyword = keywordTone(text) else { return nil }
        if authorType == .webhook { return keyword }
        if prettyJSON(text) != nil || shouldCollapse(text) { return keyword }
        return nil
    }

    static func plainText(from blocks: [ChannelMessageBlock]) -> String {
        blocks.compactMap { block in
            switch block.type {
            case .header, .section:
                return block.textObject?.text
            case .markdown:
                return block.markdownText
            case .context:
                return (block.contextElements ?? []).map(\.text).joined(separator: " ")
            case .richText:
                return (block.richTextElements ?? []).map(richPlain).joined(separator: "\n")
            case .divider:
                return nil
            }
        }.joined(separator: "\n")
    }

    static func tone(from message: ChannelMessage) -> ChannelAlertTone? {
        let body: String
        if let blocks = message.blocks, !blocks.isEmpty {
            body = plainText(from: blocks)
        } else {
            body = message.body
        }
        return tone(from: "\(message.author.name)\n\(body)", authorType: message.author.type)
    }

    static func localizedReplyError(
        _ error: String?,
        locale: CompanionLocale
    ) -> String {
        if error == "No available Worker can run this Agent." {
            return L10n.text("이 Agent를 실행할 수 있는 사용 가능한 Worker가 없습니다.", locale: locale)
        }
        return error ?? L10n.text("실행이 실패했습니다", locale: locale)
    }

    private static func jsonTone(_ value: String) -> ChannelAlertTone? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.first == "{" || trimmed.first == "[" else { return nil }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data)
        else { return nil }
        return tone(fromJSON: object)
    }

    private static func tone(fromJSON value: Any) -> ChannelAlertTone? {
        if let array = value as? [Any] {
            return array.compactMap(tone(fromJSON:)).first
        }
        guard let record = value as? [String: Any] else { return nil }
        for key in ["level", "severity", "status", "error", "type", "kind"] {
            if let field = record[key] as? String, let tone = keywordTone(field) {
                return tone
            }
            if record[key] is [String: Any] { return .error }
        }
        if record["error"] != nil || record["exception"] != nil { return .error }
        return nil
    }

    private static func keywordTone(_ value: String) -> ChannelAlertTone? {
        if matches(errorKeyword, value) { return .error }
        if matches(warningKeyword, value) { return .warning }
        return nil
    }

    private static func matches(_ expression: NSRegularExpression, _ value: String) -> Bool {
        expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..<value.endIndex, in: value)
        ) != nil
    }

    private static func richPlain(_ element: ChannelRichTextElement) -> String {
        switch element.type {
        case .section, .quote, .preformatted:
            return (element.elements ?? []).map { inline in
                switch inline.type {
                case .text: inline.text ?? ""
                case .link: inline.text ?? inline.url ?? ""
                case .emoji: ":\(inline.name ?? "emoji"):"
                }
            }.joined()
        case .list:
            return (element.sections ?? []).map { section in
                section.elements.map { inline in
                    inline.text ?? inline.url ?? ":\(inline.name ?? "emoji"):"
                }.joined()
            }.joined(separator: "\n")
        }
    }
}
