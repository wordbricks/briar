import Foundation
import XCTest
@testable import BriarCompanion

@MainActor
final class IssueMutationTests: XCTestCase {
    func testAttachmentLimitsMatchSharedMobileContract() {
        let image = PendingIssueAttachment(
            filename: "screen.png",
            contentType: "image/png",
            data: Data([1])
        )
        XCTAssertNil(PendingIssueAttachment.validationMessage(for: [image]))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: Array(repeating: image, count: 6)))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "unsafe.svg",
            contentType: "image/svg+xml",
            data: Data([1])
        )]))
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "large.png",
            contentType: "image/png",
            data: Data(count: PendingIssueAttachment.maximumFileBytes + 1)
        )]))
    }

    func testDraftPersistsUntilSuccessfulCreation() {
        let suite = "IssueMutationTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let persistence = IssueDraftPersistence(defaults: defaults)
        let draft = IssueDraft(title: "보존할 제목", description: "본문", priority: 2, status: .backlog)

        persistence.save(draft)
        XCTAssertEqual(persistence.load(), draft)
        persistence.clear()
        XCTAssertTrue(persistence.load().isEmpty)
    }

    func testDuplicateCreateTapSendsOnlyOneRequest() async throws {
        let recorder = MutationAPIRecorder(delay: .milliseconds(100))
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let draft = IssueDraft(title: "한 번만 생성", description: "", priority: nil, status: .queued)

        async let first = store.createIssue(draft: draft, attachments: [])
        try await Task.sleep(for: .milliseconds(10))
        do {
            _ = try await store.createIssue(draft: draft, attachments: [])
            XCTFail("The second tap must be rejected while the first request is active")
        } catch IssueMutationError.duplicateAction {
            // Expected.
        }
        _ = try await first
        let count = await recorder.requestCount()
        XCTAssertEqual(count, 1)
    }

    func testMutatingRunRequestUsesInjectedIdempotencyIdentifier() async throws {
        let recorder = MutationAPIRecorder()
        let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token",
            requestID: { requestID }
        )

        try await store.move(runID: Self.runID, status: .queued)
        let recordedRequestID = await recorder.lastRequestID()
        XCTAssertEqual(recordedRequestID, requestID.uuidString)
    }

    func testFailedMutationRetryReusesItsIdempotencyIdentifier() async throws {
        let recorder = MutationAPIRecorder(failuresRemaining: 1)
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        do {
            try await store.move(runID: Self.runID, status: .queued)
            XCTFail("The first transport attempt must fail")
        } catch MobileAPIError.invalidRequest {
            // Expected.
        }
        try await store.move(runID: Self.runID, status: .queued)

        let requestIDs = await recorder.allRequestIDs()
        XCTAssertEqual(requestIDs.count, 2)
        XCTAssertEqual(requestIDs[0], requestIDs[1])
    }

    func testResumeSendsExactCheckpointIdentityAndReusesRequestIDAfterFailure() async throws {
        let recorder = MutationAPIRecorder(failuresRemaining: 1)
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )
        let checkpoint = WorkflowCheckpoint(
            key: "user-before-production_qa",
            stage: "production_qa",
            stageLabel: "Production QA",
            position: .before,
            attempt: 2,
            revision: 3,
            reachedAt: nil,
            nextStage: "production_qa",
            nextStageLabel: "Production QA",
            terminalReviewOnly: false
        )

        do {
            try await store.resume(runID: Self.runID, checkpoint: checkpoint)
            XCTFail("The first transport attempt must fail")
        } catch MobileAPIError.invalidRequest {
            // Expected.
        }
        try await store.resume(runID: Self.runID, checkpoint: checkpoint)

        let requests = await recorder.resumeRequests()
        XCTAssertEqual(requests.map { $0.checkpointKey }, [checkpoint.key, checkpoint.key])
        XCTAssertEqual(requests.map { $0.attempt }, [2, 2])
        XCTAssertEqual(requests.map { $0.revision }, [3, 3])
        XCTAssertEqual(requests[0].requestID, requests[1].requestID)
    }

    func testAgentReplyPollingReturnsTheCompletedReply() async throws {
        let recorder = AgentReplyAPIRecorder()
        let store = IssueMutationStore(
            api: recorder,
            projectID: Self.projectID,
            token: "token"
        )

        let messages = try await store.sendMessage(
            runID: Self.runID,
            body: "@Briar 확인해 줘",
            parentMessageID: nil,
            pollInterval: .zero,
            maximumPolls: 1
        )

        XCTAssertEqual(messages.map(\.body), ["@Briar 확인해 줘", "확인했습니다."])
        let methods = await recorder.recordedMethods()
        XCTAssertEqual(methods, ["POST", "GET"])
    }

    private static let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private static let runID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
}

