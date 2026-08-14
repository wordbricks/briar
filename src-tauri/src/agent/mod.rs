//! Provider-neutral entry point for Briar's coding-agent backends.
//!
//! Backends keep their native transport and protocol handling private while
//! exposing the small project-scoped execution contract Briar needs.

mod agy;
mod claude;
mod codex;
mod grok;
mod opencode;
mod sidecar;

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::host::CommandRunner;

pub(crate) use codex::{
    AutoHuntCliEnvironment, AutoHuntCoordinatorResponse, ProjectAgentRunRequest,
    ProjectAgentRunResponse, ProjectAutoHuntIssue, ProjectAutoHuntIssueAttachment,
    ProjectAutoHuntIssueMessage, ProjectAutoHuntIssueResult, ProjectAutoHuntRequest,
    ProjectAutoHuntResponse, ProjectAutoHuntResult, ProjectAutoHuntWorkerResponse,
    MAX_AUTO_HUNT_ISSUES,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProviderKind {
    #[default]
    Codex,
    Claude,
    Grok,
    Agy,
    Opencode,
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
        let grok_prefix = format!("briar:grok:{project_id}:");
        if conversation_id
            .strip_prefix(&grok_prefix)
            .is_some_and(|id| !id.is_empty())
        {
            return Some(Self::Grok);
        }
        let opencode_prefix = format!("briar:opencode:{project_id}:");
        if conversation_id
            .strip_prefix(&opencode_prefix)
            .is_some_and(|id| !id.is_empty())
        {
            return Some(Self::Opencode);
        }
        let agy_prefix = format!("briar:agy:{project_id}:");
        if conversation_id
            .strip_prefix(&agy_prefix)
            .is_some_and(|id| !id.is_empty())
        {
            return Some(Self::Agy);
        }
        let codex_prefix = format!("briar:{project_id}:");
        conversation_id
            .strip_prefix(&codex_prefix)
            .filter(|id| !id.is_empty())
            .map(|_| Self::Codex)
    }

    pub(crate) fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude",
            Self::Grok => "Grok",
            Self::Agy => "Antigravity",
            Self::Opencode => "OpenCode",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentEventDirection {
    Client,
    Server,
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentActivityKind {
    Command,
    FileChange,
    WebSearch,
    Tool,
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentActivityStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum AgentEvent {
    ConversationStarted {
        conversation_id: String,
    },
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
    ActivityStarted {
        id: String,
        kind: AgentActivityKind,
        title: String,
        text: String,
    },
    ActivityDelta {
        id: String,
        delta: String,
    },
    ActivityCompleted {
        id: String,
        kind: AgentActivityKind,
        title: String,
        text: String,
        status: AgentActivityStatus,
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

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(transparent)]
pub(crate) struct ModelEffort(String);

impl ModelEffort {
    #[cfg(test)]
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    fn as_str(&self) -> &str {
        &self.0
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
    pub(crate) environment: Vec<(String, String)>,
    /// Directories outside the workspace the agent may still write to, such as
    /// the Auto Hunt per-issue worktree root. Empty keeps the sandbox at cwd.
    pub(crate) workspace_write_roots: Vec<String>,
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
    pub(crate) progress_id: Option<String>,
    #[serde(default)]
    pub(crate) conversation_id: Option<String>,
    #[serde(default)]
    pub(crate) instructions: Option<String>,
    #[serde(default)]
    pub(crate) output_schema: Option<serde_json::Value>,
}

const BRIAR_SKILL_INSTRUCTION: &str =
    "This request is running inside the Briar app; before doing any work, read the installed `briar-workflow` skill completely.";

impl ProjectLlmRequest {
    fn with_briar_skill_instruction(mut self) -> Self {
        self.instructions = Some(match self.instructions {
            Some(instructions) if !instructions.trim().is_empty() => {
                format!("{BRIAR_SKILL_INSTRUCTION}\n\n{instructions}")
            }
            _ => BRIAR_SKILL_INSTRUCTION.to_string(),
        });
        self
    }
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
    pub(crate) environment: Vec<(String, String)>,
    pub(crate) workspace_write_roots: Vec<String>,
    /// Opt-in per project: drop the filesystem sandbox entirely instead of
    /// confining writes to the checkout and the worktree root.
    pub(crate) full_access: bool,
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
    binary: String,
    runner: Arc<dyn CommandRunner>,
}

impl CodexBackend {
    pub(crate) fn discover(runner: Arc<dyn CommandRunner>) -> Result<Self, String> {
        Ok(Self {
            binary: runner.resolve_binary("codex")?,
            runner,
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
            self.runner.clone(),
            &self.binary,
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
    Claude(sidecar::SidecarBackend),
    Grok(sidecar::SidecarBackend),
    Agy(sidecar::SidecarBackend),
    Opencode(sidecar::SidecarBackend),
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
        let request = request.with_briar_skill_instruction();
        match self {
            Self::Codex(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
            Self::Claude(backend)
            | Self::Grok(backend)
            | Self::Agy(backend)
            | Self::Opencode(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
        }
    }
}

pub(crate) struct AgentRunnerBundles<'a> {
    pub(crate) claude: &'a Path,
    pub(crate) grok: &'a Path,
    pub(crate) agy: &'a Path,
    pub(crate) opencode: &'a Path,
}

pub(crate) fn discover_backend(
    provider: AgentProviderKind,
    runner: Arc<dyn CommandRunner>,
    runners: AgentRunnerBundles<'_>,
) -> Result<AgentBackendHandle, String> {
    match provider {
        AgentProviderKind::Codex => CodexBackend::discover(runner).map(AgentBackendHandle::Codex),
        AgentProviderKind::Claude => {
            sidecar::SidecarBackend::discover(runner, runners.claude, claude::CONFIG)
                .map(AgentBackendHandle::Claude)
        }
        AgentProviderKind::Grok => {
            sidecar::SidecarBackend::discover(runner, runners.grok, grok::CONFIG)
                .map(AgentBackendHandle::Grok)
        }
        AgentProviderKind::Agy => {
            sidecar::SidecarBackend::discover(runner, runners.agy, agy::CONFIG)
                .map(AgentBackendHandle::Agy)
        }
        AgentProviderKind::Opencode => {
            sidecar::SidecarBackend::discover(runner, runners.opencode, opencode::CONFIG)
                .map(AgentBackendHandle::Opencode)
        }
    }
}

/// A bundled runner used by a local provider process.
pub(super) struct BundledRunnerFile {
    path: String,
}

impl BundledRunnerFile {
    pub(super) fn prepare(local_bundle: &Path) -> Result<Self, String> {
        if !local_bundle.is_file() {
            return Err(
                "Briar 에이전트 runner 번들을 찾지 못했습니다. 앱을 다시 설치하세요.".to_string(),
            );
        }
        Ok(Self {
            path: local_bundle.to_string_lossy().into_owned(),
        })
    }

    pub(super) fn path(&self) -> &str {
        &self.path
    }
}

pub(crate) fn codex_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    codex::codex_binary(home, execution_path)
}

pub(crate) fn codex_models(
    runner: Arc<dyn CommandRunner>,
    binary: &str,
    workspace: &Path,
) -> Result<Vec<codex::ModelListEntry>, String> {
    codex::list_models(runner, binary, workspace)
}

pub(crate) fn claude_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(claude::CONFIG, home, execution_path)
}

pub(crate) fn grok_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(grok::CONFIG, home, execution_path)
}

pub(crate) fn agy_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(agy::CONFIG, home, execution_path)
}

pub(crate) fn opencode_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(opencode::CONFIG, home, execution_path)
}

pub(crate) fn start_auto_hunt_worker(
    backend: &dyn AgentBackend,
    project_id: &str,
    workspace_root: &Path,
    execution: AutoHuntExecution,
    request: ProjectAutoHuntRequest,
    issue: ProjectAutoHuntIssue,
    approve: &dyn Fn(&str, &serde_json::Value) -> bool,
) -> Result<ProjectAutoHuntResponse, String> {
    codex::start_auto_hunt_worker_with(
        backend,
        project_id,
        workspace_root,
        execution,
        request,
        issue,
        approve,
    )
}

pub(crate) fn run_project_agent(
    backend: &dyn AgentBackend,
    project_id: &str,
    workspace_root: &Path,
    execution: ChatExecution,
    workflow_json: &str,
    request: ProjectAgentRunRequest,
    approve: &dyn Fn(&str, &serde_json::Value) -> bool,
) -> Result<ProjectAgentRunResponse, String> {
    codex::run_project_agent_with(
        backend,
        project_id,
        workspace_root,
        execution,
        workflow_json,
        request,
        approve,
    )
}

pub(crate) fn summarize_auto_hunt_dispatch(
    backend: &dyn AgentBackend,
    project_id: &str,
    workspace_root: &Path,
    execution: AutoHuntExecution,
    request: &ProjectAutoHuntRequest,
    workers: &[ProjectAutoHuntWorkerResponse],
    approve: &dyn Fn(&str, &serde_json::Value) -> bool,
) -> Result<AutoHuntCoordinatorResponse, String> {
    codex::summarize_auto_hunt_dispatch_with(
        backend,
        project_id,
        workspace_root,
        execution,
        request,
        workers,
        approve,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        AgentActivityKind, AgentActivityStatus, AgentEvent, AgentProviderKind, BundledRunnerFile,
        ProjectLlmRequest, BRIAR_SKILL_INSTRUCTION,
    };
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
            AgentProviderKind::for_conversation_id("project-1", "briar:grok:project-1:session-1"),
            Some(AgentProviderKind::Grok)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:agy:project-1:session-1"),
            Some(AgentProviderKind::Agy)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id(
                "project-1",
                "briar:opencode:project-1:session-1"
            ),
            Some(AgentProviderKind::Opencode)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-2", "briar:project-1:thread-1"),
            None
        );
    }

    #[test]
    fn adds_the_briar_skill_instruction_to_every_request() {
        let request = ProjectLlmRequest {
            message: "Inspect the repository".to_string(),
            progress_id: None,
            conversation_id: None,
            instructions: Some("Be concise.".to_string()),
            output_schema: None,
        }
        .with_briar_skill_instruction();

        let expected = format!("{BRIAR_SKILL_INSTRUCTION}\n\nBe concise.");
        assert_eq!(request.instructions.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn keeps_a_local_runner_bundle_in_place() {
        let directory = tempfile::tempdir().expect("temp directory");
        let bundle = directory.path().join("runner.js");
        std::fs::write(&bundle, "console.log('ok')").expect("runner bundle");
        let prepared = BundledRunnerFile::prepare(&bundle).expect("local runner file");
        assert_eq!(prepared.path(), bundle.to_string_lossy());
        assert!(bundle.is_file());
    }

    #[test]
    fn deserializes_the_shared_activity_contract() {
        let event: AgentEvent = serde_json::from_value(serde_json::json!({
            "type": "activityCompleted",
            "id": "tool-1",
            "kind": "fileChange",
            "title": "src/main.ts",
            "text": "updated",
            "status": "cancelled"
        }))
        .expect("activity event should deserialize");

        assert!(matches!(
            event,
            AgentEvent::ActivityCompleted {
                id,
                kind: AgentActivityKind::FileChange,
                title,
                text,
                status: AgentActivityStatus::Cancelled,
            } if id == "tool-1" && title == "src/main.ts" && text == "updated"
        ));
    }
}
