use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

/// Pi ships no ACP server of its own, so Briar spawns the third-party `pi-acp`
/// adapter and the adapter spawns the `pi` CLI. Both have to be installed; the
/// missing-binary message names each install because having only one of them
/// looks exactly like having neither.
pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Pi,
    runner_name: "Pi Agent runner",
    request_name: "Pi Agent",
    executable: SidecarExecutableConfig {
        name: "pi-acp",
        home_candidates: &[
            ".local/bin/pi-acp",
            ".pi/bin/pi-acp",
            ".bun/bin/pi-acp",
            ".npm-global/bin/pi-acp",
        ],
        absolute_candidates: &["/opt/homebrew/bin/pi-acp", "/usr/local/bin/pi-acp"],
        companion_executables: &["pi"],
        missing_error: "Pi CLI와 pi-acp 어댑터가 모두 필요합니다. `npm install -g @earendil-works/pi-coding-agent pi-acp`로 설치한 뒤 다시 시도하세요.",
    },
    missing_bun_error: "Pi Agent runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: false,
    accepts_legacy_conversation_id: false,
    empty_session_error: "Pi Agent가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Pi Agent가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Pi Agent 요청에 실패했습니다",
    blocked_prefix: "Pi Agent 요청이 차단되었습니다",
    invalid_conversation_error: "이 Pi 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
