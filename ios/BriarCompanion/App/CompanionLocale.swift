import Foundation
import SwiftUI

enum CompanionLocale: String, CaseIterable, Identifiable, Sendable {
    case ko
    case en
    case zh

    var id: String { rawValue }

    static var current: CompanionLocale { L10n.current }

    var title: String {
        switch self {
        case .ko: "한국어"
        case .en: "English"
        case .zh: "中文"
        }
    }

    var foundationIdentifier: String {
        switch self {
        case .ko: "ko-KR"
        case .en: "en-US"
        case .zh: "zh-CN"
        }
    }
}

enum L10n {
    static var current: CompanionLocale {
        CompanionLocale(
            rawValue: UserDefaults.standard.string(forKey: "companion-locale")
                ?? CompanionLocale.ko.rawValue
        ) ?? .ko
    }

    static func text(_ key: Key, locale: CompanionLocale) -> String {
        switch locale {
        case .ko: key.ko
        case .en: key.en
        case .zh: key.zh
        }
    }

    /// Translates a legacy Korean UI string while the native companion moves to
    /// the shared key-based catalog. Korean remains the source text so existing
    /// snapshots and the default locale keep their current behavior.
    static func text(_ source: String, locale: CompanionLocale = L10n.current) -> String {
        switch locale {
        case .ko:
            source
        case .en:
            english[source] ?? source
        case .zh:
            chinese[source] ?? source
        }
    }

    static func format(
        _ source: String,
        locale: CompanionLocale = L10n.current,
        _ arguments: CVarArg...
    ) -> String {
        String(format: text(source, locale: locale), arguments: arguments)
    }

