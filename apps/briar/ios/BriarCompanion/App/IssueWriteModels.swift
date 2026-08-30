import Foundation
import UIKit

enum AgentProvider: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case codex
    case claude
    case cursor
    case grok
    case agy
    case opencode
    case openrouter

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .agy: "Antigravity"
        case .opencode: "OpenCode"
        case .openrouter: "OpenRouter"
        default: rawValue.capitalized
        }
    }

    static func stableMenuOrder(_ providers: [Self]) -> [Self] {
        let positions = Dictionary(
            uniqueKeysWithValues: allCases.enumerated().map { ($0.element, $0.offset) }
        )
        return providers.enumerated().sorted { left, right in
            let leftPosition = positions[left.element] ?? .max
            let rightPosition = positions[right.element] ?? .max
            return leftPosition == rightPosition
                ? left.offset < right.offset
                : leftPosition < rightPosition
        }.map(\.element)
    }
}

struct ModelEffort: RawRepresentable, Codable, Hashable, Identifiable, Sendable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    var id: String { rawValue }

    // Value conveniences for persisted fixtures. These do not define the UI
    // capability list; selectors use the reporting Worker's catalog.
    static let low = Self(rawValue: "low")
    static let medium = Self(rawValue: "medium")
    static let high = Self(rawValue: "high")
    static let xhigh = Self(rawValue: "xhigh")
    static let max = Self(rawValue: "max")
    static let ultra = Self(rawValue: "ultra")
}

struct AgentEffortCapability: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let description: String?
    let isDefault: Bool?
}

struct AgentModelCapability: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let isDefault: Bool?
    let defaultEffortId: String?
    let efforts: [AgentEffortCapability]
}

struct AgentProviderCapability: Codable, Equatable, Sendable {
    let models: [AgentModelCapability]
    let defaultEfforts: [AgentEffortCapability]
    let allowCustomModels: Bool
    let error: String?
}

struct AgentProviderCapabilityCatalog: Equatable, Sendable {
    private var entries: [String: AgentProviderCapability]

    private static let effortMenuPositions = Dictionary(
        uniqueKeysWithValues: ["low", "medium", "high", "xhigh", "max", "ultra"]
            .enumerated()
            .map { ($0.element, $0.offset) }
    )

    private static func compareMenuText(_ left: String, _ right: String) -> Bool {
        let leftFolded = left.lowercased(with: Locale(identifier: "en_US_POSIX"))
        let rightFolded = right.lowercased(with: Locale(identifier: "en_US_POSIX"))
        return leftFolded == rightFolded ? left < right : leftFolded < rightFolded
    }

    private static func stableModelOrder(
        _ models: [AgentModelCapability]
    ) -> [AgentModelCapability] {
        models.sorted { left, right in
            if left.label != right.label {
                return compareMenuText(left.label, right.label)
            }
            return compareMenuText(left.id, right.id)
        }
    }

    private static func stableEffortOrder(
        _ efforts: [AgentEffortCapability]
    ) -> [AgentEffortCapability] {
        efforts.sorted { left, right in
            let leftPosition = effortMenuPositions[left.id]
            let rightPosition = effortMenuPositions[right.id]
            switch (leftPosition, rightPosition) {
            case let (.some(leftPosition), .some(rightPosition)):
                return leftPosition < rightPosition
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case (.none, .none):
                if left.label != right.label {
                    return compareMenuText(left.label, right.label)
                }
                return compareMenuText(left.id, right.id)
            }
        }
    }

    private static func stableMenuOrder(
        _ capability: AgentProviderCapability
    ) -> AgentProviderCapability {
        AgentProviderCapability(
            models: stableModelOrder(capability.models.map { model in
                AgentModelCapability(
                    id: model.id,
                    label: model.label,
                    isDefault: model.isDefault,
                    defaultEffortId: model.defaultEffortId,
                    efforts: stableEffortOrder(model.efforts)
                )
            }),
            defaultEfforts: stableEffortOrder(capability.defaultEfforts),
            allowCustomModels: capability.allowCustomModels,
            error: capability.error
        )
    }

