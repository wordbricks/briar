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
    let persistence: IssueDraftPersistence
    let refresh: () async -> Void

    init(
        mutations: IssueMutationStore,
        members: [OrganizationMember] = [],
        providers: [AgentProvider] = [],
        persistence: IssueDraftPersistence = IssueDraftPersistence(),
        refresh: @escaping () async -> Void
    ) {
        self.mutations = mutations
        self.members = members
        self.providers = providers.isEmpty ? AgentProvider.allCases : providers
        self.persistence = persistence
        self.refresh = refresh
        _draft = State(initialValue: persistence.load())
    }

    var body: some View {
        NavigationStack {
            Form {
                issueSection
                attributesSection
                Section("선호 실행") {
                    PreferredExecutionPicker(
                        provider: $draft.preferredProvider,
                        model: $draft.preferredModel,
                        effort: $draft.preferredEffort,
                        providers: providers
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
                    Button("취소") {
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
                            Text("등록")
                        }
                    }
                    .disabled(
                        draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            mutations.isActive("create") ||
                            didSubmitSuccessfully
                    )
                    .accessibilityLabel(
                        didSubmitSuccessfully ? "등록 완료" : (mutations.isActive("create") ? "등록 중" : "등록")
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
        Section("이슈") {
            TextField("제목", text: $draft.title)
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
                    TextField("설명", text: $draft.description, axis: .vertical)
                        .lineLimit(4...10)
                        .padding(.trailing, 72)
                        .padding(.bottom, 28)
                        .accessibilityIdentifier("create-issue-description")
                    HStack(spacing: 4) {
                        PasteButton(supportedContentTypes: [UTType.image]) { providers in
                            Task { await importPastedImages(providers) }
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("클립보드 이미지 붙여넣기")
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
                        .accessibilityLabel("이미지·영상 첨부")
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
                    Text("첨부 \(attachments.count)/5 · 파일당 20MB, 전체 25MB")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var attributesSection: some View {
        Section("속성") {
            Picker("담당자", selection: $draft.assigneeUserId) {
                Text("미배정").tag(String?.none)
                ForEach(members) { member in
                    Text(member.name).tag(String?.some(member.userId))
                }
            }
            Picker("우선순위", selection: $draft.priority) {
                Text("없음").tag(Int?.none)
                ForEach(1...4, id: \.self) { priority in
                    Text("P\(priority)").tag(Int?.some(priority))
                }
            }
            Picker("등록 위치", selection: $draft.status) {
                Text("실행 대기").tag(DashboardRun.Status.queued)
                Text("백로그").tag(DashboardRun.Status.backlog)
            }
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
            errorMessage = "클립보드에서 붙여넣을 이미지를 읽지 못했습니다."
        } else if let message = PendingIssueAttachment.validationMessage(for: loaded) {
            errorMessage = message
        } else {
            attachments = loaded
            errorMessage = nil
        }
    }

    private func submit() async {
        do {
            _ = try await mutations.createIssue(draft: draft, attachments: attachments)
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

    private var availableModels: [String] {
        provider?.models ?? []
    }

    var body: some View {
        Picker("프로바이더", selection: $provider) {
            Text("기본값").tag(AgentProvider?.none)
            ForEach(providers) { provider in
                Text(provider.displayName)
                    .tag(AgentProvider?.some(provider))
            }
        }
        .accessibilityIdentifier("create-issue-provider")
        Picker("모델", selection: $model) {
            Text("기본값").tag(String?.none)
            ForEach(availableModels, id: \.self) { model in
                Text(model).tag(String?.some(model))
            }
        }
        .disabled(provider == nil)
        .accessibilityIdentifier("create-issue-model")
        Picker("Effort", selection: $effort) {
            Text("기본값").tag(ModelEffort?.none)
            ForEach(provider?.efforts ?? []) { effort in
                Text(effort.rawValue).tag(ModelEffort?.some(effort))
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
            assigneeUserId: run.assigneeUserId,
            status: run.status
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("제목", text: $draft.title)
                    .onChange(of: draft.title) { _, value in
                        let max = IssueTitleLimits.maxLength(for: value)
                        if value.count > max {
                            draft.title = String(value.prefix(max))
                        }
                    }
                    .accessibilityIdentifier("edit-issue-title")
                TextField("설명", text: $draft.description, axis: .vertical)
                    .lineLimit(5...12)
                Picker("담당자", selection: $draft.assigneeUserId) {
                    Text("미배정").tag(String?.none)
                    ForEach(members) { member in
                        Text(member.name).tag(String?.some(member.userId))
                    }
                }
                Picker("우선순위", selection: $draft.priority) {
                    Text("없음").tag(Int?.none)
                    ForEach(1...4, id: \.self) { Text("P\($0)").tag(Int?.some($0)) }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("이슈 수정")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { Task { await save() } }
                        .disabled(mutations.isActive("update-\(runID)"))
                        .accessibilityIdentifier("edit-issue-save")
                }
            }
        }
    }

    private func save() async {
        do {
            _ = try await mutations.updateIssue(runID: runID, draft: draft)
            await refresh()
            dismiss()
        } catch {
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
        self.providers = providers.isEmpty ? AgentProvider.allCases : providers
        self.workers = workers
        self.mutations = mutations
        self.refresh = refresh
        let provider = run.preferredProvider ?? run.requestedProvider ?? providers.first ?? .codex
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
                Section("실행 설정") {
                    Picker("프로바이더", selection: $preferences.provider) {
                        ForEach(providers) { Text($0.displayName).tag(AgentProvider?.some($0)) }
                    }
                    Picker("모델", selection: $preferences.model) {
                        Text("기본값").tag(String?.none)
                        ForEach(preferences.provider?.models ?? [], id: \.self) {
                            Text($0).tag(String?.some($0))
                        }
                    }
                    Picker("Effort", selection: $preferences.effort) {
                        Text("기본값").tag(ModelEffort?.none)
                        ForEach(preferences.provider?.efforts ?? []) {
                            Text($0.rawValue).tag(ModelEffort?.some($0))
                        }
                    }
                    .disabled(preferences.model == nil)
                }
                Section("Worker") {
                    Picker("실행 환경", selection: $workerID) {
                        Text("사용 가능한 Worker 자동 선택").tag(String?.none)
                        ForEach(compatibleWorkers) { worker in
                            Text("\(worker.label) · \(worker.readiness)").tag(String?.some(worker.id))
                        }
                    }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle(reassign ? "다시 배정" : "바로 처리")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await dispatch() } } label: {
                        if didDispatchSuccessfully {
                            Image(systemName: "checkmark")
                                .bold()
                        } else if mutations.isActive("dispatch-\(runID)") {
                            ProgressView()
                        } else {
                            Text(reassign ? "재할당" : "실행")
                        }
                    }
                        .disabled(
                            mutations.isActive("dispatch-\(runID)") ||
                                didDispatchSuccessfully ||
                                !preferences.isValid
                        )
                        .accessibilityLabel(
                            didDispatchSuccessfully
                                ? "실행 완료"
                                : (mutations.isActive("dispatch-\(runID)")
                                    ? "실행 중"
                                    : (reassign ? "재할당" : "실행"))
                        )
                        .accessibilityIdentifier("dispatch-issue-submit")
                }
            }
            .onChange(of: preferences.provider) { oldProvider, provider in
                guard oldProvider != provider else { return }
                preferences.model = nil
                preferences.effort = nil
                if let workerID,
                   !compatibleWorkers.contains(where: { $0.id == workerID }) {
                    self.workerID = nil
                }
            }
            .onChange(of: preferences.model) { _, model in
                if model == nil { preferences.effort = nil }
            }
        }
    }

    private var compatibleWorkers: [DashboardWorker] {
        guard let provider = preferences.provider else { return workers }
        return workers.filter { worker in
            worker.readiness == "available" &&
                (worker.providers ?? worker.agentProvider.map { [$0] } ?? []).contains(provider)
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
