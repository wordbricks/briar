import Foundation

@MainActor
final class ChannelsStore: ObservableObject {
    @Published private(set) var channels: [ChannelSummary] = []
    @Published private(set) var messages: [ChannelMessage] = []
    @Published private(set) var thread: [ChannelMessage] = []
    @Published private(set) var members: [ChannelMember] = []
    @Published private(set) var agents: [ChannelAgentSummary] = []
    @Published private(set) var loading = false
    @Published private(set) var sending = false
    @Published private(set) var acceptingProposalID: UUID?
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private let attachmentReference: @Sendable () -> String
    private let pollInterval: Duration
    private let maxDeltaPagesPerRefresh: Int
    private var organizationID: UUID?
    private var token: String?
    private var syncCursor: Int?
    private var focusedChannelID: UUID?
    private var focusedThreadParentID: UUID?
    private var generation = 0
    private var isForeground = true
    private var pollingTask: Task<Void, Never>?

    init(
        api: any MobileAPIClientProtocol,
        pollInterval: Duration = .seconds(3),
        maxDeltaPagesPerRefresh: Int = 20,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
        self.pollInterval = pollInterval
        self.maxDeltaPagesPerRefresh = min(max(maxDeltaPagesPerRefresh, 1), 20)
        self.attachmentReference = attachmentReference
    }

    func select(organizationID: UUID?, token: String?) {
        guard self.organizationID != organizationID || self.token != token else { return }
        generation += 1
        pollingTask?.cancel()
        pollingTask = nil
        self.organizationID = organizationID
        self.token = token
        syncCursor = nil
        focusedChannelID = nil
        focusedThreadParentID = nil
        channels = []
        messages = []
        thread = []
        members = []
        agents = []
        loading = false
        errorMessage = nil
        guard organizationID != nil, token != nil else { return }
        if isForeground { startPolling() }
    }

    func refresh() async {
        guard let organizationID, let token else { return }
        let expectedGeneration = generation
        loading = channels.isEmpty
        defer {
            if expectedGeneration == generation {
                loading = false
            }
        }
        do {
            let response: ChannelsResponse = try await api.get(
                MobileAPIContract.Endpoint.channels(organizationID: organizationID),
                token: token,
                as: ChannelsResponse.self
            )
            guard !Task.isCancelled, expectedGeneration == generation else { return }
            channels = response.channels
            // Only the first authoritative snapshot establishes the cursor.
            // Advancing it on a later list-only refresh could skip messages.
            if syncCursor == nil {
                syncCursor = response.cursor
            }
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, expectedGeneration == generation else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func openChannel(_ channelID: UUID) async {
        guard let organizationID, let token else { return }
        let expectedGeneration = generation
        focusedChannelID = channelID
        focusedThreadParentID = nil
        loading = true
        messages = []
        thread = []
        members = []
        agents = []
        defer {
            if expectedGeneration == generation,
               focusedChannelID == channelID,
               focusedThreadParentID == nil {
                loading = false
            }
        }
        do {
            let response: ChannelDetailResponse = try await api.get(
                MobileAPIContract.Endpoint.channel(
                    organizationID: organizationID,
                    channelID: channelID
                ),
                token: token,
                as: ChannelDetailResponse.self
            )
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                focusedChannelID == channelID
            else { return }
            messages = response.messages
            members = response.members
            agents = response.agents
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
                focusedChannelID == channelID,
                focusedThreadParentID == nil
            else { return }
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func openThread(channelID: UUID, parentMessageID: UUID) async {
        guard let organizationID, let token else { return }
        let expectedGeneration = generation
        focusedChannelID = channelID
        focusedThreadParentID = parentMessageID
        loading = true
        thread = []
        defer {
            if expectedGeneration == generation,
               focusedChannelID == channelID,
               focusedThreadParentID == parentMessageID {
                loading = false
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
                focusedChannelID == channelID,
                focusedThreadParentID == parentMessageID
            else { return }
            thread = response.messages
            errorMessage = nil
        } catch {
            guard
                !Task.isCancelled,
                expectedGeneration == generation,
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
        guard !loading else { return }
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
                    !loading,
                    syncCursor == requestedCursor
                else { return }
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
        startPolling()
    }

    func applicationDidEnterBackground() {
        isForeground = false
        pollingTask?.cancel()
        pollingTask = nil
    }

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
            let apply: (ChannelMessage) -> ChannelMessage = { candidate in
                candidate.id == response.message.id ? response.message : candidate
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
        acceptingProposalID = proposalID
        defer { acceptingProposalID = nil }
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
            let accepted = ChannelMessage.Proposal(
                id: proposalID,
                actionType: .createIssue,
                status: .accepted,
                projectId: response.projectId,
                resultRunId: response.resultRunId
            )
            for index in messages.indices where messages[index].proposal?.id == proposalID {
                messages[index].proposal = accepted
            }
            for index in thread.indices where thread[index].proposal?.id == proposalID {
                thread[index].proposal = accepted
            }
            errorMessage = nil
            return response
        } catch {
            errorMessage = CompanionStore.message(for: error)
            return nil
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

        if let focusedChannelID, removedChannelIDs.contains(focusedChannelID) {
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
        let relevant = delta.messages.filter { $0.channelId == focusedChannelID }
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

    private func startPolling() {
        pollingTask?.cancel()
        guard isForeground, organizationID != nil, token != nil else {
            pollingTask = nil
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