    init(workers: [DashboardWorker]) {
        entries = [:]
        for worker in workers where worker.readiness != "offline" {
            for (provider, capability) in worker.capabilities?.providerCapabilities ?? [:] {
                guard var existing = entries[provider] else {
                    entries[provider] = Self.stableMenuOrder(capability)
                    continue
                }
                var models = Dictionary(uniqueKeysWithValues: existing.models.map { ($0.id, $0) })
                for model in capability.models {
                    guard let saved = models[model.id] else {
                        models[model.id] = model
                        continue
                    }
                    var efforts = Dictionary(uniqueKeysWithValues: saved.efforts.map { ($0.id, $0) })
                    model.efforts.forEach { efforts[$0.id] = $0 }
                    models[model.id] = AgentModelCapability(
                        id: saved.id,
                        label: saved.label,
                        isDefault: (saved.isDefault ?? false) || (model.isDefault ?? false),
                        defaultEffortId: saved.defaultEffortId ?? model.defaultEffortId,
                        efforts: Self.stableEffortOrder(Array(efforts.values))
                    )
                }
                var defaults = Dictionary(uniqueKeysWithValues: existing.defaultEfforts.map { ($0.id, $0) })
                capability.defaultEfforts.forEach { defaults[$0.id] = $0 }
                existing = Self.stableMenuOrder(AgentProviderCapability(
                    models: Array(models.values),
                    defaultEfforts: Array(defaults.values),
                    allowCustomModels: existing.allowCustomModels || capability.allowCustomModels,
                    error: existing.error == nil || capability.error == nil ? nil : existing.error
                ))
                entries[provider] = existing
            }
        }
    }

    func models(for provider: AgentProvider?) -> [AgentModelCapability] {
        guard let provider else { return [] }
        return entries[provider.rawValue]?.models ?? []
    }

    func efforts(for provider: AgentProvider?, model: String?) -> [AgentEffortCapability] {
        guard let provider, let entry = entries[provider.rawValue] else { return [] }
        let selected = model.flatMap { id in entry.models.first(where: { $0.id == id }) }
            ?? entry.models.first(where: { $0.isDefault == true })
        return selected?.efforts.isEmpty == false ? selected!.efforts : entry.defaultEfforts
    }
}

struct IssueDependencyReference: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let runNumber: Int
    let title: String
    let status: DashboardRun.Status
}

struct PendingIssueAttachment: Identifiable, Equatable, Sendable {
    static let allowedContentTypes = Set([
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml",
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
            return L10n.text("첨부 파일은 최대 5개까지 추가할 수 있습니다.")
        }
        var total = 0
        for attachment in attachments {
            let name = attachment.filename.precomposedStringWithCanonicalMapping
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name.count <= 255, !name.contains("\0") else {
                return L10n.text("첨부 파일 이름이 유효하지 않습니다.")
            }
            guard allowedContentTypes.contains(attachment.contentType) else {
                return L10n.format("%@은(는) 지원하지 않는 이미지·영상 형식입니다.", name)
            }
            guard !attachment.data.isEmpty else {
                return L10n.format("%@은(는) 빈 파일입니다.", name)
            }
            guard attachment.data.count <= maximumFileBytes else {
                return L10n.format("%@은(는) 파일당 20MB 제한을 넘습니다.", name)
            }
            total += attachment.data.count
        }
        return total <= maximumTotalBytes
            ? nil
            : L10n.text("첨부 파일의 전체 크기는 25MB를 넘을 수 없습니다.")
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
    /// Let the selected provider/model choose its current default effort.
    static let defaultEffort: ModelEffort? = nil

    var title = ""
    var description = ""
    var priority: Int? = defaultPriority
    var difficulty: IssueDifficulty? = nil
    var assigneeUserId: String? = nil
    var status: DashboardRun.Status = .queued
    var preferredProvider: AgentProvider? = nil
    var preferredModel: String? = nil
    var preferredEffort: ModelEffort? = defaultEffort
    var fullAuto = false

    var isEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            priority == Self.defaultPriority &&
            difficulty == nil &&
            assigneeUserId == nil &&
            preferredProvider == nil &&
            preferredModel == nil &&
            !fullAuto &&
            (preferredEffort == nil || preferredEffort == Self.defaultEffort)
    }
}

struct CreateIssueResponse: Codable, Sendable {
    let runId: UUID
    let sourceKey: String
    let stage: String
    let status: DashboardRun.Status
    let attachments: [IssueAttachment]
    let assigneeUserId: String?
    let createdByUserId: String
    let difficulty: IssueDifficulty?
}

struct IssueSubscriptionResponse: Codable, Equatable, Sendable {
    let runId: UUID
    let subscribers: [IssueSubscriber]
}

