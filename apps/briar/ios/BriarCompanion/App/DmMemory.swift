import Foundation
import SwiftUI

struct DmMemorySpace: Decodable, Identifiable, Sendable {
    let id: String
    let channelId: String
    let agentId: String
    let rosterEpoch: Int
    let status: String
    let useEnabled: Bool
    let autoEnabled: Bool
    let memoryRevision: Int
    let revocationEpoch: Int
    let createdAt: String
    let updatedAt: String
}

struct DmMemorySource: Decodable, Sendable {
    let type: String
    let id: String
    let version: Int
}

struct DmMemoryDocument: Decodable, Identifiable, Sendable {
    let id: String
    let memorySpaceId: String
    let kind: String
    let title: String
    let version: Int
    let status: String
    let conflicted: Bool
    let memoryClass: String
    let evidenceType: String
    let protectedByUser: Bool
    let sourceLanguage: String
    let observedAt: String?
    let validUntil: String?
    let createdAt: String
    let updatedAt: String
    let indexState: String
    let body: String?
    let sources: [DmMemorySource]?
}

struct DmMemoryPage: Decodable, Sendable {
    struct Capabilities: Decodable, Sendable {
        let recall: Bool
        let automaticLearning: Bool
    }
    let eligible: Bool
    let capabilities: Capabilities
    let spaces: [DmMemorySpace]
    let selectedSpaceId: String?
    var documents: [DmMemoryDocument]
    var nextCursor: String?
}

struct DmMemoryRevisionPage: Decodable, Sendable {
    struct Revision: Decodable, Identifiable, Sendable {
        var id: Int { version }
        let version: Int
        let createdAt: String
        let memoryClass: String
        let protectedByUser: Bool
        let validUntil: String?
        let origin: String
    }
    let documentId: String
    let currentVersion: Int
    var revisions: [Revision]
    let nextCursor: Int?
}

struct DmMemoryWrite: Encodable, Sendable, Equatable {
    var requestId = UUID().uuidString.lowercased()
    var memorySpaceId: String?
    var expectedVersion: Int?
    var title: String
    var body: String
    var memoryClass: String
    var sourceLanguage: String
    var observedAt: String?
    var validUntil: String?

    // These nullable fields are required by the shared contract; synthesized
    // Encodable would omit them instead of encoding JSON null.
    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(requestId, forKey: .requestId)
        try container.encodeIfPresent(memorySpaceId, forKey: .memorySpaceId)
        try container.encodeIfPresent(expectedVersion, forKey: .expectedVersion)
        try container.encode(title, forKey: .title)
        try container.encode(body, forKey: .body)
        try container.encode(memoryClass, forKey: .memoryClass)
        try container.encode(sourceLanguage, forKey: .sourceLanguage)
        try container.encode(observedAt, forKey: .observedAt)
        try container.encode(validUntil, forKey: .validUntil)
    }
    private enum CodingKeys: String, CodingKey {
        case requestId, memorySpaceId, expectedVersion, title, body, memoryClass
        case sourceLanguage, observedAt, validUntil
    }
}

@MainActor
final class DmMemoryStore: ObservableObject, Identifiable {
    let id = UUID()
    @Published private(set) var page: DmMemoryPage?
    @Published private(set) var busy = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var exportedFile: URL?
    private let api: any MobileAPIClientProtocol
    private let token: String
    private let path: String
    private let scopeIsCurrent: @MainActor () -> Bool

