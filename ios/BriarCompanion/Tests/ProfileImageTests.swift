import XCTest
@testable import BriarCompanion

final class ProfileImageTests: XCTestCase {
    /// 1x1 red PNG
    private let samplePNGDataURL =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

    func testParsesDataURLAvatarPayloads() {
        guard case let .data(data) = ProfileImageSource.parse(samplePNGDataURL) else {
            return XCTFail("expected data URL source")
        }
        XCTAssertFalse(data.isEmpty)
        XCTAssertNotNil(ProfileImageSource.uiImage(from: samplePNGDataURL))
    }

    func testParsesRemoteHTTPSAvatarURLs() {
        let raw = "https://cdn.example.com/avatars/user.webp"
        guard case let .remote(url) = ProfileImageSource.parse(raw) else {
            return XCTFail("expected remote URL source")
        }
        XCTAssertEqual(url.absoluteString, raw)
    }

    func testRejectsEmptyAndUnsupportedPayloads() {
        XCTAssertNil(ProfileImageSource.parse(nil))
        XCTAssertNil(ProfileImageSource.parse("   "))
        XCTAssertNil(ProfileImageSource.parse("not-a-url"))
        XCTAssertNil(ProfileImageSource.parse("ftp://example.com/a.png"))
        XCTAssertNil(ProfileImageSource.parse("data:image/png,not-base64"))
    }

    func testDecodesAgentAvatarFromContractFixtureShape() throws {
        let agentJSON = """
        {
          "id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "projectId":"11111111-1111-4111-8111-111111111111",
          "name":"Auto Hunt agent",
          "avatar":"\(samplePNGDataURL)",
          "codexPet":null,
          "provider":"codex",
          "model":"gpt-5.4",
          "responsibility":"Hunt",
          "skill":"# skill",
          "calendarColor":"#3275d5",
          "createdAt":"2026-08-02T01:00:00Z",
          "updatedAt":"2026-08-02T01:00:00Z"
        }
        """
        let agent = try JSONDecoder.mobileContract.decode(
            ProjectAgent.self,
            from: Data(agentJSON.utf8)
        )
        XCTAssertEqual(agent.avatar, samplePNGDataURL)
        XCTAssertNotNil(ProfileImageSource.uiImage(from: agent.avatar))
    }

    func testDecodesMessageAuthorImageFromContractFixtureShape() throws {
        let messageJSON = """
        {
          "id":"99999999-9999-4999-8999-999999999999",
          "runId":"33333333-3333-4333-8333-333333333333",
          "parentMessageId":null,
          "body":"Hello",
          "author":{
            "id":"fixture-user",
            "name":"Briar User",
            "image":"\(samplePNGDataURL)",
            "provider":null
          },
          "replyCount":0,
          "createdAt":"2026-08-02T01:00:00Z",
          "updatedAt":"2026-08-02T01:00:00Z"
        }
        """
        let message = try JSONDecoder.mobileContract.decode(
            IssueMessage.self,
            from: Data(messageJSON.utf8)
        )
        XCTAssertEqual(message.author.image, samplePNGDataURL)
        XCTAssertNotNil(ProfileImageSource.uiImage(from: message.author.image))
    }
}