struct IssueExecutionPreferences: Codable, Equatable, Sendable {
    var provider: AgentProvider?
    var model: String?
    var effort: ModelEffort?

    var isValid: Bool {
        guard provider != nil else { return model == nil && effort == nil }
        guard let model else { return effort == nil }
        return !model.isEmpty
    }

    var isValidForConversationApproval: Bool {
        provider != nil && isValid
    }
}

enum IssueExecutionApprovalUnavailable: Equatable, Sendable {
    case targetUnavailable
    case prerequisites
    case stateChanged
}

/// `delegatedByAgentName` identifies the Organization Agent that delegated the
/// work. A direct Project Agent proposal has no delegation label.
func issueExecutionDelegationNotice(
    agentName: String?,
    locale: CompanionLocale
) -> String? {
    guard let name = agentName?.trimmingCharacters(in: .whitespacesAndNewlines),
          !name.isEmpty
    else { return nil }
    return L10n.format(
        "Organization Agent %@의 위임",
        locale: locale,
        name
    )
}

/// The fields that can make a previously valid execution approval stale. This
/// intentionally excludes presentation-only issue fields while covering
/// assignment, dispatch, claim, worker, provider/model/effort, dependency, and
/// server-version changes.
struct IssueExecutionSignature: Equatable, Sendable {
    let runID: UUID
    let status: DashboardRun.Status
    let workflowStage: String?
    let executionReadiness: String?
    let waitingOnPrerequisiteCount: Int?
    let prerequisiteStates: [IssueExecutionPrerequisiteSignature]
    let assigneeUserID: String?
    let preferredProvider: AgentProvider?
    let preferredModel: String?
    let preferredEffort: ModelEffort?
    let dispatchedAt: Date?
    let requestedProvider: AgentProvider?
    let requestedModel: String?
    let requestedEffort: ModelEffort?
    let requestedWorkerID: String?
    let requestedByUserID: String?
    let dispatchMode: String?
    let claimedBy: String?
    let claimedAt: Date?
    let workerID: String?
    let startedAt: Date?
    let updatedAt: Date
}

struct IssueExecutionPrerequisiteSignature: Equatable, Sendable {
    let runID: UUID
    let status: DashboardRun.Status
}

struct PendingIssueExecutionTargetSignature: Equatable, Sendable {
    let proposalID: UUID
    let targetSignature: IssueExecutionSignature?
}

/// Only a target change for an already-observed pending proposal should cause
/// an authoritative conversation reload. Initial loads, newly added cards, and
/// cards already removed by an authoritative response must not create loops.
func pendingIssueExecutionTargetChanged(
    from previous: [PendingIssueExecutionTargetSignature],
    to current: [PendingIssueExecutionTargetSignature]
) -> Bool {
    let currentByID = Dictionary(
        current.map { ($0.proposalID, $0.targetSignature) },
        uniquingKeysWith: { existing, _ in existing }
    )
    return previous.contains { previousValue in
        guard let currentValue = currentByID[previousValue.proposalID] else {
            return false
        }
        return currentValue != previousValue.targetSignature
    }
}

func issueExecutionSignature(_ run: DashboardRun?) -> IssueExecutionSignature? {
    guard let run else { return nil }
    return IssueExecutionSignature(
        runID: run.id,
        status: run.status,
        workflowStage: run.workflowStage,
        executionReadiness: run.executionReadiness,
        waitingOnPrerequisiteCount: run.waitingOnPrerequisiteCount,
        prerequisiteStates: (run.prerequisites ?? [])
            .map {
                IssueExecutionPrerequisiteSignature(
                    runID: $0.id,
                    status: $0.status
                )
            }
            .sorted { $0.runID.uuidString < $1.runID.uuidString },
        assigneeUserID: run.assigneeUserId,
        preferredProvider: run.preferredProvider,
        preferredModel: run.preferredModel,
        preferredEffort: run.preferredEffort,
        dispatchedAt: run.dispatchedAt,
        requestedProvider: run.requestedProvider,
        requestedModel: run.requestedModel,
        requestedEffort: run.requestedEffort,
        requestedWorkerID: run.requestedWorkerId,
        requestedByUserID: run.requestedByUserId,
        dispatchMode: run.dispatchMode,
        claimedBy: run.claimedBy,
        claimedAt: run.claimedAt,
        workerID: run.workerId,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt
    )
}

