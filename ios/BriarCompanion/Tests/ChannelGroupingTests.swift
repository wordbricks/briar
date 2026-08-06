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
}
