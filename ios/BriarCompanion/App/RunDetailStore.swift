import Foundation

@MainActor
final class RunDetailStore: ObservableObject {
    @Published private(set) var events: [RunEvent] = []
    @Published private(set) var evidence: [RunEvidence] = []
    @Published private(set) var messages: [IssueMessage] = []
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol

    init(api: any MobileAPIClientProtocol) {
        self.api = api
    }

    func load(projectID: UUID, runID: UUID, token: String) async {
        guard !loading else { return }
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            async let loadedEvents: RunEventsResponse = api.send(
                MobileAPIContract.Endpoint.runEvents(projectID: projectID, runID: runID),
                method: "GET",
                token: token,
                body: nil,
                as: RunEventsResponse.self
            )
            async let loadedEvidence: RunEvidenceResponse = api.send(
                MobileAPIContract.Endpoint.runEvidence(projectID: projectID, runID: runID),
                method: "GET",
                token: token,
                body: nil,
                as: RunEvidenceResponse.self
            )
            async let loadedMessages: IssueMessagesResponse = api.send(
                MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID),
                method: "GET",
                token: token,
                body: nil,
                as: IssueMessagesResponse.self
            )
            let result = try await (loadedEvents, loadedEvidence, loadedMessages)
            events = result.0.events
            evidence = result.1.evidence
            messages = result.2.messages
        } catch is CancellationError {
            return
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }
}

struct PreviewFile: Identifiable {
    let id = UUID()
    let url: URL
}

@MainActor
final class AttachmentPreviewStore: ObservableObject {
    @Published private(set) var loadingID: UUID?
    @Published var preview: PreviewFile?
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol

    init(api: any MobileAPIClientProtocol) {
        self.api = api
    }

    func open(id: UUID, filename: String, path: String, token: String) async {
        guard loadingID == nil else { return }
        loadingID = id
        errorMessage = nil
        defer { loadingID = nil }
        do {
            let data = try await api.download(path, token: token)
            let directory = FileManager.default.temporaryDirectory
                .appending(path: "BriarCompanionPreviews", directoryHint: .isDirectory)
                .appending(path: id.uuidString, directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let lastComponent = filename
                .split(whereSeparator: { $0 == "/" || $0 == "\\" })
                .last
                .map(String.init) ?? ""
            let safeName = ["", ".", ".."].contains(lastComponent) ? "preview" : lastComponent
            let destination = directory.appending(path: safeName)
            try data.write(to: destination, options: .atomic)
            preview = PreviewFile(url: destination)
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func dismissError() {
        errorMessage = nil
    }
}
