import XCTest
@testable import BriarCompanion

final class AttachmentPreviewTests: XCTestCase {
    func testDetectsImagesFromContentTypeOrFilename() {
        XCTAssertTrue(IssueAttachmentMedia.isImage(contentType: "image/png", filename: "x.bin"))
        XCTAssertTrue(IssueAttachmentMedia.isImage(contentType: "", filename: "image.png"))
        XCTAssertTrue(IssueAttachmentMedia.isImage(contentType: "  ", filename: "photo.JPG"))
        XCTAssertTrue(IssueAttachmentMedia.isImage(contentType: "IMAGE/WEBP", filename: "shot"))
        XCTAssertFalse(IssueAttachmentMedia.isImage(contentType: "video/mp4", filename: "clip.mp4"))
        XCTAssertFalse(IssueAttachmentMedia.isImage(contentType: "", filename: "notes.txt"))
    }

    func testParsesInlineBriarAttachmentMarkdownBlocks() {
        let markdown = """
        설명 시작

        ![image.png](briar-attachment://aaaaaaaa-1111-4111-8111-111111111111)

        설명 끝
        """
        let blocks = IssueDescriptionBlock.parse(markdown)
        XCTAssertEqual(blocks.count, 3)
        guard case let .markdown(leading) = blocks[0] else {
            return XCTFail("expected leading markdown")
        }
        XCTAssertEqual(leading, "설명 시작")
        guard case let .attachment(reference, alt) = blocks[1] else {
            return XCTFail("expected attachment block")
        }
        XCTAssertEqual(reference, "aaaaaaaa-1111-4111-8111-111111111111")
        XCTAssertEqual(alt, "image.png")
        guard case let .markdown(trailing) = blocks[2] else {
            return XCTFail("expected trailing markdown")
        }
        XCTAssertEqual(trailing, "설명 끝")
    }

    func testCollectsEmbeddedAttachmentReferencesCaseInsensitively() {
        let markdown = "before ![shot](briar-attachment://AaBb-123) after"
        let references = IssueAttachmentMedia.embeddedReferences(in: markdown)
        XCTAssertEqual(references, ["aabb-123"])
        XCTAssertTrue(IssueAttachmentMedia.embeddedReferences(in: nil).isEmpty)
        XCTAssertTrue(IssueAttachmentMedia.embeddedReferences(in: "no images").isEmpty)
    }

    func testKeepsPlainMarkdownWhenNoAttachmentImagesExist() {
        let markdown = "일반 설명만 있습니다."
        let blocks = IssueDescriptionBlock.parse(markdown)
        XCTAssertEqual(blocks, [.markdown(markdown)])
    }
}
