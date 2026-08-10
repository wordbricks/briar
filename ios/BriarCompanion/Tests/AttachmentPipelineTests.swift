import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import BriarCompanion

@MainActor
final class AttachmentPipelineTests: XCTestCase {
    func testImagesOnlyImportsSupportedImageWithDeterministicFilename() async throws {
        let selection = PhotoAttachmentSelection(
            supportedContentTypes: [.png],
            loadData: { Data([1, 2, 3]) }
        )

        let attachments = try await PhotoAttachmentImporter.importSelections(
            [selection],
            appendingTo: [],
            policy: .imagesOnly,
            filenameIdentifier: { "fixed-image" }
        )

        XCTAssertEqual(attachments.map(\.filename), ["image-fixed-image.png"])
        XCTAssertEqual(attachments.map(\.contentType), ["image/png"])
        XCTAssertEqual(attachments.first?.data, Data([1, 2, 3]))
    }

    func testImagesOnlyRejectsVideoButImagesAndVideosImportsIt() async throws {
        let selection = PhotoAttachmentSelection(
            supportedContentTypes: [.quickTimeMovie],
            loadData: { Data([4, 5, 6]) }
        )

        do {
            _ = try await PhotoAttachmentImporter.importSelections(
                [selection],
                appendingTo: [],
                policy: .imagesOnly
            )
            XCTFail("imagesOnly must reject movie attachments")
        } catch let error as PhotoAttachmentImportError {
            XCTAssertEqual(
                error,
                .unsupported("선택한 이미지 형식을 첨부할 수 없습니다.")
            )
        }

        let attachments = try await PhotoAttachmentImporter.importSelections(
            [selection],
            appendingTo: [],
            policy: .imagesAndVideos,
            filenameIdentifier: { "fixed-video" }
        )
        XCTAssertEqual(attachments.map(\.filename), ["video-fixed-video.mov"])
        XCTAssertEqual(attachments.map(\.contentType), ["video/quicktime"])
    }

    func testMessagePayloadMatchesCanonicalWebMarkdownEscaping() throws {
        let attachment = PendingIssueAttachment(
            filename: "line\\[a]\r\nnext\nfinal].png",
            contentType: "image/png",
            data: Data([7, 8, 9])
        )

        let payload = try AttachmentMessagePayload(
            body: "before",
            attachments: [attachment],
            referenceGenerator: { "fixed-ref" }
        )

        XCTAssertEqual(
            payload.body,
            #"before"# + "\n\n" +
                #"![line\\\[a\] next final\].png](briar-attachment://fixed-ref)"#
        )
        XCTAssertEqual(payload.references, ["fixed-ref"])
        XCTAssertEqual(payload.referencesJSON, #"["fixed-ref"]"#)
        XCTAssertEqual(payload.files.map(\.fieldName), ["attachments"])
        XCTAssertEqual(payload.files.map(\.filename), [attachment.filename])
        XCTAssertEqual(payload.files.map(\.contentType), ["image/png"])
        XCTAssertEqual(payload.files.first?.data, attachment.data)
    }
}
