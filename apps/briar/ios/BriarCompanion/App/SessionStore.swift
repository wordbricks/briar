import Foundation
import Security
import Combine

enum SessionStoreError: Error, Equatable {
    case keychain(OSStatus)
    case emptyToken
}

struct KeychainSessionTokenStore: Sendable {
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

@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var token: String?
    private let secureStore: KeychainSessionTokenStore

    init(secureStore: KeychainSessionTokenStore = KeychainSessionTokenStore()) {
        self.secureStore = secureStore
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
