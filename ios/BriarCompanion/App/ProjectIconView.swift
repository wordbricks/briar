import SwiftUI

struct ProjectIconView: View {
    let icon: String?
    var size: CGFloat = 28

    private var cornerRadius: CGFloat {
        size * 0.22
    }

    var body: some View {
        Group {
            if let source = ProfileImageSource.parse(icon) {
                switch source {
                case let .data(data):
                    if let uiImage = UIImage(data: data) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                    } else {
                        fallback
                    }
                case let .remote(url):
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case let .success(image):
                            image.resizable().scaledToFill()
                        case .failure:
                            fallback
                        case .empty:
                            ProgressView()
                        @unknown default:
                            fallback
                        }
                    }
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .background(Color.secondary.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var fallback: some View {
        Image(systemName: "folder.fill")
            .font(.system(size: max(12, size * 0.5), weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
