import SwiftUI
import UniformTypeIdentifiers

struct CreateIssueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueDraft
    @State private var attachments: [PendingIssueAttachment] = []
    @State private var showingImporter = false
    @State private var errorMessage: String?

    @ObservedObject var mutations: IssueMutationStore
    let persistence: IssueDraftPersistence
    let refresh: () async -> Void

    init(
        mutations: IssueMutationStore,
        persistence: IssueDraftPersistence = IssueDraftPersistence(),
        refresh: @escaping () async -> Void
    ) {
        self.mutations = mutations
        self.persistence = persistence
        self.refresh = refresh
        _draft = State(initialValue: persistence.load())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("이슈") {
                    TextField("제목", text: $draft.title)
                        .accessibilityIdentifier("create-issue-title")
                    TextField("설명", text: $draft.description, axis: .vertical)
                        .lineLimit(4...10)
                        .accessibilityIdentifier("create-issue-description")
                }
                Section("속성") {
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
                Section {
                    ForEach(attachments) { attachment in
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
                            Button(role: .destructive) {
                                attachments.removeAll { $0.id == attachment.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Button {
                        showingImporter = true
                    } label: {
                        Label("이미지·영상 선택", systemImage: "paperclip")
                    }
                    .disabled(attachments.count >= PendingIssueAttachment.maximumCount)
                    .accessibilityIdentifier("create-issue-attachment")
                } header: {
                    Text("첨부 \(attachments.count)/5")
                } footer: {
                    Text("파일당 20MB, 전체 25MB까지 첨부할 수 있습니다.")
                }
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("새 이슈")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        persistence.save(draft)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("등록") { Task { await submit() } }
                        .disabled(
                            draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                mutations.isActive("create")
                        )
                        .accessibilityIdentifier("create-issue-submit")
                }
            }
            .interactiveDismissDisabled(!draft.isEmpty || !attachments.isEmpty)
            .onChange(of: draft) { _, value in persistence.save(value) }
            .fileImporter(
                isPresented: $showingImporter,
                allowedContentTypes: [.image, .movie],
                allowsMultipleSelection: true,
                onCompletion: importFiles
            )
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            var loaded = attachments
            for url in urls.prefix(PendingIssueAttachment.maximumCount - loaded.count) {
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                let contentType = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType)?
                    .preferredMIMEType ?? "application/octet-stream"
                loaded.append(PendingIssueAttachment(
                    filename: url.lastPathComponent,
                    contentType: contentType,
                    data: data
                ))
            }
            if let message = PendingIssueAttachment.validationMessage(for: loaded) {
                errorMessage = message
            } else {
                attachments = loaded
                errorMessage = nil
            }
        } catch {
            errorMessage = "첨부 파일을 읽지 못했습니다."
        }
    }

    private func submit() async {
        do {
            _ = try await mutations.createIssue(draft: draft, attachments: attachments)
            persistence.clear()
            await refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct EditIssueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueDraft
    @State private var errorMessage: String?

    let runID: UUID
    @ObservedObject var mutations: IssueMutationStore
    let refresh: () async -> Void

    init(run: DashboardRun, mutations: IssueMutationStore, refresh: @escaping () async -> Void) {
        runID = run.id
        self.mutations = mutations
        self.refresh = refresh
        _draft = State(initialValue: IssueDraft(
            title: run.title,
            description: run.issueDescription ?? "",
            priority: run.priority,
            status: run.status
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("제목", text: $draft.title)
                    .accessibilityIdentifier("edit-issue-title")
                TextField("설명", text: $draft.description, axis: .vertical)
                    .lineLimit(5...12)
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
                    Button(reassign ? "재할당" : "실행") { Task { await dispatch() } }
                        .disabled(
                            mutations.isActive("dispatch-\(runID)") || !preferences.isValid
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
            await refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
