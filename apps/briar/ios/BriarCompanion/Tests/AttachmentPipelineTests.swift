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

    func testImagesOnlyImportsSVGWithoutRasterizingIt() async throws {
        let svgType = try XCTUnwrap(UTType(filenameExtension: "svg"))
        let selection = PhotoAttachmentSelection(
            supportedContentTypes: [svgType],
            loadData: { Data([60, 115, 118, 103, 62]) }
        )

        let attachments = try await PhotoAttachmentImporter.importSelections(
            [selection],
            appendingTo: [],
            policy: .imagesOnly,
            filenameIdentifier: { "fixed-svg" }
        )

        XCTAssertEqual(attachments.map(\.filename), ["image-fixed-svg.svg"])
        XCTAssertEqual(attachments.map(\.contentType), ["image/svg+xml"])
        XCTAssertEqual(attachments.first?.data, Data([60, 115, 118, 103, 62]))
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
    }

    func testMessagePayloadReusesProvidedReferencesForOptimisticPreview() throws {
        let attachments = [
            PendingIssueAttachment(
                filename: "first.png",
                contentType: "image/png",
                data: Data([1])
            ),
            PendingIssueAttachment(
                filename: "second.png",
                contentType: "image/png",
                data: Data([2])
            ),
        ]

        let payload = try AttachmentMessagePayload(
            body: "screens",
            attachments: attachments,
            references: ["first-ref", "second-ref"]
        )

        XCTAssertEqual(payload.references, ["first-ref", "second-ref"])
        XCTAssertTrue(payload.body.contains("briar-attachment://first-ref"))
        XCTAssertTrue(payload.body.contains("briar-attachment://second-ref"))
    }
}
