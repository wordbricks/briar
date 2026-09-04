use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Claude,
    runner_name: "Claude Agent runner",
    request_name: "Claude Agent",
    executable: SidecarExecutableConfig {
        name: "claude",
        home_candidates: &[".local/bin/claude", ".bun/bin/claude"],
        absolute_candidates: &["/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
        companion_executables: &[],
        missing_error:
            "Claude Code가 필요합니다. Claude를 설치하고 `claude auth login`을 실행한 뒤 다시 시도하세요.",
    },
    missing_bun_error: "Claude Agent SDK 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: true,
    accepts_legacy_conversation_id: false,
    empty_session_error: "Claude Agent SDK가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Claude Agent SDK가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Claude Agent SDK 요청에 실패했습니다",
    blocked_prefix: "Claude Agent 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 Claude 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
