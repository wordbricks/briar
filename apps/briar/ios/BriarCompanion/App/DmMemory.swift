import BriarContracts
import Foundation
import SwiftUI
import SwiftProtobuf

typealias DmMemorySpace = BriarAPI_DmMemorySpace
typealias DmMemoryDocument = BriarAPI_DmMemoryDocument
typealias DmMemoryPage = BriarAPI_ListDmMemoriesResponse

private func dmMemoryTimestamp(_ value: Google_Protobuf_Timestamp) -> String {
    value.date.ISO8601Format()
}

private extension BriarAPI_DmMemoryClass {
    var label: String {
        switch self {
        case .profile: "profile"
        case .log: "log"
        case .note: "note"
        case .unspecified, .UNRECOGNIZED: "unknown"
        }
    }
}

private extension BriarAPI_DmMemorySourceType {
    var label: String {
        switch self {
        case .message: "message"
        case .userEditEvent: "user_edit_event"
        case .unspecified, .UNRECOGNIZED: "unknown"
        }
    }
}

struct DmMemoryWrite: Sendable, Equatable {
    var requestId = UUID().uuidString.lowercased()
    var memorySpaceId: String?
    var expectedVersion: UInt32?
    var title: String
    var body: String
    var memoryClass: BriarAPI_DmMemoryClass
    var sourceLanguage: String
    var observedAt: String?
    var validUntil: String?
}

@MainActor
final class DmMemoryStore: ObservableObject, Identifiable {
    let id = UUID()
    @Published private(set) var page: DmMemoryPage?
    @Published private(set) var busy = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var exportedFile: URL?
    private let service: any BriarAPI_DmMemoryServiceClientInterface
    private let downloadClient: any AuthenticatedDownloadClientProtocol
    private let token: String
    private let organizationID: String
    private let channelID: String
    private let scopeIsCurrent: @MainActor () -> Bool

