import Foundation

/// Owns the single organization WebSocket used by every native surface.
/// Domain stores remain authoritative through their regular snapshot/delta APIs;
/// this store only fans out small cursor/version invalidations.
@MainActor
final class OrganizationRealtimeStore: ObservableObject {
    @Published private(set) var latestNotification: ChannelRealtimeNotification?
    @Published private(set) var notificationSequence = 0

    private let realtime: (any MobileRealtimeClientProtocol)?
    private var organizationID: UUID?
    private var token: String?
    private var generation = 0
    private var isForeground = true
    private var task: Task<Void, Never>?

    init(api: any MobileAPIClientProtocol) {
        realtime = api as? any MobileRealtimeClientProtocol
    }

    func select(organizationID: UUID?, token: String?) {
        guard self.organizationID != organizationID || self.token != token else { return }
        generation &+= 1
        task?.cancel()
        task = nil
        self.organizationID = organizationID
        self.token = token
        latestNotification = nil
        guard isForeground else { return }
        start()
    }

    func applicationDidBecomeActive() {
        guard !isForeground else { return }
        isForeground = true
        start()
    }

    func applicationDidEnterBackground() {
        isForeground = false
        generation &+= 1
        task?.cancel()
        task = nil
    }

    private func start() {
        guard task == nil,
              let realtime,
              let organizationID,
              let token,
              isForeground
        else { return }
        let expectedGeneration = generation
        task = Task { [weak self] in
            var reconnectAttempt = 0
            while !Task.isCancelled {
                guard let self,
                      expectedGeneration == self.generation,
                      self.isForeground
                else { return }
                do {
                    let events = realtime.realtimeEvents(
                        MobileAPIContract.Endpoint.channelEvents(
                            organizationID: organizationID,
                            cursor: 0
                        ),
                        token: token
                    )
                    for try await event in events {
                        guard !Task.isCancelled,
                              expectedGeneration == self.generation,
                              self.isForeground
                        else { return }
                        reconnectAttempt = 0
                        self.latestNotification = event
                        self.notificationSequence &+= 1
                    }
                } catch is CancellationError {
                    return
                } catch {
                    // Snapshot/delta fallback remains authoritative while the
                    // shared notification socket reconnects.
                }
                reconnectAttempt = min(reconnectAttempt + 1, 5)
                do {
                    try await Task.sleep(for: .seconds(1 << reconnectAttempt))
                } catch {
                    return
                }
            }
        }
    }
}

@MainActor
final class ChannelsStore: ObservableObject {
    static let messagePageSize = 20
    static let cachedConversationLimit = 5
    static let cachedThreadLimit = 5
    static let cachedMessageLimit = 40

    private struct CachedChannelConversation {
        let messages: [ChannelMessage]
        let nextMessageCursor: UUID?
        let members: [ChannelMember]
        let agents: [ChannelAgentSummary]
    }

    private struct ThreadCacheKey: Hashable {
        let channelID: UUID
        let parentMessageID: UUID
    }

    struct FocusContext: Equatable, Sendable {
        let revision: Int
        let channelID: UUID
        let threadParentID: UUID?
    }

    struct ExecutionApprovalContext: Identifiable, Sendable {
        let proposalID: UUID
        let snapshot: DashboardSnapshot

        var id: UUID { proposalID }
    }

    struct SkillExecutionApprovalContext: Identifiable, Sendable {
        let proposalID: UUID
        let snapshot: DashboardSnapshot

        var id: UUID { proposalID }
    }

    struct AgentTypingStatus: Identifiable, Equatable, Sendable {
        let id: UUID
        let agentName: String
        let activity: ChannelAgentActivity?
    }

    @Published private(set) var channels: [ChannelSummary] = []
    @Published private(set) var messages: [ChannelMessage] = []
    @Published private(set) var thread: [ChannelMessage] = []
    @Published private(set) var members: [ChannelMember] = []
    @Published private(set) var agents: [ChannelAgentSummary] = []
    @Published private(set) var agentReplies: [ChannelAgentReply] = []
    @Published private(set) var activityFrames: [UUID: ChannelAgentActivityFrame] = [:]
    @Published private(set) var hasEarlierMessages = false
    @Published private(set) var loadingEarlierMessages = false
    @Published private(set) var loading = false
    @Published private(set) var sending = false
    @Published private(set) var subscriptionPending = false
    @Published private(set) var optimisticMessageIDs: Set<UUID> = []
    @Published private(set) var acceptingProposalID: UUID?
    @Published private(set) var decliningProposalID: UUID?
    @Published private(set) var approvingExecutionProposalID: UUID?
    @Published private(set) var preparingExecutionProposalID: UUID?
    @Published private(set) var approvingSkillExecutionProposalID: UUID?
    @Published private(set) var preparingSkillExecutionProposalID: UUID?
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let realtime: (any MobileRealtimeClientProtocol)?
    private let managesRealtime: Bool
    private let attachmentReference: @Sendable () -> String
    private let pollInterval: Duration
    private let maxDeltaPagesPerRefresh: Int
    private var organizationID: UUID?
    private var token: String?
    private var syncCursor: Int?
    private var focusedChannelID: UUID?
    private var focusedThreadParentID: UUID?
    private var nextMessageCursor: UUID?
    private var cachedConversations: [UUID: CachedChannelConversation] = [:]
    private var cachedConversationOrder: [UUID] = []
    private var cachedThreads: [ThreadCacheKey: [ChannelMessage]] = [:]
    private var cachedThreadOrder: [ThreadCacheKey] = []
    private var generation = 0
    private var catalogLoadRevision = 0
    private var authoritativeLoadRevision = 0
    private var acceptanceRevision = 0
    private var catalogRefreshInFlight = false
    private var conversationLoadInFlight = false
    private var proposalRevisions: [UUID: Int] = [:]
    private var latestProposals: [UUID: ChannelMessage.Proposal] = [:]
    private var latestExecutionProposals: [UUID: IssueExecutionProposal] = [:]
    private var executionProposalIDsByMessage: [UUID: UUID] = [:]
    private var skillExecutionProposalRevisions: [UUID: Int] = [:]
    private var latestSkillExecutionProposals: [UUID: AgentSkillExecutionProposal] = [:]
    private var skillExecutionProposalIDsByMessage: [UUID: UUID] = [:]
    private var agentReplyTombstones: Set<UUID> = []
    private var isForeground = true
    private var changesRefreshRequested = false
    private var pollingTask: Task<Void, Never>?
    private var realtimeTask: Task<Void, Never>?
    private var activityTask: Task<Void, Never>?
    private var activityExpiryTask: Task<Void, Never>?

    init(
        api: any MobileAPIClientProtocol,
        realtime: (any MobileRealtimeClientProtocol)? = nil,
        managesRealtime: Bool = true,
        pollInterval: Duration = .seconds(60),
        maxDeltaPagesPerRefresh: Int = 20,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
        self.realtime = realtime ?? (api as? any MobileRealtimeClientProtocol)
        self.managesRealtime = managesRealtime
        self.pollInterval = pollInterval
        self.maxDeltaPagesPerRefresh = min(max(maxDeltaPagesPerRefresh, 1), 20)
        self.attachmentReference = attachmentReference
    }

    func select(organizationID: UUID?, token: String?) {
        guard self.organizationID != organizationID || self.token != token else { return }
        generation += 1
        catalogLoadRevision &+= 1
        authoritativeLoadRevision &+= 1
        acceptanceRevision &+= 1
        pollingTask?.cancel()
        pollingTask = nil
        realtimeTask?.cancel()
        realtimeTask = nil
        activityTask?.cancel()
        activityTask = nil
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
        self.organizationID = organizationID
        self.token = token
        syncCursor = nil
        proposalRevisions = [:]
        latestProposals = [:]
        latestExecutionProposals = [:]
        executionProposalIDsByMessage = [:]
        skillExecutionProposalRevisions = [:]
        latestSkillExecutionProposals = [:]
        skillExecutionProposalIDsByMessage = [:]
        agentReplyTombstones = []
        focusedChannelID = nil
        focusedThreadParentID = nil
        nextMessageCursor = nil
        cachedConversations = [:]
        cachedConversationOrder = []
        cachedThreads = [:]
        cachedThreadOrder = []
        channels = []
        messages = []
        thread = []
        optimisticMessageIDs = []
        members = []
        agents = []
        agentReplies = []
        activityFrames = [:]
        hasEarlierMessages = false
        loadingEarlierMessages = false
        loading = false
        catalogRefreshInFlight = false
        conversationLoadInFlight = false
        acceptingProposalID = nil
        decliningProposalID = nil
        approvingExecutionProposalID = nil
        preparingExecutionProposalID = nil
        approvingSkillExecutionProposalID = nil
        preparingSkillExecutionProposalID = nil
        errorMessage = nil
        changesRefreshRequested = false
        guard organizationID != nil, token != nil else { return }
        if isForeground { startSynchronization() }
    }

