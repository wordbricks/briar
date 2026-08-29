import SwiftUI

struct PreviewFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Shared helpers for issue attachment media detection and inline markdown references.
enum IssueAttachmentMedia {
    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "svg",
    ]

    static func isImage(contentType: String, filename: String) -> Bool {
        let normalizedType = contentType
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if normalizedType.hasPrefix("image/") { return true }
        let ext = URL(fileURLWithPath: filename)
            .pathExtension
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return imageExtensions.contains(ext)
    }

    static func isHTML(contentType: String, filename: String) -> Bool {
        let normalizedType = contentType
            .split(separator: ";", maxSplits: 1)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if normalizedType == "text/html" { return true }
        let ext = URL(fileURLWithPath: filename)
            .pathExtension
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return ext == "html" || ext == "htm"
    }

    /// Reference ids embedded as `![alt](briar-attachment://id)` in issue markdown.
    static func embeddedReferences(in markdown: String?) -> Set<String> {
        guard let markdown, !markdown.isEmpty else { return [] }
        let pattern = #"!\[[^\]]*\]\(briar-attachment://([0-9a-zA-Z_-]+)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(markdown.startIndex..<markdown.endIndex, in: markdown)
        var references = Set<String>()
        regex.enumerateMatches(in: markdown, range: range) { match, _, _ in
            guard
                let match,
                match.numberOfRanges > 1,
                let idRange = Range(match.range(at: 1), in: markdown)
            else { return }
            references.insert(String(markdown[idRange]).lowercased())
        }
        return references
    }
}

enum IssueDescriptionBlock: Equatable {
    case markdown(String)
    case attachment(reference: String, alt: String)

    /// Split issue markdown so authenticated attachment images render as real previews.
    static func parse(_ markdown: String) -> [IssueDescriptionBlock] {
        let pattern = #"!\[([^\]]*)\]\(briar-attachment://([0-9a-zA-Z_-]+)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return markdown.isEmpty ? [] : [.markdown(markdown)]
        }
        let fullRange = NSRange(markdown.startIndex..<markdown.endIndex, in: markdown)
        var blocks: [IssueDescriptionBlock] = []
        var cursor = markdown.startIndex

        regex.enumerateMatches(in: markdown, range: fullRange) { match, _, _ in
            guard
                let match,
                let fullSwiftRange = Range(match.range(at: 0), in: markdown),
                let altRange = Range(match.range(at: 1), in: markdown),
                let referenceRange = Range(match.range(at: 2), in: markdown)
            else { return }

            if cursor < fullSwiftRange.lowerBound {
                let leading = String(markdown[cursor..<fullSwiftRange.lowerBound])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !leading.isEmpty {
                    blocks.append(.markdown(leading))
                }
            }

            let alt = String(markdown[altRange])
                .replacingOccurrences(of: "\\[", with: "[")
                .replacingOccurrences(of: "\\]", with: "]")
            let reference = String(markdown[referenceRange])
            blocks.append(.attachment(reference: reference, alt: alt))
            cursor = fullSwiftRange.upperBound
        }

        if cursor < markdown.endIndex {
            let trailing = String(markdown[cursor...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !trailing.isEmpty {
                blocks.append(.markdown(trailing))
            }
        }

        return blocks
    }
}

struct IdentifiedIssueDescriptionBlock: Identifiable, Equatable {
    let id: Int
    let block: IssueDescriptionBlock

    static func parse(_ markdown: String) -> [IdentifiedIssueDescriptionBlock] {
        IssueDescriptionBlock.parse(markdown).enumerated().map {
            IdentifiedIssueDescriptionBlock(id: $0.offset, block: $0.element)
        }
    }
}

#if os(iOS)
import ImageIO
import QuickLook
import UIKit
import WebKit

/// In-memory cache so List cell recycle / `.task` restart does not re-download and flash.
@MainActor
enum AuthenticatedImageMemoryCache {
    static let imageCountLimit = 40
    static let imageCostLimit = 64 * 1_024 * 1_024

