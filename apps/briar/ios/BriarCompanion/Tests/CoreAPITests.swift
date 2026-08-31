import Foundation
import XCTest
@testable import BriarCompanion

final class CoreAPITests: XCTestCase {
    func testMobileAPIErrorSurfacesReadableDescriptions() {
        XCTAssertEqual(
            MobileAPIError.httpStatus(400, "Invalid request").localizedDescription,
            "Invalid request"
        )
        XCTAssertEqual(
            MobileAPIError.httpStatus(401, "Unauthorized").localizedDescription,
            "세션이 만료되었습니다. 다시 로그인해 주세요."
        )
        XCTAssertFalse(
            MobileAPIError.invalidResponse.localizedDescription.contains("MobileAPIError")
        )
    }

}
