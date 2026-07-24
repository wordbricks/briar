//! Provider-neutral entry point for Briar's local coding-agent backends.
//!
//! Backends keep their native transport and protocol handling private while
//! exposing the small project-scoped execution contract Briar needs.

mod codex;

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Arc,
};

#[cfg(test)]
pub(crate) use codex::ApprovalPolicy;
pub(crate) use codex::{
    AppServerEventRecord, AutoHuntCliEnvironment, AutoHuntExecution, ChatExecution,
    ProjectAutoHuntRequest, ProjectAutoHuntResponse, ProjectLlmRequest, ProjectLlmResponse,
    ProjectLlmSettings, SandboxMode,
};

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProviderKind {
    #[default]
    Codex,
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

pub(crate) fn codex_binary(home: &Path) -> Result<PathBuf, String> {
    codex::codex_binary(home)
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