    init(api: any MobileAPIClientProtocol, token: String, organizationID: UUID,
         channelID: UUID, scopeIsCurrent: @escaping @MainActor () -> Bool) {
        self.api = api
        self.token = token
        self.path = MobileAPIContract.Endpoint.dmMemory(organizationID: organizationID, channelID: channelID)
        self.scopeIsCurrent = scopeIsCurrent
    }
    var space: DmMemorySpace? { page?.spaces.first { $0.id == page?.selectedSpaceId } }
    var writable: Bool { page?.eligible == true && (space == nil || space?.status == "active") }
    private func requireScope() throws {
        guard scopeIsCurrent() else { throw MobileAPIError.invalidRequest }
    }
    private func query(spaceID: String?, cursor: String? = nil) -> String {
        var items: [URLQueryItem] = []
        if let spaceID { items.append(URLQueryItem(name: "memorySpaceId", value: spaceID)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        var parts = URLComponents()
        parts.queryItems = items
        return parts.percentEncodedQuery.map { "?" + $0 } ?? ""
    }
    private func fetchPage(spaceID: String?, cursor: String? = nil) async throws -> DmMemoryPage {
        try requireScope()
        let result = try await api.send(path + query(spaceID: spaceID, cursor: cursor), method: "GET",
                                        token: token, body: nil, as: DmMemoryPage.self)
        try requireScope()
        return result
    }
    func load(spaceID: String? = nil, more: Bool = false) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            var result = try await fetchPage(spaceID: spaceID ?? page?.selectedSpaceId,
                                             cursor: more ? page?.nextCursor : nil)
            if more { result.documents = (page?.documents ?? []) + result.documents }
            page = result
        } catch { errorMessage = error.localizedDescription }
    }
    func document(_ id: String, version: Int? = nil) async throws -> DmMemoryDocument {
        struct Response: Decodable, Sendable { let document: DmMemoryDocument }
        try requireScope()
        let result = try await api.send(path + "/documents/" + id + (version.map { "?version=\($0)" } ?? ""), method: "GET", token: token,
                                        body: nil, as: Response.self)
        try requireScope()
        return result.document
    }
    func history(_ id: String, cursor: Int? = nil) async throws -> DmMemoryRevisionPage {
        try requireScope()
        let result = try await api.send(path + "/documents/" + id + "/revisions" + (cursor.map { "?cursor=\($0)" } ?? ""),
                                        method: "GET", token: token, body: nil, as: DmMemoryRevisionPage.self)
        try requireScope()
        return result
    }
    func refreshStatus() async {
        guard !busy else { return }
        do {
            let selectedSpaceID = page?.selectedSpaceId
            let revision = space?.memoryRevision
            let count = page?.documents.count ?? 0
            var fresh = try await fetchPage(spaceID: selectedSpaceID)
            while let cursor = fresh.nextCursor, fresh.documents.count < count {
                let next = try await fetchPage(spaceID: selectedSpaceID, cursor: cursor)
                fresh.documents += next.documents
                fresh.nextCursor = next.nextCursor
            }
            guard !busy, page?.selectedSpaceId == selectedSpaceID, space?.memoryRevision == revision else { return }
            page = fresh
        } catch { errorMessage = error.localizedDescription }
    }
    func save(_ input: DmMemoryWrite, documentID: String?) async -> Bool {
        guard !busy else { return false }
        busy = true; errorMessage = nil
        defer { busy = false }
        struct Response: Decodable, Sendable { let documentId: String; let version: Int; let replayed: Bool }
        do {
            try requireScope()
            _ = try await api.send(path + "/documents" + (documentID.map { "/" + $0 } ?? ""),
                                   method: documentID == nil ? "POST" : "PATCH", token: token,
                                   body: input, as: Response.self)
            page = try await fetchPage(spaceID: page?.selectedSpaceId)
            return true
        } catch { errorMessage = error.localizedDescription; return false }
    }
    func setUse(_ enabled: Bool, newSpace: Bool = false) async {
        struct Input: Encodable, Sendable {
            let requestId: String; let memorySpaceId: String?; let expectedMemoryRevision: Int
            let useEnabled: Bool; let autoEnabled: Bool
        }
        struct Response: Decodable, Sendable { let space: DmMemorySpace }
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            let result = try await api.send(path + "/settings", method: "PATCH", token: token,
                body: Input(requestId: UUID().uuidString.lowercased(), memorySpaceId: newSpace ? nil : space?.id,
                            expectedMemoryRevision: newSpace ? 0 : space?.memoryRevision ?? 0,
                            useEnabled: enabled, autoEnabled: false), as: Response.self)
            page = try await fetchPage(spaceID: result.space.id)
        } catch { errorMessage = error.localizedDescription }
    }
    func forget(_ id: String) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            try await api.sendVoid(path + "/documents/" + id, method: "DELETE", token: token, body: nil)
            page = try await fetchPage(spaceID: page?.selectedSpaceId)
        } catch { errorMessage = error.localizedDescription }
    }
    func export() async {
        guard !busy, let space else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            clearExport()
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("dm-memory-" + id.uuidString, isDirectory: true)
                .appendingPathComponent("briar-memory-" + space.id + ".zip")
            let file = try await api.download(path + "/export" + query(spaceID: space.id), token: token, to: destination)
            guard scopeIsCurrent() else {
                try? FileManager.default.removeItem(at: file)
                throw MobileAPIError.invalidRequest
            }
            exportedFile = file
        } catch { errorMessage = error.localizedDescription }
    }
    func clearExport() {
        if let exportedFile { try? FileManager.default.removeItem(at: exportedFile.deletingLastPathComponent()) }
        exportedFile = nil
    }
}

