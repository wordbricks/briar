import Foundation

struct DashboardRun: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let title: String
    let status: Status
    let detail: String?
    let updatedAt: Date

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