private actor AgentReplyAPIRecorder: MobileAPIClientProtocol {
    private var methods: [String] = []

    func recordedMethods() -> [String] { methods }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        methods.append(method)
        let payload: String
        if method == "POST", path.hasSuffix("/messages") {
            payload = #"{"message":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":null,"body":"@Briar 확인해 줘","author":{"id":"fixture-user","name":"Briar User","image":null,"provider":null},"replyCount":0,"createdAt":"2026-08-02T01:00:00Z","updatedAt":"2026-08-02T01:00:00Z"},"agentReply":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","triggerMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","status":"queued","error":null}}"#
        } else if method == "GET", path.hasSuffix("/agent-reply") {
            payload = #"{"agentReply":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","triggerMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","status":"completed","error":null},"message":{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","runId":"33333333-3333-4333-8333-333333333333","parentMessageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","body":"확인했습니다.","author":{"id":null,"name":"Briar · Codex","image":null,"provider":"codex"},"replyCount":0,"createdAt":"2026-08-02T01:01:00Z","updatedAt":"2026-08-02T01:01:00Z"}}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private actor MutationAPIRecorder: MobileAPIClientProtocol {
    private var count = 0
    private var recordedRequestID: String?
    private var recordedRequestIDs: [String] = []
    private let delay: Duration
    private var failuresRemaining: Int
    private var recordedResumeRequests: [(requestID: String, checkpointKey: String, attempt: Int, revision: Int)] = []

    init(delay: Duration = .zero, failuresRemaining: Int = 0) {
        self.delay = delay
        self.failuresRemaining = failuresRemaining
    }

    func requestCount() -> Int { count }

    func lastRequestID() -> String? { recordedRequestID }

    func allRequestIDs() -> [String] { recordedRequestIDs }

    func resumeRequests() -> [(requestID: String, checkpointKey: String, attempt: Int, revision: Int)] {
        recordedResumeRequests
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        count += 1
        if let body,
           let object = try JSONSerialization.jsonObject(
               with: JSONEncoder.mobileContract.encode(TestAnyEncodable(body))
           ) as? [String: Any] {
            recordedRequestID = object["requestId"] as? String
            if let recordedRequestID { recordedRequestIDs.append(recordedRequestID) }
            if path.hasSuffix("/resume"),
               let requestID = object["requestId"] as? String,
               let checkpointKey = object["checkpointKey"] as? String,
               let attempt = object["attempt"] as? Int,
               let revision = object["revision"] as? Int {
                recordedResumeRequests.append((requestID, checkpointKey, attempt, revision))
            }
        }
        if delay != .zero { try await Task.sleep(for: delay) }
        if failuresRemaining > 0 {
            failuresRemaining -= 1
            throw MobileAPIError.invalidRequest
        }
        let payload: String
        if path.hasSuffix("/issues") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","sourceKey":"briar-issue:test","stage":"queued","status":"queued","attachments":[]}"#
        } else if path.hasSuffix("/status") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","outcome":"moved","status":"queued","workflowStage":null}"#
        } else if path.hasSuffix("/resume") {
            payload = #"{"runId":"33333333-3333-4333-8333-333333333333","outcome":"approved","workflowStage":"production_qa","startStage":"production_qa","checkpointKey":"user-before-production_qa","attempt":2,"revision":3,"terminalReviewOnly":false}"#
        } else {
            throw MobileAPIError.invalidRequest
        }
        return try JSONDecoder.mobileContract.decode(Response.self, from: Data(payload.utf8))
    }
}

private struct TestAnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