    private static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = imageCountLimit
        cache.totalCostLimit = imageCostLimit
        return cache
    }()
    private static let urls: NSCache<NSString, NSURL> = {
        let cache = NSCache<NSString, NSURL>()
        cache.countLimit = imageCountLimit
        return cache
    }()

    static func image(for sourceID: String) -> UIImage? {
        images.object(forKey: sourceID as NSString)
    }

    static func fileURL(for sourceID: String) -> URL? {
        urls.object(forKey: sourceID as NSString) as URL?
    }

    static func store(sourceID: String, image: UIImage, fileURL: URL) {
        let pixelCost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        images.setObject(
            image,
            forKey: sourceID as NSString,
            cost: pixelCost
        )
        urls.setObject(fileURL as NSURL, forKey: sourceID as NSString)
    }

    static func removeAll() {
        images.removeAllObjects()
        urls.removeAllObjects()
    }
}

enum AuthenticatedImageDecoding {
    struct SendableImage: @unchecked Sendable {
        let value: UIImage?
    }

    static let maxPreviewPixelSize: CGFloat = 2_048

    static func previewImage(at url: URL) throws -> UIImage? {
        let sourceOptions = [
            kCGImageSourceShouldCache: false,
        ] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions) else {
            return try fallbackImage(at: url)
        }
        let thumbnailOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPreviewPixelSize,
        ] as CFDictionary
        if let thumbnail = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            thumbnailOptions
        ) {
            return UIImage(cgImage: thumbnail)
        }
        return try fallbackImage(at: url)
    }

    private static func fallbackImage(at url: URL) throws -> UIImage? {
        UIImage(data: try Data(contentsOf: url))
    }
}

enum HTMLArtifactPreviewConfiguration {
    static let path = "/html-artifact-preview"
    static let protocolVersion = 1
    static let renderMessageType = "briar-html-artifact-preview:render"
    static let maximumPayloadBytes = 20 * 1_024 * 1_024

    static func allowsPayload(byteCount: Int) -> Bool {
        byteCount >= 0 && byteCount <= maximumPayloadBytes
    }

    static func previewURL(apiBaseURL: URL) -> URL? {
        guard
            let scheme = apiBaseURL.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            apiBaseURL.host != nil,
            var components = URLComponents(
                url: apiBaseURL,
                resolvingAgainstBaseURL: false
            ),
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            components.path.isEmpty || components.path == "/"
        else { return nil }
        components.path = path
        return components.url
    }

    static var previewURL: URL? {
        let configured = ProcessInfo.processInfo.environment["BRIAR_API_URL"] ??
            "https://briar-api.wbai.workers.dev"
        guard let apiBaseURL = URL(string: configured) else { return nil }
        return previewURL(apiBaseURL: apiBaseURL)
    }
}

enum HTMLArtifactDocument {
    static func read(from url: URL) throws -> String {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        if let fileSize = attributes[.size] as? NSNumber,
           !HTMLArtifactPreviewConfiguration.allowsPayload(
               byteCount: fileSize.intValue
           )
        {
            throw CocoaError(.fileReadTooLarge)
        }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard HTMLArtifactPreviewConfiguration.allowsPayload(byteCount: data.count) else {
            throw CocoaError(.fileReadTooLarge)
        }
        let document = String(decoding: data, as: UTF8.self)
        guard HTMLArtifactPreviewConfiguration.allowsPayload(
            byteCount: document.utf8.count
        ) else {
            throw CocoaError(.fileReadTooLarge)
        }
        return document
    }
}

struct AuthenticatedHTMLArtifactPreview: View {
    let filename: String
    let byteSize: Int
    let accessibilityID: String
    let load: @MainActor () async throws -> URL

    @State private var presented = false

    var body: some View {
        Button {
            presented = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.title3)
                    .foregroundStyle(.tint)
                    .frame(width: 42, height: 42)
                    .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(filename)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Text(ByteCountFormatter.string(
                        fromByteCount: Int64(byteSize),
                        countStyle: .file
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Text("HTML")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.tint)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.format("%@ 미리보기", filename))
        .accessibilityIdentifier(accessibilityID)
        .sheet(isPresented: $presented) {
            HTMLArtifactPreviewSheet(filename: filename, load: load)
        }
    }
}

