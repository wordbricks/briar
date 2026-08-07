import Foundation
import UIKit

enum AgentProvider: String, Codable, CaseIterable, Identifiable, Sendable {
    case codex
    case claude
    case grok
    case opencode

    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }

    var models: [String] {
        switch self {
        case .codex: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]
        case .claude: ["sonnet", "opus", "haiku", "fable"]
        case .grok: ["grok-4.5", "grok-build"]
        case .opencode: []
        }
    }

    var efforts: [ModelEffort] {
        switch self {
        case .codex: ModelEffort.allCases
        case .claude: ModelEffort.allCases.filter { $0 != .ultra }
        case .grok, .opencode: [.low, .medium, .high]
        }
    }
}

enum ModelEffort: String, Codable, CaseIterable, Identifiable, Sendable {
    case low
    case medium
    case high
    case xhigh
    case max
    case ultra

    var id: String { rawValue }
}

struct IssueDependencyReference: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runNumber: Int
    let title: String
    let status: DashboardRun.Status
}

struct PendingIssueAttachment: Identifiable, Equatable, Sendable {
    static let allowedContentTypes = Set([
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
        "video/mp4", "video/webm", "video/quicktime",
    ])
    static let maximumCount = 5
    static let maximumFileBytes = 20 * 1_024 * 1_024
    static let maximumTotalBytes = 25 * 1_024 * 1_024

    let id: UUID
    let filename: String
    let contentType: String
    let data: Data

    init(
        id: UUID = UUID(),
        filename: String,
        contentType: String,
        data: Data
    ) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.data = data
    }

    static func validationMessage(for attachments: [Self]) -> String? {
        guard attachments.count <= maximumCount else {
            return "첨부 파일은 최대 5개까지 추가할 수 있습니다."
        }
        var total = 0
        for attachment in attachments {
            let name = attachment.filename.precomposedStringWithCanonicalMapping
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name.count <= 255, !name.contains("\0") else {
                return "첨부 파일 이름이 유효하지 않습니다."
            }
            guard allowedContentTypes.contains(attachment.contentType) else {
                return "\(name)은(는) 지원하지 않는 이미지·영상 형식입니다."
            }
            guard !attachment.data.isEmpty else {
                return "\(name)은(는) 빈 파일입니다."
            }
            guard attachment.data.count <= maximumFileBytes else {
                return "\(name)은(는) 파일당 20MB 제한을 넘습니다."
            }
            total += attachment.data.count
        }
        return total <= maximumTotalBytes
            ? nil
            : "첨부 파일의 전체 크기는 25MB를 넘을 수 없습니다."
    }

    /// Decodes clipboard image data and wraps it as a server-supported JPEG attachment.
    /// Returns nil when the data is not a decodable image, so a text-only paste is ignored.
    static func jpeg(from data: Data) -> Self? {
        guard data.isEmpty == false,
              let image = UIImage(data: data),
              let jpegData = image.jpegData(compressionQuality: 0.9)
        else { return nil }
        return Self(
            filename: "image-\(UUID().uuidString).jpg",
            contentType: "image/jpeg",
            data: jpegData
        )
    }
}

struct IssueDraft: Codable, Equatable, Sendable {
    /// Default create-issue priority matches the desktop/web create dialog (P2).
    static let defaultPriority: Int = 2
    /// Default preferred-execution effort matches the desktop/web create dialog (high).
    static let defaultEffort: ModelEffort? = .high

    var title = ""
    var description = ""
    var priority: Int? = defaultPriority
    var assigneeUserId: String? = nil
    var status: DashboardRun.Status = .queued
    var preferredProvider: AgentProvider? = nil
    var preferredModel: String? = nil
    var preferredEffort: ModelEffort? = defaultEffort

    var isEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            priority == Self.defaultPriority &&
            assigneeUserId == nil &&
            preferredProvider == nil &&
            preferredModel == nil &&
            (preferredEffort == nil || preferredEffort == Self.defaultEffort)
    }
}

struct CreateIssueRequest: Codable, Sendable {
    let title: String
    let description: String?
    let priority: Int?
    let assigneeUserId: String?
    let status: DashboardRun.Status
    let preferredProvider: AgentProvider?
    let preferredModel: String?
    let preferredEffort: ModelEffort?
}

