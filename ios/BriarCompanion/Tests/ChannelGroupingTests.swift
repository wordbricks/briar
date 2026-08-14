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
        archived: Date? = nil
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
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
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

    func testDecodesAvatarAndLastReplyMetadataUsedByMessageRows() throws {
        let json = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000001",
          "channelId": "bbbbbbbb-0000-4000-8000-000000000001",
          "parentMessageId": null,
          "body": "Hello team",
          "author": {
            "type": "user",
            "name": "Jay",
            "image": "https://example.com/jay.png",
            "provider": null
          },
          "replyCount": 2,
          "lastReplyAt": "2026-08-01T08:00:00Z",
          "document": null,
          "createdAt": "2026-08-01T01:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let message = try decoder.decode(ChannelMessage.self, from: Data(json.utf8))

        XCTAssertEqual(message.author.image, "https://example.com/jay.png")
        XCTAssertEqual(message.replyCount, 2)
        XCTAssertNotNil(message.lastReplyAt)
    }

    func testDecodesAgentChannelMessageAuthorAvatar() throws {
        let json = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000001",
          "channelId": "bbbbbbbb-0000-4000-8000-000000000001",
          "parentMessageId": null,
          "body": "Agent report",
          "author": {
            "type": "agent",
            "id": "66666666-6666-4666-8666-666666666666",
            "name": "Honey",
            "provider": "claude",
            "image": "data:image/png;base64,cHJvamVjdC1hdmF0YXI="
          },
          "replyCount": 0,
          "lastReplyAt": null,
          "document": null,
          "createdAt": "2026-08-01T01:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let message = try decoder.decode(ChannelMessage.self, from: Data(json.utf8))

        XCTAssertEqual(message.author.type, .agent)
        XCTAssertEqual(
            message.author.image,
            "data:image/png;base64,cHJvamVjdC1hdmF0YXI="
        )
        XCTAssertEqual(message.author.provider, "claude")
    }

    func testMentionCandidatesAppearForAtSignAndInsertASelectedAgent() {
        let agent = ChannelAgentSummary(
            agentId: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            name: "Honey",
            avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
            provider: "claude",
            model: nil,
            projectId: nil,
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

    func testChannelMessageRequestEncodesStructuredMentionRecipients() throws {
        let request = CreateChannelMessageRequest(
            body: "@Honey @sam 확인",
            parentMessageId: nil,
            mentionedUserIds: ["user-2"],
            mentionedAgentIds: [UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!]
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )

        XCTAssertEqual(object["mentionedUserIds"] as? [String], ["user-2"])
        XCTAssertEqual(
            object["mentionedAgentIds"] as? [String],
            ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]
        )
    }

    func testChannelMessageDecodesStructuredMentionRecipients() throws {
        let json = """
        {
          "id": "44444444-4444-4444-8444-444444444444",
          "channelId": "33333333-3333-4333-8333-333333333333",
          "parentMessageId": null,
          "body": "@honey 온보딩 개편 계획서를 정리해줘",
          "author": {
            "type": "user",
            "name": "Jay",
            "image": null,
            "provider": null
          },
          "mentionedUserIds": [],
          "mentionedAgentIds": ["66666666-6666-4666-8666-666666666666"],
          "replyCount": 1,
          "lastReplyAt": "2026-08-06T00:04:00Z",
          "document": null,
          "proposal": null,
          "createdAt": "2026-08-06T00:03:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let message = try decoder.decode(ChannelMessage.self, from: Data(json.utf8))

        XCTAssertEqual(message.mentionedUserIds, [])
        XCTAssertEqual(
            message.mentionedAgentIds,
            [UUID(uuidString: "66666666-6666-4666-8666-666666666666")!]
        )
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

    func testIssueMentionCandidatesIncludeBriarAndMembers() {
        let member = OrganizationMember(
            userId: "user-2",
            name: "Sam",
            email: "sam@example.com",
            image: nil,
            role: "member",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let candidates = MessageMentions.issueCandidates(
            members: [member],
            currentUserId: "user-1"
        )

        XCTAssertEqual(candidates.map(\.handle), ["briar", "sam"])
        XCTAssertEqual(
            ChannelMentions.suggestions(in: "@s", candidates: candidates).map(\.handle),
            ["sam"]
        )
        XCTAssertEqual(
            ChannelMentions.suggestions(in: "@b", candidates: candidates).map(\.handle),
            ["briar"]
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

    func testChannelMessageDecodesAttachmentsAndDefaultsToEmpty() throws {
        let withAttachment = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000001",
          "channelId": "bbbbbbbb-0000-4000-8000-000000000001",
          "parentMessageId": null,
          "body": "스크린샷 공유합니다",
          "author": {
            "type": "user",
            "name": "Jay",
            "image": null,
            "provider": null
          },
          "mentionedUserIds": [],
          "mentionedAgentIds": [],
          "attachments": [
            {
              "id": "cccccccc-0000-4000-8000-000000000001",
              "filename": "design.png",
              "contentType": "image/png",
              "byteSize": 2048,
              "url": "/organizations/99999999-9999-4999-8999-999999999999/channels/bbbbbbbb-0000-4000-8000-000000000001/messages/aaaaaaaa-0000-4000-8000-000000000001/attachments/cccccccc-0000-4000-8000-000000000001"
            }
          ],
          "replyCount": 0,
          "lastReplyAt": null,
          "document": null,
          "createdAt": "2026-08-01T01:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let message = try decoder.decode(ChannelMessage.self, from: Data(withAttachment.utf8))

        XCTAssertEqual(message.attachments.count, 1)
        XCTAssertEqual(message.attachments[0].filename, "design.png")
        XCTAssertEqual(message.attachments[0].contentType, "image/png")
        XCTAssertEqual(message.attachments[0].byteSize, 2048)

        let withoutAttachment = """
        {
          "id": "aaaaaaaa-0000-4000-8000-000000000001",
          "channelId": "bbbbbbbb-0000-4000-8000-000000000001",
          "parentMessageId": null,
          "body": "Hello team",
          "author": {
            "type": "user",
            "name": "Jay",
            "image": null,
            "provider": null
          },
          "mentionedUserIds": [],
          "mentionedAgentIds": [],
          "replyCount": 0,
          "lastReplyAt": null,
          "document": null,
          "createdAt": "2026-08-01T01:00:00Z"
        }
        """
        let plain = try decoder.decode(ChannelMessage.self, from: Data(withoutAttachment.utf8))
        XCTAssertTrue(plain.attachments.isEmpty)
    }

    func testChannelMessageAttachmentFieldsRoundTripThroughJSONEncoder() throws {
        let attachment = ChannelMessageAttachment(
            id: UUID(uuidString: "cccccccc-0000-4000-8000-000000000001")!,
            filename: "design.png",
            contentType: "image/png",
            byteSize: 2048,
            url: "/organizations/99999999-9999-4999-8999-999999999999/channels/bbbbbbbb-0000-4000-8000-000000000001/messages/aaaaaaaa-0000-4000-8000-000000000001/attachments/cccccccc-0000-4000-8000-000000000001"
        )
        let encoded = try JSONEncoder().encode(attachment)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )

        XCTAssertEqual(object["filename"] as? String, "design.png")
        XCTAssertEqual(object["contentType"] as? String, "image/png")
        XCTAssertEqual(object["byteSize"] as? Int, 2048)
        XCTAssertTrue((object["url"] as? String)?.hasSuffix("/attachments/cccccccc-0000-4000-8000-000000000001") == true)
    }
}
