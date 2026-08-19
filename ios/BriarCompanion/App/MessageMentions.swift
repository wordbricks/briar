import Foundation
import SwiftUI

/// Shared @mention linkify and issue-conversation candidate helpers for native iOS.
enum MessageMentions {
    private final class AttributedStringBox: NSObject {
        let value: AttributedString

        init(_ value: AttributedString) {
            self.value = value
        }
    }

    @MainActor
    private static let attributedCache: NSCache<NSString, AttributedStringBox> = {
        let cache = NSCache<NSString, AttributedStringBox>()
        cache.countLimit = 400
        cache.totalCostLimit = 2 * 1_024 * 1_024
        return cache
    }()

    struct Segment: Equatable, Sendable {
        enum Kind: Equatable, Sendable {
            case text
            case mention(handle: String)
        }

        let kind: Kind
        let value: String
    }

    /// Splits message text so known @handles can be rendered as blue links.
    static func segments(_ body: String, handles: Set<String>) -> [Segment] {
        let normalized = Set(
            handles
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                .filter { !$0.isEmpty }
        )
        let alternatives = normalized
            .sorted { $0.count > $1.count }
            .map(NSRegularExpression.escapedPattern(for:))
            .joined(separator: "|")
        let tokenPattern =
            "(^|[^\\p{L}\\p{N}_.-])(@(?:\(alternatives)))(?=$|[^\\p{L}\\p{N}_.-]|\\.(?=$|\\s))"
        guard !body.isEmpty, !normalized.isEmpty,
              let expression = try? NSRegularExpression(
                pattern: tokenPattern,
                options: .caseInsensitive
              )
        else {
            return body.isEmpty ? [] : [Segment(kind: .text, value: body)]
        }

        let fullRange = NSRange(body.startIndex..<body.endIndex, in: body)
        let matches = expression.matches(in: body, range: fullRange)
        var segments: [Segment] = []
        var cursor = body.startIndex

        for match in matches {
            guard match.numberOfRanges >= 3,
                  let prefixRange = Range(match.range(at: 1), in: body),
                  let mentionRange = Range(match.range(at: 2), in: body)
            else { continue }

            let handle = String(body[mentionRange].dropFirst()).lowercased()
            guard normalized.contains(handle) else { continue }

            if prefixRange.lowerBound > cursor {
                segments.append(
                    Segment(kind: .text, value: String(body[cursor..<prefixRange.lowerBound]))
                )
            }
            if !prefixRange.isEmpty {
                segments.append(Segment(kind: .text, value: String(body[prefixRange])))
            }
            segments.append(
                Segment(kind: .mention(handle: handle), value: String(body[mentionRange]))
            )
            cursor = mentionRange.upperBound
        }

        if cursor < body.endIndex {
            segments.append(Segment(kind: .text, value: String(body[cursor...])))
        }
        if segments.isEmpty {
            return [Segment(kind: .text, value: body)]
        }
        return segments
    }

