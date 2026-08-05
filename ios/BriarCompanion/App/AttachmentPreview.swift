import SwiftUI

struct PreviewFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Shared helpers for issue attachment media detection and inline markdown references.
enum IssueAttachmentMedia {
    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff",
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
import QuickLook
import UIKit

/// In-memory cache so List cell recycle / `.task` restart does not re-download and flash.
@MainActor
enum AuthenticatedImageMemoryCache {
    private static let images = NSCache<NSString, UIImage>()
    private static let urls = NSCache<NSString, NSURL>()

    static func image(for sourceID: String) -> UIImage? {
        images.object(forKey: sourceID as NSString)
    }

    static func fileURL(for sourceID: String) -> URL? {
        urls.object(forKey: sourceID as NSString) as URL?
    }

    static func store(sourceID: String, image: UIImage, fileURL: URL) {
        images.setObject(image, forKey: sourceID as NSString)
        urls.setObject(fileURL as NSURL, forKey: sourceID as NSString)
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
                .accessibilityLabel("\(filename) 크게 보기")
            } else if failed {
                Button {
                    Task { await loadImage(force: true) }
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(filename)
                            Text("이미지를 불러올 수 없음 · 다시 시도")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "photo.badge.exclamationmark")
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(filename) 이미지를 다시 불러오기")
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
                .accessibilityLabel("\(filename) 이미지 불러오는 중")
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
            let data = try Data(contentsOf: downloadedURL)
            guard let loaded = UIImage(data: data) else {
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
