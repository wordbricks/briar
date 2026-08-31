import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct CreateIssueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueDraft
    @State private var attachments: [PendingIssueAttachment] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var isLoadingPhotos = false
    @State private var errorMessage: String?
    @State private var didSubmitSuccessfully = false

    @ObservedObject var mutations: IssueMutationStore
    let members: [OrganizationMember]
    let providers: [AgentProvider]
    let capabilities: AgentProviderCapabilityCatalog
    let persistence: IssueDraftPersistence
    let parentRunID: UUID?
    let refresh: () async -> Void

    init(
        mutations: IssueMutationStore,
        members: [OrganizationMember] = [],
        providers: [AgentProvider] = [],
        capabilities: AgentProviderCapabilityCatalog = AgentProviderCapabilityCatalog(workers: []),
        persistence: IssueDraftPersistence = IssueDraftPersistence(),
        defaultAssigneeUserId: String? = nil,
        parentRunID: UUID? = nil,
        refresh: @escaping () async -> Void
    ) {
        self.mutations = mutations
        self.members = members
        self.providers = AgentProvider.stableMenuOrder(
            providers.isEmpty ? AgentProvider.allCases : providers
        )
        self.capabilities = capabilities
        self.persistence = persistence
        self.parentRunID = parentRunID
        self.refresh = refresh
        var loaded = persistence.load()
        if loaded.assigneeUserId == nil, let defaultAssigneeUserId {
            loaded.assigneeUserId = defaultAssigneeUserId
        }
        _draft = State(initialValue: loaded)
    }

    var body: some View {
        NavigationStack {
            Form {
                issueSection
                attributesSection
                Section(L10n.text("선호 실행")) {
                    PreferredExecutionPicker(
                        provider: $draft.preferredProvider,
                        model: $draft.preferredModel,
                        effort: $draft.preferredEffort,
                        providers: providers,
                        capabilities: capabilities
                    )
                }
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("취소")) {
                        persistence.save(draft)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if didSubmitSuccessfully {
                            Image(systemName: "checkmark")
                                .bold()
                        } else if mutations.isActive("create") {
                            ProgressView()
                        } else {
                            Text(L10n.text("등록"))
                        }
                    }
                    .disabled(
                        draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            mutations.isActive("create") ||
                            didSubmitSuccessfully
                    )
                    .accessibilityLabel(
                        didSubmitSuccessfully
                            ? L10n.text("등록 완료")
                            : (mutations.isActive("create") ? L10n.text("등록 중") : L10n.text("등록"))
                    )
                    .accessibilityIdentifier("create-issue-submit")
                }
            }
            .interactiveDismissDisabled(!draft.isEmpty || !attachments.isEmpty)
            .onChange(of: draft) { _, value in persistence.save(value) }
            .onChange(of: selectedPhotoItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await importPhotos(items) }
            }
        }
    }

    private var issueSection: some View {
        Section(L10n.text("이슈")) {
            TextField(L10n.text("제목"), text: $draft.title)
                .onChange(of: draft.title) { _, value in
                    let max = IssueTitleLimits.maxLength(for: value)
                    if value.count > max {
                        draft.title = String(value.prefix(max))
                    }
                }
                .accessibilityIdentifier("create-issue-title")
            // Description field with a photo attachment control inside the
            // bottom-trailing corner of the writing area.
            VStack(alignment: .leading, spacing: 8) {
                ZStack(alignment: .bottomTrailing) {
                    TextField(L10n.text("설명"), text: $draft.description, axis: .vertical)
                        .lineLimit(4...10)
                        .padding(.trailing, 72)
                        .padding(.bottom, 28)
                        .accessibilityIdentifier("create-issue-description")
                    HStack(spacing: 4) {
                        PasteButton(supportedContentTypes: [UTType.image]) { providers in
                            Task { await importPastedImages(providers) }
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel(L10n.text("클립보드 이미지 붙여넣기"))
                        .accessibilityIdentifier("create-issue-paste-attachment")
                        PhotosPicker(
                            selection: $selectedPhotoItems,
                            maxSelectionCount: max(
                                1,
                                PendingIssueAttachment.maximumCount - attachments.count
                            ),
                            selectionBehavior: .ordered,
                            matching: PhotoAttachmentImportPolicy.imagesAndVideos.pickerFilter,
                            preferredItemEncoding: .compatible
                        ) {
                            Image(systemName: "photo")
                                .font(.body.weight(.medium))
                                .foregroundStyle(.secondary)
                                .frame(width: 32, height: 32)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel(L10n.text("이미지·영상 첨부"))
                        .accessibilityIdentifier("create-issue-attachment")
                    }
                    .buttonStyle(.borderless)
                    .disabled(
                        isLoadingPhotos ||
                            attachments.count >= PendingIssueAttachment.maximumCount
                    )
                    .padding(.trailing, 2)
                    .padding(.bottom, 2)
                }
                if !attachments.isEmpty {
                    ForEach(attachments) { attachment in
                        PendingAttachmentRow(attachment: attachment) {
                            attachments.removeAll { $0.id == attachment.id }
                        }
                    }
                    Text(L10n.format("첨부 %d/5 · 파일당 20MB, 전체 25MB", attachments.count))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var attributesSection: some View {
        Section(L10n.text("속성")) {
            Picker(L10n.text("담당자"), selection: $draft.assigneeUserId) {
                Text(L10n.text("미배정")).tag(String?.none)
                ForEach(members) { member in
                    Text(member.name).tag(String?.some(member.userId))
                }
            }
            Picker(L10n.text("우선순위"), selection: $draft.priority) {
                Text(L10n.text("없음")).tag(Int?.none)
                ForEach(1...4, id: \.self) { priority in
                    Text("P\(priority)").tag(Int?.some(priority))
                }
            }
            Picker(L10n.text("난이도"), selection: $draft.difficulty) {
                Text(L10n.text("없음")).tag(IssueDifficulty?.none)
                ForEach(IssueDifficulty.allCases, id: \.self) { difficulty in
                    Label(difficulty.displayName, systemImage: difficulty.systemImage)
                        .tag(IssueDifficulty?.some(difficulty))
                }
            }
            Picker(L10n.text("등록 위치"), selection: $draft.status) {
                Text(L10n.text("실행 대기")).tag(DashboardRun.Status.queued)
                Text(L10n.text("백로그")).tag(DashboardRun.Status.backlog)
            }
            Toggle("Full Auto", isOn: $draft.fullAuto)
                .accessibilityHint(L10n.text("모든 체크포인트를 건너뛰고 중단 없이 처리합니다."))
                .accessibilityIdentifier("create-issue-full-auto")
        }
    }

    @MainActor
    private func importPhotos(_ items: [PhotosPickerItem]) async {
        isLoadingPhotos = true
        defer {
            isLoadingPhotos = false
            selectedPhotoItems = []
        }

        do {
            attachments = try await PhotoAttachmentImporter.importItems(
                items,
                appendingTo: attachments,
                policy: .imagesAndVideos
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func importPastedImages(_ providers: [NSItemProvider]) async {
        guard !providers.isEmpty, attachments.count < PendingIssueAttachment.maximumCount
        else { return }
        isLoadingPhotos = true
        defer {
            isLoadingPhotos = false
        }

        var loaded = attachments
        for provider in providers.prefix(
            PendingIssueAttachment.maximumCount - loaded.count
        ) {
            do {
                let data = try await loadTransferableData(from: provider)
                // Clipboard images can arrive as PNG/HEIC/TIFF; normalize them to the
                // server-supported JPEG format just like the Photos picker does.
                guard let attachment = PendingIssueAttachment.jpeg(from: data)
                else { continue }
                loaded.append(attachment)
            } catch {
                continue
            }
        }
        if loaded.count == attachments.count {
            errorMessage = L10n.text("클립보드에서 붙여넣을 이미지를 읽지 못했습니다.")
        } else if let message = PendingIssueAttachment.validationMessage(for: loaded) {
            errorMessage = message
        } else {
            attachments = loaded
            errorMessage = nil
        }
    }

    private func submit() async {
        do {
            _ = try await mutations.createIssue(
                draft: draft,
                attachments: attachments,
                parentRunId: parentRunID
            )
            persistence.clear()
            didSubmitSuccessfully = true
            await refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadTransferableData(from provider: NSItemProvider) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadTransferable(type: Data.self) { result in
                continuation.resume(with: result)
            }
        }
    }
}

private struct PendingAttachmentRow: View {
    let attachment: PendingIssueAttachment
    let remove: () -> Void

    var body: some View {
        HStack {
            Label(attachment.filename, systemImage: "paperclip")
                .lineLimit(1)
            Spacer()
            Text(ByteCountFormatter.string(
                fromByteCount: Int64(attachment.data.count),
                countStyle: .file
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
            Button(role: .destructive, action: remove) {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
        }
    }
}

private struct PreferredExecutionPicker: View {
    @Binding var provider: AgentProvider?
    @Binding var model: String?
    @Binding var effort: ModelEffort?
    let providers: [AgentProvider]
    let capabilities: AgentProviderCapabilityCatalog

    private var availableModels: [AgentModelCapability] {
        capabilities.models(for: provider)
    }

    var body: some View {
        Picker(L10n.text("프로바이더"), selection: $provider) {
            Text(L10n.text("기본값")).tag(AgentProvider?.none)
            ForEach(providers) { provider in
                Text(provider.displayName)
                    .tag(AgentProvider?.some(provider))
            }
        }
        .accessibilityIdentifier("create-issue-provider")
        Picker(L10n.text("모델"), selection: $model) {
            Text(L10n.text("기본값")).tag(String?.none)
            ForEach(availableModels) { model in
                Text(model.label).tag(String?.some(model.id))
            }
        }
        .disabled(provider == nil)
        .accessibilityIdentifier("create-issue-model")
        Picker(L10n.text("Effort"), selection: $effort) {
            Text(L10n.text("기본값")).tag(ModelEffort?.none)
            ForEach(capabilities.efforts(for: provider, model: model)) { effort in
                Text(effort.label).tag(ModelEffort?.some(ModelEffort(rawValue: effort.id)))
            }
        }
        .disabled(model == nil)
        .accessibilityIdentifier("create-issue-effort")
        .onChange(of: provider) { previous, provider in
            guard previous != provider else { return }
            model = nil
            effort = IssueDraft.defaultEffort
        }
    }
}

struct EditIssueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueDraft
    @State private var errorMessage: String?

    let runID: UUID
    let members: [OrganizationMember]
    @ObservedObject var mutations: IssueMutationStore
    let refresh: () async -> Void

    init(
        run: DashboardRun,
        members: [OrganizationMember] = [],
        mutations: IssueMutationStore,
        refresh: @escaping () async -> Void
    ) {
        runID = run.id
        self.members = members
        self.mutations = mutations
        self.refresh = refresh
        _draft = State(initialValue: IssueDraft(
            title: run.title,
            description: run.issueDescription ?? "",
            priority: run.priority,
            difficulty: run.difficulty,
            assigneeUserId: run.assigneeUserId,
            status: run.status
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField(L10n.text("제목"), text: $draft.title)
                    .onChange(of: draft.title) { _, value in
                        let max = IssueTitleLimits.maxLength(for: value)
                        if value.count > max {
                            draft.title = String(value.prefix(max))
                        }
                    }
                    .accessibilityIdentifier("edit-issue-title")
                TextField(L10n.text("설명"), text: $draft.description, axis: .vertical)
                    .lineLimit(5...12)
                Picker(L10n.text("담당자"), selection: $draft.assigneeUserId) {
                    Text(L10n.text("미배정")).tag(String?.none)
                    ForEach(members) { member in
                        Text(member.name).tag(String?.some(member.userId))
                    }
                }
                Picker(L10n.text("우선순위"), selection: $draft.priority) {
                    Text(L10n.text("없음")).tag(Int?.none)
                    ForEach(1...4, id: \.self) { Text("P\($0)").tag(Int?.some($0)) }
                }
                Picker(L10n.text("난이도"), selection: $draft.difficulty) {
                    Text(L10n.text("없음")).tag(IssueDifficulty?.none)
                    ForEach(IssueDifficulty.allCases, id: \.self) { difficulty in
                        Label(difficulty.displayName, systemImage: difficulty.systemImage)
                            .tag(IssueDifficulty?.some(difficulty))
                    }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle(L10n.text("이슈 수정"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.text("취소")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("저장")) { Task { await save() } }
                        .disabled(mutations.isActive("update-\(runID)"))
                        .accessibilityIdentifier("edit-issue-save")
                }
            }
        }
    }

    private func save() async {
        do {
            try await mutations.updateIssue(runID: runID, draft: draft)
            await refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Provider/model/effort/Worker selectors shared by ordinary manual dispatch
/// and Agent-authored execution approvals. Approval callers pass the bounded
/// conversational effort list; manual dispatch retains every provider option.
struct ExecutionConfigurationFields: View {
    @Binding var preferences: IssueExecutionPreferences
    @Binding var workerID: String?

    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let policy: ProjectExecutionWorkerPolicy?
    let capabilities: AgentProviderCapabilityCatalog
    let locale: CompanionLocale

    private var availableProviders: [AgentProvider] {
        AgentProvider.stableMenuOrder(providers)
    }

    private var visibleEfforts: [AgentEffortCapability] {
        capabilities.efforts(for: preferences.provider, model: preferences.model)
    }

    var body: some View {
        Section(L10n.text("실행 설정", locale: locale)) {
            Picker(L10n.text("프로바이더", locale: locale), selection: $preferences.provider) {
                ForEach(availableProviders) {
                    Text($0.displayName).tag(AgentProvider?.some($0))
                }
            }
            .accessibilityIdentifier("execution-approval-provider")

            Picker(L10n.text("모델", locale: locale), selection: $preferences.model) {
                Text(L10n.text("기본값", locale: locale)).tag(String?.none)
                ForEach(capabilities.models(for: preferences.provider)) {
                    Text($0.label).tag(String?.some($0.id))
                }
            }
            .accessibilityIdentifier("execution-approval-model")

            Picker(L10n.text("Effort", locale: locale), selection: $preferences.effort) {
                Text(L10n.text("기본값", locale: locale)).tag(ModelEffort?.none)
                ForEach(visibleEfforts) {
                    Text($0.label).tag(ModelEffort?.some(ModelEffort(rawValue: $0.id)))
                }
            }
            .disabled(preferences.model == nil)
            .accessibilityIdentifier("execution-approval-effort")
        }

        Section("Worker") {
            Picker(L10n.text("실행 환경", locale: locale), selection: $workerID) {
                Text(L10n.text("사용 가능한 Worker 자동 선택", locale: locale))
                    .tag(String?.none)
                ForEach(compatibleWorkers) { worker in
                    Text("\(worker.label) · \(worker.readiness)")
                        .tag(String?.some(worker.id))
                        .disabled(worker.readiness != "available")
                }
            }
            .accessibilityIdentifier("execution-approval-worker")
        }
        .onChange(of: preferences.provider) { oldProvider, provider in
            guard oldProvider != provider else { return }
            preferences.model = nil
            preferences.effort = nil
            clearIncompatibleWorker()
        }
        .onChange(of: preferences.model) { _, model in
            if model == nil { preferences.effort = nil }
        }
        .onChange(of: preferences.effort) { _, effort in
            if let effort,
               !visibleEfforts.contains(where: { $0.id == effort.rawValue }) {
                preferences.effort = nil
            }
        }
    }

    private var compatibleWorkers: [DashboardWorker] {
        eligibleExecutionWorkers(
            workers: workers,
            provider: preferences.provider,
            policy: policy
        )
    }

    private func clearIncompatibleWorker() {
        guard let workerID,
              !compatibleWorkers.contains(where: {
                  $0.id == workerID && $0.readiness == "available"
              })
        else { return }
        self.workerID = nil
    }
}

/// Explicit execution confirmation used by channel and issue conversations.
/// Opening this sheet never dispatches; only its confirmation action sends the
/// user-selected settings to the proposal-specific approval endpoint. Channel
/// create-and-execute proposals use the same sheet as their single boundary.
struct ExecutionProposalApprovalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var preferences: IssueExecutionPreferences
    @State private var workerID: String?
    @State private var submitting = false
    @State private var completed = false
    @State private var errorMessage: String?
    @State private var presentationRevision = 0

    let targetTitle: String
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    let policy: ProjectExecutionWorkerPolicy?
    let locale: CompanionLocale
    let delegationNotice: String?
    let createsIssue: Bool
    let approve: @MainActor (AcceptIssueExecutionProposalRequest) async throws -> Bool

    init(
        targetTitle: String,
        providers: [AgentProvider],
        workers: [DashboardWorker],
        policy: ProjectExecutionWorkerPolicy? = nil,
        locale: CompanionLocale,
        delegationNotice: String? = nil,
        createsIssue: Bool = false,
        initialRequest: AcceptIssueExecutionProposalRequest? = nil,
        approve: @escaping @MainActor (AcceptIssueExecutionProposalRequest) async throws -> Bool
    ) {
        self.targetTitle = targetTitle
        let availableProviders = AgentProvider.stableMenuOrder(providers)
        let executableProviders = availableProviders.filter { provider in
            !eligibleExecutionWorkers(
                workers: workers,
                provider: provider,
                policy: policy
            ).isEmpty
        }
        let presentedProviders = executableProviders.isEmpty
            ? availableProviders
            : executableProviders
        self.providers = presentedProviders
        self.workers = workers
        self.policy = policy
        self.locale = locale
        self.delegationNotice = delegationNotice
        self.createsIssue = createsIssue
        self.approve = approve
        let initialProvider = initialRequest.map(\.provider).flatMap { provider in
            presentedProviders.contains(provider) ? provider : nil
        } ?? presentedProviders.first
        _preferences = State(initialValue: IssueExecutionPreferences(
            provider: initialProvider,
            model: initialRequest?.model,
            effort: initialRequest?.effort
        ))
        let preferredWorkerID = initialRequest?.workerId ?? policy?.defaultWorkerId
        _workerID = State(initialValue: preferredWorkerID.flatMap { workerID in
            eligibleExecutionWorkers(
                workers: workers,
                provider: initialProvider,
                policy: policy
            ).contains(where: {
                $0.id == workerID && $0.readiness == "available"
            }) ? workerID : nil
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(
                    L10n.text(
                        createsIssue ? "이슈 생성·실행 승인" : "실행 승인",
                        locale: locale
                    )
                ) {
                    Text(targetTitle)
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        L10n.text(
                            createsIssue
                                ? "이슈 내용과 실행 설정을 함께 확인합니다. 이 버튼을 한 번 승인하면 이슈를 만들고 실행을 예약합니다."
                                : "승인 시 선택한 설정으로 이슈 실행이 시작됩니다. 이슈 생성 승인과는 별개의 작업입니다.",
                            locale: locale
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let delegationNotice {
                        Label(delegationNotice, systemImage: "arrow.triangle.branch")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("execution-approval-delegation")
                    }
                }

                ExecutionConfigurationFields(
                    preferences: $preferences,
                    workerID: $workerID,
                    providers: providers,
                    workers: workers,
                    policy: policy,
                    capabilities: AgentProviderCapabilityCatalog(workers: workers),
                    locale: locale
                )

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle(
                L10n.text(
                    createsIssue ? "이슈 생성·실행 승인" : "실행 승인",
                    locale: locale
                )
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("취소", locale: locale)) { dismiss() }
                        .disabled(submitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: {
                        if completed {
                            Image(systemName: "checkmark")
                                .bold()
                        } else if submitting {
                            ProgressView()
                        } else {
                            Text(
                                L10n.text(
                                    createsIssue
                                        ? "승인하고 이슈 생성·실행"
                                        : "승인하고 실행",
                                    locale: locale
                                )
                            )
                        }
                    }
                    .disabled(
                        submitting || completed ||
                            !canSubmit
                    )
                    .accessibilityIdentifier("execution-proposal-approve")
                }
            }
        }
        .interactiveDismissDisabled(submitting)
        .onDisappear { presentationRevision &+= 1 }
    }

    @MainActor
    private func submit() async {
        guard !submitting, !completed else { return }
        let request: AcceptIssueExecutionProposalRequest
        do {
            request = try AcceptIssueExecutionProposalRequest(
                preferences: preferences,
                workerID: workerID
            )
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        let expectedRevision = presentationRevision
        submitting = true
        errorMessage = nil
        do {
            let accepted = try await approve(request)
            guard expectedRevision == presentationRevision else { return }
            guard accepted else {
                submitting = false
                return
            }
            completed = true
            submitting = false
            try? await Task.sleep(for: .milliseconds(350))
            guard expectedRevision == presentationRevision else { return }
            dismiss()
        } catch {
            guard expectedRevision == presentationRevision else { return }
            submitting = false
            errorMessage = error.localizedDescription
        }
    }

    private var canSubmit: Bool {
        guard preferences.isValidForConversationApproval else { return false }
        let eligible = eligibleExecutionWorkers(
            workers: workers,
            provider: preferences.provider,
            policy: policy
        )
        guard !eligible.isEmpty else { return false }
        return workerID.map { selected in
            eligible.contains(where: {
                $0.id == selected && $0.readiness == "available"
            })
        } ?? true
    }
}

/// Separate approval for an Agent-authored saved-Skill execution. Runtime
/// fields are immutable evidence; the only user choice is one exact Worker.
struct AgentSkillExecutionApprovalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var workerID: String?
    @State private var submitting = false
    @State private var completed = false
    @State private var errorMessage: String?
    @State private var presentationRevision = 0

    let proposal: AgentSkillExecutionProposal
    let workers: [DashboardWorker]
    let policy: ProjectExecutionWorkerPolicy?
    let locale: CompanionLocale
    let approve: @MainActor (
        AcceptAgentSkillExecutionProposalRequest
    ) async throws -> Bool

    private var eligibleWorkers: [DashboardWorker] {
        eligibleExecutionWorkers(
            workers: workers,
            provider: proposal.provider,
            policy: policy
        )
        .filter { $0.readiness == "available" }
        .sorted {
            $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }

    private var runtimeLabel: String {
        [
            proposal.provider.displayName,
            proposal.model,
            proposal.effort?.rawValue,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    private var conversationExecution: Bool {
        proposal.executionMode == .conversation
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.text("Skill 실행 승인", locale: locale)) {
                    LabeledContent("Agent", value: proposal.agentName)
                    LabeledContent(L10n.text("Skill", locale: locale), value: proposal.skillName)
                    LabeledContent(L10n.text("런타임", locale: locale), value: runtimeLabel)
                    LabeledContent(
                        L10n.text("실행 위치", locale: locale),
                        value: conversationExecution
                            ? L10n.text("이 대화에서 계속", locale: locale)
                            : L10n.text("독립 Agent 세션", locale: locale)
                    )
                    Text(
                        L10n.text(
                            "Agent, Skill, 요청과 런타임은 제안 시점의 읽기 전용 값입니다.",
                            locale: locale
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("skill-execution-immutable-notice")
                }

                Section(L10n.text("요청", locale: locale)) {
                    Text(proposal.request)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("skill-execution-request")
                }

                if let delegatedBy = proposal.delegatedByAgentName {
                    Section(L10n.text("위임", locale: locale)) {
                        Label(
                            L10n.format(
                                "%@ Agent가 Project Agent에게 위임했습니다.",
                                locale: locale,
                                delegatedBy
                            ),
                            systemImage: "arrow.triangle.branch"
                        )
                    }
                }

                if !conversationExecution {
                    Section("Worker") {
                    Picker(
                        L10n.text("실행 Worker", locale: locale),
                        selection: $workerID
                    ) {
                        Text(L10n.text("Worker 선택", locale: locale))
                            .tag(String?.none)
                        ForEach(eligibleWorkers) { worker in
                            Text("\(worker.label) · \(worker.readiness)")
                                .tag(String?.some(worker.id))
                        }
                    }
                    .accessibilityIdentifier("skill-execution-worker")
                    Text(
                        L10n.text(
                            "자동 선택 없이 정확한 Worker를 선택해야 실행할 수 있습니다.",
                            locale: locale
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("skill-execution-error")
                }
            }
            .navigationTitle(L10n.text("Skill 실행 승인", locale: locale))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("취소", locale: locale)) { dismiss() }
                        .disabled(submitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: {
                        if completed {
                            Image(systemName: "checkmark").bold()
                        } else if submitting {
                            ProgressView()
                        } else {
                            Text(L10n.text("승인하고 실행", locale: locale))
                        }
                    }
                    .disabled(submitting || completed || !canSubmit)
                    .accessibilityIdentifier("skill-execution-approve")
                }
            }
        }
        .interactiveDismissDisabled(submitting)
        .onDisappear { presentationRevision &+= 1 }
    }

    private var canSubmit: Bool {
        if conversationExecution { return true }
        guard let workerID else { return false }
        return eligibleWorkers.contains(where: { $0.id == workerID })
    }

    @MainActor
    private func submit() async {
        guard !submitting, !completed, canSubmit else { return }
        let expectedRevision = presentationRevision
        submitting = true
        errorMessage = nil
        do {
            let accepted = try await approve(
                AcceptAgentSkillExecutionProposalRequest(
                    workerId: conversationExecution ? nil : workerID
                )
            )
            guard expectedRevision == presentationRevision else { return }
            guard accepted else {
                submitting = false
                return
            }
            completed = true
            submitting = false
            try? await Task.sleep(for: .milliseconds(350))
            guard expectedRevision == presentationRevision else { return }
            dismiss()
        } catch {
            guard expectedRevision == presentationRevision else { return }
            submitting = false
            errorMessage = error.localizedDescription
        }
    }
}

struct DispatchIssueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var preferences: IssueExecutionPreferences
    @State private var workerID: String?
    @State private var errorMessage: String?
    @State private var didDispatchSuccessfully = false

    let runID: UUID
    let reassign: Bool
    let providers: [AgentProvider]
    let workers: [DashboardWorker]
    @ObservedObject var mutations: IssueMutationStore
    let refresh: () async -> Void

    init(
        run: DashboardRun,
        reassign: Bool,
        providers: [AgentProvider],
        workers: [DashboardWorker],
        mutations: IssueMutationStore,
        refresh: @escaping () async -> Void
    ) {
        runID = run.id
        self.reassign = reassign
        let availableProviders = AgentProvider.stableMenuOrder(
            providers.isEmpty ? AgentProvider.allCases : providers
        )
        self.providers = availableProviders
        self.workers = workers
        self.mutations = mutations
        self.refresh = refresh
        let provider = run.preferredProvider ?? run.requestedProvider ?? availableProviders.first ?? .codex
        let usesPreferredSettings = run.preferredProvider != nil
        _preferences = State(initialValue: IssueExecutionPreferences(
            provider: provider,
            model: usesPreferredSettings ? run.preferredModel : run.requestedModel,
            effort: usesPreferredSettings ? run.preferredEffort : run.requestedEffort
        ))
        _workerID = State(initialValue: run.requestedWorkerId)
    }

    var body: some View {
        NavigationStack {
            Form {
                ExecutionConfigurationFields(
                    preferences: $preferences,
                    workerID: $workerID,
                    providers: providers,
                    workers: workers,
                    policy: nil,
                    capabilities: AgentProviderCapabilityCatalog(workers: workers),
                    locale: .current
                )
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle(L10n.text(reassign ? "다시 배정" : "바로 처리"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.text("취소")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await dispatch() } } label: {
                        if didDispatchSuccessfully {
                            Image(systemName: "checkmark")
                                .bold()
                        } else if mutations.isActive("dispatch-\(runID)") {
                            ProgressView()
                        } else {
                            Text(L10n.text(reassign ? "재할당" : "실행"))
                        }
                    }
                        .disabled(
                            mutations.isActive("dispatch-\(runID)") ||
                                didDispatchSuccessfully ||
                                !preferences.isValid
                        )
                        .accessibilityLabel(
                            didDispatchSuccessfully
                                ? L10n.text("실행 완료")
                                : (mutations.isActive("dispatch-\(runID)")
                                    ? L10n.text("실행 중")
                                    : L10n.text(reassign ? "재할당" : "실행"))
                        )
                        .accessibilityIdentifier("dispatch-issue-submit")
                }
            }
        }
    }

    private func dispatch() async {
        do {
            try await mutations.dispatch(
                runID: runID,
                preferences: preferences,
                workerID: workerID,
                reassign: reassign
            )
            didDispatchSuccessfully = true
            await refresh()
            try? await Task.sleep(for: .milliseconds(400))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
