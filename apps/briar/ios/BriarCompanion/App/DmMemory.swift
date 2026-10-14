import BriarContracts
import Foundation
import SwiftUI
import SwiftProtobuf

typealias DmMemorySpace = BriarAPI_DmMemorySpace
typealias DmMemoryDocument = BriarAPI_DmMemoryDocument
typealias DmMemoryPage = BriarAPI_ListDmMemoriesResponse
typealias DmMemoryRevisionPage = BriarAPI_ListDmMemoryRevisionsResponse

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

private extension BriarAPI_DmMemoryRevisionOrigin {
    var label: String {
        switch self {
        case .userEdit: "user_edit"
        case .explicitRequest: "explicit_request"
        case .extract: "extract"
        case .consolidate: "consolidate"
        case .unspecified, .UNRECOGNIZED: "unknown"
        }
    }
}

/// The owner's memory vault as a folder tree: the layout's folders (sent by
/// the server, so empty ones show too), legacy folders that exist only because
/// a file lives there, and every record file at its vault path. A server before
/// the folder tree sends no folders or paths; its records then sit at the root
/// under their titles, which is the flat list the tree replaces.
indirect enum DmMemoryTreeNode: Identifiable, Equatable {
    case folder(key: String, name: String, children: [DmMemoryTreeNode], fileCount: Int)
    case file(key: String, name: String, document: DmMemoryDocument)

    var id: String {
        switch self {
        case let .folder(key, _, _, _): "folder:" + key
        case let .file(key, _, _): "file:" + key
        }
    }

    var name: String {
        switch self {
        case let .folder(_, name, _, _), let .file(_, name, _): name
        }
    }

    var fileCount: Int {
        switch self {
        case let .folder(_, _, _, count): count
        case .file: 1
        }
    }

    static let rootName = "memory"

    static func tree(folders: [String], documents: [DmMemoryDocument]) -> DmMemoryTreeNode {
        final class Folder {
            let key: String
            let name: String
            var folders: [String: Folder] = [:]
            var files: [DmMemoryTreeNode] = []
            init(key: String, name: String) { self.key = key; self.name = name }
        }
        let root = Folder(key: "", name: rootName)
        func folder(at path: Substring) -> Folder {
            var current = root
            for segment in path.split(separator: "/") {
                let name = String(segment)
                if let next = current.folders[name] { current = next; continue }
                let next = Folder(key: current.key.isEmpty ? name : current.key + "/" + name, name: name)
                current.folders[name] = next
                current = next
            }
            return current
        }
        for path in folders { _ = folder(at: Substring(path)) }
        for document in documents {
            guard document.hasPath else {
                root.files.append(.file(key: "#" + document.id, name: document.title, document: document))
                continue
            }
            let path = document.path
            if let slash = path.lastIndex(of: "/") {
                folder(at: path[..<slash]).files.append(
                    .file(key: path, name: String(path[path.index(after: slash)...]), document: document)
                )
            } else {
                root.files.append(.file(key: path, name: path, document: document))
            }
        }
        func freeze(_ folder: Folder) -> DmMemoryTreeNode {
            let subfolders = folder.folders.values.sorted { $0.name < $1.name }.map(freeze)
            let files = folder.files.sorted { $0.name < $1.name }
            return .folder(
                key: folder.key, name: folder.name, children: subfolders + files,
                fileCount: files.count + subfolders.reduce(0) { $0 + $1.fileCount }
            )
        }
        return freeze(root)
    }
}

extension DmMemoryDocument {
    /// The quiet label beside a file: its real type, a workstream's status and the revision.
    var treeDetails: [String] {
        // A server before the folder tree sends no record type, only the legacy class.
        let type = hasRecordType ? recordType : memoryClass.label
        if readOnly { return [type] }
        return [type] + (hasRecordStatus ? [recordStatus] : []) + ["r\(version)"]
    }
}

