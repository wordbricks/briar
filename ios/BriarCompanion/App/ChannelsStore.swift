import Foundation

@MainActor
final class ChannelsStore: ObservableObject {
    static let messagePageSize = 20

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

    @Published private(set) var channels: [ChannelSummary] = []
    @Published private(set) var messages: [ChannelMessage] = []
    @Published private(set) var thread: [ChannelMessage] = []
    @Published private(set) var members: [ChannelMember] = []
    @Published private(set) var agents: [ChannelAgentSummary] = []
    @Published private(set) var hasEarlierMessages = false
    @Published private(set) var loadingEarlierMessages = false
    @Published private(set) var loading = false
    @Published private(set) var sending = false
    @Published private(set) var acceptingProposalID: UUID?
    @Published private(set) var approvingExecutionProposalID: UUID?
    @Published private(set) var preparingExecutionProposalID: UUID?
    @Published private(set) var approvingSkillExecutionProposalID: UUID?
    @Published private(set) var preparingSkillExecutionProposalID: UUID?
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let realtime: (any MobileRealtimeClientProtocol)?
    private let attachmentReference: @Sendable () -> String
    private let pollInterval: Duration
    private let maxDeltaPagesPerRefresh: Int
    private var organizationID: UUID?
    private var token: String?
    private var syncCursor: Int?
    private var focusedChannelID: UUID?
    private var focusedThreadParentID: UUID?
    private var nextMessageCursor: UUID?
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
    private var isForeground = true
    private var changesRefreshRequested = false
    private var pollingTask: Task<Void, Never>?
    private var realtimeTask: Task<Void, Never>?

    init(
        api: any MobileAPIClientProtocol,
        realtime: (any MobileRealtimeClientProtocol)? = nil,
        pollInterval: Duration = .seconds(60),
        maxDeltaPagesPerRefresh: Int = 20,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
        self.realtime = realtime ?? (api as? any MobileRealtimeClientProtocol)
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
        focusedChannelID = nil
        focusedThreadParentID = nil
        nextMessageCursor = nil
        channels = []
        messages = []
        thread = []
        members = []
        agents = []
        hasEarlierMessages = false
        loadingEarlierMessages = false
        loading = false
        catalogRefreshInFlight = false
        conversationLoadInFlight = false
        acceptingProposalID = nil
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

    func openChannel(_ channelID: UUID) async {
        guard let organizationID, let token else { return }
        let previousMessageIDs = Set(messages.map(\.id)).union(thread.map(\.id))
        if focusedChannelID != channelID || focusedThreadParentID != nil {
            invalidateProposalAcceptancePresentation()
        }
        let expectedGeneration = generation
        authoritativeLoadRevision &+= 1
        let expectedLoadRevision = authoritativeLoadRevision
        focusedChannelID = channelID
        focusedThreadParentID = nil
        conversationLoadInFlight = true
        updateLoadingState()
        messages = []
        nextMessageCursor = nil
        hasEarlierMessages = false
        loadingEarlierMessages = false
        thread = []
        members = []
        agents = []
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
            messages = response.messages
            nextMessageCursor = response.nextCursor
            hasEarlierMessages = response.nextCursor != nil
            members = response.members
            agents = response.agents
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
        authoritativeLoadRevision &+= 1
        invalidateProposalAcceptancePresentation()
        focusedChannelID = nil
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
        authoritativeLoadRevision &+= 1
        invalidateProposalAcceptancePresentation()
        focusedThreadParentID = nil
        conversationLoadInFlight = false
        updateLoadingState()
    }

    func openThread(channelID: UUID, parentMessageID: UUID) async {
        guard let organizationID, let token else { return }
        let previousThreadMessageIDs = Set(thread.map(\.id))
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
        thread = []
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
            thread = response.messages
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
    }

    func applicationDidEnterBackground() {
        isForeground = false
        changesRefreshRequested = false
        pollingTask?.cancel()
        pollingTask = nil
        realtimeTask?.cancel()
        realtimeTask = nil
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

    /// A nil `parentMessageID` posts to the channel; otherwise into that thread.
    func send(
        channelID: UUID,
        parentMessageID: UUID?,
        body: String,
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
                        parentMessageId: parentMessageID,
                        mentionedUserIds: mentionedUserIds,
                        mentionedAgentIds: mentionedAgentIds
                    ),
                    as: CreateChannelMessageResponse.self
                )
            } else {
                let payload = try AttachmentMessagePayload(
                    body: trimmed,
                    attachments: attachments,
                    referenceGenerator: attachmentReference
                )
                response = try await api.upload(
                    path,
                    fields: [
                        "body": payload.body,
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
                messages.append(response.message)
            } else {
                thread.append(response.message)
            }
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    /// Toggles the current user's emoji reaction on a channel message.
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
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
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
        projectID: UUID
    ) async -> AcceptChannelProposalResponse? {
        guard let organizationID, let token else { return nil }
        guard focusedChannelID == channelID else { return nil }
        // Approval is a state-changing operation. Keep one request in flight so
        // repeated taps (including on another card) cannot race each other.
        guard acceptingProposalID == nil,
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
            let response: AcceptChannelProposalResponse = try await api.send(
                MobileAPIContract.Endpoint.acceptChannelProposal(
                    organizationID: organizationID,
                    channelID: channelID,
                    proposalID: proposalID
                ),
                method: "POST",
                token: token,
                body: AcceptChannelProposalRequest(projectId: projectID),
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
            let normalizedResponse = AcceptChannelProposalResponse(
                outcome: response.outcome,
                projectId: response.projectId,
                resultRunId: response.resultRunId,
                executionProposal: normalizedExecutionProposal
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
                        executionProposal: executionProposal(
                            forCreateProposalID: proposalID
                        )
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
        guard !request.workerId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              request.workerId == request.workerId.trimmingCharacters(
                  in: .whitespacesAndNewlines
              ),
              acceptingProposalID == nil,
              approvingExecutionProposalID == nil,
              preparingExecutionProposalID == nil,
              approvingSkillExecutionProposalID == nil,
              preparingSkillExecutionProposalID == nil,
              let expectedProposal = latestSkillExecutionProposals[proposalID],
              expectedProposal.status == .pending
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
                    guard latest?.resultSessionId == response.session.id else { return nil }
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
            resultRunId: response.resultRunId
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

    private func apply(_ delta: ChannelDeltaResponse) {
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

        if let focusedChannelID, removedChannelIDs.contains(focusedChannelID) {
            authoritativeLoadRevision &+= 1
            invalidateProposalAcceptancePresentation()
            self.focusedChannelID = nil
            focusedThreadParentID = nil
            messages = []
            thread = []
            members = []
            agents = []
            return
        }

        guard let focusedChannelID else { return }
        let removedMessageIDs = Set(delta.removedMessageIds)
        invalidateExecutionProposals(forMessageIDs: removedMessageIDs)
        let stabilizedMessages = preservingLocallyAcceptedExecutionProposals(
            in: delta.messages
        )
        recordProposalMessages(stabilizedMessages)
        let relevant = stabilizedMessages.filter { $0.channelId == focusedChannelID }
        messages = Self.mergeMessages(
            messages,
            updates: relevant.filter { $0.parentMessageId == nil },
            removing: removedMessageIDs
        )

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

        guard let realtime, let organizationID, let token else {
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
                        if event.topic == "channels",
                           event.cursor > (self.syncCursor ?? -1) {
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

    func groups(
        activeProjectID: UUID?,
        projects: [ProjectsResponse.Project],
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
