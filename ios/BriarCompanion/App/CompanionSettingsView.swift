import SwiftUI

struct CompanionSettingsView: View {
    @Binding var appearance: String
    @Binding var localeRaw: String
    @ObservedObject var notifications: LocalNotificationService
    let user: CurrentUserResponse.User?
    let onDismiss: () -> Void

    @State private var selectedIcon = AppIconService.current
    @State private var iconError: String?
    @State private var changingIcon = false

    private var locale: CompanionLocale {
        CompanionLocale(rawValue: localeRaw) ?? .ko
    }

    var body: some View {
        NavigationStack {
            Form {
                if let user {
                    Section(L10n.text(.settingsAccount, locale: locale)) {
                        LabeledContent("이름", value: user.name)
                        if let username = user.username, !username.isEmpty {
                            LabeledContent("사용자명", value: username)
                        }
                        LabeledContent(L10n.text(.profileEmail, locale: locale), value: user.email)
                    }
                }

                Section(L10n.text(.settingsAppearance, locale: locale)) {
                    Picker(L10n.text(.settingsTheme, locale: locale), selection: $appearance) {
                        ForEach(CompanionAppearance.allCases) { option in
                            Text(option.localizedTitle(locale: locale)).tag(option.rawValue)
                        }
                    }
                    Picker(L10n.text(.settingsLanguage, locale: locale), selection: $localeRaw) {
                        ForEach(CompanionLocale.allCases) { option in
                            Text(option.title).tag(option.rawValue)
                        }
                    }
                    .accessibilityIdentifier("settings-locale-picker")
                }

                Section {
                    Picker(L10n.text(.settingsAppIcon, locale: locale), selection: iconSelection) {
                        ForEach(AppIconName.allCases) { icon in
                            Text(icon.title).tag(icon)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(changingIcon)
                    .accessibilityIdentifier("settings-app-icon-picker")
                    HStack(spacing: 12) {
                        ForEach(AppIconName.allCases) { icon in
                            Button {
                                Task { await selectIcon(icon) }
                            } label: {
                                VStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .fill(icon.previewColor)
                                        .frame(width: 52, height: 52)
                                        .overlay {
                                            Image(icon.previewImageName)
                                                .resizable()
                                                .scaledToFill()
                                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        }
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                                .stroke(
                                                    selectedIcon == icon ? Color.accentColor : Color.secondary.opacity(0.3),
                                                    lineWidth: selectedIcon == icon ? 3 : 1
                                                )
                                        }
                                    Text(icon.title)
                                        .font(.caption2)
                                        .foregroundStyle(.primary)
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(changingIcon)
                            .accessibilityIdentifier("app-icon-\(icon.rawValue)")
                        }
                    }
                    .padding(.vertical, 4)
                    if let iconError {
                        Text(iconError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text(L10n.text(.settingsAppIcon, locale: locale))
                }

                Section {
                    ForEach(InboxCategory.allCases) { category in
                        Toggle(category.title, isOn: preferenceBinding(category))
                            .accessibilityIdentifier("notification-toggle-\(category.rawValue)")
                    }
                } header: {
                    Text(L10n.text(.settingsNotifications, locale: locale))
                } footer: {
                    Text(L10n.text(.notificationHint, locale: locale))
                }

                Section(L10n.text(.settingsPermissions, locale: locale)) {
                    Label("읽기·쓰기", systemImage: "pencil.and.list.clipboard")
                    Text(L10n.text(.settingsPermissionsDetail, locale: locale))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(L10n.text(.settingsTitle, locale: locale))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("완료", action: onDismiss)
                }
            }
            .onAppear { selectedIcon = AppIconService.current }
        }
    }

    private var iconSelection: Binding<AppIconName> {
        Binding(
            get: { selectedIcon },
            set: { icon in
                Task { await selectIcon(icon) }
            }
        )
    }

    private func preferenceBinding(_ category: InboxCategory) -> Binding<Bool> {
        Binding(
            get: { notifications.preferences[category] },
            set: { enabled in
                var next = notifications.preferences
                next[category] = enabled
                notifications.updatePreferences(next)
                if enabled {
                    Task { _ = await notifications.requestAuthorizationIfNeeded() }
                }
            }
        )
    }

    private func selectIcon(_ icon: AppIconName) async {
        guard icon != selectedIcon else { return }
        changingIcon = true
        iconError = nil
        defer { changingIcon = false }
        do {
            try await AppIconService.set(icon)
            selectedIcon = icon
        } catch {
            iconError = "이 기기에서 앱 아이콘을 변경할 수 없습니다."
        }
    }
}
