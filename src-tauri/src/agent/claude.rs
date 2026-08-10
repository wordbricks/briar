use serde::Serialize;
use serde_json::Value;
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::host::CommandRunner;

use super::{
    sidecar::{
        prepare_chat, run_chat, serialize_request, SidecarChatExecution, SidecarProviderConfig,
        SidecarRuntime,
    },
    AgentProviderKind, ApprovalPolicy, ChatExecution, ModelEffort, ProjectLlmRequest,
    ProjectLlmResponse, SandboxMode,
};

const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Claude,
    conversation_namespace: "claude",
    runner_name: "Claude Agent runner",
    request_name: "Claude Agent",
    empty_session_error: "Claude Agent SDK가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Claude Agent SDK가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Claude Agent SDK 요청에 실패했습니다",
    blocked_prefix: "Claude Agent 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 Claude 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
};

pub(crate) struct ClaudeRuntime {
    inner: SidecarRuntime,
}

impl ClaudeRuntime {
    pub(crate) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
    ) -> Result<Self, String> {
        Ok(Self {
            inner: SidecarRuntime::discover(
                command_runner,
                runner_bundle,
                "claude",
                "Claude Agent SDK 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
            )?,
        })
    }
}

pub(crate) fn claude_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    if let Ok(path) = which::which_in("claude", Some(execution_path), home) {
        return Ok(path);
    }
    for candidate in [
        home.join(".local/bin/claude"),
        home.join(".bun/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(
        "Claude Code가 필요합니다. Claude를 설치하고 `claude auth login`을 실행한 뒤 다시 시도하세요."
            .to_string(),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRunnerRequest<'a> {
    r#type: &'static str,
    message: &'a str,
    workspace_root: &'a str,
    conversation_id: Option<&'a str>,
    instructions: Option<&'a str>,
    output_schema: Option<&'a Value>,
    model: Option<&'a str>,
    effort: Option<ModelEffort>,
    approval_policy: ApprovalPolicy,
    sandbox_mode: SandboxMode,
    network_access: bool,
    /// Extra directories the sandbox must allow writes in (Auto Hunt worktrees).
    additional_directories: &'a [String],
    claude_binary: &'a str,
}

pub(crate) fn chat(
    runtime: &ClaudeRuntime,
    project_id: &str,
    workspace_root: &Path,
    execution: ChatExecution,
    request: ProjectLlmRequest,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
    let prepared = prepare_chat(&runtime.inner, CONFIG, project_id, workspace_root, &request)?;
    let runner_request = ClaudeRunnerRequest {
        r#type: "run",
        message: prepared.message,
        workspace_root: &prepared.workspace,
        conversation_id: prepared.conversation_id,
        instructions: request.instructions.as_deref(),
        output_schema: request.output_schema.as_ref(),
        model: execution.model.as_deref(),
        effort: execution.effort,
        approval_policy: execution.approval_policy,
        sandbox_mode: execution.sandbox_mode,
        network_access: execution.network_access,
        additional_directories: &execution.workspace_write_roots,
        claude_binary: runtime.inner.provider_binary(),
    };
    let raw_request = serialize_request(CONFIG, &runner_request)?;
    run_chat(
        &runtime.inner,
        CONFIG,
        project_id,
        prepared,
        raw_request,
        SidecarChatExecution {
            environment: &execution.environment,
            event_sink: execution.event_sink.as_ref(),
        },
        approve,
    )
}
