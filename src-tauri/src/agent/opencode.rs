use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Opencode,
    conversation_namespace: "opencode",
    runner_name: "OpenCode runner",
    request_name: "OpenCode",
    executable: SidecarExecutableConfig {
        name: "opencode",
        request_key: "opencodeBinary",
        home_candidates: &[
            ".opencode/bin/opencode",
            ".local/bin/opencode",
            ".bun/bin/opencode",
        ],
        absolute_candidates: &[
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
        ],
        missing_error:
            "OpenCode CLI가 필요합니다. OpenCode를 설치하고 `opencode auth login`을 실행한 뒤 다시 시도하세요.",
    },
    missing_bun_error: "OpenCode runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    forwards_additional_directories: false,
    empty_session_error: "OpenCode가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "OpenCode가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "OpenCode 요청에 실패했습니다",
    blocked_prefix: "OpenCode 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 OpenCode 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};
