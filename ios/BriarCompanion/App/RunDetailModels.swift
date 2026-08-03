import Foundation

struct RunEventsResponse: Codable, Equatable, Sendable {
    let events: [RunEvent]
}

struct RunEvent: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let attempt: Int
    let revision: Int
    let status: DashboardRun.Status
    let workflowStage: String?
    let detail: String?
    let actor: String
    let occurredAt: Date
}

struct RunEvidenceResponse: Codable, Equatable, Sendable {
    let evidence: [RunEvidence]
}

struct RunEvidence: Codable, Equatable, Identifiable, Sendable {
    let key: String
    let attempt: Int
    let revision: Int
    let stage: String
    let type: String
    let status: Status
    let detail: String?
    let command: String?
    let url: URL?
    let actor: String
    let observedAt: Date
    let images: [EvidenceImage]
    let requiredRevision: Int
    let canonical: Bool

    var id: String { key }

    enum Status: String, Codable, Sendable {
        case pending, passed, failed, skipped

        var displayName: String {
            switch self {
            case .pending: "대기"
            case .passed: "통과"
            case .failed: "실패"
            case .skipped: "생략"
            }
        }
    }

    enum CodingKeys: String, CodingKey {
        case key, attempt, revision, stage, type, status, detail, command, url
        case actor, observedAt, images, requiredRevision, canonical
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        key = try values.decode(String.self, forKey: .key)
        attempt = try values.decode(Int.self, forKey: .attempt)
        revision = try values.decode(Int.self, forKey: .revision)
        stage = try values.decode(String.self, forKey: .stage)
        type = try values.decode(String.self, forKey: .type)
        status = try values.decode(Status.self, forKey: .status)
        detail = try values.decodeIfPresent(String.self, forKey: .detail)
        command = try values.decodeIfPresent(String.self, forKey: .command)
        url = try values.decodeIfPresent(URL.self, forKey: .url)
        actor = try values.decode(String.self, forKey: .actor)
        observedAt = try values.decode(Date.self, forKey: .observedAt)
        images = try values.decodeIfPresent([EvidenceImage].self, forKey: .images) ?? []
        requiredRevision = try values.decodeIfPresent(Int.self, forKey: .requiredRevision) ?? 1
        canonical = try values.decodeIfPresent(Bool.self, forKey: .canonical) ?? true
    }
}

struct EvidenceImage: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let filename: String
    let contentType: String
    let byteSize: Int
    let url: String
}

struct IssueMessagesResponse: Codable, Equatable, Sendable {
    let messages: [IssueMessage]
}

struct IssueMessage: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runId: UUID
    let parentMessageId: UUID?
    let body: String
    let author: Author
    let replyCount: Int
    let createdAt: Date
    let updatedAt: Date

    struct Author: Codable, Equatable, Sendable {
        let id: String?
        let name: String
        let image: String?
        let provider: String?
    }
}
