import BriarContracts
import XCTest
@testable import BriarCompanion

final class DmMemoryTreeTests: XCTestCase {
    private func document(
        _ id: String, path: String?, type: String? = nil, status: String? = nil, readOnly: Bool = false,
        protected: Bool = false
    ) -> DmMemoryDocument {
        var document = DmMemoryDocument()
        document.id = id
        document.title = id
        document.version = 2
        document.memoryClass = .note
        if let path { document.path = path }
        if let type { document.recordType = type }
        if let status { document.recordStatus = status }
        document.readOnly = readOnly
        document.protectedByUser = protected
        return document
    }

    private func children(_ node: DmMemoryTreeNode) -> [DmMemoryTreeNode] {
        guard case let .folder(_, _, children, _) = node else { return [] }
        return children
    }

    private func child(_ node: DmMemoryTreeNode, _ name: String) -> DmMemoryTreeNode? {
        children(node).first { $0.name == name }
    }

    func testBuildsTheSkeletonAndNestsFilesAtTheirPaths() {
        let root = DmMemoryTreeNode.tree(
            folders: ["comms", "entities/people", "entities/tools", "workstreams"],
            documents: [
                document("playbook", path: "playbook.md", type: "playbook"),
                document("readme", path: "README.md", type: "readme", readOnly: true),
                document("jane", path: "entities/people/jane.md", type: "person"),
                document("move", path: "workstreams/completed/move.md", type: "workstream", status: "completed"),
                document("launch", path: "workstreams/launch.md", type: "workstream", status: "active"),
            ]
        )
        XCTAssertEqual(root.name, DmMemoryTreeNode.rootName)
        XCTAssertEqual(root.fileCount, 5)
        // Folders first, then files, each sorted by name.
        XCTAssertEqual(children(root).map(\.name), ["comms", "entities", "workstreams", "README.md", "playbook.md"])
        XCTAssertEqual(child(root, "comms")?.fileCount, 0)
        let entities = child(root, "entities")!
        XCTAssertEqual(children(entities).map(\.name), ["people", "tools"])
        XCTAssertEqual(children(child(entities, "people")!).map(\.name), ["jane.md"])
        XCTAssertEqual(child(entities, "tools")?.fileCount, 0)
        // The legacy folder exists only because a file lives there.
        let workstreams = child(root, "workstreams")!
        XCTAssertEqual(children(workstreams).map(\.name), ["completed", "launch.md"])
        XCTAssertEqual(workstreams.fileCount, 2)
        guard case let .file(_, _, move) = children(child(workstreams, "completed")!)[0] else {
            return XCTFail("expected a file")
        }
        XCTAssertEqual(move.treeDetails, ["workstream", "completed", "r2"])
        guard case let .file(_, _, readme) = child(root, "README.md")! else { return XCTFail("expected a file") }
        XCTAssertEqual(readme.treeDetails, ["readme"])
    }

    func testListsRecordsFromAnOlderServerAtTheRootUnderTheirTitles() {
        let root = DmMemoryTreeNode.tree(folders: [], documents: [document("synthetic", path: nil)])
        XCTAssertEqual(children(root).map(\.name), ["synthetic"])
        guard case let .file(_, _, synthetic) = children(root)[0] else { return XCTFail("expected a file") }
        XCTAssertEqual(synthetic.treeDetails, ["note", "r2"])
    }

    func testPreviewNamesAFileByItsLastPathSegmentOrItsTitle() {
        XCTAssertEqual(document("jane", path: "entities/people/jane.md").fileName, "jane.md")
        XCTAssertEqual(document("readme", path: "README.md").fileName, "README.md")
        // A server before the folder tree sends no path.
        XCTAssertEqual(document("synthetic", path: nil).fileName, "synthetic")
    }

    func testMetaLineAddsReadOnlyAndProtectionInTheUsersLanguage() {
        let jane = document("jane", path: "entities/people/jane.md", type: "person", protected: true)
        XCTAssertEqual(jane.detailLabels(locale: .ko), ["person", "r2", "사용자 보호"])
        XCTAssertEqual(jane.detailLabels(locale: .en), ["person", "r2", "User protected"])
        let readme = document("readme", path: "README.md", type: "readme", readOnly: true)
        XCTAssertEqual(readme.detailLabels(locale: .ko), ["readme", "읽기 전용"])
        let launch = document("launch", path: "workstreams/launch.md", type: "workstream", status: "active")
        XCTAssertEqual(launch.detailLabels(locale: .en), ["workstream", "active", "r2"])
        // An empty record type falls back to the legacy memory class.
        XCTAssertEqual(document("synthetic", path: nil).detailLabels(locale: .en), ["note", "r2"])
    }
}
