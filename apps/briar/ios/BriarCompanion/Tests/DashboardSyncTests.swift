import SwiftProtobuf
import XCTest
@testable import BriarCompanion

final class DashboardSyncTests: XCTestCase {
    private let project = Project(
        id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        name: "Briar",
        issueKeyPrefix: "AH",
        scheduleTabEnabled: true,
        icon: nil,
        organizationId: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        organizationName: "Wordbricks",
        role: .owner,
        createdAt: Date(timeIntervalSince1970: 1_700_000_000)
    )

    func testGeneratedDeltaPreservesPatchPresenceAndRejectsUnsafeCursor() throws {
        var workflow = BriarTypes_AutoHuntWorkflow()
        workflow.version = 2
        workflow.execution = BriarTypes_WorkflowExecution()
        workflow.completion = BriarTypes_WorkflowCompletion()

        var settings = BriarAPI_ProjectSettings()
        settings.linear = BriarAPI_LinearSettings()
        settings.workflow = workflow

        var response = BriarAPI_SyncDashboardResponse()
        response.cursor = 42
        response.reset = true
        response.members = BriarAPI_OrganizationMembersPatch()
        response.settings = settings
        response.generatedAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_700_000_100)
        )

        let mapped = try DashboardDelta(connectMessage: response)

        XCTAssertTrue(mapped.reset)
        XCTAssertEqual(mapped.cursor, 42)
        XCTAssertEqual(mapped.members, [])
        XCTAssertNil(mapped.conversationNotifications)
        XCTAssertEqual(mapped.settings?.workflow.version, 2)

        response.cursor = 9_007_199_254_740_992
        XCTAssertThrowsError(try DashboardDelta(connectMessage: response)) {
            XCTAssertEqual($0 as? MobileAPIError, .invalidResponse)
        }
    }

    @MainActor
    func testResetFetchesAndReplacesWithAuthoritativeSnapshot() async {
        let initialRun = run(
            id: "33333333-3333-4333-8333-333333333333",
            title: "Stale"
        )
        let replacementRun = run(
            id: "44444444-4444-4444-8444-444444444444",
            title: "Authoritative"
        )
        let initial = snapshot(cursor: 10, runs: [initialRun])
        let replacement = snapshot(cursor: 20, runs: [replacementRun])
        let reset = DashboardDelta(
            cursor: 11,
            hasMore: false,
            reset: true,
            runs: [],
            deletedRunIds: [],
            project: nil,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_200)
        )
        let api = DashboardConnectStub(snapshots: [initial, replacement], deltas: [reset])
        let store = DashboardStore(api: api, pollInterval: .seconds(3_600))

        store.select(projectID: project.id, token: "token")
        await store.refresh(forceSnapshot: true)
        await store.refresh()

        XCTAssertEqual(store.snapshot, replacement)
        let calls = await api.calls()
        XCTAssertEqual(calls, ["get", "sync:10", "get"])
        store.applicationDidEnterBackground()
    }

    func testCurrentUserRequiresGeneratedMessageAndKeepsScalarPresence() throws {
        XCTAssertThrowsError(try CurrentUser(connectMessage: BriarAPI_GetCurrentUserResponse())) {
            XCTAssertEqual($0 as? MobileAPIError, .invalidResponse)
        }

        var user = BriarAPI_User()
        user.id = "user-1"
        user.name = "Briar User"
        user.email = "user@example.com"
        var response = BriarAPI_GetCurrentUserResponse()
        response.user = user

        let mapped = try CurrentUser(connectMessage: response)

        XCTAssertEqual(mapped.id, "user-1")
        XCTAssertNil(mapped.username)
        XCTAssertNil(mapped.image)
    }

    func testMergeAppliesUpsertsAndTombstones() {
        let removed = run(
            id: "33333333-3333-4333-8333-333333333333",
            title: "Remove"
        )
        let retained = run(
            id: "44444444-4444-4444-8444-444444444444",
            title: "Before"
        )
        let updated = run(
            id: "44444444-4444-4444-8444-444444444444",
            title: "After"
        )
        let delta = DashboardDelta(
            cursor: 2,
            hasMore: false,
            runs: [updated],
            deletedRunIds: [removed.id],
            project: nil,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_300)
        )

        let merged = DashboardMerge.apply(
            delta,
            to: snapshot(cursor: 1, runs: [removed, retained])
        )

        XCTAssertEqual(merged.runs, [updated])
        XCTAssertEqual(merged.cursor, 2)
    }

    private func snapshot(cursor: Int, runs: [DashboardRun]) -> DashboardSnapshot {
        DashboardSnapshot(
            project: project,
            runs: runs,
            cursor: cursor,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func run(id: String, title: String) -> DashboardRun {
        DashboardRun(
            id: UUID(uuidString: id)!,
            title: title,
            status: .running,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }
}

private actor DashboardConnectStub: MobileAPIClientProtocol {
    private var snapshots: [DashboardSnapshot]
    private var deltas: [DashboardDelta]
    private var recordedCalls: [String] = []

    init(snapshots: [DashboardSnapshot], deltas: [DashboardDelta]) {
        self.snapshots = snapshots
        self.deltas = deltas
    }

    func getDashboard(projectID: UUID, token: String) async throws -> DashboardSnapshot {
        recordedCalls.append("get")
        guard !snapshots.isEmpty else { throw MobileAPIError.invalidResponse }
        return snapshots.removeFirst()
    }

    func syncDashboard(
        projectID: UUID,
        cursor: Int,
        token: String
    ) async throws -> DashboardDelta {
        recordedCalls.append("sync:\(cursor)")
        guard !deltas.isEmpty else { throw MobileAPIError.invalidResponse }
        return deltas.removeFirst()
    }

    func calls() -> [String] { recordedCalls }
}