/// Mirrors the shared web/Android preflight. The server remains authoritative,
/// but mobile re-reads these fields before opening and immediately before the
/// mutation so a claim, transfer, dispatch, or dependency change cannot be
/// approved from an old snapshot.
func issueExecutionApprovalUnavailable(
    run: DashboardRun?,
    targetRunID: UUID
) -> IssueExecutionApprovalUnavailable? {
    guard let run, run.id == targetRunID else { return .targetUnavailable }
    if run.executionReadiness == "waiting" { return .prerequisites }
    if run.status != .backlog ||
        run.claimedBy != nil ||
        run.claimedAt != nil ||
        run.workerId != nil ||
        run.dispatchedAt != nil ||
        run.requestedByUserId != nil ||
        run.dispatchMode != nil {
        return .stateChanged
    }
    return nil
}

func eligibleExecutionWorkers(
    workers: [DashboardWorker],
    provider: AgentProvider?,
    policy: ProjectExecutionWorkerPolicy?
) -> [DashboardWorker] {
    guard let provider else { return [] }
    return workers.filter { worker in
        worker.readiness != "disabled" &&
            worker.acceptingWork &&
            (policy?.allows(workerID: worker.id) ?? true) &&
            (worker.providers ?? worker.agentProvider.map { [$0] } ?? []).contains(provider)
    }
}

func issueExecutionApprovalAcceptedStateMatches(
    run: DashboardRun?,
    request: AcceptIssueExecutionProposalRequest
) -> Bool {
    guard let run else { return false }
    return run.status != .backlog &&
        run.dispatchedAt != nil &&
        run.requestedByUserId != nil &&
        run.dispatchMode != nil &&
        run.requestedProvider == request.provider &&
        run.requestedModel == request.model &&
        run.requestedEffort == request.effort &&
        run.requestedWorkerId == request.workerId
}

func issueExecutionApprovalResponseMatches(
    proposal: IssueExecutionProposal,
    projectID: UUID,
    runID: UUID,
    dispatch: DispatchRunResponse,
    expectedProposalID: UUID,
    request: AcceptIssueExecutionProposalRequest
) -> Bool {
    proposal.id == expectedProposalID &&
        proposal.status == .accepted &&
        proposal.projectId == projectID &&
        proposal.runId == runID &&
        proposal.acceptedAt != nil &&
        proposal.requestedProvider == request.provider &&
        proposal.requestedModel == request.model &&
        proposal.requestedEffort == request.effort &&
        proposal.requestedWorkerId == request.workerId &&
        dispatch.runId == runID &&
        dispatch.provider == request.provider &&
        dispatch.model == request.model &&
        dispatch.effort == request.effort &&
        dispatch.requestedWorkerId == request.workerId &&
        dispatch.dispatchMode == (request.workerId == nil ? "any" : "specific")
}

func issueExecutionProposalMatchesCreatedRun(
    _ proposal: IssueExecutionProposal,
    projectID: UUID,
    runID: UUID
) -> Bool {
    proposal.projectId == projectID && proposal.runId == runID
}

enum IssueExecutionApprovalError: LocalizedError, Equatable, Sendable {
    case targetUnavailable
    case prerequisites
    case stateChanged
    case providerUnavailable
    case configurationUnavailable
    case workerUnavailable

    var errorDescription: String? {
        switch self {
        case .targetUnavailable:
            L10n.text("실행 대상 이슈를 최신 프로젝트 스냅샷에서 찾을 수 없습니다.")
        case .prerequisites:
            L10n.text("완료되지 않은 선행 이슈가 있어 아직 실행할 수 없습니다.")
        case .stateChanged:
            L10n.text("이슈 상태가 변경되었습니다. 최신 상태를 확인해 다시 승인해 주세요.")
        case .providerUnavailable:
            L10n.text("이 프로젝트에서 사용할 수 없는 프로바이더입니다.")
        case .configurationUnavailable:
            L10n.text("선택한 모델 또는 Effort를 이 프로바이더에서 사용할 수 없습니다.")
        case .workerUnavailable:
            L10n.text("선택한 설정으로 실행 가능한 Worker가 없습니다.")
        }
    }

    init(_ unavailable: IssueExecutionApprovalUnavailable) {
        switch unavailable {
        case .targetUnavailable: self = .targetUnavailable
        case .prerequisites: self = .prerequisites
        case .stateChanged: self = .stateChanged
        }
    }
}

