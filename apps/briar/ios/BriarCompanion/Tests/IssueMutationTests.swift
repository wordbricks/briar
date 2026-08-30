import BriarContracts
import BriarContractsMocks
import Connect
import Foundation
import SwiftProtobuf
import XCTest
@testable import BriarCompanion

@MainActor
final class IssueMutationTests: XCTestCase {
    private static let projectID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private static let runID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!

    func testUpdateRequestPreservesAssigneeAndKeptAttachmentPresence() throws {
        let keptID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let draft = IssueDraft(title: "presence")

        let unchanged = try issueUpdateRequest(
            projectID: Self.projectID,
            runID: Self.runID,
            draft: draft,
            assigneeUpdate: .unchanged,
            attachmentReferences: [],
            keptAttachmentIDs: nil
        )
        XCTAssertNil(unchanged.assigneeUpdate)
        XCTAssertFalse(unchanged.hasKeptAttachmentIds)

        let cleared = try issueUpdateRequest(
            projectID: Self.projectID,
            runID: Self.runID,
            draft: draft,
            assigneeUpdate: .clear,
            attachmentReferences: [],
            keptAttachmentIDs: []
        )
        guard case .clearAssignee_p? = cleared.assigneeUpdate else {
            return XCTFail("expected the explicit clear oneof")
        }
        XCTAssertTrue(cleared.hasKeptAttachmentIds)
        XCTAssertEqual(cleared.keptAttachmentIds.values, [])

        let assigned = try issueUpdateRequest(
            projectID: Self.projectID,
            runID: Self.runID,
            draft: draft,
            assigneeUpdate: .assign("user-1"),
            attachmentReferences: ["upload-1"],
            keptAttachmentIDs: [keptID]
        )
        guard case .assigneeUserID(let userID)? = assigned.assigneeUpdate else {
            return XCTFail("expected the assign oneof")
        }
        XCTAssertEqual(userID, "user-1")
        XCTAssertEqual(assigned.attachmentReferences, ["upload-1"])
        XCTAssertEqual(assigned.keptAttachmentIds.values, [keptID.uuidString.lowercased()])

        let conflict = MobileAPIError.connect(ConnectError(
            code: .failedPrecondition,
            message: "revision conflict"
        ))
        XCTAssertEqual(conflict.statusCode, 409)
    }

    func testActionProposalOneofMapsWithoutInventingOptionalValues() throws {
        let proposalID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let createdRunID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        let executionID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!

        var proposedIssue = BriarAPI_ProposedIssue()
        proposedIssue.title = "Generated from Agent"
        proposedIssue.status = .backlog

        var create = BriarAPI_IssueCreateProposal()
        create.id = proposalID.uuidString.lowercased()
        create.issue = proposedIssue
        create.executeAfterCreate = true
        create.status = .accepted
        create.resultRunID = createdRunID.uuidString.lowercased()

        var execution = BriarAPI_IssueExecutionProposal()
        execution.id = executionID.uuidString.lowercased()
        execution.status = .pending
        execution.projectID = Self.projectID.uuidString.lowercased()
        execution.runID = createdRunID.uuidString.lowercased()
        execution.title = "Generated from Agent"
        execution.createdAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))

        var message = BriarAPI_AcceptIssueActionProposalResponse()
        message.create = create
        message.outcome = .accepted
        message.resultRunID = createdRunID.uuidString.lowercased()
        message.executionProposal = execution

        let mapped = try AcceptIssueActionProposalResponse(connectMessage: message)
        XCTAssertEqual(mapped.proposal.type, .create)
        XCTAssertEqual(mapped.proposal.issue?.description, nil)
        XCTAssertEqual(mapped.proposal.acceptedAt, nil)
        XCTAssertEqual(mapped.resultRunId, createdRunID)
        XCTAssertEqual(mapped.executionProposal?.id, executionID)
        XCTAssertEqual(mapped.executionProposal?.requestedProvider, nil)
        XCTAssertEqual(mapped.executionProposal?.requestedModel, nil)
        XCTAssertEqual(mapped.executionProposal?.acceptedAt, nil)
    }

    func testCreateAndMessageUseConnectWithoutBytesAndMultipartWithBytes() async throws {
        let api = IssueHTTPRecorder(projectID: Self.projectID, runID: Self.runID)
        let scenario = IssueConnectScenario(projectID: Self.projectID, runID: Self.runID)
        let issue = BriarAPI_IssueServiceClientMock()
        issue.mockAsyncCreateIssue = { request in
            .init(result: .success(scenario.createIssue(request)))
        }
        issue.mockAsyncCreateIssueMessage = { request in
            .init(result: .success(scenario.createMessage(request)))
        }
        let store = IssueMutationStore(
            api: api,
            issueService: issue,
            projectID: Self.projectID,
            token: "token",
            attachmentReference: { "generated-upload-ref" }
        )

        _ = try await store.createIssue(draft: IssueDraft(title: "Connect"), attachments: [])
        _ = try await store.createIssue(
            draft: IssueDraft(title: "Multipart"),
            attachments: [imageAttachment()]
        )

        _ = try await store.sendMessage(
            runID: Self.runID,
            body: "Connect message",
            clientMessageID: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            parentMessageID: nil,
            attachments: [],
            maximumPolls: 0
        )
        _ = try await store.sendMessage(
            runID: Self.runID,
            body: "Multipart message",
            clientMessageID: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            parentMessageID: nil,
            attachments: [imageAttachment()],
            attachmentReferences: ["existing-upload-ref"],
            maximumPolls: 0
        )

        let httpCalls = await api.calls()
        XCTAssertEqual(scenario.connectCreates, 1)
        XCTAssertEqual(scenario.connectMessages, 1)
        XCTAssertEqual(httpCalls.multipartCreates, 1)
        XCTAssertEqual(httpCalls.multipartMessages, 1)
        XCTAssertEqual(httpCalls.messageAttachmentReferences, [["existing-upload-ref"]])
    }

    func testContractValidationRetainsTheUserFacingLimits() {
        XCTAssertEqual(
            IssueTitleLimits.validationError(
                for: String(repeating: "가", count: IssueTitleLimits.hangulMax + 1)
            ),
            .titleTooLong(
                max: IssueTitleLimits.hangulMax,
                count: IssueTitleLimits.hangulMax + 1
            )
        )
        XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: [PendingIssueAttachment(
            filename: "unsafe.pdf",
            contentType: "application/pdf",
            data: Data([1])
        )]))
    }

    private func imageAttachment() -> PendingIssueAttachment {
        PendingIssueAttachment(filename: "screen.png", contentType: "image/png", data: Data([1]))
    }
}

