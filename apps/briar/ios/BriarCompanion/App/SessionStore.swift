import Foundation
import Security
import Combine

protocol SessionTokenStoring: Sendable {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}

enum SessionStoreError: Error, Equatable {
    case keychain(OSStatus)
    case emptyToken
}

struct KeychainSessionTokenStore: SessionTokenStoring, Sendable {
    let service: String
    let account: String

    init(
        service: String = Bundle.main.bundleIdentifier ?? "app.briar.companion.native",
        account: String = "briar.session-token"
    ) {
        self.service = service
        self.account = account
    }

    func read() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SessionStoreError.keychain(status) }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return token
    }

    func write(_ token: String) throws {
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SessionStoreError.emptyToken
        }
        let data = Data(token.utf8)
        let status = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw SessionStoreError.keychain(addStatus) }
        } else if status != errSecSuccess {
            throw SessionStoreError.keychain(status)
        }
    }

    func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SessionStoreError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

struct LegacyTauriSessionMigrator: Sendable {
    private struct LegacySession: Decodable { let token: String }

    let legacyURL: URL
    let markerURL: URL

    init(
        applicationSupportURL: URL? = nil,
        legacyBundleIdentifier: String = "app.briar.companion"
    ) {
        let support = applicationSupportURL ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory
        legacyURL = support
            .appending(path: legacyBundleIdentifier, directoryHint: .isDirectory)
            .appending(path: "session.json")
        markerURL = support.appending(path: ".native-session-migration-v1")
    }

    /// Imports only from the current app container. This intentionally cannot
    /// reach another installed bundle's sandbox.
    func migrateIfNeeded(into store: any SessionTokenStoring) throws -> Bool {
        let fileManager = FileManager.default
        guard !fileManager.fileExists(atPath: markerURL.path) else { return false }
        guard fileManager.fileExists(atPath: legacyURL.path) else {
            try markComplete()
            return false
        }
        if try store.read() != nil {
            try fileManager.removeItem(at: legacyURL)
            try markComplete()
            return false
        }
        let session = try JSONDecoder().decode(
            LegacySession.self,
            from: Data(contentsOf: legacyURL)
        )
        try store.write(session.token)
        try fileManager.removeItem(at: legacyURL)
        try markComplete()
        return true
    }

    private func markComplete() throws {
        try FileManager.default.createDirectory(
            at: markerURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data().write(to: markerURL, options: .atomic)
    }
}

@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var token: String?
    private let secureStore: any SessionTokenStoring

    init(
        secureStore: any SessionTokenStoring = KeychainSessionTokenStore(),
        migrator: LegacyTauriSessionMigrator = LegacyTauriSessionMigrator()
    ) {
        self.secureStore = secureStore
        _ = try? migrator.migrateIfNeeded(into: secureStore)
        token = try? secureStore.read()
    }

    func signIn(token: String) throws {
        try secureStore.write(token)
        self.token = token
    }

    func signOut() throws {
        try secureStore.clear()
        token = nil
    }
}
