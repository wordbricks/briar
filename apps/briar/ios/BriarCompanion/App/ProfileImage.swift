import Foundation
import SwiftUI
import UIKit

/// Decodes Briar profile/avatar payloads stored as data URLs or remote HTTPS URLs.
enum ProfileImageSource: Equatable, Sendable {
    case data(Data)
    case remote(URL)

    static func parse(_ raw: String?) -> ProfileImageSource? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if value.lowercased().hasPrefix("data:") {
            return decodeDataURL(value).map(ProfileImageSource.data)
        }

        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            return nil
        }
        return .remote(url)
    }

    static func decodeDataURL(_ value: String) -> Data? {
        guard let comma = value.firstIndex(of: ",") else { return nil }
        let metadata = value[..<comma].lowercased()
        let payload = String(value[value.index(after: comma)...])
        guard metadata.hasPrefix("data:"), metadata.contains(";base64") else { return nil }
        return Data(base64Encoded: payload, options: [.ignoreUnknownCharacters])
    }
}

/// Shared rendering primitive for Briar images stored as data URLs or remote URLs.
/// Callers provide only their domain-specific placeholder and corner treatment.
struct BriarImageIcon<Placeholder: View>: View {
    let source: String?
    let size: CGFloat
    let cornerRadius: CGFloat
    private let placeholder: () -> Placeholder

    init(
        source: String?,
        size: CGFloat,
        cornerRadius: CGFloat,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.source = source
        self.size = size
        self.cornerRadius = cornerRadius
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let source = ProfileImageSource.parse(source) {
                switch source {
                case let .data(data):
                    if let image = UIImage(data: data) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    } else {
                        placeholder()
                    }
                case let .remote(url):
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case let .success(image):
                            image.resizable().scaledToFill()
                        case .failure:
                            placeholder()
                        case .empty:
                            ProgressView()
                        @unknown default:
                            placeholder()
                        }
                    }
                }
            } else {
                placeholder()
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
}

struct ProfileImageView: View {
    let image: String?
    var name: String? = nil
    var systemImage: String = "person.fill"
    var size: CGFloat = 36
    var cornerRadius: CGFloat? = nil

    private var resolvedCornerRadius: CGFloat {
        cornerRadius ?? size / 2
    }

    var body: some View {
        BriarImageIcon(
            source: image,
            size: size,
            cornerRadius: resolvedCornerRadius
        ) {
            fallback
        }
    }

    @ViewBuilder
    private var fallback: some View {
        if let initial = name?.trimmingCharacters(in: .whitespacesAndNewlines).first {
            Text(String(initial).uppercased())
                .font(.system(size: max(12, size * 0.42), weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Image(systemName: systemImage)
                .font(.system(size: max(12, size * 0.42), weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