struct DmMemoryView: View {
    @ObservedObject var store: DmMemoryStore
    let locale: CompanionLocale
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Draft?
    @State private var error: String?
    @State private var observedNow = Date()
    private struct Draft: Identifiable { let id = UUID(); let document: DmMemoryDocument? }
    private func text(_ ko: String, _ en: String) -> String { locale == .ko ? ko : en }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(text("이 DM의 사용자와 Agent만 사용하는 기억입니다. 다른 DM과 자동 공유하지 않습니다.",
                              "Memory belongs to this DM's user and Agent and is not shared with other DMs."))
                    Text(text("기억에서 삭제해도 원래 대화 메시지는 남습니다. 대화 삭제는 메시지 메뉴에서 별도로 할 수 있습니다.",
                              "Forgetting leaves the original chat message. Delete it separately from its message menu."))
                        .font(.caption)
                    if store.page?.capabilities.recall == false {
                        Text(text("저장·관리는 사용할 수 있습니다. Agent 회상은 현재 비활성화되어 있습니다.",
                                  "Storage and management are available. Agent recall is currently disabled."))
                    }
                    if let message = store.errorMessage ?? error { Text(message).foregroundStyle(.red) }
                    if store.busy { ProgressView() }
                }
                if let page = store.page {
                    Section(text("설정", "Settings")) {
                        if page.spaces.count > 1 {
                            Picker(text("기억 공간", "Memory space"), selection: Binding(
                                get: { page.selectedSpaceId ?? "" },
                                set: { value in Task { await store.load(spaceID: value) } }
                            )) {
                                ForEach(page.spaces) { space in
                                    Text("\(space.status) · \(space.createdAt.prefix(10))").tag(space.id)
                                }
                            }
                        }
                        if store.space?.status == "closed" {
                            Text(text("참여자가 바뀌어 닫힌 공간입니다. 읽기·삭제·내보내기만 가능합니다.",
                                      "This space was closed after a participant change. Read, delete or export only."))
                            if page.eligible {
                                Button(text("현재 참여자로 새 공간 만들기", "Create a space for current participants")) {
                                    Task { await store.setUse(false, newSpace: true) }
                                }
                            }
                        }
                        if store.writable {
                            Toggle(text("이 DM에서 기억 사용", "Use memory in this DM"), isOn: Binding(
                                get: { store.space?.useEnabled ?? false },
                                set: { enabled in Task { await store.setUse(enabled) } }
                            ))
                        }
                        Toggle(text("자동 학습 · 아직 사용할 수 없음", "Automatic learning · not available yet"),
                               isOn: .constant(store.space?.autoEnabled ?? false)).disabled(true)
                    }
                    Section(text("저장된 기억", "Saved memories")) {
                        if page.documents.isEmpty { Text(text("저장된 기억이 없습니다.", "No saved memories.")) }
                        ForEach(page.documents) { document in
                            Button {
                                Task {
                                    do { draft = Draft(document: try await store.document(document.id)) }
                                    catch { self.error = error.localizedDescription }
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(document.title).foregroundStyle(.primary)
                                    Text("\(document.memoryClass) · v\(document.version) · \(indexLabel(document.indexState))")
                                        .font(.caption).foregroundStyle(.secondary)
                                    if let validUntil = document.validUntil {
                                        let expired = memoryDate(validUntil) <= observedNow
                                        Text("\(expired ? text("만료됨", "Expired") : text("유효기간", "Valid until")) · \(validUntil)")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    if document.protectedByUser { Text(text("사용자 보호", "User protected")).font(.caption) }
                                    if document.conflicted || document.status != "active" {
                                        Text(text("충돌 또는 근거 변경 · 확인 필요", "Conflict or changed evidence · needs review"))
                                            .font(.caption).foregroundStyle(.orange)
                                    }
                                }
                            }
                            .accessibilityIdentifier("dm-memory-document-" + document.id)
                            .swipeActions {
                                Button(text("기억에서 삭제", "Forget"), role: .destructive) {
                                    Task { await store.forget(document.id) }
                                }
                            }
                        }
                        if page.nextCursor != nil {
                            Button(text("더 보기", "Load more")) { Task { await store.load(more: true) } }
                        }
                        if store.writable {
                            Button(text("기억 추가", "Add memory"), systemImage: "plus") { draft = Draft(document: nil) }
                        } else if store.space == nil {
                            Text(text("사용자 1명과 Agent 1명이 참여하는 DM에서만 저장할 수 있습니다.",
                                      "Storage requires a DM with one user and one Agent."))
                        }
                    }
                    if store.space != nil {
                        Section {
                            Button(text("Markdown 내보내기", "Export Markdown"), systemImage: "square.and.arrow.up") {
                                Task { await store.export() }
                            }
                            if let file = store.exportedFile { ShareLink(item: file) }
                            Text(text("내보낸 사본은 서버에서 기억을 삭제해도 남습니다. 기억 삭제는 대화 원문을 삭제하지 않습니다.",
                                      "Exported copies remain after server deletion. Forgetting a memory does not delete chat history."))
                                .font(.caption)
                        }
                    }
                }
            }
            .disabled(store.busy)
            .navigationTitle(text("기억", "Memory"))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(text("닫기", "Close")) { dismiss() } }
            }
            .refreshable { await store.load() }
            .task {
                await store.load()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    observedNow = Date()
                    if draft == nil { await store.refreshStatus() }
                }
            }
            .sheet(item: $draft) { value in DmMemoryEditor(store: store, document: value.document, locale: locale) }
            .onDisappear { store.clearExport() }
        }
    }

    private func memoryDate(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value) ?? .distantFuture
    }
    private func indexLabel(_ value: String) -> String {
        switch value {
        case "ready": text("검색 가능", "Search ready")
        case "failed": text("색인 실패", "Index failed")
        default: text("색인 대기", "Awaiting index")
        }
    }
}

