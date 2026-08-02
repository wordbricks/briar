import SwiftUI

struct FoundationStatusView: View {
    private let capabilities = [
        Capability(
            icon: "iphone.gen3",
            title: "독립 앱",
            detail: "기존 Companion과 함께 설치되는 개발 전용 SwiftUI 앱"
        ),
        Capability(
            icon: "arrow.left.arrow.right",
            title: "공유 API 계약",
            detail: "iOS와 Android가 같은 로그인·사용자·프로젝트 형식을 사용"
        ),
        Capability(
            icon: "checkmark.shield",
            title: "회귀 보호",
            detail: "네이티브 테스트와 기존 모바일 빌드를 한 CI에서 확인"
        ),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "leaf.fill")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(.green)
                            .accessibilityHidden(true)
                        Text("Briar Companion")
                            .font(.largeTitle.bold())
                            .accessibilityIdentifier("foundation-title")
                        Text("iOS 네이티브 기반 준비됨")
                            .font(.title3.weight(.medium))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("foundation-status")
                    }

                    VStack(spacing: 12) {
                        ForEach(capabilities) { capability in
                            CapabilityRow(capability: capability)
                        }
                    }

                    Text("이 화면은 전환 기반의 개발 상태를 확인하기 위한 것입니다. 실제 로그인과 프로젝트 화면은 모바일 API 계약 위에 단계적으로 추가됩니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(24)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct Capability: Identifiable {
    let icon: String
    let title: String
    let detail: String

    var id: String { title }
}

private struct CapabilityRow: View {
    let capability: Capability

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: capability.icon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.green)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(capability.title)
                    .font(.headline)
                Text(capability.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("capability-\(capability.title)")
    }
}

#Preview {
    FoundationStatusView()
}