struct DmMemoryWrite: Sendable, Equatable {
    var requestId = UUID().uuidString.lowercased()
    var memorySpaceId: String?
    var expectedVersion: UInt32?
    var title: String
    var body: String
    var memoryClass: BriarAPI_DmMemoryClass
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
        request.workspaceID = organizationID
        request.channelID = channelID
        if let spaceID { request.memorySpaceID = spaceID }
        if let cursor { request.cursor = cursor }
        request.wholeVault = true
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
    func document(_ id: String, version: Int? = nil) async throws -> DmMemoryDocument {
        try requireScope()
        var request = BriarAPI_GetDmMemoryDocumentRequest()
        request.workspaceID = organizationID
        request.channelID = channelID
        request.documentID = id
        if let version {
            guard version > 0, let wireVersion = UInt32(exactly: version) else {
                throw MobileAPIError.invalidRequest
            }
            request.version = wireVersion
        }
        let result = try await service.getDmMemoryDocument(request: request, headers: [:]).briarValue()
        try requireScope()
        guard result.hasDocument else { throw MobileAPIError.invalidResponse }
        return result.document
    }

    func history(_ id: String, cursor: UInt32? = nil) async throws -> DmMemoryRevisionPage {
        try requireScope()
        var request = BriarAPI_ListDmMemoryRevisionsRequest()
        request.workspaceID = organizationID
        request.channelID = channelID
        request.documentID = id
        if let cursor { request.cursor = cursor }
        let result = try await service.listDmMemoryRevisions(request: request, headers: [:]).briarValue()
        try requireScope()
        return result
    }

    func refreshStatus() async {
        guard !busy else { return }
        do {
            let selectedSpaceID = page?.selectedSpaceID
            let revision = space?.memoryRevision
            let count = page?.documents.count ?? 0
            var fresh = try await fetchPage(spaceID: selectedSpaceID)
            while fresh.hasNextCursor, fresh.documents.count < count {
                let next = try await fetchPage(
                    spaceID: selectedSpaceID,
                    cursor: fresh.nextCursor
                )
                fresh.documents += next.documents
                if next.hasNextCursor { fresh.nextCursor = next.nextCursor }
                else { fresh.clearNextCursor() }
            }
            guard !busy,
                  page?.selectedSpaceID == selectedSpaceID,
                  space?.memoryRevision == revision else { return }
            page = fresh
        } catch { errorMessage = error.localizedDescription }
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
                request.workspaceID = organizationID
                request.channelID = channelID
                request.documentID = documentID
                request.requestID = input.requestId
                if let memorySpaceID = input.memorySpaceId { request.memorySpaceID = memorySpaceID }
                request.expectedVersion = expectedVersion
                request.title = input.title
                request.body = input.body
                request.memoryClass = input.memoryClass
                _ = try await service.updateDmMemoryDocument(request: request, headers: [:]).briarValue()
            } else {
                var request = BriarAPI_CreateDmMemoryDocumentRequest()
                request.workspaceID = organizationID
                request.channelID = channelID
                request.requestID = input.requestId
                if let memorySpaceID = input.memorySpaceId { request.memorySpaceID = memorySpaceID }
                request.title = input.title
                request.body = input.body
                request.memoryClass = input.memoryClass
                _ = try await service.createDmMemoryDocument(request: request, headers: [:]).briarValue()
            }
            page = try await fetchPage(spaceID: page?.selectedSpaceID)
            return true
        } catch { errorMessage = error.localizedDescription; return false }
    }
    func setUse(_ enabled: Bool, automatic: Bool = false, newSpace: Bool = false) async {
        guard !busy else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            var request = BriarAPI_UpdateDmMemorySettingsRequest()
            request.workspaceID = organizationID
            request.channelID = channelID
            request.requestID = UUID().uuidString.lowercased()
            if !newSpace, let space { request.memorySpaceID = space.id }
            request.expectedMemoryRevision = newSpace ? 0 : space?.memoryRevision ?? 0
            request.useEnabled = enabled
            request.autoEnabled = automatic
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
            request.workspaceID = organizationID
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
    /// Folders the user opened or closed; the rest follow whether they hold files.
    @State private var expansion: [String: Bool] = [:]
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
                        Toggle(text("Agent가 스스로 기억 저장", "Let the Agent save memories on its own"),
                               isOn: Binding(
                                get: { store.space?.autoEnabled ?? false },
                                set: { enabled in Task { await store.setUse(true, automatic: enabled) } }
                               ))
                            .disabled(!store.writable || store.space?.useEnabled != true)
                            .accessibilityIdentifier("dm-memory-automatic")
                        Text(text("기억 사용을 먼저 켜세요. 켜면 Agent가 대화에서 남길 만한 내용을 스스로 기억에 저장합니다. 끄면 요청할 때만 저장합니다. 직접 편집한 기억은 요청 없이 바꾸지 않습니다.",
                                  "Enable memory use first. When on, the Agent saves what is worth keeping from this conversation on its own. When off, it saves only when you ask. It does not change memories you edited unless you ask."))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Section(text("기억 폴더", "Memory folders")) {
                        if !page.documents.contains(where: { !$0.readOnly }) {
                            Text(text("저장된 기억이 없습니다.", "No saved memories."))
                        }
                        if page.eligible || store.space != nil {
                            DmMemoryTreeRow(
                                node: DmMemoryTreeNode.tree(folders: page.folders, documents: page.documents),
                                expansion: $expansion,
                                locale: locale,
                                open: { document in
                                    Task {
                                        do { draft = Draft(document: try await store.document(document.id)) }
                                        catch { self.error = error.localizedDescription }
                                    }
                                },
                                forget: { document in Task { await store.forget(document.id) } }
                            )
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
            .task {
                await store.load()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    if draft == nil { await store.refreshStatus() }
                }
            }
            .sheet(item: $draft) { value in DmMemoryEditor(store: store, document: value.document, locale: locale) }
            .onDisappear { store.clearExport() }
        }
    }

    private func spaceLabel(_ space: DmMemorySpace) -> String {
        "\(space.status) · \(dmMemoryTimestamp(space.createdAt).prefix(10))"
    }
}