struct CreateIssueResponse: Codable, Sendable {
    let runId: UUID
    let sourceKey: String
    let stage: String
    let status: DashboardRun.Status
    let attachments: [IssueAttachment]
    let assigneeUserId: String?
}

struct UpdateIssueRequest: Codable, Sendable {
    let title: String
    let description: String?
    let priority: Int?
    let assigneeUserId: String?
}

struct UpdateIssueResponse: Codable, Sendable {
    let runId: UUID
    let title: String
    let description: String?
    let priority: Int?
    let assigneeUserId: String?
}

struct TransferIssueRequest: Codable, Sendable {
    let targetProjectId: UUID
}

struct TransferIssueResponse: Codable, Sendable {
    let runId: UUID
    let sourceProjectId: UUID
    let targetProjectId: UUID
    let outcome: String
}

struct IssueExecutionPreferences: Codable, Equatable, Sendable {
    var provider: AgentProvider?
    var model: String?
    var effort: ModelEffort?

    var isValid: Bool {
        guard let provider else { return model == nil && effort == nil }
        guard let model else { return effort == nil }
        guard provider == .opencode || provider.models.contains(model) else { return false }
        return effort.map(provider.efforts.contains) ?? true
    }
}

struct IssueExecutionPreferencesResponse: Codable, Sendable {
    let runId: UUID
    let provider: AgentProvider?
    let model: String?
    let effort: ModelEffort?
}

struct RequestIdentity: Codable, Sendable {
    let requestId: UUID
    let reason: String?
}

struct RunStatusRequest: Codable, Sendable {
    let requestId: UUID
    let status: DashboardRun.Status
    /// Required by the mobile contract as `string | null`. Must encode JSON `null`
    /// for non-running placements; omitting the key fails server validation.
    let workflowStage: String?

    enum CodingKeys: String, CodingKey {
        case requestId, status, workflowStage
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(status, forKey: .status)
        // Prefer encode(_:forKey:) over encodeIfPresent so nil becomes JSON null.
        try container.encode(workflowStage, forKey: .workflowStage)
    }
}

struct RunStatusResponse: Codable, Sendable {
    let runId: UUID
    let outcome: String
    let status: DashboardRun.Status
    let workflowStage: String?
}

struct RunRecoveryResponse: Codable, Sendable {
    let runId: UUID
    let outcome: String
    let attempt: Int
    let stage: String
}

struct ResumeRunRequest: Codable, Sendable {
    let requestId: UUID
    let checkpointKey: String
    let attempt: Int
    let revision: Int
}

struct ResumeRunResponse: Codable, Sendable {
    let runId: UUID
    let outcome: String
    let workflowStage: String?
    let startStage: String?
    let checkpointKey: String?
    let attempt: Int?
    let revision: Int?
    let terminalReviewOnly: Bool
}

struct DispatchRunRequest: Codable, Sendable {
    let agentId: UUID?
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let persistPreferences: Bool
    let workerId: String?
    let requestId: UUID

    init(
        agentId: UUID? = nil,
        provider: AgentProvider,
        model: String?,
        effort: ModelEffort?,
        persistPreferences: Bool,
        workerId: String?,
        requestId: UUID
    ) {
        self.agentId = agentId
        self.provider = provider
        self.model = model
        self.effort = effort
        self.persistPreferences = persistPreferences
        self.workerId = workerId
        self.requestId = requestId
    }
}

struct DispatchRunResponse: Codable, Sendable {
    let runId: UUID
    let agentId: UUID?
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let requestedWorkerId: String?
    let requestedByUserId: String
    let dispatchMode: String
    let dispatchedAt: Date
    let outcome: String
}

struct DependencyResponse: Codable, Sendable {
    let prerequisiteRunId: UUID
    let dependentRunId: UUID
    let outcome: String
}

struct CreateIssueMessageRequest: Codable, Sendable {
    let body: String
    let parentMessageId: UUID?
    let mentionedUserIds: [String]
    let agentConversationId: String?
}

struct IssueAgentReplyJob: Codable, Sendable {
    enum Status: String, Codable, Sendable {
        case queued
        case running
        case completed
        case failed
    }

    let id: UUID
    let triggerMessageId: UUID
    let status: Status
    let error: String?
}

struct CreateIssueMessageResponse: Codable, Sendable {
    let message: IssueMessage
    let agentReply: IssueAgentReplyJob?
}

