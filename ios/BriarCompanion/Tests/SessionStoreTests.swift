import Foundation
import Security
import XCTest
@testable import BriarCompanion

final class SessionStoreTests: XCTestCase {
    func testMigratesLegacyTauriSessionOnceAndDeletesPlaintext() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "briar-session-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacyURL = directory
            .appending(path: "app.briar.companion", directoryHint: .isDirectory)
            .appending(path: "session.json")
        try FileManager.default.createDirectory(
            at: legacyURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(#"{"token":"legacy-token"}"#.utf8).write(to: legacyURL)
        let secureStore = MemoryTokenStore()
        let migrator = LegacyTauriSessionMigrator(applicationSupportURL: directory)

        XCTAssertTrue(try migrator.migrateIfNeeded(into: secureStore))
        XCTAssertEqual(try secureStore.read(), "legacy-token")
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyURL.path))
        XCTAssertFalse(try migrator.migrateIfNeeded(into: secureStore))
    }

    func testFailedSecureWritePreservesLegacySessionForRecovery() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "briar-session-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacyURL = directory
            .appending(path: "app.briar.companion", directoryHint: .isDirectory)
            .appending(path: "session.json")
        try FileManager.default.createDirectory(
            at: legacyURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(#"{"token":"legacy-token"}"#.utf8).write(to: legacyURL)
        let secureStore = MemoryTokenStore(failWrites: true)

        XCTAssertThrowsError(
            try LegacyTauriSessionMigrator(applicationSupportURL: directory)
                .migrateIfNeeded(into: secureStore)
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacyURL.path))
    }

    func testRetryRemovesPlaintextAfterKeychainWriteAlreadySucceeded() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "briar-session-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacyURL = directory
            .appending(path: "app.briar.companion", directoryHint: .isDirectory)
            .appending(path: "session.json")
        try FileManager.default.createDirectory(
            at: legacyURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(#"{"token":"legacy-token"}"#.utf8).write(to: legacyURL)
        let secureStore = MemoryTokenStore()
        try secureStore.write("legacy-token")

        XCTAssertFalse(
            try LegacyTauriSessionMigrator(applicationSupportURL: directory)
                .migrateIfNeeded(into: secureStore)
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyURL.path))
        XCTAssertEqual(try secureStore.read(), "legacy-token")
    }
}

private final class MemoryTokenStore: SessionTokenStoring, @unchecked Sendable {
    private var token: String?
    private let failWrites: Bool

    init(failWrites: Bool = false) { self.failWrites = failWrites }
    func read() throws -> String? { token }
    func write(_ token: String) throws {
        if failWrites { throw SessionStoreError.keychain(errSecNotAvailable) }
        self.token = token
    }
    func clear() throws { token = nil }
}
