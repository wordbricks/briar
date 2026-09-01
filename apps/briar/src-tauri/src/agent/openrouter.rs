use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

/// OpenRouter uses OpenCode's local tool runtime. Briar supplies the API key
/// only through the child process environment, never through event payloads.
pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Openrouter,
    conversation_namespace: "openrouter",
    runner_name: "OpenRouter runner",
    request_name: "OpenRouter",
    executable: SidecarExecutableConfig {
        name: "opencode",
        home_candidates: &[
            ".opencode/bin/opencode",
            ".local/bin/opencode",
            ".bun/bin/opencode",
        ],
        absolute_candidates: &["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"],
        missing_error: "OpenRouter 실행에 필요한 OpenCode CLI가 설치되어 있지 않습니다.",
    },
    missing_bun_error: "OpenRouter runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: false,
    empty_session_error: "OpenRouter가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "OpenRouter가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "OpenRouter 요청에 실패했습니다",
    blocked_prefix: "OpenRouter 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 OpenRouter 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