@discardableResult
func validateIssueExecutionApproval(
    snapshot: DashboardSnapshot,
    proposal: IssueExecutionProposal,
    request: AcceptIssueExecutionProposalRequest? = nil
) throws -> DashboardRun {
    guard snapshot.project.id == proposal.projectId else {
        throw IssueExecutionApprovalError.targetUnavailable
    }
    let run = snapshot.runs.first(where: { $0.id == proposal.runId })
    if let unavailable = issueExecutionApprovalUnavailable(
        run: run,
        targetRunID: proposal.runId
    ) {
        throw IssueExecutionApprovalError(unavailable)
    }
    guard let run else { throw IssueExecutionApprovalError.targetUnavailable }

    try validateIssueExecutionSelection(
        snapshot: snapshot,
        projectID: proposal.projectId,
        request: request
    )
    return run
}

/// Validates the execution half of a combined create-and-execute approval
/// before the issue exists. The server repeats these checks at mutation time.
func validateIssueExecutionSelection(
    snapshot: DashboardSnapshot,
    projectID: UUID,
    request: AcceptIssueExecutionProposalRequest? = nil
) throws {
    guard snapshot.project.id == projectID else {
        throw IssueExecutionApprovalError.targetUnavailable
    }

    // Conversational approval is based on the target project's exact
    // capability snapshot. Missing provider data is not permission to infer
    // that every provider is available.
    let providers = snapshot.organizationProviders ?? []
    if let request {
        guard providers.contains(request.provider) else {
            throw IssueExecutionApprovalError.providerUnavailable
        }
        guard IssueExecutionPreferences(
            provider: request.provider,
            model: request.model,
            effort: request.effort
        ).isValidForConversationApproval else {
            throw IssueExecutionApprovalError.configurationUnavailable
        }
        let eligible = eligibleExecutionWorkers(
            workers: snapshot.workers ?? [],
            provider: request.provider,
            policy: snapshot.executionPolicy
        )
        guard !eligible.isEmpty else {
            throw IssueExecutionApprovalError.workerUnavailable
        }
        if let workerID = request.workerId,
           !eligible.contains(where: {
               $0.id == workerID && $0.readiness == "available"
           }) {
            throw IssueExecutionApprovalError.workerUnavailable
        }
    } else {
        let hasExecutableProvider = providers.contains { provider in
            !eligibleExecutionWorkers(
                workers: snapshot.workers ?? [],
                provider: provider,
                policy: snapshot.executionPolicy
            ).isEmpty
        }
        guard hasExecutableProvider else {
            throw IssueExecutionApprovalError.workerUnavailable
        }
    }
}

extension AcceptIssueExecutionProposalRequest {
    init(
        preferences: IssueExecutionPreferences,
        workerID: String?
    ) throws {
        guard let provider = preferences.provider,
              preferences.isValidForConversationApproval
        else { throw IssueMutationError.invalidPreferences }
        self.init(
            provider: provider,
            model: preferences.model,
            effort: preferences.effort,
            workerId: workerID
        )
    }
}

enum AgentSkillExecutionApprovalError: LocalizedError, Equatable, Sendable {
    case proposalChanged
    case projectUnavailable
    case workerRequired
    case workerUnavailable

    var errorDescription: String? {
        switch self {
        case .proposalChanged:
            L10n.text("Agent 또는 Skill 실행 요청이 변경되었습니다. 최신 대화를 확인해 주세요.")
        case .projectUnavailable:
            L10n.text("Skill 실행 프로젝트의 최신 컨텍스트를 불러올 수 없습니다.")
        case .workerRequired:
            L10n.text("실행할 Worker를 명시적으로 선택해 주세요.")
        case .workerUnavailable:
            L10n.text("선택한 Skill 런타임으로 실행 가능한 Worker가 없습니다.")
        }
    }
}

func agentSkillExecutionImmutableFieldsMatch(
    _ candidate: AgentSkillExecutionProposal,
    _ expected: AgentSkillExecutionProposal
) -> Bool {
    candidate.id == expected.id &&
        candidate.type == expected.type &&
        candidate.projectId == expected.projectId &&
        candidate.agentId == expected.agentId &&
        candidate.agentName == expected.agentName &&
        candidate.skillId == expected.skillId &&
        candidate.skillName == expected.skillName &&
        candidate.request == expected.request &&
        candidate.provider == expected.provider &&
        candidate.model == expected.model &&
        candidate.effort == expected.effort &&
        candidate.executionMode == expected.executionMode &&
        candidate.approvalPolicy == expected.approvalPolicy &&
        candidate.createdAt == expected.createdAt &&
        candidate.delegatedByAgentId == expected.delegatedByAgentId &&
        candidate.delegatedByAgentName == expected.delegatedByAgentName
}

