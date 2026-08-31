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

    func testGeneratedMutationRequestsPreserveIdentityAndPatchPresence() throws {
        let requestID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let keptID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let attachment = uploadReference("77777777-7777-4777-8777-777777777777")
        let draft = IssueDraft(title: "presence")

        let created = try issueCreateRequest(
            projectID: Self.projectID,
            clientIssueID: Self.runID,
            draft: draft,
            attachments: [attachment]
        )
        XCTAssertEqual(created.clientIssueID, coreUUIDString(Self.runID))
        XCTAssertEqual(created.attachments.map(\.uploadID), [attachment.uploadID])

        let unchanged = try issueUpdateRequest(
            projectID: Self.projectID,
            runID: Self.runID,
            requestID: requestID,
            draft: draft,
            assigneeUpdate: .unchanged,
            attachments: [],
            keptAttachmentIDs: nil
        )
        XCTAssertEqual(unchanged.requestID, coreUUIDString(requestID))
        XCTAssertNil(unchanged.assigneeUpdate)
        XCTAssertFalse(unchanged.hasKeptAttachmentIds)

        let cleared = try issueUpdateRequest(
            projectID: Self.projectID,
            runID: Self.runID,
            requestID: requestID,
            draft: draft,
            assigneeUpdate: .clear,
            attachments: [],
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
            requestID: requestID,
            draft: draft,
            assigneeUpdate: .assign("user-1"),
            attachments: [attachment],
            keptAttachmentIDs: [keptID]
        )
        guard case .assigneeUserID(let userID)? = assigned.assigneeUpdate else {
            return XCTFail("expected the assign oneof")
        }
        XCTAssertEqual(userID, "user-1")
        XCTAssertEqual(assigned.attachments.map(\.uploadID), [attachment.uploadID])
        XCTAssertEqual(assigned.keptAttachmentIds.values, [coreUUIDString(keptID)])

        let conflict = MobileAPIError.connect(ConnectError(
            code: .failedPrecondition,
            message: "revision conflict"
        ))
        XCTAssertEqual(conflict.statusCode, 409)
    }

    func testIssueCreateUpdateAndMessagePreparePutThenFinalize() async throws {
        let uploads = PreparedUploadRecorder()
        let scenario = IssueConnectScenario(projectID: Self.projectID, runID: Self.runID)
        let store = makeStore(uploads: uploads, scenario: scenario)

        var createDraft = IssueDraft(title: "Prepared create")
        createDraft.description = "![create](briar-attachment://create-local)"
        try await store.createIssue(
            draft: createDraft,
            attachments: [imageAttachment(id: "40000000-0000-4000-8000-000000000001")],
            attachmentReferences: ["create-local"]
        )

        var updateDraft = IssueDraft(title: "Prepared update")
        updateDraft.description = "![update](briar-attachment://update-local)"
        try await store.updateIssue(
            runID: Self.runID,
            draft: updateDraft,
            attachments: [imageAttachment(id: "40000000-0000-4000-8000-000000000002")],
            attachmentReferences: ["update-local"],
            keptAttachmentIDs: []
        )

        let messageID = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
        _ = try await store.sendMessage(
            runID: Self.runID,
            body: "Prepared message",
            clientMessageID: messageID,
            parentMessageID: nil,
            attachments: [imageAttachment(id: "40000000-0000-4000-8000-000000000003")],
            attachmentReferences: ["message-local"],
            maximumPolls: 0
        )

        let snapshot = scenario.snapshot()
        XCTAssertEqual(snapshot.createPreparations.count, 1)
        XCTAssertEqual(snapshot.createFinalizations.count, 1)
        XCTAssertEqual(
            snapshot.createPreparations[0].clientIssueID,
            snapshot.createFinalizations[0].clientIssueID
        )
        XCTAssertEqual(
            snapshot.createFinalizations[0].attachments.map(\.uploadID),
            [scenario.createUploadID]
        )
        XCTAssertTrue(snapshot.createFinalizations[0].description_p.contains(scenario.createUploadID))
        XCTAssertFalse(snapshot.createFinalizations[0].description_p.contains("create-local"))

        XCTAssertEqual(snapshot.updatePreparations.count, 1)
        XCTAssertEqual(snapshot.updateFinalizations.count, 1)
        XCTAssertEqual(
            snapshot.updatePreparations[0].requestID,
            snapshot.updateFinalizations[0].requestID
        )
        XCTAssertEqual(snapshot.updatePreparations[0].runID, coreUUIDString(Self.runID))
        XCTAssertEqual(
            snapshot.updateFinalizations[0].attachments.map(\.uploadID),
            [scenario.updateUploadID]
        )
        XCTAssertTrue(snapshot.updateFinalizations[0].description_p.contains(scenario.updateUploadID))
        XCTAssertTrue(snapshot.updateFinalizations[0].hasKeptAttachmentIds)
        XCTAssertEqual(snapshot.updateFinalizations[0].keptAttachmentIds.values, [])

        XCTAssertEqual(snapshot.messagePreparations.count, 1)
        XCTAssertEqual(snapshot.messageFinalizations.count, 1)
        XCTAssertEqual(
            snapshot.messagePreparations[0].clientMessageID,
            snapshot.messageFinalizations[0].clientMessageID
        )
        XCTAssertEqual(snapshot.messageFinalizations[0].clientMessageID, coreUUIDString(messageID))
        XCTAssertEqual(
            snapshot.messageFinalizations[0].attachments.map(\.uploadID),
            [scenario.messageUploadID]
        )
        XCTAssertTrue(snapshot.messageFinalizations[0].body.contains(scenario.messageUploadID))
        XCTAssertFalse(snapshot.messageFinalizations[0].body.contains("message-local"))

        let rawUploads = await uploads.calls()
        XCTAssertEqual(rawUploads.map(\.contentType), Array(repeating: "image/png", count: 3))
        XCTAssertEqual(rawUploads.map(\.data), [Data([1]), Data([2]), Data([3])])
        XCTAssertEqual(
            rawUploads.map { $0.url.lastPathComponent },
            [scenario.createUploadID, scenario.updateUploadID, scenario.messageUploadID]
        )
    }

    func testCreateRetryReusesPreparationAndMutationIdentity() async throws {
        let uploads = PreparedUploadRecorder(failures: 1)
        let scenario = IssueConnectScenario(projectID: Self.projectID, runID: Self.runID)
        let store = makeStore(uploads: uploads, scenario: scenario)
        var draft = IssueDraft(title: "Retry exact request")
        draft.description = "![retry](briar-attachment://retry-local)"
        let attachment = imageAttachment(id: "40000000-0000-4000-8000-000000000004")

        do {
            try await store.createIssue(
                draft: draft,
                attachments: [attachment],
                attachmentReferences: ["retry-local"]
            )
            XCTFail("the first raw PUT should fail")
        } catch PreparedUploadRecorder.IntentionalFailure.once {
            // The mutation and preparation IDs remain pending for an exact retry.
        }
        try await store.createIssue(
            draft: draft,
            attachments: [attachment],
            attachmentReferences: ["retry-local"]
        )

        let snapshot = scenario.snapshot()
        XCTAssertEqual(snapshot.createPreparations.count, 2)
        XCTAssertEqual(snapshot.createFinalizations.count, 1)
        XCTAssertEqual(
            snapshot.createPreparations.map(\.preparationRequestID),
            Array(repeating: snapshot.createPreparations[0].preparationRequestID, count: 2)
        )
        XCTAssertEqual(
            snapshot.createPreparations.map(\.clientIssueID),
            Array(repeating: snapshot.createFinalizations[0].clientIssueID, count: 2)
        )
        XCTAssertEqual(
            snapshot.createPreparations.map { $0.attachments.map(\.clientID) },
            Array(repeating: ["retry-local"], count: 2)
        )
        let rawUploads = await uploads.calls()
        XCTAssertEqual(rawUploads.count, 2)
    }

    func testActionProposalOneofMapsWithoutInventingOptionalValues() throws {
        let proposalID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let createdRunID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        let executionID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!

        var proposedIssue = BriarAPI_ProposedIssue()
        proposedIssue.title = "Generated from Agent"

        var create = BriarAPI_IssueCreateProposal()
        create.id = coreUUIDString(proposalID)
        create.issue = proposedIssue
        create.executeAfterCreate = true
        create.status = .accepted
        create.resultRunID = coreUUIDString(createdRunID)

        var execution = BriarAPI_IssueExecutionProposal()
        execution.id = coreUUIDString(executionID)
        execution.status = .pending
        execution.projectID = coreUUIDString(Self.projectID)
        execution.runID = coreUUIDString(createdRunID)
        execution.title = "Generated from Agent"
        execution.createdAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 10))

        var message = BriarAPI_AcceptIssueActionProposalResponse()
        message.create = create
        message.outcome = .accepted
        message.resultRunID = coreUUIDString(createdRunID)
        message.executionProposal = execution

        let mapped = try AcceptIssueActionProposalResponse(connectMessage: message)
        XCTAssertEqual(mapped.proposal.type, .create)
        XCTAssertNil(mapped.proposal.issue?.description)
        XCTAssertNil(mapped.proposal.acceptedAt)
        XCTAssertEqual(mapped.resultRunId, createdRunID)
        XCTAssertEqual(mapped.executionProposal?.id, executionID)
        XCTAssertNil(mapped.executionProposal?.requestedProvider)
        XCTAssertNil(mapped.executionProposal?.requestedModel)
        XCTAssertNil(mapped.executionProposal?.acceptedAt)
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

    private func makeStore(
        uploads: PreparedUploadRecorder,
        scenario: IssueConnectScenario
    ) -> IssueMutationStore {
        let issue = BriarAPI_IssueServiceClientMock()
        issue.mockAsyncPrepareCreateIssueAttachments = {
            .init(result: .success(scenario.prepareCreate($0)))
        }
        issue.mockAsyncCreateIssue = {
            .init(result: .success(scenario.createIssue($0)))
        }
        issue.mockAsyncPrepareUpdateIssueAttachments = {
            .init(result: .success(scenario.prepareUpdate($0)))
        }
        issue.mockAsyncUpdateIssue = {
            .init(result: .success(scenario.updateIssue($0)))
        }
        issue.mockAsyncPrepareIssueMessageAttachments = {
            .init(result: .success(scenario.prepareMessage($0)))
        }
        issue.mockAsyncCreateIssueMessage = {
            .init(result: .success(scenario.createMessage($0)))
        }
        return IssueMutationStore(
            preparedUploadClient: uploads,
            issueService: issue,
            projectService: BriarAPI_ProjectServiceClientMock(),
            projectID: Self.projectID,
            attachmentReference: { "generated-local-reference" }
        )
    }

    private func imageAttachment(id: String) -> PendingIssueAttachment {
        let byte = UInt8(String(id.suffix(1))) ?? 1
        return PendingIssueAttachment(
            id: UUID(uuidString: id)!,
            filename: "screen-\(byte).png",
            contentType: "image/png",
            data: Data([byte])
        )
    }

    private func uploadReference(_ id: String) -> BriarTypes_UploadReference {
        var reference = BriarTypes_UploadReference()
        reference.uploadID = id
        return reference
    }
}

