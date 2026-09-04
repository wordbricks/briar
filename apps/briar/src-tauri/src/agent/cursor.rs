use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Cursor,
    runner_name: "Cursor Agent runner",
    request_name: "Cursor Agent",
    executable: SidecarExecutableConfig {
        name: "cursor-agent",
        home_candidates: &[".local/bin/cursor-agent", ".cursor/bin/cursor-agent"],
        absolute_candidates: &["/opt/homebrew/bin/cursor-agent", "/usr/local/bin/cursor-agent"],
        missing_error:
            "Cursor CLI가 필요합니다. Cursor CLI를 설치하고 `agent login`을 실행한 뒤 다시 시도하세요.",
    },
    missing_bun_error: "Cursor Agent runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: false,
    empty_session_error: "Cursor Agent가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Cursor Agent가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Cursor Agent 요청에 실패했습니다",
    blocked_prefix: "Cursor Agent 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 Cursor 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
