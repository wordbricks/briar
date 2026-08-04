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

    static func uiImage(from raw: String?) -> UIImage? {
        guard case let .data(data) = parse(raw) else { return nil }
        return UIImage(data: data)
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
        Group {
            if let source = ProfileImageSource.parse(image) {
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
        .clipShape(RoundedRectangle(cornerRadius: resolvedCornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: resolvedCornerRadius, style: .continuous)
                .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
        }
        .accessibilityHidden(true)
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
