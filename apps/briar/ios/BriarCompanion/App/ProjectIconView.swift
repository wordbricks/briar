import SwiftUI

struct ProjectIconView: View {
    let icon: String?
    var size: CGFloat = 28

    private var cornerRadius: CGFloat {
        size * 0.22
    }

    var body: some View {
        BriarImageIcon(
            source: icon,
            size: size,
            cornerRadius: cornerRadius
        ) {
            fallback
        }
    }

    @ViewBuilder
    private var fallback: some View {
        Image(systemName: "folder.fill")
            .font(.system(size: max(12, size * 0.5), weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