func eligibleAgentSkillExecutionWorkers(
    snapshot: DashboardSnapshot,
    proposal: AgentSkillExecutionProposal
) -> [DashboardWorker] {
    guard snapshot.project.id == proposal.projectId else { return [] }
    return eligibleExecutionWorkers(
        workers: snapshot.workers ?? [],
        provider: proposal.provider,
        policy: snapshot.executionPolicy
    ).filter { $0.readiness == "available" }
}

@discardableResult
func validateAgentSkillExecutionApproval(
    snapshot: DashboardSnapshot,
    proposal: AgentSkillExecutionProposal,
    request: AcceptAgentSkillExecutionProposalRequest? = nil
) throws -> [DashboardWorker] {
    guard proposal.status == .pending else {
        throw AgentSkillExecutionApprovalError.proposalChanged
    }
    guard snapshot.project.id == proposal.projectId else {
        throw AgentSkillExecutionApprovalError.projectUnavailable
    }
    if proposal.executionMode == .conversation {
        guard request?.workerId == nil else {
            throw AgentSkillExecutionApprovalError.workerUnavailable
        }
        return []
    }
    let workers = eligibleAgentSkillExecutionWorkers(
        snapshot: snapshot,
        proposal: proposal
    )
    guard !workers.isEmpty else {
        throw AgentSkillExecutionApprovalError.workerUnavailable
    }
    if let request {
        let workerID = request.workerId?.trimmingCharacters(
            in: .whitespacesAndNewlines
        ) ?? ""
        guard !workerID.isEmpty else {
            throw AgentSkillExecutionApprovalError.workerRequired
        }
        guard workerID == request.workerId,
              workers.contains(where: { $0.id == workerID })
        else {
            throw AgentSkillExecutionApprovalError.workerUnavailable
        }
    }
    return workers
}

func agentSkillExecutionApprovalResponseMatches(
    response: AcceptAgentSkillExecutionProposalResponse,
    expected: AgentSkillExecutionProposal,
    request: AcceptAgentSkillExecutionProposalRequest
) -> Bool {
    let proposal = response.proposal
    let common = response.projectId == expected.projectId &&
        agentSkillExecutionImmutableFieldsMatch(proposal, expected) &&
        proposal.status == .accepted &&
        proposal.acceptedAt != nil &&
        proposal.requestedWorkerId != nil &&
        proposal.requestedWorkerLabel?.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty == false &&
        proposal.resultSessionId != nil
    if expected.executionMode == .conversation {
        return common && request.workerId == nil && response.session == nil &&
            proposal.resultMessageId != nil
    }
    guard let session = response.session, let workerID = request.workerId else {
        return false
    }
    return common && proposal.requestedWorkerId == workerID &&
        proposal.resultSessionId == session.id &&
        session.projectId == expected.projectId &&
        session.agentId == expected.agentId &&
        session.agentName == expected.agentName &&
        session.skillId == expected.skillId &&
        session.sessionType == .task &&
        session.trigger == .manual &&
        session.request == expected.request &&
        session.requestedWorkerId == workerID &&
        session.workerId == workerID
}

struct DispatchRunRequest: Codable, Sendable {
    let agentId: UUID?
    let provider: AgentProvider
    let model: String?
    let effort: ModelEffort?
    let persistPreferences: Bool
    let workerId: String?
    let requestId: UUID

    private enum CodingKeys: String, CodingKey {
        case agentId
        case provider
        case model
        case effort
        case persistPreferences
        case workerId
        case requestId
    }

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

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(agentId?.uuidString.lowercased(), forKey: .agentId)
        try container.encode(provider, forKey: .provider)
        try container.encodeIfPresent(model, forKey: .model)
        try container.encodeIfPresent(effort, forKey: .effort)
        try container.encode(persistPreferences, forKey: .persistPreferences)
        try container.encodeIfPresent(workerId, forKey: .workerId)
        try container.encode(requestId.uuidString.lowercased(), forKey: .requestId)
    }
}

