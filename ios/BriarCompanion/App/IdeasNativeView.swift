import SwiftUI

struct IdeasNativeView: View {
    @ObservedObject var store: IdeasStore
    let projectID: UUID?
    let token: String

    var body: some View {
        Group {
            if let idea = store.selected {
                IdeaNativeDetailView(store: store, idea: idea)
            } else {
                ideaList
            }
        }
        .navigationTitle(store.selected == nil ? "아이디어" : "")
        .toolbar {
            if store.selected == nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await store.create() } } label: {
                        Label("새 아이디어", systemImage: "plus")
                    }
                    .disabled(store.working || projectID == nil)
                }
            }
        }
        .task(id: projectID) { store.select(projectID: projectID, token: token) }
    }

    private var ideaList: some View {
        List {
            if let error = store.errorMessage, !error.isEmpty {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            if store.loading && store.ideas.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if store.ideas.isEmpty {
                ContentUnavailableView {
                    Label("아이디어 없음", systemImage: "lightbulb")
                } description: {
                    Text("대화로 첫 아이디어 문서를 만들어보세요.")
                } actions: {
                    Button("새 아이디어") { Task { await store.create() } }
                }
            } else {
                ForEach(store.ideas) { idea in
                    Button { Task { try? await store.load(id: idea.id) } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(idea.title).font(.headline).foregroundStyle(.primary)
                                Spacer()
                                Text(idea.status.displayName).font(.caption.weight(.semibold))
                            }
                            Text(idea.documentMarkdown.isEmpty ? "아직 작성된 문서가 없습니다." : idea.documentMarkdown)
                                .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            Text("\(idea.author.name) · 이슈 \(idea.generatedIssueCount)")
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .refreshable { await store.refresh() }
        .accessibilityIdentifier("ideas-list")
    }
}

private struct IdeaNativeDetailView: View {
    @ObservedObject var store: IdeasStore
    let idea: IdeaDetail
    @State private var pane: Pane = .chat
    @State private var message = ""
    @State private var document = ""
    @State private var planItems: [IdeaPlanItem] = []
    @State private var showPlan = false
    @State private var confirmDelete = false

    enum Pane: String, CaseIterable { case chat = "대화"; case document = "문서" }

    private var isActiveJob: Bool {
        idea.activeJob?.status == .queued || idea.activeJob?.status == .running
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Picker("보기", selection: $pane) {
                ForEach(Pane.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal).padding(.bottom, 8)
            if let error = store.errorMessage, !error.isEmpty {
                Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal)
            }
            if pane == .chat { chatPane } else { documentPane }
        }
        .navigationBarBackButtonHidden()
        .task(id: idea.id) {
            document = idea.documentMarkdown
            planItems = idea.plan?.items ?? []
        }
        .onChange(of: idea.documentMarkdown) { _, value in document = value }
        .onChange(of: idea.plan?.version) { _, version in
            planItems = idea.plan?.items ?? []
            showPlan = version != nil && idea.activeJob == nil
        }
        .sheet(isPresented: $showPlan) {
            planReview
        }
        .confirmationDialog("아이디어를 삭제할까요?", isPresented: $confirmDelete) {
            Button("삭제", role: .destructive) { Task { await store.delete() } }
            Button("취소", role: .cancel) {}
        } message: {
            Text("문서와 대화는 삭제되지만 생성된 이슈는 유지됩니다.")
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack {
                Button { store.close() } label: { Image(systemName: "chevron.left") }
                Text(idea.title).font(.headline).lineLimit(1)
                Spacer()
                Text(idea.status.displayName).font(.caption.weight(.semibold))
                if idea.canEdit {
                    Button(role: .destructive) { confirmDelete = true } label: {
                        Image(systemName: "trash")
                    }
                }
            }
            if idea.canEdit {
                HStack {
                    Picker("Provider", selection: Binding(
                        get: { idea.provider },
                        set: { provider in Task { await store.update(provider: provider) } }
                    )) {
                        ForEach(IdeaProvider.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.menu)
                    Picker("Model", selection: Binding(
                        get: { idea.model ?? "" },
                        set: { model in Task { await store.updateModel(model.isEmpty ? nil : model) } }
                    )) {
                        ForEach(idea.provider.models, id: \.value) { model in
                            Text(model.label).tag(model.value)
                        }
                    }
                    .pickerStyle(.menu)
                    Spacer()
                    if idea.status != .ready && idea.status != .archived {
                        Button("준비 완료") { Task { await store.update(status: .ready) } }
                            .disabled(idea.documentMarkdown.isEmpty || store.working)
                    } else if idea.status == .ready {
                        Button("이슈 계획") { Task { await store.generatePlan() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.working)
                    } else if idea.status == .issuesCreated {
                        Button("보관") { Task { await store.update(status: .archived) } }
                            .disabled(store.working)
                    }
                }
            } else {
                Text("읽기 전용").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding()
    }

    private var chatPane: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if idea.messages.isEmpty {
                        ContentUnavailableView("대화를 시작하세요", systemImage: "sparkles")
                    }
                    ForEach(idea.messages) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.role == .user ? idea.author.name : idea.provider.rawValue)
                                .font(.caption2).foregroundStyle(.secondary)
                            Text(attributed(item.body))
                                .padding(item.role == .user ? 10 : 0)
                                .background(item.role == .user ? Color.secondary.opacity(0.12) : .clear)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .frame(maxWidth: .infinity, alignment: item.role == .user ? .trailing : .leading)
                    }
                    if isActiveJob { ProgressView("에이전트가 작성 중…") }
                    if let job = idea.activeJob, job.status == .failed {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(job.error ?? "에이전트 작업에 실패했습니다.", systemImage: "exclamationmark.triangle")
                                .font(.footnote).foregroundStyle(.red)
                            if idea.canEdit {
                                Button("다시 시도") { Task { await store.retryFailedJob() } }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
                .padding()
            }
            if idea.canEdit && idea.status != .archived {
                HStack(alignment: .bottom) {
                    TextField("아이디어를 설명해주세요…", text: $message, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...5)
                    Button { send() } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isActiveJob)
                }
                .padding()
            }
        }
    }

    private var documentPane: some View {
        VStack(spacing: 0) {
            if idea.canEdit && idea.status != .archived {
                TextEditor(text: $document)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .task(id: document) {
                        guard document != idea.documentMarkdown, !isActiveJob else { return }
                        try? await Task.sleep(for: .milliseconds(700))
                        guard !Task.isCancelled else { return }
                        await store.update(document: document)
                    }
            } else {
                ScrollView { Text(attributed(document)).frame(maxWidth: .infinity, alignment: .leading).padding() }
            }
        }
    }

    private var planReview: some View {
        NavigationStack {
            Form {
                ForEach($planItems) { $item in
                    Section(item.key) {
                        TextField("제목", text: $item.title)
                        TextField("설명", text: $item.description, axis: .vertical).lineLimit(3...8)
                        Picker("우선순위", selection: $item.priority) {
                            Text("기본").tag(Int?.none)
                            ForEach(1...4, id: \.self) { Text("\($0)").tag(Int?.some($0)) }
                        }
                        Picker("Provider", selection: $item.provider) {
                            Text("아이디어 기본값").tag(IdeaProvider?.none)
                            ForEach(IdeaProvider.allCases, id: \.self) { provider in
                                Text(provider.rawValue).tag(IdeaProvider?.some(provider))
                            }
                        }
                        TextField("모델 (선택)", text: Binding(
                            get: { item.model ?? "" },
                            set: { item.model = $0.isEmpty ? nil : $0 }
                        ))
                        if !dependencyCandidates(for: item.key).isEmpty {
                            DisclosureGroup("선행 이슈") {
                                ForEach(dependencyCandidates(for: item.key)) { candidate in
                                    Toggle(candidate.title, isOn: Binding(
                                        get: { item.prerequisiteKeys.contains(candidate.key) },
                                        set: { enabled in
                                            if enabled {
                                                if !item.prerequisiteKeys.contains(candidate.key) {
                                                    item.prerequisiteKeys.append(candidate.key)
                                                }
                                            } else {
                                                item.prerequisiteKeys.removeAll { $0 == candidate.key }
                                            }
                                        }
                                    ))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("이슈 계획 \(planItems.count)/5")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { showPlan = false }
                }
                ToolbarItemGroup(placement: .confirmationAction) {
                    Button("저장") { Task { await store.savePlan(planItems) } }
                    Button("이슈로 만들기") { Task {
                        _ = await store.convert()
                        showPlan = false
                    } }
                        .disabled(store.working)
                }
            }
        }
    }

    private func send() {
        let body = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        message = ""
        Task { await store.send(body) }
    }

    private func dependencyCandidates(for key: String) -> [IdeaPlanItem] {
        planItems.filter { $0.key != key }
    }

    private func attributed(_ markdown: String) -> AttributedString {
        (try? AttributedString(markdown: markdown)) ?? AttributedString(markdown)
    }
}