    static func relativeDate(_ date: Date, locale: CompanionLocale = L10n.current) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: locale.foundationIdentifier)
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func time(_ date: Date, locale: CompanionLocale = L10n.current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.foundationIdentifier)
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    static func dateTime(_ date: Date, locale: CompanionLocale = L10n.current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.foundationIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static let english: [String: String] = [
        "한국어": "Korean",
        "중국어": "Chinese",
        "Companion 설정": "Companion settings",
        "계정": "Account",
        "화면": "Appearance",
        "테마": "Theme",
        "언어": "Language",
        "앱 아이콘": "App icon",
        "알림 분류": "Notification categories",
        "접근 권한": "Access",
        "읽기·쓰기": "Read and write",
        "이슈 작성, 실행 제어, 결과 검수와 대화를 지원합니다.": "Supports issue writing, run control, result review, and conversation.",
        "시스템": "System",
        "라이트": "Light",
        "다크": "Dark",
        "모두 읽음": "Mark all read",
        "새 알림 없음": "No new messages",
        "표시할 Agent 없음": "No agents available",
        "세션": "Sessions",
        "이슈 공유": "Share issue",
        "링크 복사": "Copy link",
        "메시지 복사": "Copy message",
        "링크를 복사했습니다": "Link copied",
        "메시지를 복사했습니다": "Message copied",
        "이메일": "Email",
        "공통 채널": "Common channels",
        "다른 프로젝트": "Other project",
        "채널이 없습니다.": "No channels yet.",
        "채널을 불러오는 중…": "Loading channels…",
        "채널 메시지를 불러오는 중…": "Loading channel messages…",
        "최근 대화": "Recent conversations",
        "DM 검색": "Search DMs",
        "새 메시지": "New message",
        "DM을 불러오는 중…": "Loading DMs…",
        "아직 DM이 없습니다.": "No direct messages yet.",
        "새 메시지를 눌러 대화를 시작해 보세요.": "Tap New message to start a conversation.",
        "아직 메시지가 없습니다.": "No messages yet.",
        "어제": "Yesterday",
        "비공개 대화": "Private conversation",
        "멤버와 Agent를 불러오는 중…": "Loading members and agents…",
        "멤버 또는 Agent 검색": "Search members or agents",
        "대화 시작": "Start chat",
        "나": "You",
        "보내는 중": "Sending",
        "최신 메시지로 이동": "Jump to latest message",
        "스레드": "Thread",
        "뒤로": "Back",
        "멤버 %d명": "Members %d",
        "Agent %d개": "Agents %d",
        "답글 %d개": "%d replies",
        "스레드에서 답글": "Reply in thread",
        "마지막 답글 %@": "last reply %@",
        "React": "React",
        "#%@에 메시지 보내기": "Message #%@",
        "홈": "Home",
        "이슈 생성 제안": "Issue proposal",
        "승인되어 이슈가 생성되었습니다.": "Accepted — the issue was created.",
        "승인하면 이슈가 생성됩니다.": "Accept to create an issue.",
        "이슈 만들기": "Create issue",
        "프로젝트 선택": "Select project",
        "이슈 보기": "View issue",
        "선택한 분류의 새 항목이 도착하면 로컬 알림을 보냅니다.": "Local notifications fire for newly arrived items in the selected categories.",
        "Agents": "Agents",
        "표시할 Agent가 없습니다.": "No agents available.",
        "프로젝트에 연결된 Agent가 여기에 표시됩니다.": "Agents connected to this project appear here.",
        "아직 동기화된 세션이 없습니다.": "No sessions have synced yet.",
        "실행 Worker": "Execution workers",
        "실행 가능": "Available",
        "Agent를 불러오는 중…": "Loading agents…",
        "Agent 실행": "Run agent",
        "확인": "OK",
        "실행 요청을 처리하지 못했습니다.": "The run request could not be processed.",
        "Agent를 찾을 수 없음": "Agent not found",
        "세션을 찾을 수 없음": "Session not found",
        "프로필": "Profile",
        "등록된 프로필 사진 없음": "No profile image",
        "개요": "Overview",
        "색상": "Color",
        "등록된 Skill이 없습니다.": "No skills registered.",
        "현재 실행 가능한 Worker 없음": "No worker is currently available",
        "실행 승인": "Execution approval",
        "이슈 생성·실행 승인": "Approve issue creation and execution",
        "이슈 내용과 실행 설정을 함께 확인합니다. 이 버튼을 한 번 승인하면 이슈를 만들고 실행을 예약합니다.": "Review the issue and execution settings together. One approval creates the issue and schedules execution.",
        "승인하고 이슈 생성·실행": "Approve, create, and run",
        "이슈 생성·실행 요청을 처리하지 못했습니다.": "The issue creation and execution request could not be processed.",
        "승인 시 선택한 설정으로 이슈 실행이 시작됩니다. 이슈 생성 승인과는 별개의 작업입니다.": "Approving starts the issue with the selected settings. This is separate from issue creation approval.",
        "승인하고 실행": "Approve and run",
        "생성 승인 후에도 자동 실행되지 않습니다. 별도의 실행 승인 카드가 이어서 표시됩니다.": "It will not run automatically after creation approval. A separate execution approval card will follow.",
        "이슈 실행 제안": "Issue execution proposal",
        "승인되어 실행을 요청했습니다.": "Approved and execution requested.",
        "설정을 선택하고 명시적으로 승인해야 실행됩니다.": "Select settings and explicitly approve to run.",
        "실행할 이슈": "Issue to run",
        "Organization Agent %@의 위임": "Delegated by Organization Agent %@",
        "승인 시점에도 fresh backlog 상태인지 다시 확인합니다.": "Fresh backlog status will be checked again when you approve.",
        "최신 스냅샷에서 fresh backlog 상태를 확인한 뒤 승인할 수 있습니다.": "Approval is available after fresh backlog status is confirmed in the latest snapshot.",
        "실행 설정 선택": "Choose execution settings",
        "최신 상태 확인": "Check latest status",
        "실행 대상 이슈를 최신 프로젝트 스냅샷에서 찾을 수 없습니다.": "The target issue was not found in the latest project snapshot.",
        "완료되지 않은 선행 이슈가 있어 아직 실행할 수 없습니다.": "This issue cannot run yet because a prerequisite is incomplete.",
        "이슈 상태가 변경되었습니다. 최신 상태를 확인해 다시 승인해 주세요.": "The issue state changed. Check the latest status and approve again.",
        "이 프로젝트에서 사용할 수 없는 프로바이더입니다.": "This provider is not available for the project.",
        "선택한 모델 또는 Effort를 이 프로바이더에서 사용할 수 없습니다.": "The selected model or effort is not available from this provider.",
        "선택한 설정으로 실행 가능한 Worker가 없습니다.": "No worker can run with the selected settings.",
        "이 Agent의 세션이 아직 없습니다.": "This agent has no sessions yet.",
        "Skill을 선택해 주세요": "Select a skill",
        "실행 설정": "Execution settings",
        "작업 요청": "Task request",
        "에이전트 작업 요청": "Agent task request",
        "실행 호스트": "Execution host",
        "먼저 실행할 Skill을 선택해 주세요.": "Select a skill first.",
        "선택한 Skill을 실행할 수 있는 Worker가 없습니다.": "No worker can run the selected skill.",
        "취소": "Cancel",
        "실행": "Run",
        "상태": "Status",
        "트리거": "Trigger",
        "유형": "Type",
        "시작": "Started",
        "완료": "Completed",
        "요청": "Request",
        "요약": "Summary",
        "오류": "Error",
        "이슈": "Issue",
        "연결된 이슈 없음": "No linked issue",
        "이벤트": "Events",
        "세션 공유": "Share session",
        "보라": "Purple",
        "회색": "Gray",
        "분홍": "Pink",
        "초록": "Green",
        "새 알림": "New notification",
        "선택한 이미지 형식을 첨부할 수 없습니다.": "The selected image format cannot be attached.",
        "선택한 이미지·영상 형식을 첨부할 수 없습니다.": "The selected image or video format cannot be attached.",
        "사진 앱에서 선택한 항목을 읽지 못했습니다.": "The selected item could not be read from Photos.",
        "크게 보기": "View larger",
        "이미지를 불러올 수 없음 · 다시 시도": "Unable to load image · retry",
        "이미지를 다시 불러오기": "Reload image",
        "이미지 불러오는 중": "Loading image",
        "이미지 첨부": "Attach image",
        "첨부 삭제": "Remove attachment",
        "채널에는 이미지만 첨부할 수 있습니다.": "Channels only support image attachments.",
        "나 · %@": "Me · %@",
        "계정을 불러오는 중…": "Loading account…",
        "연결할 수 없음": "Unable to connect",
        "계정 정보를 불러오지 못했습니다.": "The account information could not be loaded.",
        "다시 시도": "Retry",
        "로그아웃": "Sign out",
        "로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.": "Sign-in could not be completed. Please try again later.",
        "프로젝트 진행 상황을 iPhone에서 안전하게 확인하세요.": "Securely check project progress on your iPhone.",
        "Briar로 로그인": "Sign in with Briar",
        "연결된 프로젝트 없음": "No connected projects",
        "Briar Desktop에서 프로젝트와 저장소를 연결한 뒤 다시 확인해 주세요.": "Connect a project and repository in Briar Desktop, then try again.",
        "조직": "Organization",
        "확인할 프로젝트": "Projects to review",
        "Companion은 선택한 프로젝트의 정보를 읽기 전용으로 표시합니다.": "Companion shows the selected project's information in read-only mode.",
        "계속": "Continue",
        "이름": "Name",
        "사용자명": "Username",
        "이 기기에서 앱 아이콘을 변경할 수 없습니다.": "The app icon cannot be changed on this device.",
        "긴급": "Urgent",
        "확인 필요": "Needs attention",
        "중요 변경": "Important changes",
        "최근 활동": "Recent activity",
        "멘션": "Mention",
        "답글": "Reply",
        "구독 대화": "Subscribed conversation",
        "구독한 스레드": "Subscribed thread",
        "구독": "Subscribe",
        "구독 중": "Subscribed",
        "구독 해제": "Unsubscribe",
        "구독 멤버 %d명": "%d subscribers",
        "담당자는 이 이슈를 항상 구독합니다.": "The assignee always subscribes to this issue.",
        "멘션, 이슈 변경, 완료된 세션이 이곳에 표시됩니다.": "Mentions, issue changes, and completed sessions appear here.",
        "선택한 필터에 메시지가 없습니다.": "No messages match the selected filter.",
        "다른 필터를 선택해 메시지를 확인해 보세요.": "Choose another filter to see messages.",
        "Tasks": "Tasks",
        "이슈를 찾을 수 없음": "Issue not found",
        "작업 필터": "Task filter",
        "작업을 불러오는 중…": "Loading tasks…",
        "작업 없음": "No tasks",
        "필터 결과 없음": "No matching tasks",
        "바로 처리": "Process now",
        "새 이슈": "New issue",
        "오프라인": "Offline",
        "마지막 동기화 %@": "Last synced %@",
        "실행 Worker %@": "Execution worker %@",
        "검수 완료됨": "Review complete",
        "이슈를 삭제할까요?": "Delete this issue?",
        "삭제": "Delete",
        "활동 기록, 대화와 첨부가 영구적으로 삭제됩니다.": "Activity history, conversation, and attachments will be permanently deleted.",
        "다른 프로젝트로 이동": "Move to another project",
        "선택한 프로젝트로 이슈와 대화·첨부·활동 기록이 함께 이동합니다. 의존성은 해제됩니다.": "The issue, conversation, attachments, and activity history will move to the selected project. Dependencies will be removed.",
        "수정": "Edit",
        "이슈 상세 탭": "Issue detail tab",
        "설명": "Description",
        "책임": "Responsibility",
        "첨부": "Attachments",
        "이슈 내용 없음": "No issue content",
        "검토 대기": "Awaiting review",
        "일시정지 상태를 유지하며 워커를 재할당하고 있습니다.": "The run remains paused while its worker is being reassigned.",
        "실행 제어": "Run control",
        "상태 이동": "Move status",
        "Worker 다시 배정": "Reassign worker",
        "재시도": "Retry",
        "실행 취소": "Cancel run",
        "결과 검수 완료": "Complete result review",
        "프로바이더": "Provider",
        "기본값": "Default",
        "모델": "Model",
        "Effort": "Effort",
        "의존성": "Dependencies",
        "선행 이슈가 없습니다.": "No prerequisites.",
        "의존성 추가": "Add dependency",
        "대화 없음": "No conversation",
        "대화": "Conversation",
        "메시지 보내기": "Send message",
        "메시지 또는 @Agent 질문": "Message or ask an Agent",
        "답글 취소": "Cancel reply",
        "갤러리": "Gallery",
        "붙여넣기": "Paste",
        "보내기": "Send",
        "Briar 재작업 제안": "Briar rework proposal",
        "현재 이슈 수정 제안": "Current issue update proposal",
        "새 이슈 생성 제안": "New issue proposal",
        "설정 안 함": "Not set",
        "우선순위": "Priority",
        "우선순위 없음": "No priority",
        "수락하고 개정 시작": "Accept and start rework",
        "수락하고 이슈 수정": "Accept and update issue",
        "수락하고 이슈 만들기": "Accept and create issue",
        "결과": "Result",
        "결과 상태": "Result status",
        "다음 조치": "Next action",
        "결과 리뷰": "Result reviews",
        "증빙": "Evidence",
        "결과 없음": "No result",
        "이전 버전": "Previous revision",
        "연결된 결과 열기": "Open linked result",
        "로그 없음": "No log",
        "실행 로그": "Run log",
        "상세 기록을 불러오는 중…": "Loading detail…",
        "상세 다시 시도": "Retry detail",
        "현재 상태": "Current status",
        "담당자": "Assignee",
        "등록자": "Creator",
        "알 수 없음": "Unknown",
        "미배정": "Unassigned",
        "자동 배정": "Auto-assign",
        "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.": "The checkpoint has already changed. The latest state was loaded.",
        "클립보드에 붙여넣을 수 있는 이미지가 없습니다.": "There is no image to paste from the clipboard.",
        "미리보기를 열 수 없음": "Unable to open preview",
        "추가할 수 있는 이슈가 없습니다.": "No issues can be added.",
        "검색 결과 없음": "No search results",
        "이미 추가했거나 추가할 수 없는 이슈만 남았습니다.": "Only issues already added or unavailable for adding remain.",
        "다른 제목이나 이슈 번호로 검색해 보세요.": "Try a different title or issue number.",
        "선행 이슈 선택": "Select prerequisite issue",
        "이슈 검색": "Search issues",
        "닫기": "Close",
        "첨부 이미지": "Attached image",
        "첨부 이미지를 불러올 수 없음": "Unable to load attached image",
        "선호 실행": "Preferred execution",
        "등록": "Create",
        "등록 완료": "Created",
        "등록 중": "Creating",
        "제목": "Title",
        "속성": "Properties",
        "등록 위치": "Create in",
        "백로그": "Backlog",
        "실행 대기": "Queued",
        "모든 체크포인트를 건너뛰고 중단 없이 처리합니다.": "Process without pausing at checkpoints.",
        "클립보드 이미지 붙여넣기": "Paste clipboard image",
        "이미지·영상 첨부": "Attach image or video",
        "첨부 파일은 최대 5개까지 추가할 수 있습니다.": "You can add up to five attachments.",
        "첨부 파일 이름이 유효하지 않습니다.": "The attachment filename is invalid.",
        "첨부 파일의 전체 크기는 25MB를 넘을 수 없습니다.": "Attachments cannot exceed 25 MB in total.",
        "클립보드에서 붙여넣을 이미지를 읽지 못했습니다.": "The image could not be read from the clipboard.",
        "이슈 수정": "Edit issue",
        "저장": "Save",
        "다시 배정": "Reassign",
        "실행 환경": "Execution environment",
        "사용 가능한 Worker 자동 선택": "Automatically select an available worker",
        "재할당": "Reassign",
        "실행 완료": "Run complete",
        "프로젝트와 로그인 정보가 준비되지 않았습니다.": "The project and sign-in information are not ready.",
        "실행할 준비가 된 queued 이슈가 없습니다.": "There are no queued issues ready to run.",
        "이미 요청을 처리하고 있습니다.": "A request is already in progress.",
        "이슈 제목을 입력해 주세요.": "Enter an issue title.",
        "메시지를 입력해 주세요.": "Enter a message.",
        "모델과 effort를 선택하려면 프로바이더와 모델을 순서대로 선택해 주세요.": "Select a provider and model before choosing a model or effort.",
        "Agent 답변이 아직 대기 중입니다. 잠시 후 다시 확인해 주세요.": "The Agent's reply is still pending. Check again shortly.",
        "메시지는 전송됐지만 Agent 답변 상태를 확인하지 못했습니다. 상세를 새로고침해 주세요.": "The message was sent, but the Agent's reply status could not be checked. Refresh the detail.",
        "Agent가 답변을 작성하고 있습니다…": "The Agent is writing a reply…",
        "서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.": "The server response could not be understood. Please try again later.",
        "세션이 만료되었습니다. 다시 로그인해 주세요.": "Your session expired. Please sign in again.",
        "요청을 준비하지 못했습니다. 입력값을 확인해 주세요.": "The request could not be prepared. Check the input.",
        "파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.": "The file could not be downloaded. Please try again later.",
        "%@ · 검수 완료됨": "%@ · Review complete",
        "%@ 바로 처리": "Process %@ now",
        "%@ 시작 전 확인": "Review before starting %@",
        "%@ 완료 후 확인": "Review after completing %@",
        "%@ 의존성 제거": "Remove %@ dependency",
        "%@ 의존성 추가": "Add %@ dependency",
        "%@ 이미지 불러오는 중": "Loading %@",
        "%@ 이미지를 다시 불러오기": "Reload %@",
        "%@ 이미지를 불러올 수 없음": "Unable to load %@",
        "%@ 체크포인트 승인 후 자동화 재개": "Resume automation after approving %@ checkpoint",
        "%@부터 개정": "Rework from %@",
        "%@에게 답글": "Reply to %@",
        "%@은(는) 빈 파일입니다.": "%@ is empty.",
        "%@은(는) 지원하지 않는 이미지·영상 형식입니다.": "%@ is an unsupported image or video format.",
        "%@은(는) 파일당 20MB 제한을 넘습니다.": "%@ exceeds the 20 MB per-file limit.",
        "%d 실행 중": "%d running",
        "Briar · %@": "Briar · %@",
        "Agent가 답변을 만들지 못했습니다.": "The Agent could not create a reply.",
        "iOS 네이티브 기반 준비됨": "iOS native foundation ready",
        "iOS와 Android가 같은 로그인·사용자·프로젝트 형식을 사용": "iOS and Android use the same sign-in, user, and project format",
        "공유 API 계약": "Shared API contract",
        "기존 Companion과 함께 설치되는 개발 전용 SwiftUI 앱": "Development-only SwiftUI app installed alongside the existing Companion",
        "네이티브 테스트와 기존 모바일 빌드를 한 CI에서 확인": "Native tests and existing mobile builds run together in CI",
        "네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.": "Unable to connect to the network. Retrying when connected.",
        "담당자 %@": "Assignee %@",
        "대기": "Pending",
        "대화에는 이미지만 첨부할 수 있습니다.": "Conversations only support image attachments.",
        "독립 앱": "Standalone app",
        "로그": "Logs",
        "리비전 %@ 개정이 시작되었습니다.": "Rework for revision %@ has started.",
        "리비전 %d": "Revision %d",
        "마지막 단계를 반복하지 않고 최종 검토 후 완료합니다.": "Complete after final review without repeating the last stage.",
        "새 이슈가 생성되었습니다.": "A new issue was created.",
        "설정": "Settings",
        "실패": "Failed",
        "실행 중": "Running",
        "없음": "None",
        "요청에 실패했습니다. (HTTP %d)": "The request failed. (HTTP %d)",
        "이 화면은 전환 기반의 개발 상태를 확인하기 위한 것입니다. 실제 로그인과 프로젝트 화면은 모바일 API 계약 위에 단계적으로 추가됩니다.": "This screen tracks the staged development state. Real sign-in and project screens will be added incrementally on the mobile API contract.",
        "이슈 내용이 수정되었습니다.": "The issue content was updated.",
        "자동화 재개": "Resume automation",
        "재개 후 %@부터 자동 진행합니다.": "Automation will resume from %@.",
        "제목이 너무 깁니다. %d자 이내로 줄여 주세요. (현재 %d자)": "The title is too long. Shorten it to %d characters or fewer (currently %d).",
        "제어": "Control",
        "중단": "Interrupted",
        "진행 중": "In progress",
        "차단": "Blocked",
        "첨부 %d/5 · 파일당 20MB, 전체 25MB": "Attachments %d/5 · 20 MB each, 25 MB total",
        "프로젝트, %@": "Project, %@",
        "회귀 보호": "Regression protection",
        "%@ 크게 보기": "View %@ larger",
        "건너뜀": "Skipped",
        "계정 메뉴": "Account menu",
        "Inbox": "Inbox",
    ]

    private static let chinese: [String: String] = [
        "한국어": "韩语",
        "Companion 설정": "Companion 设置",
        "계정": "账户",
        "화면": "外观",
        "테마": "主题",
        "언어": "语言",
        "앱 아이콘": "应用图标",
        "알림 분류": "通知分类",
        "접근 권한": "访问权限",
        "읽기·쓰기": "读写",
        "시스템": "系统",
        "라이트": "浅色",
        "다크": "深色",
        "모두 읽음": "全部标为已读",
        "새 알림 없음": "没有新消息",
        "표시할 Agent 없음": "暂无可显示的 Agent",
        "세션": "会话",
        "링크 복사": "复制链接",
        "링크를 복사했습니다": "链接已复制",
        "이메일": "电子邮件",
        "공통 채널": "公共频道",
        "다른 프로젝트": "其他项目",
        "채널이 없습니다.": "还没有频道。",
        "채널을 불러오는 중…": "正在加载频道…",
        "채널 메시지를 불러오는 중…": "正在加载频道消息…",
        "최근 대화": "最近对话",
        "DM 검색": "搜索私信",
        "새 메시지": "新消息",
        "DM을 불러오는 중…": "正在加载私信…",
        "아직 DM이 없습니다.": "还没有私信。",
        "새 메시지를 눌러 대화를 시작해 보세요.": "点击“新消息”开始对话。",
        "아직 메시지가 없습니다.": "还没有消息。",
        "어제": "昨天",
        "비공개 대화": "私密对话",
        "멤버와 Agent를 불러오는 중…": "正在加载成员和 Agent…",
        "멤버 또는 Agent 검색": "搜索成员或 Agent",
        "대화 시작": "开始对话",
        "나": "你",
        "보내는 중": "发送中",
        "최신 메시지로 이동": "跳转到最新消息",
        "스레드": "话题",
        "뒤로": "返回",
        "멤버 %d명": "%d 位成员",
        "Agent %d개": "%d 个智能体",
        "답글 %d개": "%d 条回复",
        "스레드에서 답글": "在线程中回复",
        "마지막 답글 %@": "最后回复于%@",
        "#%@에 메시지 보내기": "发送消息到 #%@",
        "홈": "主页",
        "이슈 생성 제안": "创建问题建议",
        "승인되어 이슈가 생성되었습니다.": "已批准并创建问题。",
        "승인하면 이슈가 생성됩니다.": "批准后将创建问题。",
        "이슈 만들기": "创建问题",
        "이슈 보기": "查看问题",
        "선택한 분류의 새 항목이 도착하면 로컬 알림을 보냅니다.": "所选分类有新项目时会发送本地通知。",
        "Agents": "智能体",
        "프로젝트에 연결된 Agent가 여기에 표시됩니다.": "与项目关联的 Agent 将显示在这里。",
        "아직 동기화된 세션이 없습니다.": "还没有同步的会话。",
        "실행 Worker": "执行 Worker",
        "실행 가능": "可执行",
        "실행 승인": "执行批准",
        "이슈 생성·실행 승인": "批准创建并执行问题",
        "이슈 내용과 실행 설정을 함께 확인합니다. 이 버튼을 한 번 승인하면 이슈를 만들고 실행을 예약합니다.": "同时检查问题和执行设置。一次批准将创建问题并调度执行。",
        "승인하고 이슈 생성·실행": "批准、创建并执行",
        "이슈 생성·실행 요청을 처리하지 못했습니다.": "无法处理问题创建和执行请求。",
        "승인 시 선택한 설정으로 이슈 실행이 시작됩니다. 이슈 생성 승인과는 별개의 작업입니다.": "批准后将使用所选设置开始执行问题。此操作与创建问题的批准相互独立。",
        "승인하고 실행": "批准并执行",
        "생성 승인 후에도 자동 실행되지 않습니다. 별도의 실행 승인 카드가 이어서 표시됩니다.": "创建获批后不会自动执行，随后会显示单独的执行批准卡片。",
        "이슈 실행 제안": "问题执行建议",
        "승인되어 실행을 요청했습니다.": "已批准并请求执行。",
        "설정을 선택하고 명시적으로 승인해야 실행됩니다.": "选择设置并明确批准后才会执行。",
        "실행할 이슈": "要执行的问题",
        "Organization Agent %@의 위임": "由 Organization Agent %@ 委派",
        "승인 시점에도 fresh backlog 상태인지 다시 확인합니다.": "批准时会再次确认问题仍为全新的待办状态。",
        "최신 스냅샷에서 fresh backlog 상태를 확인한 뒤 승인할 수 있습니다.": "在最新快照中确认问题为全新的待办状态后才可批准。",
        "실행 설정 선택": "选择执行设置",
        "최신 상태 확인": "检查最新状态",
        "실행 대상 이슈를 최신 프로젝트 스냅샷에서 찾을 수 없습니다.": "在最新项目快照中找不到目标问题。",
        "완료되지 않은 선행 이슈가 있어 아직 실행할 수 없습니다.": "由于前置问题尚未完成，目前无法执行。",
        "이슈 상태가 변경되었습니다. 최신 상태를 확인해 다시 승인해 주세요.": "问题状态已更改。请检查最新状态后重新批准。",
        "이 프로젝트에서 사용할 수 없는 프로바이더입니다.": "此项目无法使用该提供商。",
        "선택한 모델 또는 Effort를 이 프로바이더에서 사용할 수 없습니다.": "所选提供商不支持该模型或 Effort。",
        "선택한 설정으로 실행 가능한 Worker가 없습니다.": "没有 Worker 能使用所选设置执行。",
        "Agent를 불러오는 중…": "正在加载 Agent…",
        "Agent 실행": "运行 Agent",
        "확인": "确定",
        "취소": "取消",
        "실행": "运行",
        "상태": "状态",
        "트리거": "触发器",
        "유형": "类型",
        "시작": "开始",
        "완료": "完成",
        "요청": "请求",
        "요약": "摘要",
        "오류": "错误",
        "이슈": "问题",
        "이벤트": "事件",
        "세션 공유": "分享会话",
        "보라": "紫色",
        "회색": "灰色",
        "분홍": "粉色",
        "초록": "绿色",
        "새 알림": "新通知",
        "선택한 이미지 형식을 첨부할 수 없습니다.": "无法附加所选图片格式。",
        "선택한 이미지·영상 형식을 첨부할 수 없습니다.": "无法附加所选图片或视频格式。",
        "사진 앱에서 선택한 항목을 읽지 못했습니다.": "无法读取从照片中选择的项目。",
        "크게 보기": "查看大图",
        "이미지 첨부": "附加图片",
        "첨부 삭제": "移除附件",
        "채널에는 이미지만 첨부할 수 있습니다.": "频道只能附加图片。",
        "나 · %@": "我 · %@",
        "계정을 불러오는 중…": "正在加载账户…",
        "연결할 수 없음": "无法连接",
        "다시 시도": "重试",
        "로그아웃": "退出登录",
        "Briar로 로그인": "使用 Briar 登录",
        "연결된 프로젝트 없음": "没有关联的项目",
        "조직": "组织",
        "확인할 프로젝트": "要查看的项目",
        "이름": "姓名",
        "사용자명": "用户名",
        "긴급": "紧急",
        "확인 필요": "需要处理",
        "중요 변경": "重要变更",
        "최근 활동": "最近活动",
        "멘션": "提及",
        "답글": "回复",
        "구독 대화": "订阅对话",
        "구독": "订阅",
        "구독 중": "已订阅",
        "구독 해제": "取消订阅",
        "구독 멤버 %d명": "%d 位订阅成员",
        "담당자는 이 이슈를 항상 구독합니다.": "负责人会始终订阅此问题。",
        "Tasks": "任务",
        "작업 필터": "任务筛选",
        "작업을 불러오는 중…": "正在加载任务…",
        "작업 없음": "没有任务",
        "필터 결과 없음": "没有匹配的任务",
        "바로 처리": "立即处理",
        "새 이슈": "新问题",
        "오프라인": "离线",
        "검수 완료됨": "审核完成",
        "삭제": "删除",
        "다른 프로젝트로 이동": "移动到其他项目",
        "수정": "编辑",
        "설명": "说明",
        "책임": "职责",
        "첨부": "附件",
        "검토 대기": "等待审核",
        "실행 제어": "运行控制",
        "상태 이동": "移动状态",
        "Worker 다시 배정": "重新分配 Worker",
        "재시도": "重试",
        "실행 취소": "取消运行",
        "결과 검수 완료": "完成结果审核",
        "프로바이더": "提供商",
        "기본값": "默认",
        "모델": "模型",
        "의존성": "依赖",
        "의존성 추가": "添加依赖",
        "대화": "对话",
        "메시지 보내기": "发送消息",
        "답글 취소": "取消回复",
        "갤러리": "图库",
        "붙여넣기": "粘贴",
        "보내기": "发送",
        "결과": "结果",
        "결과 상태": "结果状态",
        "다음 조치": "下一步",
        "결과 리뷰": "结果审核",
        "증빙": "证据",
        "결과 없음": "没有结果",
        "이전 버전": "之前的版本",
        "연결된 결과 열기": "打开关联结果",
        "로그 없음": "没有日志",
        "실행 로그": "运行日志",
        "상세 기록을 불러오는 중…": "正在加载详细记录…",
        "상세 다시 시도": "重试详细记录",
        "현재 상태": "当前状态",
        "담당자": "负责人",
        "등록자": "创建者",
        "알 수 없음": "未知",
        "미배정": "未分配",
        "자동 배정": "自动分配",
        "미리보기를 열 수 없음": "无法打开预览",
        "검색 결과 없음": "没有搜索结果",
        "선행 이슈 선택": "选择前置问题",
        "이슈 검색": "搜索问题",
        "닫기": "关闭",
        "선호 실행": "首选运行设置",
        "등록": "创建",
        "등록 완료": "已创建",
        "등록 중": "正在创建",
        "제목": "标题",
        "속성": "属性",
        "등록 위치": "创建位置",
        "백로그": "待办",
        "실행 대기": "等待运行",
        "클립보드 이미지 붙여넣기": "粘贴剪贴板图片",
        "이미지·영상 첨부": "附加图片或视频",
        "이슈 수정": "编辑问题",
        "저장": "保存",
        "다시 배정": "重新分配",
        "실행 환경": "运行环境",
        "사용 가능한 Worker 자동 선택": "自动选择可用的 Worker",
        "재할당": "重新分配",
        "실행 완료": "运行完成",
        "이미 요청을 처리하고 있습니다.": "请求正在处理中。",
        "이슈 제목을 입력해 주세요.": "请输入问题标题。",
        "메시지를 입력해 주세요.": "请输入消息。",
        "멘션, 이슈 변경, 완료된 세션이 이곳에 표시됩니다.": "提及、问题变更和已完成的会话会显示在这里。",
        "다른 필터를 선택해 메시지를 확인해 보세요.": "选择其他筛选条件来查看消息。",
        "%@ · 검수 완료됨": "%@ · 审核完成",
        "%@ 바로 처리": "立即处理 %@",
        "%@ 시작 전 확인": "开始 %@ 前审核",
        "%@ 완료 후 확인": "完成 %@ 后审核",
        "%@ 의존성 제거": "移除 %@ 依赖",
        "%@ 의존성 추가": "添加 %@ 依赖",
        "%@ 이미지 불러오는 중": "正在加载 %@",
        "%@ 이미지를 다시 불러오기": "重新加载 %@",
        "%@ 이미지를 불러올 수 없음": "无法加载 %@",
        "%@ 체크포인트 승인 후 자동화 재개": "批准 %@ 检查点后恢复自动化",
        "%@부터 개정": "从 %@ 开始返工",
        "%@에게 답글": "回复 %@",
        "%@은(는) 빈 파일입니다.": "%@ 为空。",
        "%@은(는) 지원하지 않는 이미지·영상 형식입니다.": "%@ 是不支持的图片或视频格式。",
        "%@은(는) 파일당 20MB 제한을 넘습니다.": "%@ 超过了单个文件 20 MB 的限制。",
        "%d 실행 중": "%d 个运行中",
        "Agent · %@": "Agent · %@",
        "Agent가 답변을 만들지 못했습니다.": "Agent 无法生成回复。",
        "Agent가 답변을 작성하고 있습니다…": "Agent 正在撰写回复…",
        "iOS 네이티브 기반 준비됨": "iOS 原生基础已准备就绪",
        "iOS와 Android가 같은 로그인·사용자·프로젝트 형식을 사용": "iOS 和 Android 使用相同的登录、用户和项目格式",
        "공유 API 계약": "共享 API 契约",
        "기존 Companion과 함께 설치되는 개발 전용 SwiftUI 앱": "与现有 Companion 一起安装的开发专用 SwiftUI 应用",
        "네이티브 테스트와 기존 모바일 빌드를 한 CI에서 확인": "在同一 CI 中运行原生测试和现有移动端构建",
        "네트워크에 연결할 수 없습니다. 연결되면 다시 시도합니다.": "无法连接网络。连接后将重试。",
        "담당자 %@": "负责人 %@",
        "대기": "等待中",
        "대화에는 이미지만 첨부할 수 있습니다.": "对话只能附加图片。",
        "독립 앱": "独立应用",
        "로그": "日志",
        "리비전 %@ 개정이 시작되었습니다.": "已开始返工版本 %@。",
        "리비전 %d": "版本 %d",
        "마지막 단계를 반복하지 않고 최종 검토 후 완료합니다.": "完成最终审核后结束，不重复最后一个阶段。",
        "새 이슈가 생성되었습니다.": "已创建新问题。",
        "설정": "设置",
        "실패": "失败",
        "실행 중": "运行中",
        "없음": "无",
        "요청에 실패했습니다. (HTTP %d)": "请求失败。（HTTP %d）",
        "이 화면은 전환 기반의 개발 상태를 확인하기 위한 것입니다. 실제 로그인과 프로젝트 화면은 모바일 API 계약 위에 단계적으로 추가됩니다.": "此页面用于查看分阶段的开发状态。实际登录和项目页面将基于移动 API 契约逐步添加。",
        "이슈 내용이 수정되었습니다.": "问题内容已更新。",
        "자동화 재개": "恢复自动化",
        "재개 후 %@부터 자동 진행합니다.": "恢复后将从 %@ 自动继续。",
        "제목이 너무 깁니다. %d자 이내로 줄여 주세요. (현재 %d자)": "标题过长。请缩短至 %d 个字符以内（当前 %d 个）。",
        "제어": "控制",
        "중단": "已中断",
        "진행 중": "进行中",
        "차단": "已阻止",
        "첨부 %d/5 · 파일당 20MB, 전체 25MB": "附件 %d/5 · 单个 20 MB，总计 25 MB",
        "프로젝트, %@": "项目，%@",
        "회귀 보호": "回归保护",
        "%@ 크게 보기": "查看 %@ 大图",
        "건너뜀": "已跳过",
        "계정 메뉴": "账户菜单",
        "Inbox": "收件箱",
    ]

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
        case copyMessage
        case linkCopied
        case messageCopied
        case profileEmail
        case notificationHint
        case channelsCommon
        case channelsOtherProject
        case channelsEmpty
        case channelThread
        case channelBack
        case channelMembers
        case channelAgents
        case channelReplies
        case channelReplyInThread
        case channelLastReply
        case channelReact
        case channelMessagePlaceholder
        case channelAgentTyping
        case channelHome
        case channelIssueProposal
        case channelIssueProposalAccepted
        case channelIssueProposalPending
        case channelIssuePriority
        case channelIssueProject
        case channelIssueCreationSafety
        case channelIssueCreationAndExecutionSafety
        case channelIssueShowDescription
        case channelIssueHideDescription
        case channelCreateIssue
        case channelCreateAndExecute
        case channelRetryExecution
        case channelSelectProposalProject
        case channelViewIssue

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
            case .copyMessage: "메시지 복사"
            case .linkCopied: "링크를 복사했습니다"
            case .messageCopied: "메시지를 복사했습니다"
            case .profileEmail: "이메일"
            case .channelsCommon: "공통 채널"
            case .channelsOtherProject: "다른 프로젝트"
            case .channelsEmpty: "채널이 없습니다."
            case .channelThread: "스레드"
            case .channelBack: "뒤로"
            case .channelMembers: "멤버 %d명"
            case .channelAgents: "Agent %d개"
            case .channelReplies: "답글 %d개"
            case .channelReplyInThread: "스레드에서 답글"
            case .channelLastReply: "마지막 답글 %@"
            case .channelReact: "React"
            case .channelMessagePlaceholder: "#%@에 메시지 보내기"
            case .channelAgentTyping: "%@님이 답변을 작성하고 있습니다…"
            case .channelHome: "홈"
            case .channelIssueProposal: "이슈 생성 제안"
            case .channelIssueProposalAccepted: "승인되어 이슈가 생성되었습니다."
            case .channelIssueProposalPending: "승인하면 이슈가 생성됩니다."
            case .channelIssuePriority: "우선순위 P%d"
            case .channelIssueProject: "대상 프로젝트: %@"
            case .channelIssueCreationSafety: "백로그 이슈로만 생성되며 실행은 시작되지 않습니다. 실행하려면 별도 승인이 필요합니다."
            case .channelIssueCreationAndExecutionSafety: "이슈 내용과 실행 설정을 함께 확인합니다. 한 번 승인하면 이슈 생성과 실행 예약이 이어집니다."
            case .channelIssueShowDescription: "설명 전체 보기"
            case .channelIssueHideDescription: "설명 접기"
            case .channelCreateIssue: "승인하고 이슈 만들기"
            case .channelCreateAndExecute: "승인하고 이슈 생성·실행"
            case .channelRetryExecution: "실행 예약 다시 시도"
            case .channelSelectProposalProject: "프로젝트 선택"
            case .channelViewIssue: "이슈 보기"
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
            case .copyMessage: "Copy message"
            case .linkCopied: "Link copied"
            case .messageCopied: "Message copied"
            case .profileEmail: "Email"
            case .channelsCommon: "Common channels"
            case .channelsOtherProject: "Other project"
            case .channelsEmpty: "No channels yet."
            case .channelThread: "Thread"
            case .channelBack: "Back"
            case .channelMembers: "Members %d"
            case .channelAgents: "Agents %d"
            case .channelReplies: "%d replies"
            case .channelReplyInThread: "Reply in thread"
            case .channelLastReply: "last reply %@"
            case .channelReact: "React"
            case .channelMessagePlaceholder: "Message #%@"
            case .channelAgentTyping: "%@ is writing a reply…"
            case .channelHome: "Home"
            case .channelIssueProposal: "Issue proposal"
            case .channelIssueProposalAccepted: "Accepted — the issue was created."
            case .channelIssueProposalPending: "Accept to create an issue."
            case .channelIssuePriority: "Priority P%d"
            case .channelIssueProject: "Target project: %@"
            case .channelIssueCreationSafety: "Creates a backlog issue only; execution will not start. Separate approval is required to execute it."
            case .channelIssueCreationAndExecutionSafety: "Review the issue and execution settings together. One approval creates the issue and schedules its execution."
            case .channelIssueShowDescription: "Show full description"
            case .channelIssueHideDescription: "Collapse description"
            case .channelCreateIssue: "Approve and create issue"
            case .channelCreateAndExecute: "Approve, create, and run"
            case .channelRetryExecution: "Retry execution scheduling"
            case .channelSelectProposalProject: "Select project"
            case .channelViewIssue: "View issue"
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
            case .copyMessage: "复制消息"
            case .linkCopied: "链接已复制"
            case .messageCopied: "消息已复制"
            case .profileEmail: "电子邮件"
            case .channelsCommon: "公共频道"
            case .channelsOtherProject: "其他项目"
            case .channelsEmpty: "还没有频道。"
            case .channelThread: "话题"
            case .channelBack: "返回"
            case .channelMembers: "%d 位成员"
            case .channelAgents: "%d 个智能体"
            case .channelReplies: "%d 条回复"
            case .channelReplyInThread: "在线程中回复"
            case .channelLastReply: "最后回复于%@"
            case .channelReact: "React"
            case .channelMessagePlaceholder: "发送消息到 #%@"
            case .channelAgentTyping: "%@ 正在撰写回复…"
            case .channelHome: "主页"
            case .channelIssueProposal: "创建问题建议"
            case .channelIssueProposalAccepted: "已批准并创建问题。"
            case .channelIssueProposalPending: "批准后将创建问题。"
            case .channelIssuePriority: "优先级 P%d"
            case .channelIssueProject: "目标项目：%@"
            case .channelIssueCreationSafety: "仅创建为待办问题，不会开始执行。执行需另行批准。"
            case .channelIssueCreationAndExecutionSafety: "同时检查问题和执行设置。一次批准将创建问题并调度执行。"
            case .channelIssueShowDescription: "查看完整说明"
            case .channelIssueHideDescription: "收起说明"
            case .channelCreateIssue: "批准并创建问题"
            case .channelCreateAndExecute: "批准、创建并执行"
            case .channelRetryExecution: "重试执行调度"
            case .channelSelectProposalProject: "选择项目"
            case .channelViewIssue: "查看问题"
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