    /// Blue hyperlink styling aligned with web `.issue-mention-link` / `.channel-mention-link`.
    @MainActor
    static func attributed(_ body: String, handles: Set<String>) -> AttributedString {
        let cacheKey = renderingCacheKey(body, handles: handles)
        if let cached = attributedCache.object(forKey: cacheKey as NSString) {
            return cached.value
        }
        var result = AttributedString()
        for segment in segments(body, handles: handles) {
            var part = AttributedString(segment.value)
            if case let .mention(handle) = segment.kind {
                part.foregroundColor = Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255)
                part.underlineStyle = .single
                part.link = mentionURL(handle)
            }
            result.append(part)
        }
        attributedCache.setObject(
            AttributedStringBox(result),
            forKey: cacheKey as NSString,
            cost: body.utf16.count * MemoryLayout<UInt16>.size
        )
        return result
    }

    static func renderingCacheKey(_ body: String, handles: Set<String>) -> String {
        let normalizedHandles = handles
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
            .sorted()
        return body + "\u{1F}" + normalizedHandles.joined(separator: "\u{1E}")
    }

    @MainActor
    static func clearRenderingCache() {
        attributedCache.removeAllObjects()
    }

    /// Rewrites known @handles into markdown links so MarkdownText can keep other markup.
    static func markdownWithLinks(_ body: String, handles: Set<String>) -> String {
        segments(body, handles: handles).map { segment in
            switch segment.kind {
            case .text:
                return segment.value
            case let .mention(handle):
                let escaped = segment.value
                    .replacingOccurrences(of: "[", with: "\\[")
                    .replacingOccurrences(of: "]", with: "\\]")
                return "[\(escaped)](\(mentionURL(handle)?.absoluteString ?? "briar-mention://mention"))"
            }
        }.joined()
    }

    /// Channel message handles that were stored as structured mention recipients.
    static func channelHandles(
        mentionedUserIds: [String],
        mentionedAgentIds: [UUID],
        members: [ChannelMember],
        agents: [ChannelAgentSummary]
    ) -> Set<String> {
        let userIds = Set(mentionedUserIds)
        let agentIds = Set(mentionedAgentIds)
        var handles = Set<String>()
        for member in members where userIds.contains(member.userId) {
            handles.insert(
                ChannelMentions.normalizedHandle(
                    member.email.split(separator: "@").first.map(String.init) ?? member.userId
                )
            )
        }
        for agent in agents where agentIds.contains(agent.agentId) {
            handles.insert(agent.name)
        }
        return handles
    }

    private static func mentionURL(_ value: String) -> URL? {
        let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? "mention"
        return URL(string: "briar-mention://\(encoded)")
    }

    /// Issue conversation linkifies known organization members and Project Agents.
    static func issueHandles(
        members: [OrganizationMember],
        agents: [ProjectAgent] = []
    ) -> Set<String> {
        var handles = Set<String>()
        for member in members {
            handles.insert(issueHandle(for: member))
        }
        for agent in agents {
            handles.insert(issueHandle(for: agent))
        }
        return handles
    }

    static func issueHandle(for member: OrganizationMember) -> String {
        ChannelMentions.normalizedHandle(
            member.email.split(separator: "@").first.map(String.init) ?? member.userId
        )
    }

    static func issueHandle(for agent: ProjectAgent) -> String {
        ChannelMentions.normalizedHandle(agent.name)
    }

    static func issueCandidates(
        members: [OrganizationMember],
        agents: [ProjectAgent] = [],
        currentUserId: String?
    ) -> [ChannelMentionTarget] {
        let agentTargets = agents.map { agent in
            ChannelMentionTarget(
                kind: .agent,
                recipientId: agent.id.uuidString,
                handle: issueHandle(for: agent),
                label: agent.name,
                detail: agent.summary,
                image: agent.avatar
            )
        }
        let memberTargets = members.map { member in
            ChannelMentionTarget(
                kind: .user,
                recipientId: member.userId,
                handle: issueHandle(for: member),
                label: member.name,
                detail: member.userId == currentUserId
                    ? L10n.format("나 · %@", member.email)
                    : member.email,
                image: member.image
            )
        }
        return agentTargets + memberTargets
    }
}

/// Renders message text with known @mentions as blue hyperlinks.
/// Truncated quotes stay on SwiftUI `Text` so `lineLimit` still clips.
struct MentionText: View {
    let text: String
    let handles: Set<String>
    var allowsRangeSelection = true

    var body: some View {
        let attributed = MessageMentions.attributed(text, handles: handles)
        Group {
            if allowsRangeSelection {
                SelectableText(
                    attributed: attributed,
                    cacheKey: MessageMentions.renderingCacheKey(text, handles: handles)
                )
            } else {
                Text(attributed)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            // Keep mention taps in-app; do not hand briar-mention:// to Safari.
            if url.scheme == "briar-mention" { return .handled }
            return .systemAction
        })
    }
}