private actor PreparedUploadRecorder: PreparedUploadClientProtocol {
    enum IntentionalFailure: Error {
        case once
    }

    struct Call: Sendable {
        let url: URL
        let capability: String
        let contentType: String
        let data: Data
    }

    private var remainingFailures: Int
    private var recorded: [Call] = []

    init(failures: Int = 0) {
        remainingFailures = failures
    }

    func calls() -> [Call] { recorded }

    func putPreparedUpload(
        _ url: URL,
        capability: String,
        contentType: String,
        data: Data
    ) async throws {
        recorded.append(Call(
            url: url,
            capability: capability,
            contentType: contentType,
            data: data
        ))
        if remainingFailures > 0 {
            remainingFailures -= 1
            throw IntentionalFailure.once
        }
    }
}

private final class IssueConnectScenario: @unchecked Sendable {
    struct Snapshot: Sendable {
        let createPreparations: [BriarAPI_PrepareCreateIssueAttachmentsRequest]
        let createFinalizations: [BriarAPI_CreateIssueRequest]
        let updatePreparations: [BriarAPI_PrepareUpdateIssueAttachmentsRequest]
        let updateFinalizations: [BriarAPI_UpdateIssueRequest]
        let messagePreparations: [BriarAPI_PrepareIssueMessageAttachmentsRequest]
        let messageFinalizations: [BriarAPI_CreateIssueMessageRequest]
    }