private struct HTMLArtifactPreviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    let filename: String
    let load: @MainActor () async throws -> URL

    @State private var document: String?
    @State private var failed = false
    @State private var loading = true
    @State private var loadAttempt = 0
    @State private var shellAttempt = UUID()

    var body: some View {
        NavigationStack {
            ZStack {
                if let document,
                   let shellURL = HTMLArtifactPreviewConfiguration.previewURL
                {
                    IsolatedHTMLArtifactWebView(
                        document: document,
                        shellURL: shellURL,
                        onRendered: {
                            loading = false
                            failed = false
                        },
                        onFailure: {
                            loading = false
                            failed = true
                        }
                    )
                    .id(shellAttempt)
                }
                if loading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemBackground))
                } else if failed {
                    ContentUnavailableView {
                        Label(
                            L10n.text("미리보기를 열 수 없음"),
                            systemImage: "exclamationmark.triangle"
                        )
                    } actions: {
                        Button(L10n.text("다시 시도")) { retry() }
                    }
                    .background(Color(.systemBackground))
                }
            }
            .navigationTitle(filename)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("닫기")) { dismiss() }
                }
            }
        }
        .task(id: loadAttempt) { await loadDocument() }
    }

    @MainActor
    private func loadDocument() async {
        guard document == nil else { return }
        loading = true
        failed = false
        do {
            let downloadedURL = try await load()
            let loadedDocument = try await Task.detached(priority: .userInitiated) {
                try HTMLArtifactDocument.read(from: downloadedURL)
            }.value
            guard !Task.isCancelled else { return }
            document = loadedDocument
            shellAttempt = UUID()
            if HTMLArtifactPreviewConfiguration.previewURL == nil {
                loading = false
                failed = true
            }
        } catch is CancellationError {
            return
        } catch {
            loading = false
            failed = true
        }
    }

    private func retry() {
        loading = true
        failed = false
        if document == nil {
            loadAttempt += 1
        } else {
            shellAttempt = UUID()
        }
    }
}

private struct IsolatedHTMLArtifactWebView: UIViewRepresentable {
    let document: String
    let shellURL: URL
    let onRendered: @MainActor () -> Void
    let onFailure: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            document: document,
            shellURL: shellURL,
            onRendered: onRendered,
            onFailure: onFailure
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsLinkPreview = false
        context.coordinator.startTimeout()
        webView.load(URLRequest(
            url: shellURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 5
        ))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.cancel()
        webView.stopLoading()
        webView.navigationDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private let document: String
        private let shellURL: URL
        private let onRendered: () -> Void
        private let onFailure: () -> Void
        private var allowedInitialNavigation = false
        private var completed = false
        private var timeout: DispatchWorkItem?

        init(
            document: String,
            shellURL: URL,
            onRendered: @escaping () -> Void,
            onFailure: @escaping () -> Void
        ) {
            self.document = document
            self.shellURL = shellURL
            self.onRendered = onRendered
            self.onFailure = onFailure
        }