    func refresh() async {
        guard let organizationID, let token else { return }
        let expectedGeneration = generation
        catalogLoadRevision &+= 1
        let expectedCatalogRevision = catalogLoadRevision
        catalogRefreshInFlight = true
        updateLoadingState()
        defer {
            if expectedGeneration == generation,
               expectedCatalogRevision == catalogLoadRevision {
                catalogRefreshInFlight = false
                updateLoadingState()
                scheduleRequestedChangesRefreshIfNeeded()
            }
        }
        do {
            let response: ChannelsResponse = try await api.get(
                MobileAPIContract.Endpoint.channels(organizationID: organizationID),
                token: token,
                as: ChannelsResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedCatalogRevision == catalogLoadRevision
            else { return }
            channels = response.channels
            // Only the first authoritative snapshot establishes the cursor.
            // Advancing it on a later list-only refresh could skip messages.
            if syncCursor == nil {
                syncCursor = response.cursor
            }
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedCatalogRevision == catalogLoadRevision
            else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func loadDirectMessageRecipients() async throws -> (
        members: [OrganizationMember],
        agents: [ChannelAgentSummary]
    ) {
        guard let organizationID, let token else {
            throw MobileAPIError.invalidRequest
        }
        async let membersResponse: DirectMessageRecipientsResponse = api.get(
            MobileAPIContract.Endpoint.organizationMembers(organizationID: organizationID),
            token: token,
            as: DirectMessageRecipientsResponse.self
        )
        async let agentsResponse: OrganizationAgentsResponse = api.get(
            MobileAPIContract.Endpoint.organizationAgents(organizationID: organizationID),
            token: token,
            as: OrganizationAgentsResponse.self
        )
        let (loadedMembers, loadedAgents) = try await (membersResponse, agentsResponse)
        return (loadedMembers.members, loadedAgents.agents)
    }

    func createDirectMessage(
        memberIDs: [String],
        agentIDs: [UUID]
    ) async throws -> ChannelSummary {
        guard let organizationID, let token,
              !memberIDs.isEmpty || !agentIDs.isEmpty else {
            throw MobileAPIError.invalidRequest
        }
        let response: CreateDirectMessageResponse = try await api.send(
            MobileAPIContract.Endpoint.directMessages(organizationID: organizationID),
            method: "POST",
            token: token,
            body: CreateDirectMessageRequest(
                memberIds: memberIDs,
                agentIds: agentIDs.map { $0.uuidString.lowercased() }
            ),
            as: CreateDirectMessageResponse.self
        )
        upsertChannel(response.channel)
        return response.channel
    }

    func openChannel(_ channelID: UUID) async {
        guard let organizationID, let token else { return }
        cacheFocusedThread()
        cacheFocusedConversation()
        if focusedChannelID != channelID || focusedThreadParentID != nil {
            invalidateProposalAcceptancePresentation()
        }
        let expectedGeneration = generation
        authoritativeLoadRevision &+= 1
        let expectedLoadRevision = authoritativeLoadRevision
        focusedChannelID = channelID
        focusedThreadParentID = nil
        activityFrames = [:]
        startActivitySynchronization()
        conversationLoadInFlight = true
        updateLoadingState()
        let cachedConversation = cachedConversation(for: channelID)
        messages = cachedConversation?.messages ?? []
        nextMessageCursor = cachedConversation?.nextMessageCursor
        hasEarlierMessages = cachedConversation?.nextMessageCursor != nil
        loadingEarlierMessages = false
        thread = []
        members = cachedConversation?.members ?? []
        agents = cachedConversation?.agents ?? []
        // Reply jobs are live execution state. A cached running job can finish
        // while another screen is open, so restoring it would replay a stale
        // typing indicator until the authoritative channel load completes.
        let repliesBeforeAuthoritativeLoad = agentReplies.filter {
            $0.channelId == channelID
        }
        agentReplies = []
        if let cachedConversation {
            recordProposalMessages(cachedConversation.messages)
        }
        let previousMessageIDs = Set(messages.map(\.id)).union(thread.map(\.id))
        defer {
            if expectedGeneration == generation,
               expectedLoadRevision == authoritativeLoadRevision,
               focusedChannelID == channelID,
               focusedThreadParentID == nil {
                conversationLoadInFlight = false
                updateLoadingState()
                scheduleRequestedChangesRefreshIfNeeded()
            }
        }
        do {
            let response: ChannelDetailResponse = try await api.get(
                MobileAPIContract.Endpoint.channel(
                    organizationID: organizationID,
                    channelID: channelID,
                    messageLimit: Self.messagePageSize
                ),
                token: token,
                as: ChannelDetailResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID
            else { return }
            upsertChannel(response.channel)
            await markChannelRead(channelID)
            invalidateExecutionProposals(
                forMessageIDs: previousMessageIDs.subtracting(Set(response.messages.map(\.id)))
            )
            recordProposalMessages(response.messages)
            messages = mergeAuthoritativeSnapshot(
                current: messages,
                incoming: response.messages
            )
            nextMessageCursor = response.nextCursor
            hasEarlierMessages = nextMessageCursor != nil
            members = response.members
            agents = response.agents
            replaceAgentReplies(
                with: response.agentReplies ?? [],
                channelID: channelID,
                previous: repliesBeforeAuthoritativeLoad
            )
            cacheFocusedConversation()
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == nil
            else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    /// Invalidates work owned by a channel detail after its root view closes.
    /// The root view also disappears while a thread is pushed, so only clear a
    /// root focus here; the thread owns its own close lifecycle below.
    func closeChannelFocus(channelID: UUID) {
        guard focusedChannelID == channelID, focusedThreadParentID == nil else { return }
        cacheFocusedConversation()
        authoritativeLoadRevision &+= 1
        invalidateProposalAcceptancePresentation()
        focusedChannelID = nil
        activityTask?.cancel()
        activityTask = nil
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
        activityFrames = [:]
        agentReplies = []
        nextMessageCursor = nil
        hasEarlierMessages = false
        loadingEarlierMessages = false
        conversationLoadInFlight = false
        updateLoadingState()
    }

    func loadEarlierMessages(channelID: UUID) async {
        guard
            let organizationID,
            let token,
            let cursor = nextMessageCursor,
            focusedChannelID == channelID,
            focusedThreadParentID == nil,
            !loadingEarlierMessages
        else { return }
        let expectedGeneration = generation
        let expectedLoadRevision = authoritativeLoadRevision
        loadingEarlierMessages = true
        defer {
            if expectedGeneration == generation,
               expectedLoadRevision == authoritativeLoadRevision,
               focusedChannelID == channelID,
               focusedThreadParentID == nil {
                loadingEarlierMessages = false
            }
        }
        do {
            let response: ChannelMessagesResponse = try await api.get(
                MobileAPIContract.Endpoint.channelMessages(
                    organizationID: organizationID,
                    channelID: channelID,
                    cursor: cursor,
                    limit: Self.messagePageSize
                ),
                token: token,
                as: ChannelMessagesResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == nil
            else { return }
            let stabilizedMessages = preservingLocallyAcceptedExecutionProposals(
                in: response.messages
            )
            recordProposalMessages(stabilizedMessages)
            messages = Self.mergeMessages(
                messages,
                updates: stabilizedMessages,
                removing: []
            )
            nextMessageCursor = response.nextCursor
            hasEarlierMessages = response.nextCursor != nil
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == nil
            else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    /// A notification may point to a root older than the initial page. Fetch
    /// that root through the thread endpoint without expanding every page in
    /// between, then merge it into the channel so navigation can open it.
    func loadRootMessageForNavigation(
        channelID: UUID,
        messageID: UUID
    ) async -> ChannelMessage? {
        if let message = messages.first(where: { $0.id == messageID }) {
            return message
        }
        guard
            let organizationID,
            let token,
            focusedChannelID == channelID,
            focusedThreadParentID == nil
        else { return nil }
        let expectedGeneration = generation
        let expectedLoadRevision = authoritativeLoadRevision
        do {
            let response: ChannelMessagesResponse = try await api.get(
                MobileAPIContract.Endpoint.channelMessages(
                    organizationID: organizationID,
                    channelID: channelID,
                    parentMessageID: messageID
                ),
                token: token,
                as: ChannelMessagesResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == nil,
                let root = response.messages.first(where: {
                    $0.id == messageID && $0.parentMessageId == nil
                })
            else { return nil }
            guard let stabilizedRoot = preservingLocallyAcceptedExecutionProposals(
                in: [root]
            ).first else { return nil }
            recordProposalMessages([stabilizedRoot])
            messages = Self.mergeMessages(
                messages,
                updates: [stabilizedRoot],
                removing: []
            )
            errorMessage = nil
            return stabilizedRoot
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == nil
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    /// Invalidates delayed thread loads and proposal responses when an
    /// interactive pop or back action leaves that exact thread. The identity
    /// guard prevents an old view's `onDisappear` from closing a newer thread.
    func closeThreadFocus(channelID: UUID, parentMessageID: UUID) {
        guard
            focusedChannelID == channelID,
            focusedThreadParentID == parentMessageID
        else { return }
        cacheFocusedThread()
        authoritativeLoadRevision &+= 1
        invalidateProposalAcceptancePresentation()
        focusedThreadParentID = nil
        conversationLoadInFlight = false
        updateLoadingState()
    }

    func openThread(channelID: UUID, parentMessageID: UUID) async {
        guard let organizationID, let token else { return }
        cacheFocusedThread()
        if focusedChannelID != channelID || focusedThreadParentID != parentMessageID {
            invalidateProposalAcceptancePresentation()
        }
        let expectedGeneration = generation
        authoritativeLoadRevision &+= 1
        let expectedLoadRevision = authoritativeLoadRevision
        focusedChannelID = channelID
        focusedThreadParentID = parentMessageID
        conversationLoadInFlight = true
        updateLoadingState()
        let cacheKey = ThreadCacheKey(
            channelID: channelID,
            parentMessageID: parentMessageID
        )
        thread = cachedThread(for: cacheKey)
        recordProposalMessages(thread)
        let previousThreadMessageIDs = Set(thread.map(\.id))
        defer {
            if expectedGeneration == generation,
               expectedLoadRevision == authoritativeLoadRevision,
               focusedChannelID == channelID,
               focusedThreadParentID == parentMessageID {
                conversationLoadInFlight = false
                updateLoadingState()
                scheduleRequestedChangesRefreshIfNeeded()
            }
        }
        do {
            let response: ChannelMessagesResponse = try await api.get(
                MobileAPIContract.Endpoint.channelMessages(
                    organizationID: organizationID,
                    channelID: channelID,
                    parentMessageID: parentMessageID
                ),
                token: token,
                as: ChannelMessagesResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == parentMessageID
            else { return }
            invalidateExecutionProposals(
                forMessageIDs: previousThreadMessageIDs.subtracting(
                    Set(response.messages.map(\.id))
                )
            )
            recordProposalMessages(response.messages)
            thread = mergeAuthoritativeSnapshot(
                current: thread,
                incoming: response.messages
            )
            storeCachedThread(thread, for: cacheKey)
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                expectedLoadRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == parentMessageID
            else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    /// Applies a bounded number of organization channel-change pages. The
    /// server includes the changed reply's root message, so one feed keeps both
    /// root reply counts and the currently open thread current.
    func refreshChanges() async {
        guard let organizationID, let token else { return }
        // Do not advance the organization cursor while an authoritative
        // channel/thread snapshot is loading. A slower snapshot could otherwise
        // overwrite this delta and make the skipped reply unrecoverable.
        guard !authoritativeLoadInFlight else {
            changesRefreshRequested = true
            return
        }
        changesRefreshRequested = false
        guard syncCursor != nil else {
            await refresh()
            return
        }
        let expectedGeneration = generation
        do {
            for _ in 0..<maxDeltaPagesPerRefresh {
                guard let requestedCursor = syncCursor else { return }
                let response: ChannelDeltaResponse = try await api.get(
                    MobileAPIContract.Endpoint.channelChanges(
                        organizationID: organizationID,
                        cursor: requestedCursor
                    ),
                    token: token,
                    as: ChannelDeltaResponse.self
                )
                guard
                    !Task.isCancelled,
                    expectedGeneration == generation,
                    self.organizationID == organizationID,
                    self.token == token,
                    syncCursor == requestedCursor
                else { return }
                guard !authoritativeLoadInFlight else {
                    changesRefreshRequested = true
                    return
                }
                guard response.cursor >= requestedCursor else {
                    throw MobileAPIError.invalidResponse
                }

                apply(response)
                syncCursor = response.cursor
                errorMessage = nil
                guard response.hasMore, response.cursor > requestedCursor else { return }
            }
        } catch {
            guard !Task.isCancelled, expectedGeneration == generation else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func applicationDidBecomeActive() {
        isForeground = true
        guard organizationID != nil, token != nil else { return }
        startSynchronization()
        startActivitySynchronization()
    }

    func applicationDidEnterBackground() {
        isForeground = false
        changesRefreshRequested = false
        pollingTask?.cancel()
        pollingTask = nil
        realtimeTask?.cancel()
        realtimeTask = nil
        activityTask?.cancel()
        activityTask = nil
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
    }

    func applicationDidReceiveMemoryWarning() {
        cachedConversations.removeAll(keepingCapacity: false)
        cachedConversationOrder.removeAll(keepingCapacity: false)
        cachedThreads.removeAll(keepingCapacity: false)
        cachedThreadOrder.removeAll(keepingCapacity: false)
    }

    private var authoritativeLoadInFlight: Bool {
        catalogRefreshInFlight || conversationLoadInFlight
    }

    private func updateLoadingState() {
        loading = conversationLoadInFlight ||
            (catalogRefreshInFlight && channels.isEmpty)
    }

    private func scheduleRequestedChangesRefreshIfNeeded() {
        guard changesRefreshRequested, !authoritativeLoadInFlight else { return }
        changesRefreshRequested = false
        Task { [weak self] in
            await self?.refreshChanges()
        }
    }

    var viewingChannelID: UUID? { focusedChannelID }
    var viewingThreadParentID: UUID? { focusedThreadParentID }

    func isMessageOptimistic(_ messageID: UUID) -> Bool {
        optimisticMessageIDs.contains(messageID)
    }

    /// A nil `parentMessageID` posts to the channel; otherwise into that thread.
    func send(
        channelID: UUID,
        parentMessageID: UUID?,
        body: String,
        currentUserID: String? = nil,
        mentions: [ChannelMentionTarget],
        attachments: [PendingIssueAttachment] = []
    ) async {
        guard let organizationID, let token else { return }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        if let message = PendingIssueAttachment.validationMessage(for: attachments) {
            errorMessage = message
            return
        }
        guard attachments.allSatisfy({ $0.contentType.hasPrefix("image/") }) else {
            errorMessage = L10n.text("채널에는 이미지만 첨부할 수 있습니다.")
            return
        }
        let clientMessageID = UUID()
        let attachmentReferences = attachments.map { _ in attachmentReference() }
        let payload = attachments.isEmpty
            ? nil
            : try? AttachmentMessagePayload(
                body: trimmed,
                attachments: attachments,
                references: attachmentReferences,
                referenceGenerator: attachmentReference
            )
        let optimisticBody = payload?.body ?? trimmed
        let currentMember = members.first { $0.userId == currentUserID }
        let optimistic = ChannelMessage(
            id: clientMessageID,
            channelId: channelID,
            parentMessageId: parentMessageID,
            body: optimisticBody,
            author: ChannelMessage.Author(
                type: .user,
                name: currentMember?.name ?? L10n.text("나"),
                image: currentMember?.image,
                provider: nil
            ),
            mentionedUserIds: mentions.compactMap {
                $0.kind == .user ? $0.recipientId : nil
            },
            mentionedAgentIds: mentions.compactMap {
                $0.kind == .agent ? UUID(uuidString: $0.recipientId) : nil
            },
            replyCount: 0,
            lastReplyAt: nil,
            document: nil,
            proposal: nil,
            createdAt: Date()
        )
        optimisticMessageIDs.insert(clientMessageID)
        if parentMessageID == nil {
            messages = Self.mergeMessages(messages, updates: [optimistic], removing: [])
            cacheFocusedConversation()
        } else {
            thread = Self.mergeMessages(thread, updates: [optimistic], removing: [])
            cacheFocusedThread()
        }
        sending = true
        defer { sending = false }
        do {
            let path = MobileAPIContract.Endpoint.channelMessages(
                organizationID: organizationID,
                channelID: channelID
            )
            let mentionedUserIds = mentions.compactMap {
                $0.kind == .user ? $0.recipientId : nil
            }
            let mentionedAgentIds = mentions.compactMap {
                $0.kind == .agent ? UUID(uuidString: $0.recipientId) : nil
            }
            let response: CreateChannelMessageResponse
            if attachments.isEmpty {
                response = try await api.send(
                    path,
                    method: "POST",
                    token: token,
                    body: CreateChannelMessageRequest(
                        body: trimmed,
                        clientMessageId: clientMessageID,
                        parentMessageId: parentMessageID,
                        mentionedUserIds: mentionedUserIds,
                        mentionedAgentIds: mentionedAgentIds
                    ),
                    as: CreateChannelMessageResponse.self
                )
            } else {
                guard let payload else { throw MobileAPIError.invalidRequest }
                response = try await api.upload(
                    path,
                    fields: [
                        "body": payload.body,
                        "clientMessageId": clientMessageID.uuidString.lowercased(),
                        "parentMessageId": parentMessageID?.uuidString.lowercased() ?? "",
                        "mentionedUserIds": String(
                            data: try JSONEncoder().encode(mentionedUserIds),
                            encoding: .utf8
                        ) ?? "[]",
                        "mentionedAgentIds": String(
                            data: try JSONEncoder().encode(
                                mentionedAgentIds.map { $0.uuidString.lowercased() }
                            ),
                            encoding: .utf8
                        ) ?? "[]",
                        "attachmentReferences": payload.referencesJSON,
                    ],
                    files: payload.files,
                    token: token,
                    as: CreateChannelMessageResponse.self
                )
            }
            if parentMessageID == nil {
                messages = Self.mergeMessages(messages, updates: [response.message], removing: [])
                cacheFocusedConversation()
            } else {
                thread = Self.mergeMessages(thread, updates: [response.message], removing: [])
                cacheFocusedThread()
            }
            mergeAgentReplies(response.agentReplies)
            optimisticMessageIDs.remove(clientMessageID)
            errorMessage = nil
        } catch {
            if optimisticMessageIDs.remove(clientMessageID) != nil {
                messages.removeAll { $0.id == clientMessageID }
                thread.removeAll { $0.id == clientMessageID }
                cacheFocusedConversation()
                cacheFocusedThread()
            }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    /// Toggles the current user's emoji reaction on a channel message.
    func setThreadSubscription(
        channelID: UUID,
        messageID: UUID,
        subscribed: Bool
    ) async {
        guard let organizationID, let token, !subscriptionPending else { return }
        subscriptionPending = true
        defer { subscriptionPending = false }
        do {
            let response: ChannelThreadSubscriptionResponse = try await api.send(
                MobileAPIContract.Endpoint.channelThreadSubscription(
                    organizationID: organizationID,
                    channelID: channelID,
                    messageID: messageID
                ),
                method: subscribed ? "PUT" : "DELETE",
                token: token,
                body: nil,
                as: ChannelThreadSubscriptionResponse.self
            )
            let apply: (ChannelMessage) -> ChannelMessage = { candidate in
                guard candidate.id == response.rootMessageId else { return candidate }
                var updated = candidate
                updated.subscribers = response.subscribers
                return updated
            }
            messages = messages.map(apply)
            thread = thread.map(apply)
            cacheFocusedThread()
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func toggleReaction(channelID: UUID, messageID: UUID, emoji: String) async {
        guard let organizationID, let token else { return }
        let trimmed = emoji.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let response: ToggleChannelMessageReactionResponse = try await api.send(
                MobileAPIContract.Endpoint.channelMessageReactions(
                    organizationID: organizationID,
                    channelID: channelID,
                    messageID: messageID
                ),
                method: "PUT",
                token: token,
                body: ToggleChannelMessageReactionRequest(emoji: trimmed),
                as: ToggleChannelMessageReactionResponse.self
            )
            guard response.message.channelId == channelID,
                  response.message.id == messageID
            else { throw MobileAPIError.invalidResponse }
            // A reaction request may have captured its message before a Skill
            // approval completed and arrive afterwards. Route the full-message
            // response through the same monotonic/tombstone reconciliation used
            // for channel deltas before replacing visible reaction state.
            guard let stabilized = preservingLocallyAcceptedExecutionProposals(
                in: [response.message]
            ).first else { throw MobileAPIError.invalidResponse }
            recordProposalMessages([stabilized])
            let apply: (ChannelMessage) -> ChannelMessage = { candidate in
                candidate.id == stabilized.id ? stabilized : candidate
            }
            messages = messages.map(apply)
            thread = thread.map(apply)
            cacheFocusedThread()
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func deleteMessage(channelID: UUID, messageID: UUID) async -> Bool {
        guard let organizationID, let token, focusedChannelID == channelID else {
            return false
        }
        guard let deletionTarget = messages.first(where: { $0.id == messageID }) ??
                thread.first(where: { $0.id == messageID })
        else { return false }
        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedThreadParentID = focusedThreadParentID
        let expectedParentMessageID = deletionTarget.parentMessageId
        let focusIsCurrent = {
            expectedGeneration == self.generation &&
                expectedFocusRevision == self.authoritativeLoadRevision &&
                self.focusedChannelID == channelID &&
                self.focusedThreadParentID == expectedThreadParentID
        }
        do {
            let response: DeleteChannelMessageResponse = try await api.send(
                MobileAPIContract.Endpoint.channelMessage(
                    organizationID: organizationID,
                    channelID: channelID,
                    messageID: messageID
                ),
                method: "DELETE",
                token: token,
                body: nil,
                as: DeleteChannelMessageResponse.self
            )
            guard response.message?.channelId == nil ||
                    (response.message?.channelId == channelID &&
                        response.message?.id == messageID &&
                        response.message?.parentMessageId == nil),
                  response.parentMessage?.channelId == nil ||
                    (response.parentMessage?.channelId == channelID &&
                        response.parentMessage?.id == expectedParentMessageID &&
                        response.parentMessage?.parentMessageId == nil)
            else { throw MobileAPIError.invalidResponse }
            guard focusIsCurrent() else { return response.deleted }
            let updates = [response.message, response.parentMessage].compactMap { $0 }
            let removed = response.deleted && response.message == nil
                ? Set([messageID])
                : Set<UUID>()
            let messageIDs = Set(messages.map(\.id))
            let threadIDs = Set(thread.map(\.id))
            messages = Self.mergeMessages(
                messages,
                updates: updates.filter { messageIDs.contains($0.id) },
                removing: removed
            )
            thread = Self.mergeMessages(
                thread,
                updates: updates.filter { threadIDs.contains($0.id) },
                removing: removed
            )
            agentReplies.removeAll {
                response.deleted &&
                    ($0.triggerMessageId == messageID || $0.replyMessageId == messageID)
            }
            updateCachedThreads(with: updates, removing: removed)
            cacheFocusedConversation()
            cacheFocusedThread()
            errorMessage = nil
            return response.deleted
        } catch {
            guard focusIsCurrent() else { return false }
            errorMessage = CompanionStore.message(for: error)
            return false
        }
    }

    /// Downloads a channel message attachment for previewing.
    func download(path: String, filename: String) async throws -> URL {
        guard let token else { throw MobileAPIError.invalidRequest }
        let safeName = filename.replacingOccurrences(of: "/", with: "-")
        let destination = FileManager.default.temporaryDirectory
            .appending(path: "briar-channel-previews", directoryHint: .isDirectory)
            .appending(path: "\(UUID().uuidString)-\(safeName)")
        return try await api.download(path, token: token, to: destination)
    }

    func acceptProposal(
        channelID: UUID,
        proposalID: UUID,
        projectID: UUID,
        execution: AcceptIssueExecutionProposalRequest? = nil
    ) async -> AcceptChannelProposalResponse? {
        guard let organizationID, let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        // Approval is a state-changing operation. Keep one request in flight so
        // repeated taps (including on another card) cannot race each other.
        guard acceptingProposalID == nil,
              decliningProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil
        else { return nil }
        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedChannelID = focusedChannelID
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = proposalRevisions[proposalID, default: 0]
        let requestsExecutionFollowUp = latestProposals[proposalID]?
            .payload?.executeAfterCreate == true
        guard execution == nil || requestsExecutionFollowUp else { return nil }
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        acceptingProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               acceptingProposalID == proposalID {
                acceptingProposalID = nil
            }
        }
        do {
            if let execution {
                let preflight: DashboardSnapshot = try await api.get(
                    MobileAPIContract.Endpoint.dashboard(projectID: projectID),
                    token: token,
                    as: DashboardSnapshot.self
                )
                guard
                    expectedGeneration == generation,
                    expectedAcceptanceRevision == acceptanceRevision,
                    expectedFocusRevision == authoritativeLoadRevision,
                    expectedFocusedChannelID == focusedChannelID,
                    expectedFocusedThreadParentID == focusedThreadParentID,
                    proposalRevisions[proposalID, default: 0] == expectedProposalRevision,
                    latestProposals[proposalID]?.payload?.executeAfterCreate == true
                else { return nil }
                try validateIssueExecutionSelection(
                    snapshot: preflight,
                    projectID: projectID,
                    request: execution
                )
            }
            let response: AcceptChannelProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.acceptChannelProposal(
                    organizationID: organizationID,
                    channelID: channelID,
                    proposalID: proposalID
                ),
                method: "POST",
                token: token,
                body: AcceptChannelProposalRequest(
                    projectId: projectID,
                    execution: execution
                ),
                as: AcceptChannelProposalResponse.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            let normalizedExecutionProposal: IssueExecutionProposal? =
                response.executionProposal.flatMap { candidate in
                issueExecutionProposalMatchesCreatedRun(
                    candidate,
                    projectID: response.projectId,
                    runID: response.resultRunId
                ) ? candidate : nil
            }
            if let execution {
                guard let proposal = normalizedExecutionProposal,
                      let dispatch = response.dispatch,
                      issueExecutionApprovalResponseMatches(
                          proposal: proposal,
                          projectID: response.projectId,
                          runID: response.resultRunId,
                          dispatch: dispatch,
                          expectedProposalID: proposal.id,
                          request: execution
                      )
                else { throw MobileAPIError.invalidResponse }
            }
            let normalizedResponse = AcceptChannelProposalResponse(
                outcome: response.outcome,
                projectId: response.projectId,
                resultRunId: response.resultRunId,
                resultItems: response.resultItems,
                executionProposal: normalizedExecutionProposal,
                dispatch: response.dispatch
            )
            if proposalRevisions[proposalID, default: 0] != expectedProposalRevision {
                var latest = latestProposals[proposalID]
                if latest?.status != .accepted {
                    let beforeRefreshRevision = authoritativeLoadRevision
                    if let parentID = expectedFocusedThreadParentID {
                        await openThread(channelID: channelID, parentMessageID: parentID)
                    } else {
                        await openChannel(channelID)
                    }
                    guard
                        authoritativeLoadRevision == (beforeRefreshRevision &+ 1),
                        focusedChannelID == expectedFocusedChannelID,
                        focusedThreadParentID == expectedFocusedThreadParentID
                    else { return nil }
                    latest = latestProposals[proposalID]
                }
                if latest?.status == .accepted,
                   let projectID = latest?.projectId,
                   let runID = latest?.resultRunId {
                    return AcceptChannelProposalResponse(
                        outcome: .alreadyAccepted,
                        projectId: projectID,
                        resultRunId: runID,
                        resultItems: latest?.resultItems,
                        executionProposal: executionProposal(
                            forCreateProposalID: proposalID
                        ),
                        dispatch: response.dispatch
                    )
                }
                // A pending proposal on the accepted target is the reservation
                // phase of this same successful request. A reopen clears that
                // target, so only this exact post-response state may fall
                // through and apply the response.
                guard
                    errorMessage == nil,
                    latest?.status == .pending,
                    latest?.projectId == normalizedResponse.projectId
                else { return nil }
            }
            for index in messages.indices where messages[index].proposal?.id == proposalID {
                messages[index].proposal = acceptedProposal(
                    messages[index].proposal,
                    response: normalizedResponse
                )
            }
            for index in thread.indices where thread[index].proposal?.id == proposalID {
                thread[index].proposal = acceptedProposal(
                    thread[index].proposal,
                    response: normalizedResponse
                )
            }
            if let executionProposal = normalizedResponse.executionProposal {
                applyCreatedExecutionProposal(
                    executionProposal,
                    createProposalID: proposalID
                )
            }
            latestProposals[proposalID] = messages
                .compactMap(\.proposal)
                .first(where: { $0.id == proposalID })
                ?? thread.compactMap(\.proposal).first(where: { $0.id == proposalID })
            proposalRevisions[proposalID, default: 0] &+= 1
            errorMessage = nil
            let droppedMismatchedExecutionProposal = response.executionProposal != nil &&
                normalizedResponse.executionProposal == nil
            if (requestsExecutionFollowUp && normalizedResponse.executionProposal == nil) ||
                droppedMismatchedExecutionProposal {
                let beforeRefreshRevision = authoritativeLoadRevision
                if let parentID = expectedFocusedThreadParentID {
                    await openThread(channelID: channelID, parentMessageID: parentID)
                } else {
                    await openChannel(channelID)
                }
                guard
                    authoritativeLoadRevision == (beforeRefreshRevision &+ 1),
                    focusedChannelID == expectedFocusedChannelID,
                    focusedThreadParentID == expectedFocusedThreadParentID
                else { return nil }
            }
            return normalizedResponse
        } catch {
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func declineProposal(channelID: UUID, proposalID: UUID) async -> Bool {
        guard let organizationID, let token else { return false }
        guard focusedChannelID == channelID else { return false }
        guard acceptingProposalID == nil,
              decliningProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              latestProposals[proposalID]?.status == .pending
        else { return false }
        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedChannelID = focusedChannelID
        let expectedFocusedThreadParentID = focusedThreadParentID
        decliningProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               decliningProposalID == proposalID {
                decliningProposalID = nil
            }
        }
        do {
            let _: DeclineChannelProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.declineChannelProposal(
                    organizationID: organizationID,
                    channelID: channelID,
                    proposalID: proposalID
                ),
                method: "POST",
                token: token,
                body: nil,
                as: DeclineChannelProposalResponse.self
            )
            guard expectedGeneration == generation,
                  expectedFocusRevision == authoritativeLoadRevision,
                  expectedFocusedChannelID == focusedChannelID,
                  expectedFocusedThreadParentID == focusedThreadParentID
            else { return false }
            for index in messages.indices where messages[index].proposal?.id == proposalID {
                messages[index].proposal = declinedProposal(messages[index].proposal)
            }
            for index in thread.indices where thread[index].proposal?.id == proposalID {
                thread[index].proposal = declinedProposal(thread[index].proposal)
            }
            latestProposals[proposalID] = messages.compactMap(\.proposal).first {
                $0.id == proposalID
            } ?? thread.compactMap(\.proposal).first { $0.id == proposalID }
            proposalRevisions[proposalID, default: 0] &+= 1
            cacheFocusedConversation()
            cacheFocusedThread()
            errorMessage = nil
            return true
        } catch {
            guard expectedGeneration == generation else { return false }
            errorMessage = CompanionStore.message(for: error)
            return false
        }
    }

    func acceptExecutionProposal(
        channelID: UUID,
        proposalID: UUID,
        request: AcceptIssueExecutionProposalRequest
    ) async -> AcceptChannelExecutionProposalResponse? {
        guard let organizationID, let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        guard channels.first(where: { $0.id == channelID })?.archivedAt == nil else {
            return nil
        }
        guard acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil
        else { return nil }
        guard latestExecutionProposals[proposalID]?.status == .pending else { return nil }

        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedChannelID = focusedChannelID
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = proposalRevisions[proposalID, default: 0]
        guard let expectedProposal = latestExecutionProposals[proposalID] else { return nil }
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        approvingExecutionProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               approvingExecutionProposalID == proposalID {
                approvingExecutionProposalID = nil
            }
        }

        do {
            let preflight: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: expectedProposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID,
                proposalRevisions[proposalID, default: 0] == expectedProposalRevision,
                latestExecutionProposals[proposalID] == expectedProposal
            else { return nil }
            _ = try validateIssueExecutionApproval(
                snapshot: preflight,
                proposal: expectedProposal,
                request: request
            )

            let response: AcceptChannelExecutionProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.acceptChannelExecutionProposal(
                    organizationID: organizationID,
                    channelID: channelID,
                    proposalID: proposalID
                ),
                method: "POST",
                token: token,
                body: request,
                as: AcceptChannelExecutionProposalResponse.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }

            guard response.projectId == expectedProposal.projectId,
                  response.runId == expectedProposal.runId,
                  issueExecutionApprovalResponseMatches(
                      proposal: response.proposal,
                      projectID: response.projectId,
                      runID: response.runId,
                      dispatch: response.dispatch,
                      expectedProposalID: proposalID,
                      request: request
                  )
            else { throw MobileAPIError.invalidResponse }
            let acceptedSnapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: response.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            guard issueExecutionApprovalAcceptedStateMatches(
                run: acceptedSnapshot.runs.first(where: { $0.id == response.runId }),
                request: request
            ) else { throw IssueExecutionApprovalError.stateChanged }

            if proposalRevisions[proposalID, default: 0] != expectedProposalRevision {
                var latest = latestExecutionProposals[proposalID]
                if latest?.status != .accepted {
                    let beforeRefreshRevision = authoritativeLoadRevision
                    if let parentID = expectedFocusedThreadParentID {
                        await openThread(channelID: channelID, parentMessageID: parentID)
                    } else {
                        await openChannel(channelID)
                    }
                    guard
                        authoritativeLoadRevision == (beforeRefreshRevision &+ 1),
                        focusedChannelID == expectedFocusedChannelID,
                        focusedThreadParentID == expectedFocusedThreadParentID
                    else { return nil }
                    latest = latestExecutionProposals[proposalID]
                }
                if latest?.status == .accepted {
                    guard latest?.projectId == response.projectId,
                          latest?.runId == response.runId
                    else { return nil }
                    return response
                }
                guard errorMessage == nil, latest?.status == .pending else { return nil }
            }

            applyAcceptedExecutionProposal(response.proposal)
            errorMessage = nil
            return response
        } catch {
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                expectedFocusedChannelID == focusedChannelID,
                expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func prepareExecutionProposal(
        channelID: UUID,
        proposalID: UUID
    ) async -> ExecutionApprovalContext? {
        guard let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        guard channels.first(where: { $0.id == channelID })?.archivedAt == nil else {
            return nil
        }
        guard acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              let proposal = latestExecutionProposals[proposalID],
              proposal.status == .pending
        else { return nil }

        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = proposalRevisions[proposalID, default: 0]
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        preparingExecutionProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               preparingExecutionProposalID == proposalID {
                preparingExecutionProposalID = nil
            }
        }

        do {
            let snapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == expectedFocusedThreadParentID,
                proposalRevisions[proposalID, default: 0] == expectedProposalRevision,
                latestExecutionProposals[proposalID] == proposal
            else { return nil }
            _ = try validateIssueExecutionApproval(
                snapshot: snapshot,
                proposal: proposal
            )
            errorMessage = nil
            return ExecutionApprovalContext(proposalID: proposalID, snapshot: snapshot)
        } catch {
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == expectedFocusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func prepareCreateExecutionProposal(
        channelID: UUID,
        proposalID: UUID,
        projectID: UUID
    ) async -> ExecutionApprovalContext? {
        guard let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        guard channels.first(where: { $0.id == channelID })?.archivedAt == nil else {
            return nil
        }
        guard acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              let proposal = latestProposals[proposalID],
              proposal.payload?.executeAfterCreate == true,
              proposal.projectId == nil || proposal.projectId == projectID
        else { return nil }

        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = proposalRevisions[proposalID, default: 0]
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        preparingExecutionProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               preparingExecutionProposalID == proposalID {
                preparingExecutionProposalID = nil
            }
        }

        do {
            let snapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: projectID),
                token: token,
                as: DashboardSnapshot.self
            )
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == expectedFocusedThreadParentID,
                proposalRevisions[proposalID, default: 0] == expectedProposalRevision,
                latestProposals[proposalID] == proposal
            else { return nil }
            try validateIssueExecutionSelection(
                snapshot: snapshot,
                projectID: projectID
            )
            errorMessage = nil
            return ExecutionApprovalContext(proposalID: proposalID, snapshot: snapshot)
        } catch {
            guard
                expectedGeneration == generation,
                expectedAcceptanceRevision == acceptanceRevision,
                expectedFocusRevision == authoritativeLoadRevision,
                focusedChannelID == channelID,
                focusedThreadParentID == expectedFocusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func acceptSkillExecutionProposal(
        channelID: UUID,
        proposalID: UUID,
        request: AcceptAgentSkillExecutionProposalRequest
    ) async -> AcceptAgentSkillExecutionProposalResponse? {
        guard let organizationID, let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        guard channels.first(where: { $0.id == channelID })?.archivedAt == nil else {
            return nil
        }
        guard acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              let expectedProposal = latestSkillExecutionProposals[proposalID],
              expectedProposal.status == .pending
        else { return nil }
        let requestedWorkerID = request.workerId?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard expectedProposal.executionMode == .conversation
            ? request.workerId == nil
            : requestedWorkerID?.isEmpty == false &&
                requestedWorkerID == request.workerId
        else { return nil }

        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedChannelID = focusedChannelID
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = skillExecutionProposalRevisions[
            proposalID,
            default: 0
        ]
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        approvingSkillExecutionProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               approvingSkillExecutionProposalID == proposalID {
                approvingSkillExecutionProposalID = nil
            }
        }

        do {
            let preflight: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: expectedProposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard expectedGeneration == generation,
                  expectedAcceptanceRevision == acceptanceRevision,
                  expectedFocusRevision == authoritativeLoadRevision,
                  expectedFocusedChannelID == focusedChannelID,
                  expectedFocusedThreadParentID == focusedThreadParentID,
                  skillExecutionProposalRevisions[proposalID, default: 0] ==
                    expectedProposalRevision,
                  latestSkillExecutionProposals[proposalID] == expectedProposal
            else { return nil }
            _ = try validateAgentSkillExecutionApproval(
                snapshot: preflight,
                proposal: expectedProposal,
                request: request
            )

            let response: AcceptAgentSkillExecutionProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.acceptChannelSkillExecutionProposal(
                    organizationID: organizationID,
                    channelID: channelID,
                    proposalID: proposalID
                ),
                method: "POST",
                token: token,
                body: request,
                as: AcceptAgentSkillExecutionProposalResponse.self
            )
            guard expectedGeneration == generation,
                  expectedAcceptanceRevision == acceptanceRevision,
                  expectedFocusRevision == authoritativeLoadRevision,
                  expectedFocusedChannelID == focusedChannelID,
                  expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            guard agentSkillExecutionApprovalResponseMatches(
                response: response,
                expected: expectedProposal,
                request: request
            ) else { throw MobileAPIError.invalidResponse }

            if skillExecutionProposalRevisions[proposalID, default: 0] !=
                expectedProposalRevision {
                var latest = latestSkillExecutionProposals[proposalID]
                if latest?.status != .accepted {
                    let beforeRefreshRevision = authoritativeLoadRevision
                    if let parentID = expectedFocusedThreadParentID {
                        await openThread(channelID: channelID, parentMessageID: parentID)
                    } else {
                        await openChannel(channelID)
                    }
                    guard authoritativeLoadRevision == (beforeRefreshRevision &+ 1),
                          focusedChannelID == expectedFocusedChannelID,
                          focusedThreadParentID == expectedFocusedThreadParentID
                    else { return nil }
                    latest = latestSkillExecutionProposals[proposalID]
                }
                if latest?.status == .accepted {
                    guard latest?.resultSessionId == response.proposal.resultSessionId
                    else { return nil }
                    return response
                }
                guard errorMessage == nil, latest == expectedProposal else { return nil }
            }

            applyAcceptedSkillExecutionProposal(response.proposal)
            errorMessage = nil
            return response
        } catch {
            guard expectedGeneration == generation,
                  expectedAcceptanceRevision == acceptanceRevision,
                  expectedFocusRevision == authoritativeLoadRevision,
                  expectedFocusedChannelID == focusedChannelID,
                  expectedFocusedThreadParentID == focusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func prepareSkillExecutionProposal(
        channelID: UUID,
        proposalID: UUID
    ) async -> SkillExecutionApprovalContext? {
        guard let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        guard channels.first(where: { $0.id == channelID })?.archivedAt == nil else {
            return nil
        }
        guard acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              let proposal = latestSkillExecutionProposals[proposalID],
              proposal.status == .pending
        else { return nil }

        let expectedGeneration = generation
        let expectedFocusRevision = authoritativeLoadRevision
        let expectedFocusedThreadParentID = focusedThreadParentID
        let expectedProposalRevision = skillExecutionProposalRevisions[
            proposalID,
            default: 0
        ]
        acceptanceRevision &+= 1
        let expectedAcceptanceRevision = acceptanceRevision
        preparingSkillExecutionProposalID = proposalID
        defer {
            if expectedGeneration == generation,
               expectedAcceptanceRevision == acceptanceRevision,
               preparingSkillExecutionProposalID == proposalID {
                preparingSkillExecutionProposalID = nil
            }
        }

        do {
            let snapshot: DashboardSnapshot = try await api.get(
                MobileAPIContract.Endpoint.dashboard(projectID: proposal.projectId),
                token: token,
                as: DashboardSnapshot.self
            )
            guard expectedGeneration == generation,
                  expectedAcceptanceRevision == acceptanceRevision,
                  expectedFocusRevision == authoritativeLoadRevision,
                  focusedChannelID == channelID,
                  focusedThreadParentID == expectedFocusedThreadParentID,
                  skillExecutionProposalRevisions[proposalID, default: 0] ==
                    expectedProposalRevision,
                  latestSkillExecutionProposals[proposalID] == proposal
            else { return nil }
            _ = try validateAgentSkillExecutionApproval(
                snapshot: snapshot,
                proposal: proposal
            )
            errorMessage = nil
            return SkillExecutionApprovalContext(
                proposalID: proposalID,
                snapshot: snapshot
            )
        } catch {
            guard expectedGeneration == generation,
                  expectedAcceptanceRevision == acceptanceRevision,
                  expectedFocusRevision == authoritativeLoadRevision,
                  focusedChannelID == channelID,
                  focusedThreadParentID == expectedFocusedThreadParentID
            else { return nil }
            errorMessage = CompanionStore.message(for: error)
            return nil
        }
    }

    func dismissError() {
        errorMessage = nil
    }

    func captureFocus(channelID: UUID, threadParentID: UUID?) -> FocusContext? {
        guard focusedChannelID == channelID, focusedThreadParentID == threadParentID else {
            return nil
        }
        return FocusContext(
            revision: authoritativeLoadRevision,
            channelID: channelID,
            threadParentID: threadParentID
        )
    }

    func focusIsCurrent(_ context: FocusContext) -> Bool {
        context.revision == authoritativeLoadRevision &&
            context.channelID == focusedChannelID &&
            context.threadParentID == focusedThreadParentID
    }

    private func invalidateProposalAcceptancePresentation() {
        acceptanceRevision &+= 1
        acceptingProposalID = nil
        decliningProposalID = nil
        approvingExecutionProposalID = nil
        preparingExecutionProposalID = nil
        approvingSkillExecutionProposalID = nil
        preparingSkillExecutionProposalID = nil
    }

    private func acceptedProposal(
        _ proposal: ChannelMessage.Proposal?,
        response: AcceptChannelProposalResponse
    ) -> ChannelMessage.Proposal? {
        guard let proposal else { return nil }
        return ChannelMessage.Proposal(
            id: proposal.id,
            actionType: proposal.actionType,
            status: .accepted,
            projectId: response.projectId,
            payload: proposal.payload,
            resultRunId: response.resultRunId,
            resultItems: response.resultItems ?? []
        )
    }

    private func declinedProposal(
        _ proposal: ChannelMessage.Proposal?
    ) -> ChannelMessage.Proposal? {
        guard let proposal else { return nil }
        return ChannelMessage.Proposal(
            id: proposal.id,
            actionType: proposal.actionType,
            status: .declined,
            projectId: proposal.projectId,
            payload: proposal.payload,
            resultRunId: nil,
            resultItems: []
        )
    }

    private func applyAcceptedExecutionProposal(_ proposal: IssueExecutionProposal) {
        for index in messages.indices
            where messages[index].executionProposal?.id == proposal.id {
            messages[index].executionProposal = proposal
        }
        for index in thread.indices
            where thread[index].executionProposal?.id == proposal.id {
            thread[index].executionProposal = proposal
        }
        latestExecutionProposals[proposal.id] = proposal
        proposalRevisions[proposal.id, default: 0] &+= 1
    }

    private func applyAcceptedSkillExecutionProposal(
        _ proposal: AgentSkillExecutionProposal
    ) {
        for index in messages.indices
            where messages[index].skillExecutionProposal?.id == proposal.id {
            messages[index].skillExecutionProposal = proposal
        }
        for index in thread.indices
            where thread[index].skillExecutionProposal?.id == proposal.id {
            thread[index].skillExecutionProposal = proposal
        }
        latestSkillExecutionProposals[proposal.id] = proposal
        skillExecutionProposalRevisions[proposal.id, default: 0] &+= 1
    }

    private func applyCreatedExecutionProposal(
        _ proposal: IssueExecutionProposal,
        createProposalID: UUID
    ) {
        var affectedMessageIDs: Set<UUID> = []
        for index in messages.indices
            where messages[index].proposal?.id == createProposalID {
            affectedMessageIDs.insert(messages[index].id)
            messages[index].executionProposal = proposal
        }
        for index in thread.indices
            where thread[index].proposal?.id == createProposalID {
            affectedMessageIDs.insert(thread[index].id)
            thread[index].executionProposal = proposal
        }
        for messageID in affectedMessageIDs {
            if let previousID = executionProposalIDsByMessage[messageID],
               previousID != proposal.id {
                latestExecutionProposals.removeValue(forKey: previousID)
                proposalRevisions[previousID, default: 0] &+= 1
            }
            executionProposalIDsByMessage[messageID] = proposal.id
        }
        if latestExecutionProposals[proposal.id] != proposal {
            latestExecutionProposals[proposal.id] = proposal
            proposalRevisions[proposal.id, default: 0] &+= 1
        }
    }

    private func executionProposal(
        forCreateProposalID proposalID: UUID
    ) -> IssueExecutionProposal? {
        messages.first(where: { $0.proposal?.id == proposalID })?
            .executionProposal
            ?? thread.first(where: { $0.proposal?.id == proposalID })?
                .executionProposal
    }

    private func recordProposalMessages(_ incoming: [ChannelMessage]) {
        var recordedCreate: Set<UUID> = []
        var recordedExecution: Set<UUID> = []
        var recordedSkillExecution: Set<UUID> = []
        for message in incoming {
            if let proposal = message.proposal,
               recordedCreate.insert(proposal.id).inserted {
                if latestProposals[proposal.id] != proposal {
                    latestProposals[proposal.id] = proposal
                    proposalRevisions[proposal.id, default: 0] &+= 1
                }
            }

            let previousExecutionID = executionProposalIDsByMessage[message.id]
            let nextExecutionID = message.executionProposal?.id
            if let previousExecutionID, previousExecutionID != nextExecutionID {
                invalidateExecutionProposal(previousExecutionID)
            }
            if let nextExecutionID {
                executionProposalIDsByMessage[message.id] = nextExecutionID
            } else {
                executionProposalIDsByMessage.removeValue(forKey: message.id)
            }
            if let proposal = message.executionProposal,
               recordedExecution.insert(proposal.id).inserted,
               latestExecutionProposals[proposal.id] != proposal {
                latestExecutionProposals[proposal.id] = proposal
                proposalRevisions[proposal.id, default: 0] &+= 1
            }

            let previousSkillExecutionID = skillExecutionProposalIDsByMessage[message.id]
            let nextSkillExecutionID = message.skillExecutionProposal?.id
            if let previousSkillExecutionID,
               previousSkillExecutionID != nextSkillExecutionID {
                invalidateSkillExecutionProposal(previousSkillExecutionID)
            }
            if let nextSkillExecutionID {
                skillExecutionProposalIDsByMessage[message.id] = nextSkillExecutionID
            } else {
                skillExecutionProposalIDsByMessage.removeValue(forKey: message.id)
            }
            if let proposal = message.skillExecutionProposal,
               recordedSkillExecution.insert(proposal.id).inserted,
               latestSkillExecutionProposals[proposal.id] != proposal {
                latestSkillExecutionProposals[proposal.id] = proposal
                skillExecutionProposalRevisions[proposal.id, default: 0] &+= 1
            }
        }
    }

    private func invalidateExecutionProposal(_ proposalID: UUID) {
        latestExecutionProposals.removeValue(forKey: proposalID)
        proposalRevisions[proposalID, default: 0] &+= 1
        acceptanceRevision &+= 1
        if approvingExecutionProposalID == proposalID {
            approvingExecutionProposalID = nil
        }
        if preparingExecutionProposalID == proposalID {
            preparingExecutionProposalID = nil
        }
    }

    private func invalidateSkillExecutionProposal(_ proposalID: UUID) {
        latestSkillExecutionProposals.removeValue(forKey: proposalID)
        skillExecutionProposalRevisions[proposalID, default: 0] &+= 1
        acceptanceRevision &+= 1
        if approvingSkillExecutionProposalID == proposalID {
            approvingSkillExecutionProposalID = nil
        }
        if preparingSkillExecutionProposalID == proposalID {
            preparingSkillExecutionProposalID = nil
        }
    }

    private func invalidateExecutionProposals(forMessageIDs messageIDs: Set<UUID>) {
        for messageID in messageIDs {
            if let proposalID = executionProposalIDsByMessage.removeValue(
                forKey: messageID
            ) {
                invalidateExecutionProposal(proposalID)
            }
            if let proposalID = skillExecutionProposalIDsByMessage.removeValue(
                forKey: messageID
            ) {
                invalidateSkillExecutionProposal(proposalID)
            }
        }
    }

    private func isDirectMessage(channelID: UUID) -> Bool {
        channels.first(where: { $0.id == channelID })?.isDirectMessage == true
    }

    private func apply(_ delta: ChannelDeltaResponse) {
        if let incomingReplies = delta.agentReplies {
            mergeAgentReplies(incomingReplies)
        }
        let removedChannelIDs = Set(delta.removedChannelIds)
        var nextChannels = channels.filter { !removedChannelIDs.contains($0.id) }
        for updated in delta.channels {
            if let index = nextChannels.firstIndex(where: { $0.id == updated.id }) {
                nextChannels[index] = updated
            } else {
                nextChannels.append(updated)
            }
        }
        channels = nextChannels
        for removedChannelID in removedChannelIDs {
            cachedConversations.removeValue(forKey: removedChannelID)
            cachedConversationOrder.removeAll { $0 == removedChannelID }
        }
        cachedThreads = cachedThreads.filter {
            !removedChannelIDs.contains($0.key.channelID)
        }
        cachedThreadOrder.removeAll { removedChannelIDs.contains($0.channelID) }
        if let focusedChannelID,
           nextChannels.contains(where: { $0.id == focusedChannelID && $0.hasUnread == true }) {
            Task { await markChannelRead(focusedChannelID) }
        }

        if let focusedChannelID,
           delta.channels.contains(where: {
               $0.id == focusedChannelID && $0.archivedAt != nil
           }) {
            invalidateProposalAcceptancePresentation()
        }

        let removedMessageIDs = Set(delta.removedMessageIds)
        let stabilizedMessages = preservingLocallyAcceptedExecutionProposals(
            in: delta.messages
        )
        updateCachedThreads(
            with: stabilizedMessages,
            removing: removedMessageIDs
        )

        if let focusedChannelID, removedChannelIDs.contains(focusedChannelID) {
            authoritativeLoadRevision &+= 1
            invalidateProposalAcceptancePresentation()
            self.focusedChannelID = nil
            focusedThreadParentID = nil
            messages = []
            thread = []
            members = []
            agents = []
            agentReplies = []
            activityFrames = [:]
            activityTask?.cancel()
            activityTask = nil
            activityExpiryTask?.cancel()
            activityExpiryTask = nil
            return
        }

        guard let focusedChannelID else { return }
        invalidateExecutionProposals(forMessageIDs: removedMessageIDs)
        recordProposalMessages(stabilizedMessages)
        let relevant = stabilizedMessages.filter { $0.channelId == focusedChannelID }
        optimisticMessageIDs.subtract(relevant.map(\.id))
        var updatedMessages = Self.mergeMessages(
            messages,
            updates: relevant.filter { $0.parentMessageId == nil },
            removing: removedMessageIDs
        )
        if isDirectMessage(channelID: focusedChannelID) {
            // A direct message reads as one continuous conversation, so
            // replies to loaded roots join the timeline instead of waiting
            // behind a thread summary chip.
            let timelineIDs = Set(updatedMessages.map(\.id))
            updatedMessages = Self.mergeMessages(
                updatedMessages,
                updates: relevant.filter { reply in
                    guard let parentMessageID = reply.parentMessageId else { return false }
                    return timelineIDs.contains(parentMessageID) ||
                        timelineIDs.contains(reply.id)
                },
                removing: removedMessageIDs
            )
        }
        messages = updatedMessages

        guard let focusedThreadParentID else { return }
        thread = Self.mergeMessages(
            thread,
            updates: relevant.filter {
                $0.id == focusedThreadParentID ||
                    $0.parentMessageId == focusedThreadParentID
            },
            removing: removedMessageIDs
        )
    }

    /// Deltas may have been produced before this client approved the proposal.
    /// Keep the accepted local value for the same proposal ID; a null or a new
    /// ID still passes through so authoritative tombstones and replacements win.
    private func preservingLocallyAcceptedExecutionProposals(
        in incoming: [ChannelMessage]
    ) -> [ChannelMessage] {
        incoming.map { message in
            var stabilized = message
            if let incomingProposal = message.executionProposal,
               incomingProposal.status == .pending,
               let accepted = latestExecutionProposals[incomingProposal.id],
               accepted.status == .accepted {
                stabilized.executionProposal = accepted
            }
            if let incomingProposal = message.skillExecutionProposal,
               incomingProposal.status == .pending,
               let accepted = latestSkillExecutionProposals[incomingProposal.id],
               accepted.status == .accepted {
                stabilized.skillExecutionProposal = accepted
            }
            return stabilized
        }
    }

    private func upsertChannel(_ updated: ChannelSummary) {
        if let index = channels.firstIndex(where: { $0.id == updated.id }) {
            channels[index] = updated
        } else {
            channels.append(updated)
        }
    }

    private func cacheFocusedConversation() {
        guard let focusedChannelID else { return }
        let boundedMessages = Array(messages.suffix(Self.cachedMessageLimit))
        let cacheCursor = messages.count > boundedMessages.count
            ? boundedMessages.first?.id
            : nextMessageCursor
        storeCachedConversation(CachedChannelConversation(
            messages: boundedMessages,
            nextMessageCursor: cacheCursor,
            members: members,
            agents: agents
        ), for: focusedChannelID)
    }

    private func mergeAuthoritativeSnapshot(
        current: [ChannelMessage],
        incoming: [ChannelMessage]
    ) -> [ChannelMessage] {
        let incomingIDs = Set(incoming.map(\.id))
        let pending = current.filter {
            optimisticMessageIDs.contains($0.id) && !incomingIDs.contains($0.id)
        }
        optimisticMessageIDs.subtract(incomingIDs)
        return Self.mergeMessages(incoming, updates: pending, removing: [])
    }

    private func cacheFocusedThread() {
        guard let focusedChannelID, let focusedThreadParentID else { return }
        let key = ThreadCacheKey(
            channelID: focusedChannelID,
            parentMessageID: focusedThreadParentID
        )
        storeCachedThread(thread, for: key)
    }

    private func updateCachedThreads(
        with messages: [ChannelMessage],
        removing removedMessageIDs: Set<UUID>
    ) {
        for key in Array(cachedThreads.keys) {
            if removedMessageIDs.contains(key.parentMessageID) {
                cachedThreads.removeValue(forKey: key)
                cachedThreadOrder.removeAll { $0 == key }
                continue
            }
            let relevantMessages = messages.filter {
                $0.channelId == key.channelID &&
                    ($0.id == key.parentMessageID ||
                        $0.parentMessageId == key.parentMessageID)
            }
            cachedThreads[key] = boundedThreadMessages(Self.mergeMessages(
                cachedThreads[key] ?? [],
                updates: relevantMessages,
                removing: removedMessageIDs
            ), for: key)
        }
    }

    private func cachedConversation(for channelID: UUID) -> CachedChannelConversation? {
        guard let cached = cachedConversations[channelID] else { return nil }
        cachedConversationOrder.removeAll { $0 == channelID }
        cachedConversationOrder.append(channelID)
        return cached
    }

    private func storeCachedConversation(
        _ conversation: CachedChannelConversation,
        for channelID: UUID
    ) {
        cachedConversations[channelID] = conversation
        cachedConversationOrder.removeAll { $0 == channelID }
        cachedConversationOrder.append(channelID)
        while cachedConversationOrder.count > Self.cachedConversationLimit {
            cachedConversations.removeValue(forKey: cachedConversationOrder.removeFirst())
        }
    }

    private func cachedThread(for key: ThreadCacheKey) -> [ChannelMessage] {
        guard let cached = cachedThreads[key] else { return [] }
        cachedThreadOrder.removeAll { $0 == key }
        cachedThreadOrder.append(key)
        return cached
    }

    private func storeCachedThread(_ messages: [ChannelMessage], for key: ThreadCacheKey) {
        cachedThreads[key] = boundedThreadMessages(messages, for: key)
        cachedThreadOrder.removeAll { $0 == key }
        cachedThreadOrder.append(key)
        while cachedThreadOrder.count > Self.cachedThreadLimit {
            cachedThreads.removeValue(forKey: cachedThreadOrder.removeFirst())
        }
    }

    private func boundedThreadMessages(
        _ messages: [ChannelMessage],
        for key: ThreadCacheKey
    ) -> [ChannelMessage] {
        guard messages.count > Self.cachedMessageLimit else { return messages }
        let root = messages.first { $0.id == key.parentMessageID }
        let replies = messages.filter { $0.id != key.parentMessageID }
        let replyLimit = root == nil
            ? Self.cachedMessageLimit
            : Self.cachedMessageLimit - 1
        return (root.map { [$0] } ?? []) + Array(replies.suffix(replyLimit))
    }

    private func markChannelRead(_ channelID: UUID) async {
        guard let organizationID, let token else { return }
        if let index = channels.firstIndex(where: { $0.id == channelID }) {
            var updated = channels[index]
            updated.hasUnread = false
            updated.lastReadAt = Date()
            channels[index] = updated
        }
        do {
            let response: ChannelReadResponse = try await api.send(
                MobileAPIContract.Endpoint.channelRead(
                    organizationID: organizationID,
                    channelID: channelID
                ),
                method: "PUT",
                token: token,
                body: ChannelReadRequest(lastReadAt: Date()),
                as: ChannelReadResponse.self
            )
            upsertChannel(response.channel)
        } catch {
            // The next catalog snapshot restores unread if the write failed.
        }
    }

    private static func mergeMessages(
        _ current: [ChannelMessage],
        updates: [ChannelMessage],
        removing removedIDs: Set<UUID>
    ) -> [ChannelMessage] {
        var byID = Dictionary(
            uniqueKeysWithValues: current
                .filter { !removedIDs.contains($0.id) }
                .map { ($0.id, $0) }
        )
        for message in updates where !removedIDs.contains(message.id) {
            byID[message.id] = message
        }
        return byID.values.sorted { left, right in
            if left.createdAt != right.createdAt {
                return left.createdAt < right.createdAt
            }
            return left.id.uuidString < right.id.uuidString
        }
    }

    private static func agentReplyIsTerminal(_ reply: ChannelAgentReply) -> Bool {
        reply.status == .completed || reply.status == .failed
    }

    private static func agentReplyStatusRank(_ reply: ChannelAgentReply) -> Int {
        if agentReplyIsTerminal(reply) { return 2 }
        return reply.status == .running ? 1 : 0
    }

    private static func agentReplyShouldReplace(
        current: ChannelAgentReply,
        incoming: ChannelAgentReply
    ) -> Bool {
        let currentTerminal = agentReplyIsTerminal(current)
        let incomingTerminal = agentReplyIsTerminal(incoming)
        if currentTerminal != incomingTerminal { return incomingTerminal }
        if incoming.updatedAt != current.updatedAt {
            return incoming.updatedAt > current.updatedAt
        }
        return agentReplyStatusRank(incoming) > agentReplyStatusRank(current)
    }

    private func mergeAgentReplies(_ incoming: [ChannelAgentReply]) {
        for reply in incoming where Self.agentReplyIsTerminal(reply) {
            agentReplyTombstones.insert(reply.id)
        }
        var byID = Dictionary(uniqueKeysWithValues: agentReplies.map { ($0.id, $0) })
        for reply in incoming {
            if agentReplyTombstones.contains(reply.id),
               !Self.agentReplyIsTerminal(reply) {
                continue
            }
            if let current = byID[reply.id],
               !Self.agentReplyShouldReplace(current: current, incoming: reply) {
                continue
            }
            byID[reply.id] = reply
        }
        agentReplies = byID.values.sorted { $0.id.uuidString < $1.id.uuidString }
    }

    private func replaceAgentReplies(
        with incoming: [ChannelAgentReply],
        channelID: UUID,
        previous: [ChannelAgentReply]
    ) {
        let authoritative = incoming.filter { $0.channelId == channelID }
        let concurrent = agentReplies.filter { $0.channelId == channelID }
        let incomingIDs = Set(authoritative.map(\.id))
        for reply in previous where !incomingIDs.contains(reply.id) {
            agentReplyTombstones.insert(reply.id)
        }
        for reply in authoritative where Self.agentReplyIsTerminal(reply) {
            agentReplyTombstones.insert(reply.id)
        }
        agentReplies = authoritative
            .filter {
                !agentReplyTombstones.contains($0.id) ||
                    Self.agentReplyIsTerminal($0)
            }
            .sorted { $0.id.uuidString < $1.id.uuidString }
        mergeAgentReplies(concurrent)
    }

    func typingStatuses(messageIDs: Set<UUID>) -> [AgentTypingStatus] {
        let now = Date()
        var byAgentID: [UUID: AgentTypingStatus] = [:]
        for reply in agentReplies where
            reply.channelId == focusedChannelID &&
            (reply.status == .queued || reply.status == .running) &&
            messageIDs.contains(reply.parentMessageId) {
            let name = agents.first(where: { $0.agentId == reply.agentId })?.name ?? "Agent"
            let frame = activityFrames[reply.id]
            let liveActivity = frame?.attempt == reply.attempts &&
                    (frame?.expiresAt ?? .distantPast) > now
                ? frame?.activity
                : nil
            byAgentID[reply.agentId] = AgentTypingStatus(
                id: reply.id,
                agentName: name,
                activity: liveActivity
            )
        }
        return Array(byAgentID.values).sorted { $0.agentName < $1.agentName }
    }

    private func startActivitySynchronization() {
        activityTask?.cancel()
        activityTask = nil
        guard managesRealtime,
              let realtime,
              let organizationID,
              let channelID = focusedChannelID,
              let token,
              isForeground
        else { return }
        let expectedGeneration = generation
        activityTask = Task { [weak self] in
            var reconnectAttempt = 0
            while !Task.isCancelled {
                guard let self,
                      expectedGeneration == self.generation,
                      self.focusedChannelID == channelID,
                      self.isForeground
                else { return }
                do {
                    let events = realtime.channelActivityEvents(
                        MobileAPIContract.Endpoint.channelActivityEvents(
                            organizationID: organizationID,
                            channelID: channelID
                        ),
                        token: token
                    )
                    for try await frame in events {
                        guard !Task.isCancelled,
                              expectedGeneration == self.generation,
                              self.focusedChannelID == channelID,
                              self.isForeground,
                              frame.channelId == channelID
                        else { return }
                        reconnectAttempt = 0
                        self.applyActivityFrame(frame)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    // Durable reply state keeps the generic typing fallback while
                    // this best-effort activity socket reconnects.
                }
                reconnectAttempt = min(reconnectAttempt + 1, 5)
                do {
                    try await Task.sleep(for: .seconds(1 << reconnectAttempt))
                } catch {
                    return
                }
            }
        }
    }

    private func applyActivityFrame(_ frame: ChannelAgentActivityFrame) {
        if let previous = activityFrames[frame.replyJobId],
           previous.attempt > frame.attempt ||
            (previous.attempt == frame.attempt && previous.sequence >= frame.sequence) {
            return
        }
        // Keep null activity as a short-lived high-water tombstone so a delayed
        // lower-sequence publish cannot restore stale UI after completion.
        if frame.expiresAt > Date() {
            activityFrames[frame.replyJobId] = frame
        } else {
            activityFrames.removeValue(forKey: frame.replyJobId)
        }
        scheduleActivityExpiry()
    }

    private func scheduleActivityExpiry() {
        activityExpiryTask?.cancel()
        activityExpiryTask = nil
        guard let expiresAt = activityFrames.values.map(\.expiresAt).min() else { return }
        let delay = max(0, expiresAt.timeIntervalSinceNow)
        activityExpiryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(Int64(delay * 1_000) + 1))
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            let now = Date()
            self.activityFrames = self.activityFrames.filter { $0.value.expiresAt > now }
            self.scheduleActivityExpiry()
        }
    }

    private func startSynchronization() {
        pollingTask?.cancel()
        realtimeTask?.cancel()
        guard isForeground, organizationID != nil, token != nil else {
            pollingTask = nil
            realtimeTask = nil
            return
        }
        let expectedGeneration = generation
        let interval = pollInterval
        pollingTask = Task { [weak self] in
            if let self {
                guard expectedGeneration == self.generation else { return }
                if self.syncCursor == nil {
                    await self.refresh()
                } else {
                    await self.refreshChanges()
                }
            }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: interval)
                } catch {
                    return
                }
                guard
                    !Task.isCancelled,
                    let self,
                    expectedGeneration == self.generation
                else { return }
                await self.refreshChanges()
            }
        }

        guard managesRealtime,
              let realtime,
              let organizationID,
              let token
        else {
            realtimeTask = nil
            return
        }
        realtimeTask = Task { [weak self] in
            var reconnectAttempt = 0
            while !Task.isCancelled {
                guard
                    let self,
                    expectedGeneration == self.generation,
                    self.isForeground
                else { return }
                let cursor = self.syncCursor ?? 0
                do {
                    let events = realtime.realtimeEvents(
                        MobileAPIContract.Endpoint.channelEvents(
                            organizationID: organizationID,
                            cursor: cursor
                        ),
                        token: token
                    )
                    for try await event in events {
                        guard
                            !Task.isCancelled,
                            expectedGeneration == self.generation,
                            self.isForeground
                        else { return }
                        reconnectAttempt = 0
                        if case .channelsChanged(let cursor) = event,
                           cursor > (self.syncCursor ?? -1) {
                            await self.refreshChanges()
                        }
                    }
                } catch is CancellationError {
                    return
                } catch {
                    // The low-frequency delta refresh remains authoritative
                    // while the notification connection reconnects.
                }
                reconnectAttempt = min(reconnectAttempt + 1, 5)
                do {
                    try await Task.sleep(for: .seconds(1 << reconnectAttempt))
                } catch {
                    return
                }
            }
        }
    }

    func receiveRealtimeNotification(
        _ notification: ChannelRealtimeNotification
    ) async {
        guard case .channelsChanged(let cursor) = notification,
              cursor > (syncCursor ?? -1),
              isForeground
        else { return }
        await refreshChanges()
    }

    func groups(
        activeProjectID: UUID?,
        projects: [Project],
        commonLabel: String,
        unknownProjectLabel: String
    ) -> [ChannelGroup] {
        ChannelGrouping.groups(
            channels: channels,
            activeProjectID: activeProjectID,
            projectNames: Dictionary(
                projects.map { ($0.id, $0.name) },
                uniquingKeysWith: { first, _ in first }
            ),
            commonLabel: commonLabel,
            unknownProjectLabel: unknownProjectLabel
        )
    }
}
