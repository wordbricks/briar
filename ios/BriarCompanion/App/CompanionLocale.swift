import Foundation
import SwiftUI

enum CompanionLocale: String, CaseIterable, Identifiable, Sendable {
    case ko
    case en
    case zh

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ko: "한국어"
        case .en: "English"
        case .zh: "中文"
        }
    }

    var agentLocale: ProjectAgentLocale {
        switch self {
        case .ko: .ko
        case .en: .en
        case .zh: .zh
        }
    }
}

enum L10n {
    static func text(_ key: Key, locale: CompanionLocale) -> String {
        switch locale {
        case .ko: key.ko
        case .en: key.en
        case .zh: key.zh
        }
    }

    enum Key {
        case settingsTitle
        case settingsAccount
        case settingsAppearance
        case settingsTheme
        case settingsLanguage
        case settingsAppIcon
        case settingsNotifications
        case settingsPermissions
        case settingsPermissionsDetail
        case themeSystem
        case themeLight
        case themeDark
        case markAllRead
        case inboxEmpty
        case agentsEmpty
        case sessionsSection
        case shareIssue
        case copyLink
        case linkCopied
        case profileEmail
        case notificationHint
        case channelsCommon
        case channelsOtherProject
        case channelsEmpty
        case channelThread
        case channelHome

        var ko: String {
            switch self {
            case .settingsTitle: "Companion 설정"
            case .settingsAccount: "계정"
            case .settingsAppearance: "화면"
            case .settingsTheme: "테마"
            case .settingsLanguage: "언어"
            case .settingsAppIcon: "앱 아이콘"
            case .settingsNotifications: "알림 분류"
            case .settingsPermissions: "접근 권한"
            case .settingsPermissionsDetail: "이슈 작성, 실행 제어, 결과 검수와 대화를 지원합니다."
            case .themeSystem: "시스템"
            case .themeLight: "라이트"
            case .themeDark: "다크"
            case .markAllRead: "모두 읽음"
            case .inboxEmpty: "새 알림 없음"
            case .agentsEmpty: "표시할 Agent 없음"
            case .sessionsSection: "세션"
            case .shareIssue: "이슈 공유"
            case .copyLink: "링크 복사"
            case .linkCopied: "링크를 복사했습니다"
            case .profileEmail: "이메일"
            case .channelsCommon: "공통 채널"
            case .channelsOtherProject: "다른 프로젝트"
            case .channelsEmpty: "채널이 없습니다."
            case .channelThread: "스레드"
            case .channelHome: "홈"
            case .notificationHint: "선택한 분류의 새 항목이 도착하면 로컬 알림을 보냅니다."
            }
        }

        var en: String {
            switch self {
            case .settingsTitle: "Companion settings"
            case .settingsAccount: "Account"
            case .settingsAppearance: "Appearance"
            case .settingsTheme: "Theme"
            case .settingsLanguage: "Language"
            case .settingsAppIcon: "App icon"
            case .settingsNotifications: "Notification categories"
            case .settingsPermissions: "Access"
            case .settingsPermissionsDetail: "Supports issue writing, run control, result review, and conversation."
            case .themeSystem: "System"
            case .themeLight: "Light"
            case .themeDark: "Dark"
            case .markAllRead: "Mark all read"
            case .inboxEmpty: "No new messages"
            case .agentsEmpty: "No agents yet"
            case .sessionsSection: "Sessions"
            case .shareIssue: "Share issue"
            case .copyLink: "Copy link"
            case .linkCopied: "Link copied"
            case .profileEmail: "Email"
            case .channelsCommon: "Common channels"
            case .channelsOtherProject: "Other project"
            case .channelsEmpty: "No channels yet."
            case .channelThread: "Thread"
            case .channelHome: "Home"
            case .notificationHint: "Local notifications fire for newly arrived items in the selected categories."
            }
        }

        var zh: String {
            switch self {
            case .settingsTitle: "Companion 设置"
            case .settingsAccount: "账户"
            case .settingsAppearance: "外观"
            case .settingsTheme: "主题"
            case .settingsLanguage: "语言"
            case .settingsAppIcon: "应用图标"
            case .settingsNotifications: "通知分类"
            case .settingsPermissions: "访问权限"
            case .settingsPermissionsDetail: "支持问题编写、运行控制、结果审核与对话。"
            case .themeSystem: "系统"
            case .themeLight: "浅色"
            case .themeDark: "深色"
            case .markAllRead: "全部标为已读"
            case .inboxEmpty: "没有新消息"
            case .agentsEmpty: "暂无 Agent"
            case .sessionsSection: "会话"
            case .shareIssue: "分享问题"
            case .copyLink: "复制链接"
            case .linkCopied: "链接已复制"
            case .profileEmail: "电子邮件"
            case .channelsCommon: "公共频道"
            case .channelsOtherProject: "其他项目"
            case .channelsEmpty: "还没有频道。"
            case .channelThread: "话题"
            case .channelHome: "主页"
            case .notificationHint: "所选分类有新项目时会发送本地通知。"
            }
        }
    }
}

extension CompanionAppearance {
    func localizedTitle(locale: CompanionLocale) -> String {
        switch self {
        case .system: L10n.text(.themeSystem, locale: locale)
        case .light: L10n.text(.themeLight, locale: locale)
        case .dark: L10n.text(.themeDark, locale: locale)
        }
    }
}
