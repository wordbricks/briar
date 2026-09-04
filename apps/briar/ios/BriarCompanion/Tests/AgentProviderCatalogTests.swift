import BriarContracts
import XCTest
@testable import BriarCompanion

/// `briar.types.v1.AgentProvider` owns provider identity (ADR-0008). The app
/// keeps its own `AgentProvider` for display and persistence, so these tests are
/// what turns a proto-only provider into a build failure instead of a silent
/// `invalidResponse` at runtime.
final class AgentProviderCatalogTests: XCTestCase {
    private var wireProviders: [BriarTypes_AgentProvider] {
        BriarTypes_AgentProvider.allCases.filter { $0 != .unspecified }
    }

    func testCoversEveryWireProviderInEnumOrder() {
        XCTAssertEqual(AgentProvider.allCases.map(\.wire), wireProviders)
    }

    func testDecodesEveryWireProvider() {
        for value in wireProviders {
            XCTAssertEqual(AgentProvider(wire: value)?.wire, value)
        }
        XCTAssertNil(AgentProvider(wire: .unspecified))
        XCTAssertNil(AgentProvider(wire: .UNRECOGNIZED(9_999)))
    }

    func testNamesEveryProvider() {
        for provider in AgentProvider.allCases {
            XCTAssertFalse(provider.displayName.isEmpty)
        }
    }
}
