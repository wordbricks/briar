import Foundation

struct DashboardRun: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runNumber: Int?
    let currentAttempt: Int
    let currentRevision: Int
    let title: String
    let status: Status
    let workflowStage: String?
    let detail: String?
    let issueDescription: String?
    let attachments: [IssueAttachment]
    let resultSummary: String?
    let structuredResult: StructuredResult?
    let resultReviews: [ResultReview]
    let pullRequestURLs: [URL]
    let updatedAt: Date

    init(
        id: UUID,
        runNumber: Int? = nil,
        currentAttempt: Int = 1,
        currentRevision: Int = 1,
        title: String,
        status: Status,
        workflowStage: String? = nil,
        detail: String? = nil,
        issueDescription: String? = nil,
        attachments: [IssueAttachment] = [],
        resultSummary: String? = nil,
        structuredResult: StructuredResult? = nil,
        resultReviews: [ResultReview] = [],
        pullRequestURLs: [URL] = [],
        updatedAt: Date
    ) {
        self.id = id
        self.runNumber = runNumber
        self.currentAttempt = currentAttempt
        self.currentRevision = currentRevision
        self.title = title
        self.status = status
        self.workflowStage = workflowStage
        self.detail = detail
        self.issueDescription = issueDescription
        self.attachments = attachments
        self.resultSummary = resultSummary
        self.structuredResult = structuredResult
        self.resultReviews = resultReviews
        self.pullRequestURLs = pullRequestURLs
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, runNumber, currentAttempt, currentRevision, title, status
        case workflowStage, detail, issueDescription, attachments, resultSummary
        case structuredResult, resultReviews, updatedAt
        case pullRequestURLs = "pullRequestUrls"
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        runNumber = try values.decodeIfPresent(Int.self, forKey: .runNumber)
        currentAttempt = try values.decodeIfPresent(Int.self, forKey: .currentAttempt) ?? 1
        currentRevision = try values.decodeIfPresent(Int.self, forKey: .currentRevision) ?? 1
        title = try values.decode(String.self, forKey: .title)
        status = try values.decode(Status.self, forKey: .status)
        workflowStage = try values.decodeIfPresent(String.self, forKey: .workflowStage)
        detail = try values.decodeIfPresent(String.self, forKey: .detail)
        issueDescription = try values.decodeIfPresent(String.self, forKey: .issueDescription)
        attachments = try values.decodeIfPresent([IssueAttachment].self, forKey: .attachments) ?? []
        resultSummary = try values.decodeIfPresent(String.self, forKey: .resultSummary)
        structuredResult = try values.decodeIfPresent(StructuredResult.self, forKey: .structuredResult)
        resultReviews = try values.decodeIfPresent([ResultReview].self, forKey: .resultReviews) ?? []
        pullRequestURLs = try values.decodeIfPresent([URL].self, forKey: .pullRequestURLs) ?? []
        updatedAt = try values.decode(Date.self, forKey: .updatedAt)
    }

    enum Status: String, Codable, CaseIterable, Sendable {
        case backlog
        case queued
        case running
        case blocked
        case failed
        case completed
        case cancelled

        var displayName: String {
            switch self {
            case .backlog: "대기"
            case .queued: "실행 대기"
            case .running: "진행 중"
            case .blocked: "차단됨"
            case .failed: "실패"
            case .completed: "완료"
            case .cancelled: "취소"
            }
        }
    }

    var searchableText: String {
        [title, detail, issueDescription, resultSummary, structuredResult?.summary]
            .compactMap { $0 }
            .joined(separator: " ")
    }
}

struct IssueAttachment: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let filename: String
    let contentType: String
    let byteSize: Int
    let url: String
}

struct StructuredResult: Codable, Equatable, Sendable {
    let summary: String
    let outcome: String?
    let humanActionRequired: Bool?
    let nextAction: String?
}

struct ResultReview: Codable, Equatable, Identifiable, Sendable {
    let userId: String
    let name: String
    let username: String?
    let image: String?
    let completedAt: Date

    var id: String { userId }
}

enum RunFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "전체"
    case active = "진행"
    case attention = "확인 필요"
    case completed = "완료"

    var id: Self { self }

    func includes(_ status: DashboardRun.Status) -> Bool {
        switch self {
        case .all: true
        case .active: [.backlog, .queued, .running].contains(status)
        case .attention: [.blocked, .failed].contains(status)
        case .completed: [.completed, .cancelled].contains(status)
        }
    }
}

enum RunCollection {
    static func filtered(
        _ runs: [DashboardRun],
        by filter: RunFilter,
        query: String = ""
    ) -> [DashboardRun] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return runs.filter { run in
            guard filter.includes(run.status) else { return false }
            return normalized.isEmpty || run.searchableText.localizedCaseInsensitiveContains(normalized)
        }
    }
}

struct DashboardSnapshot: Codable, Equatable, Sendable {
    var project: ProjectsResponse.Project
    var runs: [DashboardRun]
    var cursor: Int?
    var generatedAt: Date
}

struct DashboardDelta: Codable, Equatable, Sendable {
    let cursor: Int
    let hasMore: Bool
    let runs: [DashboardRun]
    let deletedRunIds: [UUID]
    let project: ProjectsResponse.Project?
    let generatedAt: Date
}

enum DashboardMerge {
    static func apply(_ delta: DashboardDelta, to snapshot: DashboardSnapshot) -> DashboardSnapshot {
        let deleted = Set(delta.deletedRunIds)
        let changed = Dictionary(uniqueKeysWithValues: delta.runs.map { ($0.id, $0) })
        var runs: [DashboardRun] = snapshot.runs.compactMap { run -> DashboardRun? in
            guard !deleted.contains(run.id) else { return nil }
            return changed[run.id] ?? run
        }
        let existing = Set(runs.map(\.id))
        runs.append(contentsOf: delta.runs.filter { !existing.contains($0.id) })
        runs.sort {
            if $0.status == .completed && $1.status != .completed { return false }
            if $0.status != .completed && $1.status == .completed { return true }
            return $0.updatedAt > $1.updatedAt
        }
        return DashboardSnapshot(
            project: delta.project ?? snapshot.project,
            runs: Array(runs.prefix(200)),
            cursor: delta.cursor,
            generatedAt: delta.generatedAt
        )
    }
}
