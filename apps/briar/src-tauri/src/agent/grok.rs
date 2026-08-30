use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Grok,
    conversation_namespace: "grok",
    runner_name: "Grok Agent runner",
    request_name: "Grok Agent",
    executable: SidecarExecutableConfig {
        name: "grok",
        home_candidates: &[".local/bin/grok", ".grok/bin/grok", ".bun/bin/grok"],
        absolute_candidates: &["/opt/homebrew/bin/grok", "/usr/local/bin/grok"],
        missing_error:
            "Grok CLI가 필요합니다. Grok을 설치하고 `grok login`을 실행한 뒤 다시 시도하세요.",
    },
    missing_bun_error: "Grok runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: false,
    empty_session_error: "Grok Agent가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Grok Agent가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Grok Agent 요청에 실패했습니다",
    blocked_prefix: "Grok Agent 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 Grok 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