private struct DmMemoryEditor: View {
    @ObservedObject var store: DmMemoryStore
    let document: DmMemoryDocument?
    let locale: CompanionLocale
    @Environment(\.dismiss) private var dismiss
    @State private var draft: DmMemoryWrite
    private func text(_ ko: String, _ en: String) -> String { locale == .ko ? ko : en }
    init(store: DmMemoryStore, document: DmMemoryDocument?, locale: CompanionLocale) {
        self.store = store; self.document = document; self.locale = locale
        _draft = State(initialValue: DmMemoryWrite(memorySpaceId: store.space?.id, expectedVersion: document?.version,
            title: document?.title ?? "", body: document?.body ?? "", memoryClass: document?.memoryClass ?? "profile",
            sourceLanguage: document?.sourceLanguage ?? "und", observedAt: document?.observedAt, validUntil: document?.validUntil))
    }
    var body: some View {
        NavigationStack {
            Form {
                if let error = store.errorMessage { Text(error).foregroundStyle(.red) }
                Section {
                    TextField(text("제목", "Title"), text: $draft.title)
                    TextEditor(text: $draft.body).frame(minHeight: 160).accessibilityLabel(text("기억 본문", "Memory text"))
                    Text("\(draft.body.utf8.count) / 65536 bytes").font(.caption)
                    Picker(text("분류", "Category"), selection: $draft.memoryClass) {
                        ForEach(["profile", "log", "note"], id: \.self) { Text($0) }
                    }
                    TextField(text("원본 언어: ko, en, mul, und", "Source language: ko, en, mul, und"), text: $draft.sourceLanguage)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(text("관찰 시각 · ISO 시각", "Observed at · ISO timestamp"), text: Binding(
                        get: { draft.observedAt ?? "" }, set: { draft.observedAt = $0.isEmpty ? nil : $0 }
                    )).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(text("유효기간 종료 · 선택", "Valid until · optional"), text: Binding(
                        get: { draft.validUntil ?? "" }, set: { draft.validUntil = $0.isEmpty ? nil : $0 }
                    )).textInputAutocapitalization(.never).autocorrectionDisabled()
                }.disabled(!store.writable || store.busy)
                if let document {
                    Section(text("근거", "Sources")) {
                        NavigationLink(text("변경 이력", "Revision history")) {
                            DmMemoryHistoryView(store: store, documentID: document.id, locale: locale)
                        }
                        .accessibilityIdentifier("dm-memory-history")
                        Text(document.updatedAt).font(.caption)
                        ForEach(Array((document.sources ?? []).enumerated()), id: \.offset) { _, source in
                            Text("\(source.type):\(source.id)@\(source.version)").font(.caption).textSelection(.enabled)
                        }
                        Button(text("기억에서 삭제", "Forget memory"), role: .destructive) {
                            Task { await store.forget(document.id); if store.errorMessage == nil { dismiss() } }
                        }.disabled(store.busy).accessibilityIdentifier("dm-memory-forget")
                    }
                }
            }
            .onChange(of: draft) { old, new in
                if old.title != new.title || old.body != new.body || old.memoryClass != new.memoryClass ||
                    old.sourceLanguage != new.sourceLanguage || old.observedAt != new.observedAt || old.validUntil != new.validUntil {
                    draft.requestId = UUID().uuidString.lowercased()
                }
            }
            .navigationTitle(text("기억", "Memory"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(text("닫기", "Close")) { dismiss() } }
                if store.writable {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(store.busy ? text("저장 중", "Saving") : text("저장", "Save")) {
                            Task { if await store.save(draft, documentID: document?.id) { dismiss() } }
                        }.disabled(store.busy || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                   draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.body.utf8.count > 65_536)
                        .accessibilityIdentifier("dm-memory-save")
                    }
                }
            }
        }
    }
}


