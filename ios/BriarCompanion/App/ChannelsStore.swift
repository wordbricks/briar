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
    @Published private(set) var errorMessage: String?

    private let api: any MobileAPIClientProtocol
    private var organizationID: UUID?
    private var token: String?

    init(api: any MobileAPIClientProtocol) { self.api = api }

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
        mentions: [ChannelMentionTarget]
    ) async {
        guard let organizationID, let token else { return }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let response: CreateChannelMessageResponse = try await api.send(
                MobileAPIContract.Endpoint.channelMessages(
                    organizationID: organizationID,
                    channelID: channelID
                ),
                method: "POST",
                token: token,
                body: CreateChannelMessageRequest(
                    body: trimmed,
                    parentMessageId: parentMessageID,
                    mentionedUserIds: mentions.compactMap {
                        $0.kind == .user ? $0.recipientId : nil
                    },
                    mentionedAgentIds: mentions.compactMap {
                        $0.kind == .agent ? UUID(uuidString: $0.recipientId) : nil
                    }
                ),
                as: CreateChannelMessageResponse.self
            )
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