/// One node of the folder tree: a folder as a `DisclosureGroup` (open while it
/// holds files unless the user closed it, dimmed when empty), a file as a row
/// that opens the detail screen.
private struct DmMemoryTreeRow: View {
    let node: DmMemoryTreeNode
    @Binding var expansion: [String: Bool]
    let locale: CompanionLocale
    let open: (DmMemoryDocument) -> Void
    let forget: (DmMemoryDocument) -> Void
    private func text(_ ko: String, _ en: String) -> String { locale == .ko ? ko : en }

    var body: some View {
        switch node {
        case let .folder(key, name, children, fileCount):
            let identifier = "dm-memory-folder-" + (key.isEmpty ? DmMemoryTreeNode.rootName : key)
            // The identifier goes on the label: on the DisclosureGroup it would replace every descendant's.
            if children.isEmpty {
                folderLabel(name: name, fileCount: fileCount, expanded: false)
                    .accessibilityIdentifier(identifier)
            } else {
                DisclosureGroup(isExpanded: Binding(
                    get: { expansion[key] ?? (key.isEmpty || fileCount > 0) },
                    set: { expansion[key] = $0 }
                )) {
                    ForEach(children) { child in
                        DmMemoryTreeRow(node: child, expansion: $expansion, locale: locale, open: open, forget: forget)
                    }
                } label: {
                    folderLabel(name: name, fileCount: fileCount, expanded: expansion[key] ?? (key.isEmpty || fileCount > 0))
                        .accessibilityIdentifier(identifier)
                }
            }
        case let .file(_, name, document):
            let details = document.treeDetails
                + (document.readOnly ? [text("읽기 전용", "Read only")] : [])
                + (document.protectedByUser ? [text("사용자 보호", "User protected")] : [])
            Button { open(document) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Label(name, systemImage: "doc.text")
                        .font(.body.monospaced())
                        .foregroundStyle(.primary)
                    Text(details.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                        .padding(.leading, 28)
                }
            }
            .accessibilityIdentifier("dm-memory-document-" + document.id)
            .swipeActions {
                if !document.readOnly {
                    Button(text("기억에서 삭제", "Forget"), role: .destructive) { forget(document) }
                }
            }
        }
    }

