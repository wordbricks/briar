import BriarContracts
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
        let api = IssueTransportRecorder(projectID: Self.projectID, runID: Self.runID)
        let store = IssueMutationStore(
            api: api,
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

        let calls = await api.calls()
        XCTAssertEqual(calls.connectCreates, 1)
        XCTAssertEqual(calls.connectMessages, 1)
        XCTAssertEqual(calls.multipartCreates, 1)
        XCTAssertEqual(calls.multipartMessages, 1)
        XCTAssertEqual(calls.messageAttachmentReferences, [["existing-upload-ref"]])
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

private actor IssueTransportRecorder: MobileAPIClientProtocol {
    struct Calls: Sendable {
        var connectCreates = 0
        var connectMessages = 0
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

    func createIssue(
        projectID: UUID,
        draft: IssueDraft,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueResponse {
        recorded.connectCreates += 1
        return createResponse()
    }

    func createIssueMessage(
        projectID: UUID,
        runID: UUID,
        clientMessageID: UUID,
        body: String,
        parentMessageID: UUID?,
        mentionedUserIDs: [String],
        mentionedAgentIDs: [String],
        agentConversationID: String?,
        attachmentReferences: [String],
        token: String
    ) async throws -> CreateIssueMessageResponse {
        recorded.connectMessages += 1
        return messageResponse(id: clientMessageID, body: body)
    }

    func send<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        token: String?,
        body: (any Encodable & Sendable)?,
        as responseType: Response.Type
    ) async throws -> Response {
        throw MobileAPIError.invalidRequest
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        files: [MultipartFile],
        token: String,
        as responseType: Response.Type
    ) async throws -> Response {
        if responseType == CreateIssueResponse.self {
            recorded.multipartCreates += 1
            return createResponse() as! Response
        }
        if responseType == CreateIssueMessageResponse.self {
            recorded.multipartMessages += 1
            let referencesData = Data((fields["attachmentReferences"] ?? "[]").utf8)
            recorded.messageAttachmentReferences.append(
                try JSONDecoder().decode([String].self, from: referencesData)
            )
            return messageResponse(id: UUID(), body: fields["body"] ?? "") as! Response
        }
        throw MobileAPIError.invalidRequest
    }

    private func createResponse() -> CreateIssueResponse {
        CreateIssueResponse(
            runId: runID,
            sourceKey: "BR-1",
            stage: "backlog",
            status: .backlog,
            attachments: [],
            assigneeUserId: nil,
            createdByUserId: "user-1",
            difficulty: nil
        )
    }

    private func messageResponse(id: UUID, body: String) -> CreateIssueMessageResponse {
        CreateIssueMessageResponse(
            message: IssueMessage(
                id: id,
                runId: runID,
                parentMessageId: nil,
                body: body,
                attachments: [],
                author: .init(id: "user-1", name: "User", image: nil, provider: nil),
                replyCount: 0,
                createdAt: Date(timeIntervalSince1970: 10),
                updatedAt: Date(timeIntervalSince1970: 10)
            ),
            agentReply: nil
        )
    }
}
