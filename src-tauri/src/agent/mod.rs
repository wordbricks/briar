//! Provider-neutral entry point for Briar's local coding-agent backends.
//!
//! Backends keep their native transport and protocol handling private while
//! exposing the small project-scoped execution contract Briar needs.

mod claude;
mod codex;

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) use codex::{AutoHuntCliEnvironment, ProjectAutoHuntRequest, ProjectAutoHuntResponse};

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProviderKind {
    #[default]
    Codex,
    Claude,
}

impl AgentProviderKind {
    pub(crate) fn for_conversation_id(project_id: &str, conversation_id: &str) -> Option<Self> {
        let claude_prefix = format!("briar:claude:{project_id}:");
        if conversation_id
            .strip_prefix(&claude_prefix)
            .is_some_and(|id| !id.is_empty())
        {
            return Some(Self::Claude);
        }
        let codex_prefix = format!("briar:{project_id}:");
        conversation_id
            .strip_prefix(&codex_prefix)
            .filter(|id| !id.is_empty())
            .map(|_| Self::Codex)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentEventDirection {
    Client,
    Server,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum AgentEvent {
    MessageStarted {
        id: String,
        phase: Option<String>,
        text: String,
    },
    MessageDelta {
        id: String,
        delta: String,
    },
    MessageCompleted {
        id: String,
        phase: Option<String>,
        text: String,
    },
    TurnCompleted {
        status: String,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct AgentProviderEvent {
    pub(crate) provider: AgentProviderKind,
    pub(crate) direction: AgentEventDirection,
    pub(crate) raw: serde_json::Value,
    pub(crate) event: Option<AgentEvent>,
}

pub(crate) type AgentEventSink =
    Arc<dyn Fn(AgentProviderEvent) -> Result<(), String> + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl SandboxMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::DangerFullAccess => "danger-full-access",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ApprovalPolicy {
    Untrusted,
    OnRequest,
    #[default]
    Never,
}

impl ApprovalPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Untrusted => "untrusted",
            Self::OnRequest => "on-request",
            Self::Never => "never",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ModelEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

impl ModelEffort {
    fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
            Self::Ultra => "ultra",
        }
    }
}

#[derive(Clone)]
pub(crate) struct ChatExecution {
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) sandbox_mode: SandboxMode,
    pub(crate) network_access: bool,
    pub(crate) model: Option<String>,
    pub(crate) effort: Option<ModelEffort>,
    pub(crate) event_sink: Option<AgentEventSink>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmSettings {
    #[serde(default)]
    pub(crate) provider: AgentProviderKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) effort: Option<ModelEffort>,
    #[serde(default)]
    pub(crate) approval_policy: ApprovalPolicy,
}

impl Default for ProjectLlmSettings {
    fn default() -> Self {
        Self {
            provider: AgentProviderKind::Codex,
            model: None,
            effort: None,
            approval_policy: ApprovalPolicy::Never,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmRequest {
    pub(crate) message: String,
    #[serde(default)]
    pub(crate) conversation_id: Option<String>,
    #[serde(default)]
    pub(crate) instructions: Option<String>,
    #[serde(default)]
    pub(crate) output_schema: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmResponse {
    pub(crate) conversation_id: String,
    pub(crate) message: String,
    pub(crate) workspace_root: String,
}

#[derive(Clone)]
pub(crate) struct AutoHuntExecution {
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) model: Option<String>,
    pub(crate) effort: Option<ModelEffort>,
    pub(crate) event_sink: AgentEventSink,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppServerEventRecord {
    pub(crate) session_id: String,
    pub(crate) sequence: u64,
    pub(crate) occurred_at_ms: u64,
    pub(crate) direction: String,
    pub(crate) message: serde_json::Value,
    #[serde(default)]
    pub(crate) provider: AgentProviderKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) event: Option<AgentEvent>,
}

impl AppServerEventRecord {
    pub(crate) fn new(
        session_id: String,
        sequence: u64,
        provider_event: AgentProviderEvent,
    ) -> Self {
        Self {
            session_id,
            sequence,
            occurred_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            direction: match provider_event.direction {
                AgentEventDirection::Client => "client",
                AgentEventDirection::Server => "server",
            }
            .to_string(),
            message: provider_event.raw,
            provider: provider_event.provider,
            event: provider_event.event,
        }
    }
}

/// Minimal backend boundary for one project-scoped agent turn.
pub(crate) trait AgentBackend {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &serde_json::Value) -> bool,
    ) -> Result<ProjectLlmResponse, String>;
}

pub(crate) struct CodexBackend {
    binary: PathBuf,
    execution_path: std::ffi::OsString,
}

impl CodexBackend {
    pub(crate) fn discover(home: &Path, execution_path: &OsStr) -> Result<Self, String> {
        Ok(Self {
            binary: codex::codex_binary(home)?,
            execution_path: execution_path.to_os_string(),
        })
    }
}

impl AgentBackend for CodexBackend {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &serde_json::Value) -> bool,
    ) -> Result<ProjectLlmResponse, String> {
        codex::chat(
            &self.binary,
            &self.execution_path,
            project_id,
            workspace_root,
            execution,
            request,
            approve,
        )
    }
}

pub(crate) struct ClaudeBackend {
    runtime: claude::ClaudeRuntime,
}

impl ClaudeBackend {
    pub(crate) fn discover(
        home: &Path,
        execution_path: &OsStr,
        runner: &Path,
    ) -> Result<Self, String> {
        Ok(Self {
            runtime: claude::ClaudeRuntime::discover(home, execution_path, runner)?,
        })
    }
}

impl AgentBackend for ClaudeBackend {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &serde_json::Value) -> bool,
    ) -> Result<ProjectLlmResponse, String> {
        claude::chat(
            &self.runtime,
            project_id,
            workspace_root,
            execution,
            request,
            approve,
        )
    }
}