struct DispatchRunResponse: Codable, Equatable, Sendable {
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

struct IssueAgentReplyJob: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        case queued
        case running
        case completed
        case failed
    }

    let id: UUID
    let triggerMessageId: UUID
    let parentMessageId: UUID
    let agentId: UUID?
    let agentName: String?
    let status: Status
    let attempts: Int
    let error: String?

    init(
        id: UUID,
        triggerMessageId: UUID,
        parentMessageId: UUID,
        agentId: UUID? = nil,
        agentName: String? = nil,
        status: Status,
        attempts: Int,
        error: String?
    ) {
        self.id = id
        self.triggerMessageId = triggerMessageId
        self.parentMessageId = parentMessageId
        self.agentId = agentId
        self.agentName = agentName
        self.status = status
        self.attempts = attempts
        self.error = error
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case triggerMessageId
        case parentMessageId
        case agentId
        case agentName
        case status
        case attempts
        case error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        triggerMessageId = try container.decode(UUID.self, forKey: .triggerMessageId)
        parentMessageId = try container.decodeIfPresent(
            UUID.self,
            forKey: .parentMessageId
        ) ?? triggerMessageId
        agentId = try container.decodeIfPresent(UUID.self, forKey: .agentId)
        agentName = try container.decodeIfPresent(String.self, forKey: .agentName)
        status = try container.decode(Status.self, forKey: .status)
        attempts = try container.decodeIfPresent(Int.self, forKey: .attempts) ?? 0
        error = try container.decodeIfPresent(String.self, forKey: .error)
    }
}

struct CreateIssueMessageResponse: Codable, Sendable {
    let message: IssueMessage
    let agentReply: IssueAgentReplyJob?
    let agentReplies: [IssueAgentReplyJob]

    init(
        message: IssueMessage,
        agentReply: IssueAgentReplyJob?,
        agentReplies: [IssueAgentReplyJob] = []
    ) {
        self.message = message
        self.agentReply = agentReply
        self.agentReplies = agentReplies
    }

    private enum CodingKeys: String, CodingKey {
        case message
        case agentReply
        case agentReplies
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try container.decode(IssueMessage.self, forKey: .message)
        agentReply = try container.decodeIfPresent(
            IssueAgentReplyJob.self,
            forKey: .agentReply
        )
        agentReplies = try container.decodeIfPresent(
            [IssueAgentReplyJob].self,
            forKey: .agentReplies
        ) ?? []
    }
}

struct IssueAgentReplyResponse: Codable, Sendable {
    let agentReply: IssueAgentReplyJob
    let message: IssueMessage?
    let agentReplies: [IssueAgentReplyJob]
    let messages: [IssueMessage]

    private enum CodingKeys: String, CodingKey {
        case agentReply
        case message
        case agentReplies
        case messages
    }

    init(
        agentReply: IssueAgentReplyJob,
        message: IssueMessage?,
        agentReplies: [IssueAgentReplyJob],
        messages: [IssueMessage]
    ) {
        self.agentReply = agentReply
        self.message = message
        self.agentReplies = agentReplies
        self.messages = messages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        agentReply = try container.decode(IssueAgentReplyJob.self, forKey: .agentReply)
        message = try container.decodeIfPresent(IssueMessage.self, forKey: .message)
        agentReplies = try container.decodeIfPresent(
            [IssueAgentReplyJob].self,
            forKey: .agentReplies
        ) ?? []
        messages = try container.decodeIfPresent(
            [IssueMessage].self,
            forKey: .messages
        ) ?? []
    }
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
        case .duplicateAction: L10n.text("이미 요청을 처리하고 있습니다.")
        case .invalidTitle: L10n.text("이슈 제목을 입력해 주세요.")
        case let .titleTooLong(max, count):
            L10n.format("제목이 너무 깁니다. %d자 이내로 줄여 주세요. (현재 %d자)", max, count)
        case .invalidMessage: L10n.text("메시지를 입력해 주세요.")
        case .invalidPreferences: L10n.text("모델과 effort를 선택하려면 프로바이더와 모델을 순서대로 선택해 주세요.")
        case let .attachment(message): message
        case .agentReplyTimedOut: L10n.text("Agent 답변이 아직 대기 중입니다. 잠시 후 다시 확인해 주세요.")
        case .agentReplyPollingFailed:
            L10n.text("메시지는 전송됐지만 Agent 답변 상태를 확인하지 못했습니다. 상세를 새로고침해 주세요.")
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