private struct DmMemoryHistoryView: View {
    @ObservedObject var store: DmMemoryStore
    let documentID: String
    let locale: CompanionLocale
    @State private var history: DmMemoryRevisionPage?
    @State private var preview: DmMemoryDocument?
    @State private var error: String?
    @State private var loading = false
    private func text(_ ko: String, _ en: String) -> String { locale == .ko ? ko : en }

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if loading { ProgressView() }
            if let history {
                ForEach(history.revisions) { revision in
                    Button("v\(revision.version) · \(revision.createdAt) · \(revision.origin)") {
                        Task {
                            loading = true
                            defer { loading = false }
                            do { preview = try await store.document(documentID, version: revision.version) }
                            catch { self.error = error.localizedDescription }
                        }
                    }.accessibilityIdentifier("dm-memory-revision-\(revision.version)")
                }
                if let cursor = history.nextCursor {
                    Button(text("더 보기", "Load more")) { Task { await load(cursor: cursor) } }
                }
            }
            if let preview {
                Section(text("이전 버전 · 읽기 전용", "Earlier version · read only")) {
                    Text("v\(preview.version)").font(.caption)
                    Text(preview.body ?? "").textSelection(.enabled)
                        .accessibilityIdentifier("dm-memory-revision-body")
                }
            }
        }
        .disabled(loading)
        .navigationTitle(text("변경 이력", "Revision history"))
        .task { await load() }
    }
    private func load(cursor: Int? = nil) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            var next = try await store.history(documentID, cursor: cursor)
            if cursor != nil { next.revisions = (history?.revisions ?? []) + next.revisions }
            history = next
        } catch { self.error = error.localizedDescription }
    }
}

struct DmMemoryCitationView: View {
    @ObservedObject var store: DmMemoryStore
    let reference: ChannelMemoryCitation
    let locale: CompanionLocale
    @Environment(\.dismiss) private var dismiss
    @State private var document: DmMemoryDocument?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let document {
                        Text(document.title).font(.headline)
                        Text("v\(document.version) · \(document.memoryClass)").font(.caption)
                        Text(document.body ?? (locale == .ko ? "기억을 불러오지 못했습니다." : "Memory is unavailable.")).textSelection(.enabled)
                            .accessibilityIdentifier("dm-memory-citation-body")
                    } else if let error { Text(error).foregroundStyle(.red) }
                    else { ProgressView() }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .navigationTitle(locale == .ko ? "참고한 기억" : "Referenced memory")
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button(locale == .ko ? "닫기" : "Close") { dismiss() }
            } }
        }
        .task(id: reference.id) {
            document = nil; error = nil
            do {
                let loaded = try await store.document(reference.documentId.uuidString.lowercased(), version: reference.version)
                if !Task.isCancelled { document = loaded }
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}
