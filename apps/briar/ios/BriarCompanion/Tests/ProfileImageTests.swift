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
}