        func startTimeout() {
            let workItem = DispatchWorkItem { [weak self] in self?.finish(success: false) }
            timeout = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: workItem)
        }

        func cancel() {
            timeout?.cancel()
            timeout = nil
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if !allowedInitialNavigation,
               navigationAction.request.url == shellURL
            {
                allowedInitialNavigation = true
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
        ) {
            guard
                navigationResponse.response.url == shellURL,
                let response = navigationResponse.response as? HTTPURLResponse,
                response.statusCode == 200,
                let policy = response.value(forHTTPHeaderField: "Content-Security-Policy"),
                policy.contains("sandbox allow-scripts"),
                policy.contains("connect-src 'none'"),
                response.value(forHTTPHeaderField: "Referrer-Policy") == "no-referrer"
            else {
                decisionHandler(.cancel)
                finish(success: false)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor [weak self, weak webView] in
                guard let self, let webView else { return }
                do {
                    let value = try await webView.evaluateJavaScript(
                        "globalThis.__BRIAR_HTML_ARTIFACT_PREVIEW_READY__ === true"
                    )
                    guard value as? Bool == true else {
                        finish(success: false)
                        return
                    }
                    _ = try await webView.callAsyncJavaScript(
                        "window.postMessage(message, '*')",
                        arguments: [
                            "message": [
                                "type": HTMLArtifactPreviewConfiguration.renderMessageType,
                                "version": HTMLArtifactPreviewConfiguration.protocolVersion,
                                "html": self.document,
                            ],
                        ],
                        in: nil,
                        contentWorld: .page
                    )
                    finish(success: true)
                } catch {
                    finish(success: false)
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            finish(success: false)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            finish(success: false)
        }

        private func finish(success: Bool) {
            guard !completed else { return }
            completed = true
            cancel()
            if success { onRendered() } else { onFailure() }
        }
    }
}

struct AuthenticatedImagePreview: View {
    let sourceID: String
    let filename: String
    let detail: String?
    let accessibilityID: String
    let load: @MainActor () async throws -> URL
    let open: @MainActor (URL) -> Void

    @State private var image: UIImage?
    @State private var fileURL: URL?
    @State private var failed = false
    @State private var loading = false

    var body: some View {
        Group {
            if let image {
                Button {
                    if let fileURL {
                        open(fileURL)
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 360)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        metadata
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.format("%@ 크게 보기", filename))
            } else if failed {
                VStack(alignment: .leading, spacing: 8) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(filename)
                            Text(L10n.text("이미지 미리보기를 지원하지 않음"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "photo.badge.exclamationmark")
                    }
                    if let fileURL {
                        Button {
                            open(fileURL)
                        } label: {
                            Label(L10n.text("파일 열기"), systemImage: "arrow.up.right.square")
                        }
                        .buttonStyle(.borderless)
                    }
                    Button {
                        Task { await loadImage(force: true) }
                    } label: {
                        Label(L10n.text("다시 시도"), systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                }
                .foregroundStyle(.secondary)
                .accessibilityLabel(L10n.format("%@ 미리보기", filename))
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text(filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel(L10n.format("%@ 이미지 불러오는 중", filename))
            }
        }
        .accessibilityIdentifier(accessibilityID)
        .task(id: sourceID) {
            await loadImage(force: false)
        }
    }

    @MainActor
    private func loadImage(force: Bool) async {
        if !force,
           let cached = AuthenticatedImageMemoryCache.image(for: sourceID)
        {
            image = cached
            fileURL = AuthenticatedImageMemoryCache.fileURL(for: sourceID)
            failed = false
            return
        }
        if !force, image != nil { return }
        if loading, !force { return }

        loading = true
        if force {
            image = nil
            fileURL = nil
        }
        failed = false
        defer { loading = false }

        do {
            let downloadedURL = try await load()
            fileURL = downloadedURL
            let decoded = try await Task.detached(priority: .userInitiated) {
                AuthenticatedImageDecoding.SendableImage(
                    value: try AuthenticatedImageDecoding.previewImage(
                        at: downloadedURL
                    )
                )
            }.value
            guard let loaded = decoded.value else {
                failed = true
                return
            }
            AuthenticatedImageMemoryCache.store(
                sourceID: sourceID,
                image: loaded,
                fileURL: downloadedURL
            )
            image = loaded
            fileURL = downloadedURL
        } catch is CancellationError {
            // Keep current state; a later task restart or cache hit will finish the job.
            return
        } catch {
            failed = true
        }
    }

    @ViewBuilder
    private var metadata: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(filename)
                .font(.subheadline)
                .lineLimit(2)
            if let detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct QuickLookPreview: UIViewControllerRepresentable {
    let fileURL: URL

    func makeCoordinator() -> Coordinator { Coordinator(fileURL: fileURL) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.fileURL = fileURL
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var fileURL: URL

        init(fileURL: URL) { self.fileURL = fileURL }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> any QLPreviewItem {
            fileURL as NSURL
        }
    }
}
#else
struct QuickLookPreview: View {
    let fileURL: URL

    var body: some View {
        Link(fileURL.lastPathComponent, destination: fileURL)
    }
}
#endif
