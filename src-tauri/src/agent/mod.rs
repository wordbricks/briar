//! Provider-neutral entry point for Briar's coding-agent backends.
//!
//! Backends keep their native transport and protocol handling private while
//! exposing the small project-scoped execution contract Briar needs.

mod claude;
mod codex;
mod grok;

use std::{
    ffi::OsStr,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::host::{CommandRunner, CommandSpec};

pub(crate) use codex::{
    AutoHuntCliEnvironment, AutoHuntCoordinatorResponse, ProjectAgentRunRequest,
    ProjectAgentRunResponse, ProjectAutoHuntIssue, ProjectAutoHuntIssueResult,
    ProjectAutoHuntRequest, ProjectAutoHuntResponse, ProjectAutoHuntResult,
    ProjectAutoHuntWorkerResponse, MAX_AUTO_HUNT_ISSUES,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProviderKind {
    #[default]
    Codex,
    Claude,
    Grok,
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
        }
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

pub(crate) struct ClaudeBackend {
    runtime: claude::ClaudeRuntime,
}

impl ClaudeBackend {
    pub(crate) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
    ) -> Result<Self, String> {
        Ok(Self {
            runtime: claude::ClaudeRuntime::discover(command_runner, runner_bundle)?,
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

pub(crate) struct GrokBackend {
    runtime: grok::GrokRuntime,
}

impl GrokBackend {
    pub(crate) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
    ) -> Result<Self, String> {
        Ok(Self {
            runtime: grok::GrokRuntime::discover(command_runner, runner_bundle)?,
        })
    }
}

impl AgentBackend for GrokBackend {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &serde_json::Value) -> bool,
    ) -> Result<ProjectLlmResponse, String> {
        grok::chat(
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
    Grok(GrokBackend),
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
            Self::Grok(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
        }
    }
}

pub(crate) struct AgentRunnerBundles<'a> {
    pub(crate) claude: &'a Path,
    pub(crate) grok: &'a Path,
}

pub(crate) fn discover_backend(
    provider: AgentProviderKind,
    runner: Arc<dyn CommandRunner>,
    runners: AgentRunnerBundles<'_>,
) -> Result<AgentBackendHandle, String> {
    match provider {
        AgentProviderKind::Codex => CodexBackend::discover(runner).map(AgentBackendHandle::Codex),
        AgentProviderKind::Claude => {
            ClaudeBackend::discover(runner, runners.claude).map(AgentBackendHandle::Claude)
        }
        AgentProviderKind::Grok => {
            GrokBackend::discover(runner, runners.grok).map(AgentBackendHandle::Grok)
        }
    }
}

/// A bundled runner materialized on the execution host. Local runs use the
/// bundle in place; SSH runs upload it to a mode-0700 temporary directory and
/// remove that directory when the backend is dropped.
pub(super) struct HostRunnerFile {
    path: String,
    cleanup: Option<(Arc<dyn CommandRunner>, String)>,
}

impl HostRunnerFile {
    pub(super) fn prepare(
        runner: Arc<dyn CommandRunner>,
        local_bundle: &Path,
        filename: &str,
    ) -> Result<Self, String> {
        if !local_bundle.is_file() {
            return Err(
                "Briar 에이전트 runner 번들을 찾지 못했습니다. 앱을 다시 설치하세요.".to_string(),
            );
        }
        if !runner.is_remote() {
            return Ok(Self {
                path: local_bundle.to_string_lossy().into_owned(),
                cleanup: None,
            });
        }

        let shell = runner.resolve_binary("sh")?;
        let directory_output = runner.run(&CommandSpec::new(shell.clone()).args([
            "-c",
            "umask 077; mktemp -d \"${TMPDIR:-/tmp}/briar-agent.XXXXXX\"",
        ]))?;
        if !directory_output.success() {
            return Err(format!(
                "원격 에이전트 임시 폴더를 만들지 못했습니다: {}",
                directory_output.failure_message()
            ));
        }
        let directory = directory_output.stdout_trimmed();
        validate_remote_agent_directory(&directory)?;
        let path = format!("{directory}/{filename}");
        let mut child = runner.spawn_piped(&CommandSpec::new(shell).args([
            "-c".to_string(),
            "umask 077; cat > \"$1\"; chmod 700 \"$1\"".to_string(),
            "briar-agent-upload".to_string(),
            path.clone(),
        ]))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "원격 에이전트 runner 업로드 입력을 열지 못했습니다.".to_string())?;
        let contents = std::fs::read(local_bundle)
            .map_err(|error| format!("에이전트 runner 번들을 읽지 못했습니다: {error}"))?;
        if let Err(error) = stdin.write_all(&contents) {
            let _ = child.kill();
            let _ = child.wait();
            let _ =
                runner.run(&CommandSpec::new("rm").args(["-rf".to_string(), directory.clone()]));
            return Err(format!(
                "원격 에이전트 runner를 전송하지 못했습니다: {error}"
            ));
        }
        drop(stdin);
        let output = child
            .wait_with_output()
            .map_err(|error| format!("원격 에이전트 runner 전송을 완료하지 못했습니다: {error}"))?;
        if !output.status.success() {
            let _ =
                runner.run(&CommandSpec::new("rm").args(["-rf".to_string(), directory.clone()]));
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if message.is_empty() {
                "원격 에이전트 runner 전송이 실패했습니다.".to_string()
            } else {
                format!("원격 에이전트 runner 전송이 실패했습니다: {message}")
            });
        }
        Ok(Self {
            path,
            cleanup: Some((runner, directory)),
        })
    }

    pub(super) fn path(&self) -> &str {
        &self.path
    }
}

