import Foundation
import XCTest
@testable import BriarCompanion

final class ReadOnlyCompanionTests: XCTestCase {
    func testFiltersRepresentativeRunStates() {
        let runs = [
            run("Active", .running),
            run("Needs attention", .blocked),
            run("Done", .completed),
            run("Cancelled", .cancelled),
        ]

        XCTAssertEqual(RunCollection.filtered(runs, by: .all).count, 4)
        XCTAssertEqual(RunCollection.filtered(runs, by: .active).map(\.title), ["Active"])
        XCTAssertEqual(RunCollection.filtered(runs, by: .attention).map(\.title), ["Needs attention"])
        XCTAssertEqual(RunCollection.filtered(runs, by: .completed).map(\.title), ["Done", "Cancelled"])
    }

    func testSearchMatchesTitleDescriptionDetailAndResult() {
        let runs = [
            DashboardRun(
                id: UUID(),
                title: "Native shell",
                status: .running,
                detail: "Pull to refresh",
                issueDescription: "Markdown attachment preview",
                resultSummary: "Offline recovery verified",
                updatedAt: .now
            ),
        ]

        XCTAssertEqual(RunCollection.filtered(runs, by: .all, query: "native").count, 1)
        XCTAssertEqual(RunCollection.filtered(runs, by: .all, query: "attachment").count, 1)
        XCTAssertEqual(RunCollection.filtered(runs, by: .all, query: "offline").count, 1)
        XCTAssertTrue(RunCollection.filtered(runs, by: .all, query: "write action").isEmpty)
    }

    @MainActor
    func testDetailStoreLoadsAllReadOnlyResources() async {
        let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let api = DetailFixtureAPIClient()
        let store = RunDetailStore(api: api)

        await store.load(projectID: projectID, runID: runID, token: "token")

        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(store.events.count, 1)
        XCTAssertEqual(store.evidence.count, 1)
        XCTAssertEqual(store.messages.count, 1)
        let paths = await api.requestedPaths()
        XCTAssertEqual(Set(paths), Set([
            MobileAPIContract.Endpoint.runEvents(projectID: projectID, runID: runID),
            MobileAPIContract.Endpoint.runEvidence(projectID: projectID, runID: runID),
            MobileAPIContract.Endpoint.runMessages(projectID: projectID, runID: runID),
        ]))
    }

    private func run(_ title: String, _ status: DashboardRun.Status) -> DashboardRun {
        DashboardRun(id: UUID(), title: title, status: status, updatedAt: .now)
    }
}

private actor DetailFixtureAPIClient: MobileAPIClientProtocol {
    private var paths: [String] = []

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        paths.append(path)
        let json: String
        if path.hasSuffix("/events") {
            json = #"{"events":[{"id":"77777777-7777-4777-8777-777777777777","attempt":1,"revision":1,"status":"running","workflowStage":"implementing","detail":null,"actor":"agent","occurredAt":"2026-08-02T01:00:00.000Z"}]}"#
        } else if path.hasSuffix("/evidence") {
            json = #"{"evidence":[{"key":"fixture","attempt":1,"revision":1,"stage":"local_qa","type":"test","status":"passed","detail":null,"command":null,"url":null,"actor":"agent","observedAt":"2026-08-02T01:00:00.000Z","images":[],"requiredRevision":1,"canonical":true}]}"#
        } else {
            json = #"{"messages":[{"id":"88888888-8888-4888-8888-888888888888","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":null,"body":"Read only","author":{"id":"user","name":"User","image":null,"provider":null},"replyCount":0,"createdAt":"2026-08-02T01:00:00.000Z","updatedAt":"2026-08-02T01:00:00.000Z"}]}"#
        }
        return try JSONDecoder.mobileContract.decode(responseType, from: Data(json.utf8))
    }

    func requestedPaths() -> [String] { paths }
}
