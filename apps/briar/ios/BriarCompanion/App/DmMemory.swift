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
    func document(_ id: String, version: Int? = nil) async throws -> DmMemoryDocument {
        try requireScope()
        var request = BriarAPI_GetDmMemoryDocumentRequest()
        request.organizationID = organizationID
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
        request.organizationID = organizationID
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
    func setUse(_ enabled: Bool, automatic: Bool = false, newSpace: Bool = false) async {
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
            request.organizationID = organizationID
            request.channelID = channelID
            request.documentID = id
            _ = try await service.deleteDmMemoryDocument(request: request, headers: [:]).briarValue()
            page = try await fetchPage(spaceID: page?.selectedSpaceID)
        } catch { errorMessage = error.localizedDescription }
    }
    func retryLearning(_ jobID: String) async {
        guard !busy, let space else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            try requireScope()
            var request = BriarAPI_RetryDmMemoryLearningRequest()
            request.organizationID = organizationID
            request.channelID = channelID
            request.jobID = jobID
            request.requestID = UUID().uuidString.lowercased()
            request.revocationEpoch = space.revocationEpoch
            _ = try await service.retryDmMemoryLearning(request: request, headers: [:]).briarValue()
            page = try await fetchPage(spaceID: space.id)
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
                        Toggle(page.capabilities.automaticLearning
                               ? text("대화에서 자동으로 기억", "Learn memories from this conversation")
                               : text("자동 학습 · 아직 사용할 수 없음", "Automatic learning · not available yet"),
                               isOn: Binding(
                                get: { store.space?.autoEnabled ?? false },
                                set: { enabled in Task { await store.setUse(true, automatic: enabled) } }
                               ))
                            .disabled(!store.writable || store.space?.useEnabled != true ||
                                      (!page.capabilities.automaticLearning && store.space?.autoEnabled != true))
                            .accessibilityIdentifier("dm-memory-automatic")
                        Text(text("기억 사용을 먼저 켜세요. 자동 학습은 켠 시점 이후의 대화만 처리하며 직접 편집한 기억은 덮어쓰지 않습니다.",
                                  "Enable memory first. Automatic learning only processes later conversations and never overwrites user-edited memories."))
                            .font(.caption).foregroundStyle(.secondary)
                        if page.hasLearning { learningStatus(page.learning) }
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
                                    if document.hasValidUntil {
                                        let validUntil = document.validUntil.date
                                        Text("\(validUntil <= observedNow ? text("만료됨", "Expired") : text("유효기간", "Valid until")) · \(validUntil.ISO8601Format())")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
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

    private func indexLabel(_ value: BriarAPI_DmMemoryIndexState) -> String {
        switch value {
        case .ready: text("검색 가능", "Search ready")
        case .failed: text("색인 실패", "Index failed")
        case .pending: text("색인 대기", "Awaiting index")
        case .unspecified, .UNRECOGNIZED: text("알 수 없음", "Unknown")
        }
    }

    @ViewBuilder
    private func learningStatus(_ learning: BriarAPI_DmMemoryLearningStatus) -> some View {
        if learning.hasConfiguration {
            let configuration = learning.configuration
            Text("\(text("제안 / 검증 모델", "Proposer / verifier model")) · \(configuration.proposer.model) / \(configuration.verifier.model)")
                .font(.caption)
            Text("\(configuration.proposer.transport == "agent" ? "Agent" : "OpenRouter") · \(configuration.proposer.provider) / \(configuration.verifier.transport == "agent" ? "Agent" : "OpenRouter") · \(configuration.verifier.provider)")
                .font(.caption)
            Text("\(text("오늘 호출 / 하루 한도", "Calls today / daily limit")) · \(learning.callsToday) / \(configuration.spaceDailyCalls)")
                .font(.caption)
            if configuration.costTracked {
                Text(text("오늘 예약 비용 / 하루 한도", "Reserved cost today / daily limit") + " · " +
                     String(format: "$%.4f / $%.2f USD", Double(learning.reservedMicroUsdToday) / 1_000_000,
                            Double(configuration.spaceDailyMicroUsd) / 1_000_000))
                    .font(.caption)
            }
        }
        Text("\(text("대기·진행 작업", "Pending or running jobs")) · \(learning.pendingJobs) / \(text("실패 기록", "Failed jobs")) · \(learning.failedJobs)")
            .font(.caption)
        if learning.hasLastJob {
            Text(text("학습 상태", "Learning status") + " · " + learningState(learning.lastJob))
                .font(.caption)
            if learning.lastJob.hasErrorCode {
                Text(learningError(learning.lastJob.errorCode))
                    .font(.caption).foregroundStyle(.red)
            }
            if learning.hasRetryableJob {
                Button(text("실패한 학습 다시 시도", "Retry failed learning")) {
                    Task { await store.retryLearning(learning.retryableJob.id) }
                }.disabled(store.busy)
            }
        } else {
            Text(text("아직 학습 작업 없음", "No learning jobs yet")).font(.caption)
        }
    }

    private func learningState(_ job: BriarAPI_DmMemoryLearningJob) -> String {
        if job.status == .running, job.hasStage {
            switch job.stage {
            case .proposing: return text("기억 변경안 생성 중", "Proposing memory changes")
            case .verifying: return text("원본 근거 검증 중", "Verifying original evidence")
            case .committing: return text("검증된 기억 저장 중", "Saving verified memories")
            case .unspecified, .UNRECOGNIZED: break
            }
        }
        switch job.status {
        case .pending: return text("실행 대기", "Waiting to run")
        case .running: return text("처리 중", "Processing")
        case .retryWait: return text("재시도 대기", "Waiting to retry")
        case .failed: return text("학습 실패 · 기억은 변경하지 않음", "Learning failed; memories unchanged")
        case .cancelled: return text("취소됨", "Cancelled")
        case .succeeded: return text("기억 저장 완료", "Memories saved")
        case .noChange: return text("검토 완료 · 새 기억 없음", "Reviewed; no new memories")
        case .unspecified, .UNRECOGNIZED: return text("확인 필요", "Needs review")
        }
    }

    private func learningError(_ code: BriarAPI_DmMemoryLearningFailureCode) -> String {
        switch code {
        case .invalidProposal: return text("변경안 형식이나 근거가 유효하지 않아 저장하지 않았습니다.", "The proposal or evidence was invalid. No changes were saved.")
        case .verificationRejected: return text("별도 검증이 변경안을 거절했습니다. 저장된 기억은 바뀌지 않았습니다.", "Independent verification rejected the proposal. Saved memories were unchanged.")
        case .stale: return text("근거나 기억이 바뀌어 최신 입력으로 다시 처리합니다.", "Evidence or memories changed. Processing will use current input.")
        case .scopeRevoked: return text("기억 설정이나 접근 권한이 바뀌어 작업을 중단했습니다.", "Memory settings or access changed. The job stopped.")
        case .budgetExhausted: return text("설정된 호출·비용 한도를 소진했습니다.", "The call or cost limit was reached.")
        case .modelUnavailable: return text("학습 모델에 연결하지 못했습니다.", "The learning model could not be reached.")
        case .modelTimeout: return text("학습 모델 응답 시간이 초과됐습니다.", "The learning model timed out.")
        case .modelCredentials: return text("학습 모델 인증이나 잔액 설정을 확인해야 합니다.", "Check learning model credentials or account balance.")
        case .modelConfiguration: return text("설정된 학습 모델·제공자·출력 계약을 사용할 수 없습니다.", "The configured model, provider or output contract is unavailable.")
        case .inputCapacity: return text("입력 한도를 초과해 학습을 중단했습니다.", "The input exceeded its limit.")
        case .unspecified, .UNRECOGNIZED: return text("학습 실패 기록을 확인하세요.", "Check the learning failure record.")
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