private actor IssueHTTPRecorder: MobileHTTPClientProtocol {
    struct Calls: Sendable {
        var multipartCreates = 0
        var multipartMessages = 0
        var messageAttachmentReferences: [[String]] = []
    }

    private let projectID: UUID
    private let runID: UUID
    private var recorded = Calls()

    init(projectID: UUID, runID: UUID) {
        self.projectID = projectID
        self.runID = runID
    }

    func calls() -> Calls { recorded }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }

    func upload<Response: SwiftProtobuf.Message & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        if responseType == BriarAPI_CreateIssueResponse.self {
            recorded.multipartCreates += 1
            return createResponse() as! Response
        }
        if responseType == BriarAPI_CreateIssueMessageResponse.self {
            recorded.multipartMessages += 1
            let referencesData = Data((fields["attachmentReferences"] ?? "[]").utf8)
            recorded.messageAttachmentReferences.append(
                try JSONDecoder().decode([String].self, from: referencesData)
            )
            return messageResponse(id: UUID(), body: fields["body"] ?? "") as! Response
        }
        throw MobileAPIError.invalidRequest
    }

    private func createResponse() -> BriarAPI_CreateIssueResponse {
        var response = BriarAPI_CreateIssueResponse()
        response.runID = runID.uuidString.lowercased()
        response.sourceKey = "BR-1"
        response.stage = "backlog"
        response.status = .backlog
        response.createdByUserID = "user-1"
        return response
    }

    private func messageResponse(
        id: UUID,
        body: String
    ) -> BriarAPI_CreateIssueMessageResponse {
        var author = BriarAPI_MessageAuthor()
        author.id = "user-1"
        author.name = "User"
        var message = BriarAPI_IssueMessage()
        message.id = id.uuidString.lowercased()
        message.runID = runID.uuidString.lowercased()
        message.body = body
        message.author = author
        message.createdAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))
        message.updatedAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))
        var response = BriarAPI_CreateIssueMessageResponse()
        response.message = message
        return response
    }
}

private final class IssueConnectScenario: @unchecked Sendable {
    private let lock = NSLock()
    private let projectID: UUID
    private let runID: UUID
    private var createCount = 0
    private var messageCount = 0

    init(projectID: UUID, runID: UUID) {
        self.projectID = projectID
        self.runID = runID
    }

    var connectCreates: Int {
        lock.lock()
        defer { lock.unlock() }
        return createCount
    }

    var connectMessages: Int {
        lock.lock()
        defer { lock.unlock() }
        return messageCount
    }

    func createIssue(_ request: BriarAPI_CreateIssueRequest) -> BriarAPI_CreateIssueResponse {
        lock.lock()
        defer { lock.unlock() }
        precondition(request.projectID == projectID.uuidString.lowercased())
        precondition(request.title == "Connect")
        createCount += 1

        var response = BriarAPI_CreateIssueResponse()
        response.runID = runID.uuidString.lowercased()
        response.sourceKey = "BR-1"
        response.stage = "backlog"
        response.status = .backlog
        response.createdByUserID = "user-1"
        return response
    }

    func createMessage(
        _ request: BriarAPI_CreateIssueMessageRequest
    ) -> BriarAPI_CreateIssueMessageResponse {
        lock.lock()
        defer { lock.unlock() }
        precondition(request.projectID == projectID.uuidString.lowercased())
        precondition(request.runID == runID.uuidString.lowercased())
        messageCount += 1

        var author = BriarAPI_MessageAuthor()
        author.id = "user-1"
        author.name = "User"
        var message = BriarAPI_IssueMessage()
        message.id = request.clientMessageID
        message.runID = request.runID
        message.body = request.body
        message.author = author
        message.createdAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))
        message.updatedAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))
        var response = BriarAPI_CreateIssueMessageResponse()
        response.message = message
        return response
    }
}
