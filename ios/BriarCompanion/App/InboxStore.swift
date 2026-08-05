import Foundation

@MainActor
final class InboxStore: ObservableObject {
    @Published private(set) var messages: [InboxMessage] = []
    @Published private(set) var unreadCount = 0

    private var readVersions: [String: String] = [:]
    private var remoteReadVersions: [String: String] = [:]
    private var pendingPush: [String: String] = [:]
    private var pushTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var token: String?
    private var userID: String?
    private let defaults: UserDefaults
    private let api: (any MobileAPIClientProtocol)?
    private let storageKeyPrefix = "briar.inbox.v1"

    init(
        defaults: UserDefaults = .standard,
        api: (any MobileAPIClientProtocol)? = nil
    ) {
        self.defaults = defaults
        self.api = api
    }

    func configure(token: String?, userID: String?) {
        let normalizedUserID = userID?.trimmingCharacters(in: .whitespacesAndNewlines)
        let changed =
            self.token != token ||
            self.userID != normalizedUserID
        self.token = token
        self.userID = (normalizedUserID?.isEmpty == false) ? normalizedUserID : nil
        guard changed else { return }

        syncTask?.cancel()
        pushTask?.cancel()
        pendingPush = [:]
        remoteReadVersions = [:]

        if let userID = self.userID {
            loadReadVersions(storageKey: storageKey(for: userID))
            recompute(persist: false)
            syncTask = Task { await syncFromServer() }
        } else {
            readVersions = [:]
            messages = []
            unreadCount = 0
        }
    }

    func update(
        snapshot: DashboardSnapshot?,
        sessions: [ProjectAgentSession],
        project: ProjectsResponse.Project
    ) {
        if let userID {
            loadReadVersions(storageKey: storageKey(for: userID))
        }

        let built = InboxMessageBuilder.build(
            snapshot: snapshot,
            sessions: sessions,
            project: project
        )

        messages = built.map { message in
            var copy = message
            copy.isUnread = readVersions[message.id] != message.version
            return copy
        }
        unreadCount = messages.filter(\.isUnread).count
        persistIfPossible()
        Task { await AppBadgeService.sync(count: unreadCount) }
    }

    func markRead(id: String) {
        guard let message = messages.first(where: { $0.id == id }) else { return }
        guard readVersions[id] != message.version else { return }
        readVersions[id] = message.version
        recompute()
        queuePush([id: message.version])
    }

    func markAllRead() {
        var pushed: [String: String] = [:]
        for message in messages {
            if readVersions[message.id] != message.version {
                pushed[message.id] = message.version
            }
            readVersions[message.id] = message.version
        }
        recompute()
        if !pushed.isEmpty {
            queuePush(pushed)
        }
    }

    func messages(in category: InboxCategory) -> [InboxMessage] {
        messages.filter { InboxMessageBuilder.classify($0) == category }
    }

    private func recompute(persist: Bool = true) {
        messages = messages.map { message in
            var copy = message
            copy.isUnread = readVersions[message.id] != message.version
            return copy
        }
        unreadCount = messages.filter(\.isUnread).count
        if persist {
            persistIfPossible()
        }
        Task { await AppBadgeService.sync(count: unreadCount) }
    }

    private func storageKey(for userID: String) -> String {
        "\(storageKeyPrefix).user.\(userID)"
    }

    private func loadReadVersions(storageKey: String) {
        guard
            let data = defaults.data(forKey: storageKey),
            let decoded = try? JSONDecoder().decode(Storage.self, from: data)
        else {
            // Migrate legacy per-project keys once so local reads are not lost.
            if readVersions.isEmpty {
                readVersions = migrateLegacyReadVersions()
            }
            return
        }
        readVersions = decoded.readVersions
    }

    private func migrateLegacyReadVersions() -> [String: String] {
        var migrated: [String: String] = [:]
        for (key, value) in defaults.dictionaryRepresentation() {
            guard key.hasPrefix("\(storageKeyPrefix).") else { continue }
            guard !key.contains(".user.") else { continue }
            guard let data = value as? Data,
                  let decoded = try? JSONDecoder().decode(Storage.self, from: data)
            else { continue }
            for (messageID, version) in decoded.readVersions {
                migrated[messageID] = version
            }
        }
        return migrated
    }

    private func persistIfPossible() {
        guard let userID else { return }
        let storage = Storage(
            messages: messages.map {
                StoredMessage(id: $0.id, version: $0.version)
            },
            readVersions: readVersions
        )
        if let data = try? JSONEncoder().encode(storage) {
            defaults.set(data, forKey: storageKey(for: userID))
        }
    }

    private func queuePush(_ versions: [String: String]) {
        guard api != nil, token != nil, userID != nil else { return }
        for (messageID, version) in versions {
            if remoteReadVersions[messageID] != version {
                pendingPush[messageID] = version
            }
        }
        guard !pendingPush.isEmpty else { return }
        // Do not cancel an in-flight push: the previous task already took
        // ownership of its payload and will drain any newer pending entries.
        guard pushTask == nil else { return }
        pushTask = Task { await flushPush() }
    }

    private func syncFromServer() async {
        guard let api, let token, userID != nil else { return }
        do {
            let response = try await api.get(
                MobileAPIContract.Endpoint.inboxReadStates,
                token: token,
                as: InboxReadStatesResponse.self
            )
            remoteReadVersions = response.readVersions
            readVersions.merge(response.readVersions) { _, remote in remote }
            recompute()

            var pending: [String: String] = [:]
            for (messageID, version) in readVersions where remoteReadVersions[messageID] != version {
                pending[messageID] = version
            }
            if !pending.isEmpty {
                pendingPush.merge(pending) { _, latest in latest }
                await flushPush()
            }
        } catch {
            // Keep local cache when offline or during auth races.
        }
    }

    private func flushPush() async {
        guard let api, let token, userID != nil else {
            pushTask = nil
            return
        }
        let payload = pendingPush
        guard !payload.isEmpty else {
            pushTask = nil
            return
        }
        pendingPush = [:]
        do {
            let response = try await api.send(
                MobileAPIContract.Endpoint.inboxReadStates,
                method: "PUT",
                token: token,
                body: InboxReadStatesRequest(readVersions: payload),
                as: InboxReadStatesResponse.self
            )
            remoteReadVersions.merge(response.readVersions) { _, remote in remote }
            readVersions.merge(response.readVersions) { _, remote in remote }
            recompute()
            if !pendingPush.isEmpty {
                await flushPush()
            } else {
                pushTask = nil
            }
        } catch {
            pendingPush.merge(payload) { _, latest in latest }
            pushTask = nil
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