struct IssueAgentReplyResponse: Codable, Sendable {
    let agentReply: IssueAgentReplyJob
    let message: IssueMessage?
}

enum IssueMutationError: LocalizedError, Equatable {
    case duplicateAction
    case invalidTitle
    case titleTooLong(max: Int, count: Int)
    case invalidMessage
    case invalidPreferences
    case attachment(String)
    case agentReplyTimedOut
    case agentReplyPollingFailed
    case agentReplyFailed(String)

    var errorDescription: String? {
        switch self {
        case .duplicateAction: "이미 요청을 처리하고 있습니다."
        case .invalidTitle: "이슈 제목을 입력해 주세요."
        case let .titleTooLong(max, count):
            "제목이 너무 깁니다. \(max)자 이내로 줄여 주세요. (현재 \(count)자)"
        case .invalidMessage: "메시지를 입력해 주세요."
        case .invalidPreferences: "모델과 effort를 선택하려면 프로바이더와 모델을 순서대로 선택해 주세요."
        case let .attachment(message): message
        case .agentReplyTimedOut: "Briar 답변이 아직 대기 중입니다. 잠시 후 다시 확인해 주세요."
        case .agentReplyPollingFailed:
            "메시지는 전송됐지만 Briar 답변 상태를 확인하지 못했습니다. 상세를 새로고침해 주세요."
        case let .agentReplyFailed(message): message
        }
    }
}

/// Language-aware issue title limits matching `src/lib/issue-title.ts`.
enum IssueTitleLimits {
    static let absoluteMax = 300
    static let hangulMax = 100
    static let hanMax = 80
    static let kanaMax = 100
    static let latinMax = 200

    static func graphemeCount(_ value: String) -> Int {
        value.count
    }

    static func maxLength(for title: String) -> Int {
        let letters = title.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard !letters.isEmpty else { return latinMax }

        var hangul = 0
        var han = 0
        var kana = 0
        for scalar in letters {
            if isHangul(scalar) {
                hangul += 1
            } else if isHan(scalar) {
                han += 1
            } else if isKana(scalar) {
                kana += 1
            }
        }
        let threshold = max(1, Int(ceil(Double(letters.count) * 0.3)))
        if hangul >= threshold { return hangulMax }
        if han >= threshold { return hanMax }
        if kana >= threshold { return kanaMax }
        return latinMax
    }

    static func validationError(for title: String) -> IssueMutationError? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .invalidTitle }
        let count = graphemeCount(trimmed)
        let max = maxLength(for: trimmed)
        if count > max {
            return .titleTooLong(max: max, count: count)
        }
        return nil
    }

    private static func isHangul(_ scalar: UnicodeScalar) -> Bool {
        let value = scalar.value
        return (0x1100...0x11FF).contains(value)
            || (0x3130...0x318F).contains(value)
            || (0xA960...0xA97F).contains(value)
            || (0xAC00...0xD7A3).contains(value)
            || (0xD7B0...0xD7FF).contains(value)
    }

    private static func isHan(_ scalar: UnicodeScalar) -> Bool {
        let value = scalar.value
        return (0x2E80...0x2EFF).contains(value)
            || (0x2F00...0x2FDF).contains(value)
            || (0x3400...0x4DBF).contains(value)
            || (0x4E00...0x9FFF).contains(value)
            || (0xF900...0xFAFF).contains(value)
    }

    private static func isKana(_ scalar: UnicodeScalar) -> Bool {
        let value = scalar.value
        return (0x3040...0x309F).contains(value)
            || (0x30A0...0x30FF).contains(value)
            || (0x31F0...0x31FF).contains(value)
            || (0xFF66...0xFF9D).contains(value)
    }
}

struct IssueDraftPersistence {
    static let storageKey = "briar.native.create-issue-draft.v1"
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> IssueDraft {
        guard let data = defaults.data(forKey: Self.storageKey),
              let draft = try? JSONDecoder().decode(IssueDraft.self, from: data)
        else { return IssueDraft() }
        return draft
    }

    func save(_ draft: IssueDraft) {
        if draft.isEmpty {
            defaults.removeObject(forKey: Self.storageKey)
        } else if let data = try? JSONEncoder().encode(draft) {
            defaults.set(data, forKey: Self.storageKey)
        }
    }

    func clear() {
        defaults.removeObject(forKey: Self.storageKey)
    }
}