pub(crate) enum AgentBackendHandle {
    Codex(CodexBackend),
    Claude(ClaudeBackend),
}

impl AgentBackend for AgentBackendHandle {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &serde_json::Value) -> bool,
    ) -> Result<ProjectLlmResponse, String> {
        match self {
            Self::Codex(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
            Self::Claude(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
        }
    }
}

pub(crate) fn discover_backend(
    provider: AgentProviderKind,
    home: &Path,
    execution_path: &OsStr,
    claude_runner: &Path,
) -> Result<AgentBackendHandle, String> {
    match provider {
        AgentProviderKind::Codex => {
            CodexBackend::discover(home, execution_path).map(AgentBackendHandle::Codex)
        }
        AgentProviderKind::Claude => ClaudeBackend::discover(home, execution_path, claude_runner)
            .map(AgentBackendHandle::Claude),
    }
}

pub(crate) fn codex_binary(home: &Path) -> Result<PathBuf, String> {
    codex::codex_binary(home)
}

pub(crate) fn claude_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    claude::claude_binary(home, execution_path)
}

pub(crate) fn start_auto_hunt(
    backend: &dyn AgentBackend,
    project_id: &str,
    workspace_root: &Path,
    execution: AutoHuntExecution,
    request: ProjectAutoHuntRequest,
    approve: &dyn Fn(&str, &serde_json::Value) -> bool,
) -> Result<ProjectAutoHuntResponse, String> {
    codex::start_auto_hunt_with(
        backend,
        project_id,
        workspace_root,
        execution,
        request,
        approve,
    )
}

#[cfg(test)]
mod tests {
    use super::AgentProviderKind;

    #[test]
    fn resolves_the_original_provider_from_a_project_conversation() {
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:project-1:thread-1"),
            Some(AgentProviderKind::Codex)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:claude:project-1:session-1"),
            Some(AgentProviderKind::Claude)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-2", "briar:project-1:thread-1"),
            None
        );
    }
}
