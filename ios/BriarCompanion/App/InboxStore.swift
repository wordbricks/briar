import Foundation

@MainActor
final class InboxStore: ObservableObject {
    @Published private(set) var messages: [InboxMessage] = []
    @Published private(set) var unreadCount = 0

    private var readVersions: [String: String] = [:]
    private let defaults: UserDefaults
    private let storageKeyPrefix = "briar.inbox.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func update(
        snapshot: DashboardSnapshot?,
        sessions: [ProjectAgentSession],
        project: ProjectsResponse.Project
    ) {
        let storageKey = "\(storageKeyPrefix).\(project.id.uuidString.lowercased())"
        loadReadVersions(storageKey: storageKey)

        let built = InboxMessageBuilder.build(
            snapshot: snapshot,
            sessions: sessions,
            project: project
        )
        let validIDs = Set(built.map(\.id))
        readVersions = readVersions.filter { validIDs.contains($0.key) }

        messages = built.map { message in
            var copy = message
            copy.isUnread = readVersions[message.id] != message.version
            return copy
        }
        unreadCount = messages.filter(\.isUnread).count
        persist(storageKey: storageKey)
        Task { await AppBadgeService.sync(count: unreadCount) }
    }

    func markRead(id: String) {
        guard let message = messages.first(where: { $0.id == id }) else { return }
        guard readVersions[id] != message.version else { return }
        readVersions[id] = message.version
        recompute()
    }

    func markAllRead() {
        for message in messages {
            readVersions[message.id] = message.version
        }
        recompute()
    }

    func messages(in category: InboxCategory) -> [InboxMessage] {
        messages.filter { InboxMessageBuilder.classify($0) == category }
    }

    private func recompute() {
        messages = messages.map { message in
            var copy = message
            copy.isUnread = readVersions[message.id] != message.version
            return copy
        }
        unreadCount = messages.filter(\.isUnread).count
        if let projectID = messages.first?.projectId {
            persist(storageKey: "\(storageKeyPrefix).\(projectID.uuidString.lowercased())")
        }
        Task { await AppBadgeService.sync(count: unreadCount) }
    }

    private func loadReadVersions(storageKey: String) {
        guard
            let data = defaults.data(forKey: storageKey),
            let decoded = try? JSONDecoder().decode(Storage.self, from: data)
        else {
            readVersions = [:]
            return
        }
        readVersions = decoded.readVersions
    }

    private func persist(storageKey: String) {
        let storage = Storage(
            messages: messages.map {
                StoredMessage(id: $0.id, version: $0.version)
            },
            readVersions: readVersions
        )
        if let data = try? JSONEncoder().encode(storage) {
            defaults.set(data, forKey: storageKey)
        }
    }

    private struct Storage: Codable {
        let messages: [StoredMessage]
        let readVersions: [String: String]
    }

    private struct StoredMessage: Codable {
        let id: String
        let version: String
    }
}