    init(
        service: any BriarAPI_DmMemoryServiceClientInterface,
        downloadClient: any AuthenticatedDownloadClientProtocol,
        token: String,
        organizationID: UUID,
        channelID: UUID,
        scopeIsCurrent: @escaping @MainActor () -> Bool
    ) {
        self.service = service
        self.downloadClient = downloadClient
        self.token = token
        self.organizationID = organizationID.uuidString.lowercased()
        self.channelID = channelID.uuidString.lowercased()
        self.scopeIsCurrent = scopeIsCurrent
    }
    var space: DmMemorySpace? { page?.spaces.first { $0.id == page?.selectedSpaceID } }
    var writable: Bool { page?.eligible == true && (space == nil || space?.status == .active) }
    private func requireScope() throws {
        guard scopeIsCurrent() else { throw MobileAPIError.invalidRequest }
    }
    private func fetchPage(spaceID: String?, cursor: String? = nil) async throws -> DmMemoryPage {
        try requireScope()
        var request = BriarAPI_ListDmMemoriesRequest()
        request.organizationID = organizationID
        request.channelID = channelID
        if let spaceID { request.memorySpaceID = spaceID }
        if let cursor { request.cursor = cursor }
        let result = try await service.listDmMemories(request: request, headers: [:]).briarValue()
        try requireScope()
        return result
    }
    func load(spaceID: String? = nil, more: Bool = false) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            var result = try await fetchPage(
                spaceID: spaceID ?? page?.selectedSpaceID,
                cursor: more ? page?.nextCursor : nil
            )
            if more { result.documents = (page?.documents ?? []) + result.documents }
            page = result
        } catch { errorMessage = error.localizedDescription }
    }
    func document(_ id: String) async throws -> DmMemoryDocument {
        try requireScope()
        var request = BriarAPI_GetDmMemoryDocumentRequest()
        request.organizationID = organizationID
        request.channelID = channelID
        request.documentID = id
        let result = try await service.getDmMemoryDocument(request: request, headers: [:]).briarValue()
        try requireScope()
        guard result.hasDocument else { throw MobileAPIError.invalidResponse }
        return result.document
    }

    private func timestamp(_ value: String?) throws -> Google_Protobuf_Timestamp? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        guard let date else { throw MobileAPIError.invalidRequest }
        return Google_Protobuf_Timestamp(date: date)
    }

    func save(_ input: DmMemoryWrite, documentID: String?) async -> Bool {
        guard !busy else { return false }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            if let documentID {
                guard let expectedVersion = input.expectedVersion else {
                    throw MobileAPIError.invalidRequest
                }
                var request = BriarAPI_UpdateDmMemoryDocumentRequest()
                request.organizationID = organizationID
                request.channelID = channelID
                request.documentID = documentID
                request.requestID = input.requestId
                if let memorySpaceID = input.memorySpaceId { request.memorySpaceID = memorySpaceID }
                request.expectedVersion = expectedVersion
                request.title = input.title
                request.body = input.body
                request.memoryClass = input.memoryClass
                request.sourceLanguage = input.sourceLanguage
                if let observedAt = try timestamp(input.observedAt) { request.observedAt = observedAt }
                if let validUntil = try timestamp(input.validUntil) { request.validUntil = validUntil }
                _ = try await service.updateDmMemoryDocument(request: request, headers: [:]).briarValue()
            } else {
                var request = BriarAPI_CreateDmMemoryDocumentRequest()
                request.organizationID = organizationID
                request.channelID = channelID
                request.requestID = input.requestId
                if let memorySpaceID = input.memorySpaceId { request.memorySpaceID = memorySpaceID }
                request.title = input.title
                request.body = input.body
                request.memoryClass = input.memoryClass
                request.sourceLanguage = input.sourceLanguage
                if let observedAt = try timestamp(input.observedAt) { request.observedAt = observedAt }
                if let validUntil = try timestamp(input.validUntil) { request.validUntil = validUntil }
                _ = try await service.createDmMemoryDocument(request: request, headers: [:]).briarValue()
            }
            page = try await fetchPage(spaceID: page?.selectedSpaceID)
            return true
        } catch { errorMessage = error.localizedDescription; return false }
    }
    func setUse(_ enabled: Bool, newSpace: Bool = false) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            var request = BriarAPI_UpdateDmMemorySettingsRequest()
            request.organizationID = organizationID
            request.channelID = channelID
            request.requestID = UUID().uuidString.lowercased()
            if !newSpace, let space { request.memorySpaceID = space.id }
            request.expectedMemoryRevision = newSpace ? 0 : space?.memoryRevision ?? 0
            request.useEnabled = enabled
            request.autoEnabled = false
            let result = try await service.updateDmMemorySettings(request: request, headers: [:]).briarValue()
            guard result.hasSpace else { throw MobileAPIError.invalidResponse }
            page = try await fetchPage(spaceID: result.space.id)
        } catch { errorMessage = error.localizedDescription }
    }
    func forget(_ id: String) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            var request = BriarAPI_DeleteDmMemoryDocumentRequest()
            request.organizationID = organizationID
            request.channelID = channelID
            request.documentID = id
            _ = try await service.deleteDmMemoryDocument(request: request, headers: [:]).briarValue()
            page = try await fetchPage(spaceID: page?.selectedSpaceID)
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
            let path = "/organizations/\(organizationID)/channels/\(channelID)/memory/export?memorySpaceId=\(space.id)"
            let file = try await downloadClient.download(path, token: token, to: destination)
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
    private struct Draft: Identifiable { let id = UUID(); let document: DmMemoryDocument? }
    private func text(_ ko: String, _ en: String) -> String { locale == .ko ? ko : en }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(text("이 DM의 사용자와 Agent만 사용하는 기억입니다. 다른 DM과 자동 공유하지 않습니다.",
                              "Memory belongs to this DM's user and Agent and is not shared with other DMs."))
                    if store.page?.capabilities.recall == false {
                        Text(text("저장·관리는 사용할 수 있습니다. Agent 회상은 아직 연결되지 않았습니다.",
                                  "Storage and management are available. Agent recall is not connected yet."))
                    }
                    if let message = store.errorMessage ?? error { Text(message).foregroundStyle(.red) }
                    if store.busy { ProgressView() }
                }
                if let page = store.page {
                    Section(text("설정", "Settings")) {
                        if page.spaces.count > 1, page.hasSelectedSpaceID {
                            Picker(text("기억 공간", "Memory space"), selection: Binding(
                                get: { page.selectedSpaceID },
                                set: { value in Task { await store.load(spaceID: value) } }
                            )) {
                                ForEach(page.spaces, id: \.id) { space in
                                    Text(spaceLabel(space)).tag(space.id)
                                }
                            }
                        }
                        if store.space?.status == .closed {
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
                        ForEach(page.documents, id: \.id) { document in
                            Button {
                                Task {
                                    do { draft = Draft(document: try await store.document(document.id)) }
                                    catch { self.error = error.localizedDescription }
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(document.title).foregroundStyle(.primary)
                                    Text("\(document.memoryClass.label) · v\(document.version) · \(indexLabel(document.indexState))")
                                        .font(.caption).foregroundStyle(.secondary)
                                    if document.protectedByUser { Text(text("사용자 보호", "User protected")).font(.caption) }
                                    if document.conflicted || document.status != .active {
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
                        if page.hasNextCursor {
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
            .task { await store.load() }
            .sheet(item: $draft) { value in DmMemoryEditor(store: store, document: value.document, locale: locale) }
            .onDisappear { store.clearExport() }
        }
    }

    private func indexLabel(_ value: BriarAPI_DmMemoryIndexState) -> String {
        switch value {
        case .ready: text("검색 가능", "Search ready")
        case .failed: text("색인 실패", "Index failed")
        case .pending: text("색인 대기", "Awaiting index")
        case .unspecified, .UNRECOGNIZED: text("알 수 없음", "Unknown")
        }
    }

    private func spaceLabel(_ space: DmMemorySpace) -> String {
        "\(space.status) · \(dmMemoryTimestamp(space.createdAt).prefix(10))"
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
            title: document?.title ?? "",
            body: document?.hasBody == true ? document?.body ?? "" : "",
            memoryClass: document?.memoryClass ?? .profile,
            sourceLanguage: document?.sourceLanguage ?? "und",
            observedAt: document?.hasObservedAt == true ? dmMemoryTimestamp(document!.observedAt) : nil,
            validUntil: document?.hasValidUntil == true ? dmMemoryTimestamp(document!.validUntil) : nil
        ))
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
                        ForEach([BriarAPI_DmMemoryClass.profile, .log, .note], id: \.rawValue) {
                            Text($0.label)
                        }
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
                        Text(dmMemoryTimestamp(document.updatedAt)).font(.caption)
                        ForEach(Array(document.sources.enumerated()), id: \.offset) { _, source in
                            Text("\(source.type.label):\(source.id)@\(source.version)").font(.caption).textSelection(.enabled)
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