    private func folderLabel(name: String, fileCount: Int, expanded: Bool) -> some View {
        HStack(spacing: 6) {
            Label(name, systemImage: expanded ? "folder.fill" : "folder")
                .font(.body.monospaced().weight(fileCount > 0 ? .semibold : .regular))
            if fileCount > 0 { Text("\(fileCount)").font(.caption).foregroundStyle(.secondary) }
        }
        .foregroundStyle(fileCount > 0 ? .primary : .secondary)
        .accessibilityElement(children: .combine)
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
            memoryClass: document?.memoryClass ?? .profile
        ))
    }
    /// README.md belongs to the app: shown, never edited, versioned or forgotten.
    private var readOnly: Bool { document?.readOnly == true }

    var body: some View {
        NavigationStack {
            Form {
                if let error = store.errorMessage { Text(error).foregroundStyle(.red) }
                if let document, document.hasPath {
                    Text(document.path).font(.caption.monospaced()).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("dm-memory-path")
                }
                if readOnly, let document {
                    Section {
                        Text(text("앱이 관리하는 안내 파일입니다. 읽을 수만 있고 편집하거나 삭제할 수 없습니다.",
                                  "The app maintains this guide. You can read it but not edit or delete it."))
                            .font(.caption).foregroundStyle(.secondary)
                        Text(document.body).font(.callout.monospaced()).textSelection(.enabled)
                            .accessibilityIdentifier("dm-memory-readonly-body")
                    }
                } else {
                    Section {
                        TextField(text("제목", "Title"), text: $draft.title)
                        TextEditor(text: $draft.body).frame(minHeight: 160).accessibilityLabel(text("기억 본문", "Memory text"))
                        Text("\(draft.body.utf8.count) / 65536 bytes").font(.caption)
                        Picker(text("분류", "Category"), selection: $draft.memoryClass) {
                            ForEach([BriarAPI_DmMemoryClass.profile, .log, .note], id: \.rawValue) {
                                Text($0.label)
                            }
                        }
                    }.disabled(!store.writable || store.busy)
                    if let document {
                        Section(text("근거", "Sources")) {
                            NavigationLink(text("변경 이력", "Revision history")) {
                                DmMemoryHistoryView(store: store, documentID: document.id, locale: locale)
                            }
                            .accessibilityIdentifier("dm-memory-history")
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
            }
            .onChange(of: draft) { old, new in
                if old.title != new.title || old.body != new.body || old.memoryClass != new.memoryClass {
                    draft.requestId = UUID().uuidString.lowercased()
                }
            }
            .navigationTitle(text("기억", "Memory"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(text("닫기", "Close")) { dismiss() }.accessibilityIdentifier("dm-memory-editor-close")
                }
                if store.writable && !readOnly {
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
                ForEach(history.revisions, id: \.version) { revision in
                    Button("v\(revision.version) · \(dmMemoryTimestamp(revision.createdAt)) · \(revision.origin.label)") {
                        Task {
                            loading = true
                            defer { loading = false }
                            do { preview = try await store.document(documentID, version: Int(revision.version)) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                    .accessibilityIdentifier("dm-memory-revision-\(revision.version)")
                }
                if history.hasNextCursor {
                    Button(text("더 보기", "Load more")) {
                        Task { await load(cursor: history.nextCursor) }
                    }
                }
            }
            if let preview {
                Section(text("이전 버전 · 읽기 전용", "Earlier version · read only")) {
                    Text("v\(preview.version)").font(.caption)
                    Text(preview.body).textSelection(.enabled)
                        .accessibilityIdentifier("dm-memory-revision-body")
                }
            }
        }
        .disabled(loading)
        .navigationTitle(text("변경 이력", "Revision history"))
        .task { await load() }
    }

    private func load(cursor: UInt32? = nil) async {
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
                        Text("v\(document.version) · \(document.memoryClass.label)").font(.caption)
                        Text(document.body).textSelection(.enabled)
                            .accessibilityIdentifier("dm-memory-citation-body")
                    } else if let error { Text(error).foregroundStyle(.red) }
                    else { ProgressView() }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .navigationTitle(locale == .ko ? "참고한 기억" : "Referenced memory")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(locale == .ko ? "닫기" : "Close") { dismiss() }
                }
            }
        }
        .task(id: reference.id) {
            document = nil
            error = nil
            do {
                let loaded = try await store.document(
                    reference.documentId.uuidString.lowercased(),
                    version: reference.version
                )
                if !Task.isCancelled { document = loaded }
            } catch {
                if !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
    }
}