fn validate_remote_agent_directory(directory: &str) -> Result<(), String> {
    let path = Path::new(directory);
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    if !path.is_absolute()
        || directory.lines().count() != 1
        || !name.starts_with("briar-agent.")
        || name.len() <= "briar-agent.".len()
    {
        return Err("원격 에이전트 임시 폴더 경로가 안전하지 않습니다.".to_string());
    }
    Ok(())
}

impl Drop for HostRunnerFile {
    fn drop(&mut self) {
        if let Some((runner, directory)) = self.cleanup.take() {
            let _ = runner.run(&CommandSpec::new("rm").args(["-rf".to_string(), directory]));
        }
    }
}

pub(crate) fn codex_binary(home: &Path) -> Result<PathBuf, String> {
    codex::codex_binary(home)
}

pub(crate) fn claude_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    claude::claude_binary(home, execution_path)
}

pub(crate) fn grok_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    grok::grok_binary(home, execution_path)
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
    use super::{validate_remote_agent_directory, AgentProviderKind, HostRunnerFile};
    use crate::host::{CommandRunner, LocalRunner};
    use std::sync::Arc;

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
            AgentProviderKind::for_conversation_id("project-2", "briar:project-1:thread-1"),
            None
        );
    }

    #[test]
    fn only_accepts_narrow_remote_agent_temp_directories() {
        assert!(validate_remote_agent_directory("/tmp/briar-agent.a1b2c3").is_ok());
        for unsafe_path in [
            "/",
            "/tmp",
            "tmp/briar-agent.a1b2c3",
            "/tmp/not-briar.a1b2c3",
            "/tmp/briar-agent.\n/tmp/other",
        ] {
            assert!(
                validate_remote_agent_directory(unsafe_path).is_err(),
                "{unsafe_path:?} must not be removable"
            );
        }
    }

    #[test]
    fn keeps_a_local_runner_bundle_in_place() {
        let directory = tempfile::tempdir().expect("temp directory");
        let bundle = directory.path().join("runner.js");
        std::fs::write(&bundle, "console.log('ok')").expect("runner bundle");
        let runner: Arc<dyn CommandRunner> = Arc::new(LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            directory.path().to_path_buf(),
        ));
        let prepared =
            HostRunnerFile::prepare(runner, &bundle, "runner.js").expect("local runner file");
        assert_eq!(prepared.path(), bundle.to_string_lossy());
        assert!(bundle.is_file());
    }
}
