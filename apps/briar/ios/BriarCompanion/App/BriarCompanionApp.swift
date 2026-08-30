import SwiftUI

@main
struct BriarCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            #if BRIAR_UI_TEST_SUPPORT
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                UITestCompanionFlow(
                    offline: ProcessInfo.processInfo.arguments.contains("--ui-testing-offline"),
                    locale: ProcessInfo.processInfo.arguments.contains("--ui-testing-english") ? .en : .ko,
                    delaysMessageSend: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-delayed-message-send"
                    ),
                    delaysChannelLoad: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-delayed-channel-load"
                    ),
                    hasChannelHistory: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-channel-history"
                    ),
                    showsBatchProposal: ProcessInfo.processInfo.arguments.contains(
                        "--ui-testing-batch-proposal"
                    )
                )
            } else {
                CompanionRootView(api: MobileHTTPClient(baseURL: Self.apiBaseURL))
            }
            #else
            CompanionRootView(api: MobileHTTPClient(baseURL: Self.apiBaseURL))
            #endif
        }
        .handlesExternalEvents(matching: Set(arrayLiteral: "*"))
    }

    private static var apiBaseURL: URL {
        let configured = ProcessInfo.processInfo.environment["BRIAR_API_URL"] ??
            "https://briar-api.wbai.workers.dev"
        return URL(string: configured)!
    }
}