    let createUploadID = "70000000-0000-4000-8000-000000000001"
    let updateUploadID = "70000000-0000-4000-8000-000000000002"
    let messageUploadID = "70000000-0000-4000-8000-000000000003"

    private let lock = NSLock()
    private let projectID: UUID
    private let runID: UUID
    private var createPreparations: [BriarAPI_PrepareCreateIssueAttachmentsRequest] = []
    private var createFinalizations: [BriarAPI_CreateIssueRequest] = []
    private var updatePreparations: [BriarAPI_PrepareUpdateIssueAttachmentsRequest] = []
    private var updateFinalizations: [BriarAPI_UpdateIssueRequest] = []
    private var messagePreparations: [BriarAPI_PrepareIssueMessageAttachmentsRequest] = []
    private var messageFinalizations: [BriarAPI_CreateIssueMessageRequest] = []

    init(projectID: UUID, runID: UUID) {
        self.projectID = projectID
        self.runID = runID
    }

    func snapshot() -> Snapshot {
        lock.withLock {
            Snapshot(
                createPreparations: createPreparations,
                createFinalizations: createFinalizations,
                updatePreparations: updatePreparations,
                updateFinalizations: updateFinalizations,
                messagePreparations: messagePreparations,
                messageFinalizations: messageFinalizations
            )
        }
    }

