import Foundation
import UIKit
import UniformTypeIdentifiers
import XCTest
@testable import BriarCompanion

@MainActor
final class AttachmentPipelineTests: XCTestCase {
    func testChannelDocumentsPreserveNameAndBytesWithoutEnablingIssueDocuments() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = Data("# 한글\r\n<script>neverExecute()</script>\n".utf8)
        for (filename, type) in [("설계.MD", "text/markdown"), ("메모.txt", "text/plain")] {
            let url = directory.appendingPathComponent(filename)
            try bytes.write(to: url)
            let imported = try ChannelDocumentAttachments.load([url], appendingTo: [])
            XCTAssertEqual(imported.first?.filename, filename)
            XCTAssertEqual(imported.first?.contentType, type)
            XCTAssertEqual(imported.first?.data, bytes)
            XCTAssertNil(ChannelDocumentAttachments.validationMessage(for: imported))
            XCTAssertNotNil(PendingIssueAttachment.validationMessage(for: imported))
            XCTAssertThrowsError(try ChannelDocumentAttachments.load(Array(repeating: url, count: 6), appendingTo: []))
        }
        let unsupported = directory.appendingPathComponent("page.html")
        try bytes.write(to: unsupported)
        XCTAssertThrowsError(try ChannelDocumentAttachments.load([unsupported], appendingTo: []))
        let empty = directory.appendingPathComponent("empty.txt")
        try Data().write(to: empty)
        XCTAssertThrowsError(try ChannelDocumentAttachments.load([empty], appendingTo: []))
    }

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

    func testUploadMetadataReportsImageDimensionsForLayoutReservation() throws {
        let attachment = PendingIssueAttachment(
            filename: "photo.png",
            contentType: "image/png",
            data: Self.pngData(width: 1_600, height: 900)
        )

        let metadata = try PreparedUploadPipeline.metadata(
            attachments: [attachment],
            clientIDs: ["client-1"]
        )

        XCTAssertEqual(metadata.first?.hasImageWidth, true)
        XCTAssertEqual(metadata.first?.imageWidth, 1_600)
        XCTAssertEqual(metadata.first?.imageHeight, 900)
    }

    func testUploadMetadataOmitsDimensionsForUndecodableAttachments() throws {
        let attachments = [
            PendingIssueAttachment(
                filename: "clip.mp4",
                contentType: "video/mp4",
                data: Data([0, 1, 2, 3])
            ),
            PendingIssueAttachment(
                filename: "broken.png",
                contentType: "image/png",
                data: Data([0, 1, 2, 3])
            ),
        ]

        let metadata = try PreparedUploadPipeline.metadata(
            attachments: attachments,
            clientIDs: ["client-1", "client-2"]
        )

        XCTAssertEqual(metadata.map(\.hasImageWidth), [false, false])
        XCTAssertEqual(metadata.map(\.hasImageHeight), [false, false])
    }

    /// Encodes a solid image so the header carries real pixel dimensions.
    private static func pngData(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat.default()
        // Without a fixed scale the renderer would multiply by the device's,
        // and the assertion would depend on which simulator ran the test.
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        )
        let image = renderer.image { context in
            UIColor.gray.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        return image.pngData() ?? Data()
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
