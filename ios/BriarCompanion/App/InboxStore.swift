import Foundation

@MainActor
final class InboxStore: ObservableObject {
    @Published private(set) var messages: [InboxMessage] = []
    @Published private(set) var unreadCount = 0

    private var readVersions: [String: String] = [:]
    private var remoteReadVersions: [String: String] = [:]
    private var pendingPush: [String: String] = [:]
    private var inFlightPush: [String: String] = [:]
    private var pushTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var accountGeneration: UInt64 = 0
    private var syncRequestGeneration: UInt64 = 0
    private var remoteMutationGeneration: UInt64 = 0
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
        let nextUserID = (normalizedUserID?.isEmpty == false) ? normalizedUserID : nil
        let changed =
            self.token != token ||
            self.userID != nextUserID
        guard changed else { return }

        accountGeneration &+= 1
        syncRequestGeneration = 0
        remoteMutationGeneration = 0
        syncTask?.cancel()
        pushTask?.cancel()
        syncTask = nil
        pushTask = nil
        self.token = token
        self.userID = nextUserID
        pendingPush = [:]
        inFlightPush = [:]
        remoteReadVersions = [:]
        // Never let a previous account's in-memory cache seed the new account.
        readVersions = [:]
        messages = []
        unreadCount = 0

        if let userID = self.userID {
            loadReadVersions(storageKey: storageKey(for: userID))
            recompute(persist: false)
            startReadStateSync()
        } else {
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
            copy.isUnread = isUnread(message)
            return copy
        }
        unreadCount = messages.filter(countsTowardUnread).count
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

    func markIssueRead(runID: UUID) {
        markRead(id: "issue:\(runID.uuidString.lowercased())")
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

    func applicationDidBecomeActive() {
        startReadStateSync()
    }

    func refreshReadStates() async {
        guard let task = startReadStateSync() else { return }
        await task.value
    }

    func messages(in category: InboxCategory) -> [InboxMessage] {
        messages.filter { InboxMessageBuilder.classify($0) == category }
    }

    private func recompute(persist: Bool = true) {
        messages = messages.map { message in
            var copy = message
            copy.isUnread = isUnread(message)
            return copy
        }
        unreadCount = messages.filter(countsTowardUnread).count
        if persist {
            persistIfPossible()
        }
        Task { await AppBadgeService.sync(count: unreadCount) }
    }

    private func isUnread(_ message: InboxMessage) -> Bool {
        readVersions[message.id] != message.version
    }

    private func countsTowardUnread(_ message: InboxMessage) -> Bool {
        message.isUnread && InboxMessageBuilder.classify(message) != .activity
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
        var changed = false
        for (messageID, version) in versions {
            if remoteReadVersions[messageID] != version,
               inFlightPush[messageID] != version,
               pendingPush[messageID] != version {
                pendingPush[messageID] = version
                changed = true
            }
        }
        guard changed else { return }
        // Any GET that was already waiting is older than this explicit read.
        remoteMutationGeneration &+= 1
        startPushIfNeeded()
    }

    @discardableResult
    private func startReadStateSync() -> Task<Void, Never>? {
        guard api != nil, let token, let userID else { return nil }
        // Foregrounding and pull-to-refresh also retry a previously failed PUT.
        startPushIfNeeded()
        syncRequestGeneration &+= 1
        let requestGeneration = syncRequestGeneration
        let accountGeneration = accountGeneration
        let responseGeneration = remoteMutationGeneration
        let localAtRequestStart = readVersions
        syncTask?.cancel()
        let task = Task { [weak self] in
            guard let self else { return }
            await self.syncFromServer(
                accountGeneration: accountGeneration,
                requestGeneration: requestGeneration,
                responseGeneration: responseGeneration,
                token: token,
                userID: userID,
                localAtRequestStart: localAtRequestStart
            )
        }
        syncTask = task
        return task
    }

    private func syncFromServer(
        accountGeneration: UInt64,
        requestGeneration: UInt64,
        responseGeneration: UInt64,
        token: String,
        userID: String,
        localAtRequestStart: [String: String]
    ) async {
        defer {
            if isCurrentAccount(
                generation: accountGeneration,
                token: token,
                userID: userID
            ), syncRequestGeneration == requestGeneration {
                syncTask = nil
            }
        }
        guard let api else { return }
        do {
            let response = try await api.get(
                MobileAPIContract.Endpoint.inboxReadStates,
                token: token,
                as: InboxReadStatesResponse.self
            )
            guard isCurrentAccount(
                generation: accountGeneration,
                token: token,
                userID: userID
            ), syncRequestGeneration == requestGeneration,
               remoteMutationGeneration == responseGeneration
            else { return }

            let localOnly = localAtRequestStart.filter {
                response.readVersions[$0.key] == nil
            }
            var protectedLocal = localOnly
            protectedLocal.merge(inFlightPush) { _, latest in latest }
            protectedLocal.merge(pendingPush) { _, latest in latest }
            applyRemoteReadVersions(
                response.readVersions,
                preserving: protectedLocal
            )
            if !localOnly.isEmpty {
                queuePush(localOnly)
            }
        } catch {
            // Keep local cache when offline or during auth races.
        }
    }

    private func startPushIfNeeded() {
        guard pushTask == nil,
              !pendingPush.isEmpty,
              api != nil,
              let token,
              let userID
        else { return }
        let accountGeneration = accountGeneration
        pushTask = Task { [weak self] in
            guard let self else { return }
            await self.drainPush(
                accountGeneration: accountGeneration,
                token: token,
                userID: userID
            )
        }
    }

    private func drainPush(
        accountGeneration: UInt64,
        token: String,
        userID: String
    ) async {
        guard let api else { return }
        while isCurrentAccount(
            generation: accountGeneration,
            token: token,
            userID: userID
        ) {
            let payload = pendingPush
            guard !payload.isEmpty else {
                pushTask = nil
                return
            }
            pendingPush = [:]
            inFlightPush = payload

            do {
                let response = try await api.send(
                    MobileAPIContract.Endpoint.inboxReadStates,
                    method: "PUT",
                    token: token,
                    body: InboxReadStatesRequest(readVersions: payload),
                    as: InboxReadStatesResponse.self
                )
                guard isCurrentAccount(
                    generation: accountGeneration,
                    token: token,
                    userID: userID
                ) else { return }

                remoteMutationGeneration &+= 1
                inFlightPush = [:]
                applyRemoteReadVersions(
                    response.readVersions,
                    preserving: pendingPush
                )
            } catch {
                guard isCurrentAccount(
                    generation: accountGeneration,
                    token: token,
                    userID: userID
                ) else { return }

                var retry = payload
                retry.merge(pendingPush) { _, latest in latest }
                pendingPush = retry
                inFlightPush = [:]
                // Retry only after the next mark, foreground, or explicit sync.
                pushTask = nil
                return
            }
        }
    }

    private func applyRemoteReadVersions(
        _ remote: [String: String],
        preserving protectedLocal: [String: String]
    ) {
        remoteReadVersions = remote
        readVersions.merge(remote) { _, remote in remote }
        readVersions.merge(protectedLocal) { _, local in local }
        recompute()
    }

    private func isCurrentAccount(
        generation: UInt64,
        token: String,
        userID: String
    ) -> Bool {
        accountGeneration == generation &&
            self.token == token &&
            self.userID == userID
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