    func prepareCreate(
        _ request: BriarAPI_PrepareCreateIssueAttachmentsRequest
    ) -> BriarAPI_PrepareIssueAttachmentsResponse {
        lock.withLock { createPreparations.append(request) }
        return preparedResponse(request.attachments, uploadID: createUploadID, capability: "create")
    }

    func createIssue(_ request: BriarAPI_CreateIssueRequest) -> BriarAPI_CreateIssueResponse {
        lock.withLock { createFinalizations.append(request) }
        precondition(request.projectID == coreUUIDString(projectID))
        var response = BriarAPI_CreateIssueResponse()
        response.runID = request.clientIssueID
        response.sourceKey = "briar-issue:\(request.clientIssueID)"
        response.stage = "queued"
        response.status = request.status
        response.createdByUserID = "user-1"
        return response
    }

    func prepareUpdate(
        _ request: BriarAPI_PrepareUpdateIssueAttachmentsRequest
    ) -> BriarAPI_PrepareIssueAttachmentsResponse {
        lock.withLock { updatePreparations.append(request) }
        return preparedResponse(request.attachments, uploadID: updateUploadID, capability: "update")
    }

    func updateIssue(_ request: BriarAPI_UpdateIssueRequest) -> BriarAPI_UpdateIssueResponse {
        lock.withLock { updateFinalizations.append(request) }
        precondition(request.projectID == coreUUIDString(projectID))
        precondition(request.runID == coreUUIDString(runID))
        var response = BriarAPI_UpdateIssueResponse()
        response.runID = request.runID
        response.title = request.title
        return response
    }

    func prepareMessage(
        _ request: BriarAPI_PrepareIssueMessageAttachmentsRequest
    ) -> BriarAPI_PrepareIssueAttachmentsResponse {
        lock.withLock { messagePreparations.append(request) }
        return preparedResponse(request.attachments, uploadID: messageUploadID, capability: "message")
    }

    func createMessage(
        _ request: BriarAPI_CreateIssueMessageRequest
    ) -> BriarAPI_CreateIssueMessageResponse {
        lock.withLock { messageFinalizations.append(request) }
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

    private func preparedResponse(
        _ metadata: [BriarTypes_UploadFileMetadata],
        uploadID: String,
        capability: String
    ) -> BriarAPI_PrepareIssueAttachmentsResponse {
        precondition(metadata.count == 1)
        var reference = BriarTypes_UploadReference()
        reference.uploadID = uploadID
        var upload = BriarTypes_PreparedUpload()
        upload.clientID = metadata[0].clientID
        upload.reference = reference
        upload.uploadURL = "https://api.example/uploads/\(uploadID)"
        upload.uploadCapability = "\(capability)-capability"
        upload.expiresAt = Google_Protobuf_Timestamp(date: Date(timeIntervalSince1970: 100))
        var response = BriarAPI_PrepareIssueAttachmentsResponse()
        response.uploads = [upload]
        return response
    }
}
