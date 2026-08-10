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
    private var organizationID: UUID?
    private var token: String?

    init(
        api: any MobileAPIClientProtocol,
        attachmentReference: @escaping @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) {
        self.api = api
        self.attachmentReference = attachmentReference
    }

    func select(organizationID: UUID?, token: String?) {
        guard self.organizationID != organizationID || self.token != token else { return }
        self.organizationID = organizationID
        self.token = token
        channels = []
        messages = []
        thread = []
        members = []
        agents = []
        guard organizationID != nil, token != nil else { return }
        Task { await refresh() }
    }

    func refresh() async {
        guard let organizationID, let token else { return }
        loading = channels.isEmpty
        defer { loading = false }
        do {
            let response: ChannelsResponse = try await api.get(
                MobileAPIContract.Endpoint.channels(organizationID: organizationID),
                token: token,
                as: ChannelsResponse.self
            )
            channels = response.channels
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func openChannel(_ channelID: UUID) async {
        guard let organizationID, let token else { return }
        loading = true
        messages = []
        thread = []
        members = []
        agents = []
        defer { loading = false }
        do {
            let response: ChannelDetailResponse = try await api.get(
                MobileAPIContract.Endpoint.channel(
                    organizationID: organizationID,
                    channelID: channelID
                ),
                token: token,
                as: ChannelDetailResponse.self
            )
            messages = response.messages
            members = response.members
            agents = response.agents
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
    }

    func openThread(channelID: UUID, parentMessageID: UUID) async {
        guard let organizationID, let token else { return }
        loading = true
        thread = []
        defer { loading = false }
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
            thread = response.messages
            errorMessage = nil
        } catch {
            errorMessage = CompanionStore.message(for: error)
        }
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
