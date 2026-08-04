import SwiftUI

struct PreviewFile: Identifiable {
    let url: URL
    var id: URL { url }
}

#if os(iOS)
import QuickLook
import UIKit

struct AuthenticatedImagePreview: View {
    let sourceID: String
    let filename: String
    let detail: String?
    let accessibilityID: String
    let load: @MainActor () async throws -> URL
    let open: @MainActor (URL) -> Void

    @State private var fileURL: URL?
    @State private var failed = false

    var body: some View {
        Group {
            if let fileURL, let image = UIImage(contentsOfFile: fileURL.path) {
                Button {
                    open(fileURL)
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
                    Task { await loadImage() }
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
            await loadImage()
        }
    }

    @MainActor
    private func loadImage() async {
        fileURL = nil
        failed = false
        do {
            let downloadedURL = try await load()
            guard UIImage(contentsOfFile: downloadedURL.path) != nil else {
                failed = true
                return
            }
            fileURL = downloadedURL
        } catch is CancellationError {
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
