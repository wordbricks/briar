import XCTest
@testable import BriarCompanion

/// Home grouping must match `src/lib/channel-grouping.ts` so both mobile
/// surfaces order the same organization identically.
final class ChannelGroupingTests: XCTestCase {
    private let projectOne = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let projectTwo = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private let projectThree = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!

    private func channel(
        _ id: String,
        _ name: String,
        project: UUID?,
        archived: Date? = nil,
        kind: ChannelSummary.Kind? = nil,
        lastMessageAt: Date? = nil
    ) -> ChannelSummary {
        ChannelSummary(
            id: UUID(uuidString: id)!,
            organizationId: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
            slug: name.lowercased(),
            name: name,
            topic: nil,
            visibility: .org,
            defaultProjectId: project,
            archivedAt: archived,
            memberCount: 1,
            agentCount: 0,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000),
            kind: kind,
            lastMessageAt: lastMessageAt
        )
    }

    private func groups(
        _ channels: [ChannelSummary],
        activeProjectID: UUID?,
        names: [UUID: String]
    ) -> [ChannelGroup] {
        ChannelGrouping.groups(
            channels: channels,
            activeProjectID: activeProjectID,
            projectNames: names,
            commonLabel: "공통 채널",
            unknownProjectLabel: "다른 프로젝트"
        )
    }

    func testOrdersCommonThenActiveProjectThenOthersByName() {
        let result = groups(
            [
                channel("aaaaaaaa-0000-4000-8000-000000000003", "Sprout", project: projectTwo),
                channel("aaaaaaaa-0000-4000-8000-000000000001", "General", project: nil),
                channel("aaaaaaaa-0000-4000-8000-000000000002", "Briar dev", project: projectOne),
                channel("aaaaaaaa-0000-4000-8000-000000000004", "Acorn", project: projectThree),
            ],
            activeProjectID: projectOne,
            names: [projectOne: "Briar", projectTwo: "Sprout", projectThree: "Acorn"]
        )

        XCTAssertEqual(result.map(\.kind), [.common, .currentProject, .otherProject, .otherProject])
        XCTAssertEqual(result.map(\.label), ["공통 채널", "Briar", "Acorn", "Sprout"])
    }

    func testOmitsCommonGroupWhenEveryChannelBelongsToAProject() {
        let result = groups(
            [channel("aaaaaaaa-0000-4000-8000-000000000002", "Briar dev", project: projectOne)],
            activeProjectID: projectOne,
            names: [projectOne: "Briar"]
        )

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.first?.kind, .currentProject)
    }

    func testOmitsActiveProjectGroupWhenItHasNoChannels() {
        let result = groups(
            [
                channel("aaaaaaaa-0000-4000-8000-000000000001", "General", project: nil),
                channel("aaaaaaaa-0000-4000-8000-000000000003", "Sprout", project: projectTwo),
            ],
            activeProjectID: projectOne,
            names: [projectOne: "Briar", projectTwo: "Sprout"]
        )

        XCTAssertEqual(result.map(\.kind), [.common, .otherProject])
    }

    func testKeepsChannelWhoseProjectIsNotVisibleUnderNeutralLabel() {
        let result = groups(
            [channel("aaaaaaaa-0000-4000-8000-000000000005", "Secret", project: projectThree)],
            activeProjectID: projectOne,
            names: [projectOne: "Briar"]
        )

        XCTAssertEqual(result.map(\.label), ["다른 프로젝트"])
        XCTAssertEqual(result.first?.channels.map(\.name), ["Secret"])
    }

    func testDropsArchivedChannels() {
        let result = groups(
            [
                channel("aaaaaaaa-0000-4000-8000-000000000001", "General", project: nil),
                channel(
                    "aaaaaaaa-0000-4000-8000-000000000006",
                    "Old",
                    project: nil,
                    archived: Date(timeIntervalSince1970: 1_700_000_500)
                ),
            ],
            activeProjectID: nil,
            names: [:]
        )

        XCTAssertEqual(result.first?.channels.map(\.name), ["General"])
    }

    func testSortsChannelsInsideAGroupByName() {
        let result = groups(
            [
                channel("aaaaaaaa-0000-4000-8000-00000000000c", "Zeta", project: nil),
                channel("aaaaaaaa-0000-4000-8000-00000000000a", "Alpha", project: nil),
                channel("aaaaaaaa-0000-4000-8000-00000000000b", "Mid", project: nil),
            ],
            activeProjectID: nil,
            names: [:]
        )

        XCTAssertEqual(result.first?.channels.map(\.name), ["Alpha", "Mid", "Zeta"])
    }

    func testReturnsNothingWithoutVisibleChannels() {
        XCTAssertTrue(groups([], activeProjectID: projectOne, names: [:]).isEmpty)
    }

    func testHomeGroupingExcludesDirectMessages() {
        let result = groups(
            [
                channel(
                    "aaaaaaaa-0000-4000-8000-000000000001",
                    "General",
                    project: nil
                ),
                channel(
                    "aaaaaaaa-0000-4000-8000-000000000002",
                    "Honey",
                    project: nil,
                    kind: .directMessage
                ),
            ],
            activeProjectID: nil,
            names: [:]
        )

        XCTAssertEqual(result.flatMap(\.channels).map(\.name), ["General"])
    }

    func testDirectMessagesDecodeParticipantsAndSortByLatestActivity() throws {
        let json = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000001",
          "organizationId": "99999999-9999-4999-8999-999999999999",
          "kind": "dm",
          "slug": "dm-honey",
          "name": "Briar User, Honey",
          "topic": null,
          "visibility": "private",
          "defaultProjectId": null,
          "archivedAt": null,
          "memberCount": 1,
          "agentCount": 1,
          "createdAt": "2026-08-01T01:00:00Z",
          "updatedAt": "2026-08-01T02:00:00Z",
          "lastMessageAt": "2026-08-01T02:00:00Z",
          "lastMessagePreview": "작업 결과를 확인해 주세요.",
          "hasUnread": true,
          "dmParticipants": [
            {"type":"user","id":"fixture-user","name":"Briar User","image":null},
            {"type":"agent","id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Honey","image":null}
          ]
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dm = try decoder.decode(ChannelSummary.self, from: Data(json.utf8))
        var olderDM = channel(
            "aaaaaaaa-0000-4000-8000-000000000002",
            "Older",
            project: nil,
            kind: .directMessage,
            lastMessageAt: Date(timeIntervalSince1970: 1_700_000_100)
        )
        olderDM.dmParticipants = []

        XCTAssertTrue(dm.isDirectMessage)
        XCTAssertEqual(dm.directMessageDisplayName(currentUserID: "fixture-user"), "Honey")
        XCTAssertEqual(dm.lastMessagePreview, "작업 결과를 확인해 주세요.")
        XCTAssertEqual(DirectMessageOrdering.byMostRecent([olderDM, dm]).map(\.id), [dm.id, olderDM.id])
        XCTAssertEqual(
            dm.directMessageParticipants(excluding: "fixture-user").map(\.profileKey),
            ["agent:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
        )
    }

    func testDirectMessageProfileUsesAgentRosterDetailsWhenPresent() {
        let participant = DirectMessageParticipant(
            type: .agent,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Honey",
            image: nil
        )
        let agent = ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
            provider: "codex",
            model: "gpt-5.4",
            projectId: nil,
            description: "제품 작업을 돕는 Organization Agent",
            responsibility: "Review mobile product work.",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let profile = ConversationProfileTarget.resolve(
            participant: participant,
            members: [],
            agents: [agent]
        )

        guard case let .agent(resolved) = profile else {
            return XCTFail("expected an agent profile")
        }
        XCTAssertEqual(resolved.name, "Honey")
        XCTAssertEqual(resolved.image, agent.avatar)
        XCTAssertEqual(resolved.provider, "codex")
        XCTAssertEqual(resolved.model, "gpt-5.4")
        XCTAssertEqual(resolved.responsibility, "Review mobile product work.")
        XCTAssertNil(resolved.projectId)
    }

    func testDirectMessageProfileFallsBackToCatalogParticipant() {
        let participant = DirectMessageParticipant(
            type: .agent,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "QA Engineer",
            image: nil
        )

        let profile = ConversationProfileTarget.resolve(
            participant: participant,
            members: [],
            agents: []
        )

        guard case let .agent(resolved) = profile else {
            return XCTFail("expected an agent profile")
        }
        XCTAssertEqual(resolved.name, "QA Engineer")
        XCTAssertNil(resolved.provider)
        XCTAssertNil(resolved.responsibility)
    }

    func testGroupDirectMessageListsEveryParticipantExceptTheCurrentUser() throws {
        let json = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000003",
          "organizationId": "99999999-9999-4999-8999-999999999999",
          "kind": "dm",
          "slug": "dm-group",
          "name": "Honey, Growth Marketer",
          "topic": null,
          "visibility": "private",
          "defaultProjectId": null,
          "archivedAt": null,
          "memberCount": 1,
          "agentCount": 2,
          "createdAt": "2026-08-01T01:00:00Z",
          "updatedAt": "2026-08-01T02:00:00Z",
          "dmParticipants": [
            {"type":"user","id":"fixture-user","name":"Briar User","image":null},
            {"type":"agent","id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Honey","image":null},
            {"type":"agent","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","name":"Growth Marketer","image":null}
          ]
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let dm = try decoder.decode(ChannelSummary.self, from: Data(json.utf8))
        let participants = dm.directMessageParticipants(excluding: "fixture-user")

        XCTAssertEqual(participants.map(\.name), ["Honey", "Growth Marketer"])
        XCTAssertEqual(
            dm.directMessageDisplayName(currentUserID: "fixture-user"),
            "Honey, Growth Marketer"
        )
        XCTAssertGreaterThan(participants.count, 1)
    }

    func testReplyAuthorsDriveThreadSummaryPresentation() {
        let message = ChannelMessage(
            id: UUID(uuidString: "aaaaaaaa-0000-4000-8000-000000000001")!,
            channelId: UUID(uuidString: "bbbbbbbb-0000-4000-8000-000000000001")!,
            parentMessageId: nil,
            body: "Hello team",
            author: ChannelMessage.Author(
                type: .user,
                name: "Jay",
                image: "https://example.com/jay.png",
                provider: nil
            ),
            replyCount: 2,
            lastReplyAt: Date(timeIntervalSince1970: 1_700_000_100),
            replyAuthors: [
                ChannelMessage.Author(
                    type: .agent,
                    name: "Honey",
                    image: nil,
                    provider: "claude",
                    id: "66666666-6666-4666-8666-666666666666"
                ),
            ],
            document: nil,
            proposal: nil,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        XCTAssertEqual(message.replyAuthors.map(\.name), ["Honey"])
        XCTAssertEqual(
            ChannelReplySummaryPresentation.participants(for: message).map(\.name),
            ["Jay", "Honey"]
        )
        XCTAssertTrue(
            ChannelReplySummaryPresentation.isVisible(
                showsThreadSummary: true,
                isOptimistic: false,
                replyCount: message.replyCount
            )
        )
        XCTAssertFalse(
            ChannelReplySummaryPresentation.isVisible(
                showsThreadSummary: true,
                isOptimistic: false,
                replyCount: 0
            )
        )
    }

    func testMentionCandidatesAppearForAtSignAndInsertASelectedAgent() {
        let agent = ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
            provider: "claude",
            model: nil,
            projectId: nil,
            description: "Writing and editing support",
            responsibility: "Writing partner",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let candidates = ChannelMentions.candidates(
            members: [],
            agents: [agent],
            currentUserId: "user-1"
        )

        XCTAssertEqual(candidates.map(\.handle), ["Honey"])
        XCTAssertEqual(candidates.map(\.image), [agent.avatar])
        XCTAssertEqual(ChannelMentions.suggestions(in: "@h", candidates: candidates).map(\.handle), ["Honey"])
        XCTAssertEqual(ChannelMentions.suggestions(in: "@", candidates: candidates).map(\.handle), ["Honey"])
        XCTAssertEqual(ChannelMentions.insert(candidates[0], into: "확인 @hon"), "확인 @Honey ")
    }

    func testAtSignSuggestsEveryChannelRosterMember() {
        let agent = ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: nil,
            provider: "claude",
            model: nil,
            projectId: nil,
            description: "Writing and editing support",
            responsibility: "Writing partner",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let member = ChannelMember(
            userId: "user-2",
            name: "Sam",
            email: "sam@example.com",
            image: nil,
            role: "member",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let candidates = ChannelMentions.candidates(
            members: [member],
            agents: [agent],
            currentUserId: "user-1"
        )

        XCTAssertEqual(
            ChannelMentions.suggestions(in: "@", candidates: candidates),
            candidates
        )
    }

    func testMentionRecipientsStayAttachedOnlyWhileTheirPickedHandleRemains() {
        let member = ChannelMember(
            userId: "user-2",
            name: "Sam",
            email: "sam@example.com",
            image: nil,
            role: "member",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let targets = ChannelMentions.candidates(
            members: [member],
            agents: [],
            currentUserId: "user-1"
        )

        XCTAssertEqual(ChannelMentions.retained(in: "@sam 확인", mentions: targets), targets)
        XCTAssertTrue(ChannelMentions.retained(in: "sam 확인", mentions: targets).isEmpty)
    }

    func testMessageMentionsLinkOnlyKnownHandles() {
        let segments = MessageMentions.segments(
            "@Honey please ask @typed and @sam.",
            handles: ["Honey", "sam"]
        )
        let mentions = segments.compactMap { segment -> String? in
            if case let .mention(handle) = segment.kind { return handle }
            return nil
        }

        XCTAssertEqual(mentions, ["honey", "sam"])
        XCTAssertEqual(
            MessageMentions.markdownWithLinks("@Honey 확인", handles: ["Honey"]),
            "[@Honey](briar-mention://honey) 확인"
        )
        XCTAssertEqual(
            MessageMentions.markdownWithLinks("@typed 확인", handles: ["honey"]),
            "@typed 확인"
        )
    }

    func testIssueMentionCandidatesIncludeProjectAgentsAndMembers() {
        let member = OrganizationMember(
            userId: "user-2",
            name: "Sam",
            email: "sam@example.com",
            image: nil,
            role: "developer",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let agent = ProjectAgent(
            id: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            projectId: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            name: "Developer",
            avatar: nil,
            codexPet: nil,
            provider: .codex,
            model: nil,
            effort: nil,
            description: nil,
            responsibility: "Owns code changes",
            skill: "",
            skills: [],
            calendarColor: "#3275d5",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let candidates = MessageMentions.issueCandidates(
            members: [member],
            agents: [agent],
            currentUserId: "user-1"
        )

        XCTAssertEqual(candidates.map(\.handle), ["developer", "sam"])
        XCTAssertEqual(
            ChannelMentions.suggestions(in: "@s", candidates: candidates).map(\.handle),
            ["sam"]
        )
        XCTAssertEqual(
            ChannelMentions.suggestions(in: "@d", candidates: candidates).map(\.handle),
            ["developer"]
        )
    }

    func testChannelMentionHandlesResolveFromStructuredRecipients() {
        let agent = ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: nil,
            provider: "claude",
            model: nil,
            projectId: nil,
            description: "Writing and editing support",
            responsibility: "Writing partner",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let member = ChannelMember(
            userId: "user-2",
            name: "Sam",
            email: "sam@example.com",
            image: nil,
            role: "member",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let handles = MessageMentions.channelHandles(
            mentionedUserIds: ["user-2"],
            mentionedAgentIds: [agent.agentId],
            members: [member],
            agents: [agent]
        )

        XCTAssertEqual(handles, Set(["Honey", "sam"]))
    }

}
