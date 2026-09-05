import BriarContracts
import BriarContractsMocks
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

        var settings = BriarAPI_TeamSettings()
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
        let scenario = DashboardMockScenario(
            snapshots: [
                wireSnapshot(cursor: 10, run: initialRun),
                wireSnapshot(cursor: 20, run: replacementRun),
            ],
            deltas: [wireReset(cursor: 11)]
        )
        let dashboard = BriarAPI_DashboardServiceClientMock()
        dashboard.mockAsyncGetDashboard = { request in
            .init(result: .success(scenario.nextSnapshot(request: request)))
        }
        dashboard.mockAsyncSyncDashboard = { request in
            .init(result: .success(scenario.nextDelta(request: request)))
        }
        let store = DashboardStore(
            dashboardService: dashboard,
            pollInterval: .seconds(3_600)
        )

        store.select(projectID: project.id, token: "token")
        await store.refresh(forceSnapshot: true)
        await store.refresh()

        XCTAssertEqual(store.snapshot?.cursor, 20)
        XCTAssertEqual(store.snapshot?.runs.map(\.id), [replacementRun.id])
        XCTAssertEqual(store.snapshot?.runs.map(\.title), ["Authoritative"])
        XCTAssertEqual(scenario.calls, ["get", "sync:10", "get"])
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

    private func wireSnapshot(
        cursor: UInt64,
        run: DashboardRun
    ) -> BriarAPI_GetDashboardResponse {
        var projectMessage = BriarAPI_Team()
        projectMessage.id = project.id.uuidString.lowercased()
        projectMessage.name = project.name
        projectMessage.issueKeyPrefix = project.issueKeyPrefix
        projectMessage.scheduleTabEnabled = project.scheduleTabEnabled
        projectMessage.organizationID = project.organizationId.uuidString.lowercased()
        projectMessage.organizationName = project.organizationName
        projectMessage.role = .owner
        projectMessage.createdAt = Google_Protobuf_Timestamp(date: project.createdAt)

        var settings = BriarAPI_TeamSettings()
        settings.linear = BriarAPI_LinearSettings()
        settings.workflow = wireWorkflow()

        var runMessage = BriarAPI_DashboardRun()
        runMessage.id = run.id.uuidString.lowercased()
        runMessage.title = run.title
        runMessage.status = .running
        runMessage.workflow = wireWorkflow()
        runMessage.source = .issue
        runMessage.startedAt = Google_Protobuf_Timestamp(date: run.updatedAt)
        runMessage.updatedAt = Google_Protobuf_Timestamp(date: run.updatedAt)
        runMessage.lastEventAt = Google_Protobuf_Timestamp(date: run.updatedAt)

        var response = BriarAPI_GetDashboardResponse()
        response.team = projectMessage
        response.settings = settings
        response.runs = [runMessage]
        response.cursor = cursor
        response.generatedAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_700_000_000 + Double(cursor))
        )
        return response
    }

    private func wireReset(cursor: UInt64) -> BriarAPI_SyncDashboardResponse {
        var response = BriarAPI_SyncDashboardResponse()
        response.cursor = cursor
        response.reset = true
        response.generatedAt = Google_Protobuf_Timestamp(
            date: Date(timeIntervalSince1970: 1_700_000_200)
        )
        return response
    }

    private func wireWorkflow() -> BriarTypes_AutoHuntWorkflow {
        var workflow = BriarTypes_AutoHuntWorkflow()
        workflow.version = 2
        workflow.execution = BriarTypes_WorkflowExecution()
        workflow.completion = BriarTypes_WorkflowCompletion()
        return workflow
    }
}

private final class DashboardMockScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var snapshots: [BriarAPI_GetDashboardResponse]
    private var deltas: [BriarAPI_SyncDashboardResponse]
    private var recordedCalls: [String] = []

    init(
        snapshots: [BriarAPI_GetDashboardResponse],
        deltas: [BriarAPI_SyncDashboardResponse]
    ) {
        self.snapshots = snapshots
        self.deltas = deltas
    }

    func nextSnapshot(
        request: BriarAPI_GetDashboardRequest
    ) -> BriarAPI_GetDashboardResponse {
        lock.lock()
        defer { lock.unlock() }
        recordedCalls.append("get")
        precondition(!request.teamID.isEmpty)
        precondition(!snapshots.isEmpty)
        return snapshots.removeFirst()
    }

    func nextDelta(
        request: BriarAPI_SyncDashboardRequest
    ) -> BriarAPI_SyncDashboardResponse {
        lock.lock()
        defer { lock.unlock() }
        recordedCalls.append("sync:\(request.cursor)")
        precondition(!request.teamID.isEmpty)
        precondition(!deltas.isEmpty)
        return deltas.removeFirst()
    }

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedCalls
    }
}
