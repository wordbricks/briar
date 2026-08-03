import Foundation

enum IdeaStatus: String, Codable, Sendable {
    case draft
    case refining
    case ready
    case issuesCreated = "issues_created"
    case archived

    var displayName: String {
        switch self {
        case .draft: "초안"
        case .refining: "구체화 중"
        case .ready: "준비됨"
        case .issuesCreated: "이슈 생성됨"
        case .archived: "보관됨"
        }
    }
}

enum IdeaProvider: String, Codable, CaseIterable, Sendable {
    case codex, claude, grok, opencode

    var models: [(value: String, label: String)] {
        switch self {
        case .codex:
            [("", "Provider default"), ("gpt-5.6-sol", "GPT-5.6 Sol"),
             ("gpt-5.6-terra", "GPT-5.6 Terra"), ("gpt-5.6-luna", "GPT-5.6 Luna")]
        case .claude:
            [("", "Provider default"), ("sonnet", "Claude Sonnet"),
             ("opus", "Claude Opus"), ("haiku", "Claude Haiku"), ("fable", "Claude Fable")]
        case .grok:
            [("", "Provider default"), ("grok-4.5", "Grok 4.5"), ("grok-build", "Grok Build")]
        case .opencode:
            [("", "Provider default")]
        }
    }
}

struct IdeaAuthor: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let image: String?
}

struct IdeaSummary: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let projectId: UUID
    let author: IdeaAuthor
    var title: String
    var documentMarkdown: String
    var status: IdeaStatus
    var provider: IdeaProvider
    var model: String?
    var version: Int
    let generatedIssueCount: Int
    let createdAt: Date
    var updatedAt: Date
}

struct IdeaMessage: Codable, Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable { case user, assistant }
    let id: UUID
    let role: Role
    let body: String
    let jobId: UUID?
    let createdAt: Date
}

struct IdeaJob: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case chat, issuePlan = "issue_plan" }
    enum Status: String, Codable, Sendable { case queued, running, completed, failed }
    let id: UUID
    let kind: Kind
    let status: Status
    let triggerMessageId: UUID?
    let attempts: Int
    let error: String?
    let createdAt: Date
    let updatedAt: Date
}

struct IdeaPlanItem: Codable, Identifiable, Equatable, Sendable {
    var id: String { key }
    let key: String
    var title: String
    var description: String
    var priority: Int?
    var provider: IdeaProvider?
    var model: String?
    var effort: String?
    var prerequisiteKeys: [String]
}

struct IdeaPlan: Codable, Equatable, Sendable {
    let id: UUID
    let ideaId: UUID
    let documentVersion: Int
    let version: Int
    let items: [IdeaPlanItem]
    let createdAt: Date
    let updatedAt: Date
}

struct IdeaDetail: Codable, Equatable, Sendable {
    let id: UUID
    let projectId: UUID
    let author: IdeaAuthor
    var title: String
    var documentMarkdown: String
    var status: IdeaStatus
    var provider: IdeaProvider
    var model: String?
    var version: Int
    let generatedIssueCount: Int
    let createdAt: Date
    var updatedAt: Date
    let canEdit: Bool
    let messages: [IdeaMessage]
    let activeJob: IdeaJob?
    let plan: IdeaPlan?
    let generatedRunIds: [UUID]
}

struct IdeasResponse: Codable, Sendable { let ideas: [IdeaSummary] }
struct IdeaResponse: Codable, Sendable { let idea: IdeaDetail }
struct IdeaConversionResponse: Codable, Sendable { let runIds: [UUID] }
struct IdeaDeleteResponse: Codable, Sendable { let deleted: Bool }

struct CreateIdeaRequest: Codable, Sendable {
    let provider: IdeaProvider
    let model: String?
}

struct UpdateIdeaRequest: Codable, Sendable {
    let expectedVersion: Int
    let title: String?
    let documentMarkdown: String?
    let status: IdeaStatus?
    let provider: IdeaProvider?
    let model: String?
}

struct UpdateIdeaModelRequest: Encodable, Sendable {
    let expectedVersion: Int
    let model: String?

    enum CodingKeys: String, CodingKey { case expectedVersion, model }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        if let model { try container.encode(model, forKey: .model) }
        else { try container.encodeNil(forKey: .model) }
    }
}

struct IdeaMessageRequest: Codable, Sendable { let body: String }
struct IdeaPlanUpdateRequest: Codable, Sendable {
    let expectedVersion: Int
    let items: [IdeaPlanItem]
}
struct IdeaConversionRequest: Codable, Sendable { let planVersion: Int }
struct EmptyRequest: Codable, Sendable {}
