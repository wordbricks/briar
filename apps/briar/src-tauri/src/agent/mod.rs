//! Provider-neutral entry point for Briar's coding-agent backends.
//!
//! Backends keep their native transport and protocol handling private while
//! exposing the small project-scoped execution contract Briar needs.

mod agy;
mod claude;
mod codex;
mod cursor;
mod grok;
mod opencode;
mod openrouter;
mod project_agent;
mod sidecar;

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Arc,
};

use briar_contracts::proto::briar::types::v1 as types_proto;
use buffa::Enumeration as _;

use crate::host::CommandRunner;
use crate::project_config::bundled_path;

pub(crate) use project_agent::{
    AutoHuntCliEnvironment, AutoHuntCoordinatorResponse, ProjectAgentRunRequest,
    ProjectAgentRunResponse, ProjectAutoHuntIssue, ProjectAutoHuntIssueAttachment,
    ProjectAutoHuntIssueMessage, ProjectAutoHuntIssueMessageAuthor, ProjectAutoHuntIssueResult,
    ProjectAutoHuntRequest, ProjectAutoHuntResponse, ProjectAutoHuntResult,
    ProjectAutoHuntWorkerResponse, MAX_AUTO_HUNT_ISSUES,
};

#[derive(
    Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProviderKind {
    #[default]
    Codex,
    Claude,
    Cursor,
    Grok,
    Agy,
    Opencode,
    Openrouter,
}

/// Marker naming the Briar provider a runner process executes for.
///
/// The sidecar `RunRequest` carries no provider id and several providers share
/// one runner bundle, so the launcher names the provider in the environment
/// instead. Mirrors `agentProviderEnvironmentKey` in `src/lib/agent-provider.ts`.
pub(crate) const AGENT_PROVIDER_ENVIRONMENT_KEY: &str = "BRIAR_AGENT_PROVIDER";

/// Home-relative skills directory of OpenCode's local runtime.
const OPENCODE_SKILL_DIRECTORY: &str = ".config/opencode";

/// Bundled runner that drives OpenCode's local runtime.
const OPENCODE_RUNNER_BUNDLE: &str = "opencode-runner.js";

/// A provider that is not its own CLI: it runs behind the OpenCode runner with
/// a Briar-generated OpenCode config, which names the credential environment
/// variable rather than carrying the credential itself.
pub(crate) struct OpenCodeUpstream {
    pub(crate) provider: AgentProviderKind,
    /// Environment variable OpenCode resolves this upstream's credential from.
    pub(crate) credential_environment_variable: &'static str,
    /// `OPENCODE_CONFIG_CONTENT` Briar generates for this upstream. Byte for
    /// byte what `openCodeUpstreamConfigJson` produces in TypeScript.
    pub(crate) config_content: &'static str,
    /// Shown when a turn is requested before the credential is saved.
    pub(crate) missing_credential_error: &'static str,
}

/// The single source of OpenCode upstreams. Everything that used to enumerate
/// `Opencode | Openrouter` derives from this table instead.
static OPENCODE_UPSTREAMS: &[OpenCodeUpstream] = &[OpenCodeUpstream {
    provider: AgentProviderKind::Openrouter,
    credential_environment_variable: "OPENROUTER_API_KEY",
    config_content: r#"{"provider":{"openrouter":{"options":{"apiKey":"{env:OPENROUTER_API_KEY}"}}}}"#,
    missing_credential_error: "앱 설정에서 OpenRouter API 키를 먼저 저장하세요.",
}];

/// 대화 ID 네임스페이스의 단일 출처.
///
/// 여기 등록된 provider는 대화 ID를 `briar:<네임스페이스>:<프로젝트 id>:<세션 id>`
/// 형태로 주고받는다. 표에 없는 provider는
/// [`AgentProviderKind::conversation_namespace`]가 `None`을 돌려준다. Codex는
/// 네임스페이스가 없던 시절 `briar:<프로젝트 id>:<세션 id>` 형식을 썼으므로
/// [`AgentProviderKind::for_conversation_id`]의 레거시 폴백이 표와 무관하게 남아
/// 있고, 그때 저장된 대화 ID도 계속 인식된다.
const CONVERSATION_NAMESPACES: &[(AgentProviderKind, &str)] = &[
    (AgentProviderKind::Codex, "codex"),
    (AgentProviderKind::Claude, "claude"),
    (AgentProviderKind::Grok, "grok"),
    (AgentProviderKind::Cursor, "cursor"),
    (AgentProviderKind::Opencode, "opencode"),
    (AgentProviderKind::Agy, "agy"),
    (AgentProviderKind::Openrouter, "openrouter"),
];

impl AgentProviderKind {
    /// The OpenCode upstream this provider runs as, when it is one.
    pub(crate) fn opencode_upstream(self) -> Option<&'static OpenCodeUpstream> {
        OPENCODE_UPSTREAMS
            .iter()
            .find(|upstream| upstream.provider == self)
    }

    /// provider가 대화 ID에 사용하는 네임스페이스. 레거시 형식만 쓰면 `None`.
    pub(crate) fn conversation_namespace(self) -> Option<&'static str> {
        CONVERSATION_NAMESPACES
            .iter()
            .find(|(kind, _)| *kind == self)
            .map(|(_, namespace)| *namespace)
    }

    pub(crate) fn for_conversation_id(project_id: &str, conversation_id: &str) -> Option<Self> {
        for (kind, namespace) in CONVERSATION_NAMESPACES {
            let prefix = format!("briar:{namespace}:{project_id}:");
            if conversation_id
                .strip_prefix(&prefix)
                .is_some_and(|session_id| !session_id.is_empty())
            {
                return Some(*kind);
            }
        }
        // 네임스페이스가 없던 시절의 Codex 대화 ID. Codex가 네임스페이스를 갖게
        // 되더라도 이미 저장된 대화를 계속 이어갈 수 있도록 남겨 둔다.
        let legacy_codex_prefix = format!("briar:{project_id}:");
        conversation_id
            .strip_prefix(&legacy_codex_prefix)
            .filter(|session_id| !session_id.is_empty())
            .map(|_| Self::Codex)
    }

    pub(crate) fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude",
            Self::Cursor => "Cursor",
            Self::Grok => "Grok",
            Self::Agy => "Antigravity",
            Self::Opencode => "OpenCode",
            Self::Openrouter => "OpenRouter",
        }
    }

    /// Home-relative directory this provider reads Briar skills from.
    pub(crate) fn skill_directory(self) -> &'static str {
        // Every upstream runs on OpenCode's local runtime and reads its skills.
        if self.opencode_upstream().is_some() {
            return OPENCODE_SKILL_DIRECTORY;
        }
        match self {
            Self::Codex => ".codex",
            Self::Claude => ".claude",
            Self::Cursor => ".cursor",
            Self::Grok => ".grok",
            Self::Agy => ".gemini/config",
            Self::Opencode | Self::Openrouter => OPENCODE_SKILL_DIRECTORY,
        }
    }

    /// Bundled Bun sidecar runner this provider executes, when it has one.
    pub(crate) fn runner_bundle_name(self) -> &'static str {
        // An upstream has no runner of its own; OpenCode's runner drives it.
        if self.opencode_upstream().is_some() {
            return OPENCODE_RUNNER_BUNDLE;
        }
        match self {
            Self::Codex => "codex-runner.js",
            Self::Claude => "claude-runner.js",
            Self::Cursor => "cursor-runner.js",
            Self::Grok => "grok-runner.js",
            Self::Agy => "agy-runner.js",
            Self::Opencode | Self::Openrouter => OPENCODE_RUNNER_BUNDLE,
        }
    }

    /// Platform name as the CLI and the frontend spell it ("codex", "agy").
    pub(crate) fn wire_name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::Grok => "grok",
            Self::Agy => "agy",
            Self::Opencode => "opencode",
            Self::Openrouter => "openrouter",
        }
    }

    /// Wire identity from `briar.types.v1.AgentProvider` (ADR-0008). The match
    /// is exhaustive, so a new platform provider must declare a wire value.
    pub(crate) fn wire(self) -> types_proto::AgentProvider {
        use types_proto::AgentProvider as Wire;
        match self {
            Self::Codex => Wire::AGENT_PROVIDER_CODEX,
            Self::Claude => Wire::AGENT_PROVIDER_CLAUDE,
            Self::Cursor => Wire::AGENT_PROVIDER_CURSOR,
            Self::Grok => Wire::AGENT_PROVIDER_GROK,
            Self::Agy => Wire::AGENT_PROVIDER_AGY,
            Self::Opencode => Wire::AGENT_PROVIDER_OPENCODE,
            Self::Openrouter => Wire::AGENT_PROVIDER_OPENROUTER,
        }
    }

    /// Platform provider behind a wire value. The match is exhaustive over the
    /// generated enum, so a new proto value must be handled here.
    pub(crate) fn from_wire(value: types_proto::AgentProvider) -> Option<Self> {
        use types_proto::AgentProvider as Wire;
        match value {
            Wire::AGENT_PROVIDER_UNSPECIFIED => None,
            Wire::AGENT_PROVIDER_CODEX => Some(Self::Codex),
            Wire::AGENT_PROVIDER_CLAUDE => Some(Self::Claude),
            Wire::AGENT_PROVIDER_CURSOR => Some(Self::Cursor),
            Wire::AGENT_PROVIDER_GROK => Some(Self::Grok),
            Wire::AGENT_PROVIDER_AGY => Some(Self::Agy),
            Wire::AGENT_PROVIDER_OPENCODE => Some(Self::Opencode),
            Wire::AGENT_PROVIDER_OPENROUTER => Some(Self::Openrouter),
        }
    }

    /// Every provider in wire declaration order, derived from the generated
    /// enum so no caller keeps a provider list of its own.
    pub(crate) fn all() -> impl Iterator<Item = Self> {
        types_proto::AgentProvider::values()
            .iter()
            .copied()
            .filter_map(Self::from_wire)
    }
}

impl From<AgentProviderKind> for types_proto::AgentProvider {
    fn from(value: AgentProviderKind) -> Self {
        value.wire()
    }
}

/// Why a provider stopped a turn before producing a result, mirrored from
/// `briar.types.v1.ProviderBlockReason`. Serialized in snake_case so the
/// desktop frontend and the CLI share one vocabulary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProviderBlockReason {
    McpAuthRequired,
    UsageExhausted,
    UpstreamOverloaded,
    FreeTierLimit,
    AuthRequired,
    ContextWindowExceeded,
    BillingRequired,
    ModelUnavailable,
}

impl ProviderBlockReason {
    pub(crate) fn from_wire(value: types_proto::ProviderBlockReason) -> Option<Self> {
        use types_proto::ProviderBlockReason as Wire;
        match value {
            Wire::PROVIDER_BLOCK_REASON_UNSPECIFIED => None,
            Wire::PROVIDER_BLOCK_REASON_MCP_AUTH_REQUIRED => Some(Self::McpAuthRequired),
            Wire::PROVIDER_BLOCK_REASON_USAGE_EXHAUSTED => Some(Self::UsageExhausted),
            Wire::PROVIDER_BLOCK_REASON_UPSTREAM_OVERLOADED => Some(Self::UpstreamOverloaded),
            Wire::PROVIDER_BLOCK_REASON_FREE_TIER_LIMIT => Some(Self::FreeTierLimit),
            Wire::PROVIDER_BLOCK_REASON_AUTH_REQUIRED => Some(Self::AuthRequired),
            Wire::PROVIDER_BLOCK_REASON_CONTEXT_WINDOW_EXCEEDED => {
                Some(Self::ContextWindowExceeded)
            }
            Wire::PROVIDER_BLOCK_REASON_BILLING_REQUIRED => Some(Self::BillingRequired),
            Wire::PROVIDER_BLOCK_REASON_MODEL_UNAVAILABLE => Some(Self::ModelUnavailable),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::McpAuthRequired => "mcp_auth_required",
            Self::UsageExhausted => "usage_exhausted",
            Self::UpstreamOverloaded => "upstream_overloaded",
            Self::FreeTierLimit => "free_tier_limit",
            Self::AuthRequired => "auth_required",
            Self::ContextWindowExceeded => "context_window_exceeded",
            Self::BillingRequired => "billing_required",
            Self::ModelUnavailable => "model_unavailable",
        }
    }
}

/// Tauri commands return `Result<_, String>`, so a block travels to the
/// frontend as this prefix followed by the JSON of a [`ProviderBlock`]. The
/// frontend strips the prefix and reads the structure; every other consumer
/// still sees one readable line.
pub(crate) const PROVIDER_BLOCKED_ERROR_PREFIX: &str = "BRIAR_PROVIDER_BLOCKED: ";

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderBlock {
    pub(crate) reason: ProviderBlockReason,
    pub(crate) provider: String,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) next_retry_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) status_code: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_code: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) server_names: Vec<String>,
}

impl ProviderBlock {
    pub(crate) fn from_wire(
        fallback_provider: AgentProviderKind,
        value: types_proto::ProviderBlock,
    ) -> Option<Self> {
        let reason = ProviderBlockReason::from_wire(value.reason.as_known()?)?;
        let provider = value
            .provider
            .as_deref()
            .map(str::trim)
            .filter(|provider| !provider.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| fallback_provider.wire_name().to_string());
        let next_retry_at = value
            .next_retry_at
            .into_option()
            .and_then(|timestamp| serde_json::to_value(timestamp).ok())
            .and_then(|timestamp| timestamp.as_str().map(str::to_string));
        Some(Self {
            reason,
            provider,
            message: value.message.trim().to_string(),
            next_retry_at,
            status_code: value.status_code,
            provider_code: value
                .provider_code
                .map(|code| code.trim().to_string())
                .filter(|code| !code.is_empty()),
            server_names: value
                .server_names
                .into_iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect(),
        })
    }

    /// The `Err(String)` a Tauri command carries for this block.
    pub(crate) fn to_error(&self, prefix: &str) -> String {
        match serde_json::to_string(self) {
            Ok(json) => format!("{PROVIDER_BLOCKED_ERROR_PREFIX}{json}"),
            Err(_) => format!(
                "{prefix}: {} (reason={})",
                self.message,
                self.reason.as_str()
            ),
        }
    }

    /// Recover the block from an error string produced by [`Self::to_error`].
    pub(crate) fn from_error(error: &str) -> Option<Self> {
        let json = error.trim().strip_prefix(PROVIDER_BLOCKED_ERROR_PREFIX)?;
        serde_json::from_str(json).ok()
    }

    /// One readable line for logs and run events.
    pub(crate) fn describe(&self) -> String {
        let mut details = vec![
            format!("reason={}", self.reason.as_str()),
            format!("provider={}", self.provider),
        ];
        if !self.server_names.is_empty() {
            details.push(format!("serverNames={}", self.server_names.join(",")));
        }
        if let Some(next_retry_at) = &self.next_retry_at {
            details.push(format!("nextRetryAt={next_retry_at}"));
        }
        if let Some(status_code) = self.status_code {
            details.push(format!("statusCode={status_code}"));
        }
        if let Some(code) = &self.provider_code {
            details.push(format!("providerCode={code}"));
        }
        format!("{} ({})", self.message, details.join(", "))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentEventDirection {
    Client,
    Server,
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentActivityKind {
    Command,
    FileChange,
    WebSearch,
    Tool,
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentActivityStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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

#[derive(
    Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize, specta::Type,
)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ApprovalPolicy {
    Untrusted,
    OnRequest,
    #[default]
    Never,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(transparent)]
pub(crate) struct ModelEffort(String);

impl ModelEffort {
    pub(crate) fn from_id(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn id(&self) -> &str {
        &self.0
    }

    #[cfg(test)]
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self::from_id(value)
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

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
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

#[derive(serde::Deserialize, specta::Type)]
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
    #[specta(type = Option<crate::ipc::JsonValue>)]
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

#[derive(Debug, serde::Serialize, specta::Type)]
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

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "auto-hunt-app-server-event")]
pub(crate) struct AppServerEventRecord {
    pub(crate) session_id: String,
    pub(crate) sequence: u64,
    pub(crate) occurred_at_ms: u64,
    pub(crate) direction: AgentEventDirection,
    #[specta(type = crate::ipc::JsonValue)]
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
            direction: provider_event.direction,
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

pub(crate) enum AgentBackendHandle {
    Codex(sidecar::SidecarBackend),
    Claude(sidecar::SidecarBackend),
    Cursor(sidecar::SidecarBackend),
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
            Self::Codex(backend)
            | Self::Claude(backend)
            | Self::Cursor(backend)
            | Self::Grok(backend)
            | Self::Agy(backend)
            | Self::Opencode(backend) => {
                backend.run(project_id, workspace_root, execution, request, approve)
            }
        }
    }
}

/// Resolves the bundled runner a provider executes. Keyed by provider so no
/// caller carries one field, argument, or path lookup per provider.
pub(crate) struct AgentRunnerBundles<'a> {
    resource_directory: &'a Path,
}

impl<'a> AgentRunnerBundles<'a> {
    pub(crate) fn new(resource_directory: &'a Path) -> Self {
        Self { resource_directory }
    }

    fn path(&self, provider: AgentProviderKind) -> PathBuf {
        let name = provider.runner_bundle_name();
        bundled_path(
            self.resource_directory,
            &format!("agent/{name}"),
            &format!("dist-agent/{name}"),
        )
    }
}

pub(crate) fn discover_backend(
    provider: AgentProviderKind,
    runner: Arc<dyn CommandRunner>,
    runners: AgentRunnerBundles<'_>,
) -> Result<AgentBackendHandle, String> {
    match provider {
        AgentProviderKind::Codex => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), codex::CONFIG)
                .map(AgentBackendHandle::Codex)
        }
        AgentProviderKind::Claude => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), claude::CONFIG)
                .map(AgentBackendHandle::Claude)
        }
        AgentProviderKind::Cursor => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), cursor::CONFIG)
                .map(AgentBackendHandle::Cursor)
        }
        AgentProviderKind::Grok => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), grok::CONFIG)
                .map(AgentBackendHandle::Grok)
        }
        AgentProviderKind::Agy => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), agy::CONFIG)
                .map(AgentBackendHandle::Agy)
        }
        AgentProviderKind::Opencode => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), opencode::CONFIG)
                .map(AgentBackendHandle::Opencode)
        }
        AgentProviderKind::Openrouter => {
            sidecar::SidecarBackend::discover(runner, &runners.path(provider), openrouter::CONFIG)
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

pub(crate) fn claude_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(claude::CONFIG, home, execution_path)
}

pub(crate) fn grok_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(grok::CONFIG, home, execution_path)
}

pub(crate) fn cursor_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    sidecar::provider_binary(cursor::CONFIG, home, execution_path)
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
    project_agent::start_auto_hunt_worker_with(
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
    project_agent::run_project_agent_with(
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
    project_agent::summarize_auto_hunt_dispatch_with(
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
        ProjectLlmRequest, ProviderBlock, ProviderBlockReason, BRIAR_SKILL_INSTRUCTION,
        CONVERSATION_NAMESPACES, OPENCODE_UPSTREAMS, PROVIDER_BLOCKED_ERROR_PREFIX,
    };
    use briar_contracts::proto::briar::types::v1 as types_proto;

    #[test]
    fn opencode_upstreams_run_on_the_opencode_runtime() {
        for upstream in OPENCODE_UPSTREAMS {
            assert_eq!(
                upstream.provider.skill_directory(),
                AgentProviderKind::Opencode.skill_directory()
            );
            assert_eq!(
                upstream.provider.runner_bundle_name(),
                AgentProviderKind::Opencode.runner_bundle_name()
            );
            // The generated config names the credential variable so the key
            // itself only ever travels through the child environment.
            assert!(upstream.config_content.contains(&format!(
                "{{env:{}}}",
                upstream.credential_environment_variable
            )));
        }
    }

    #[test]
    fn only_upstream_providers_carry_an_upstream_descriptor() {
        for provider in AgentProviderKind::all() {
            assert_eq!(
                provider.opencode_upstream().is_some(),
                OPENCODE_UPSTREAMS
                    .iter()
                    .any(|upstream| upstream.provider == provider)
            );
        }
        assert!(AgentProviderKind::Opencode.opencode_upstream().is_none());
        assert!(AgentProviderKind::Openrouter.opencode_upstream().is_some());
    }

    #[test]
    fn provider_block_round_trips_through_the_command_error_string() {
        let block = ProviderBlock {
            reason: ProviderBlockReason::UsageExhausted,
            provider: "claude".to_string(),
            message: "Claude AI usage limit reached".to_string(),
            next_retry_at: Some("2026-09-04T12:00:00Z".to_string()),
            status_code: Some(429),
            provider_code: Some("rate_limit".to_string()),
            server_names: Vec::new(),
        };
        let error = block.to_error("Claude Agent 요청이 차단되었습니다");
        assert!(error.starts_with(PROVIDER_BLOCKED_ERROR_PREFIX));
        assert!(error.contains("\"reason\":\"usage_exhausted\""));
        assert_eq!(ProviderBlock::from_error(&error), Some(block.clone()));
        assert_eq!(
            ProviderBlock::from_error("Codex 요청에 실패했습니다: boom"),
            None
        );
        assert_eq!(
            block.describe(),
            "Claude AI usage limit reached (reason=usage_exhausted, provider=claude, nextRetryAt=2026-09-04T12:00:00Z, statusCode=429, providerCode=rate_limit)"
        );
    }

    #[test]
    fn provider_block_reads_every_wire_reason_and_falls_back_to_the_runner_provider() {
        use buffa::Enumeration as _;
        for value in types_proto::ProviderBlockReason::values() {
            let block = ProviderBlock::from_wire(
                AgentProviderKind::Grok,
                types_proto::ProviderBlock {
                    reason: (*value).into(),
                    message: " limit ".to_string(),
                    ..Default::default()
                },
            );
            if *value == types_proto::ProviderBlockReason::PROVIDER_BLOCK_REASON_UNSPECIFIED {
                assert!(block.is_none());
            } else {
                let block = block.expect("known reason maps");
                assert_eq!(block.provider, "grok");
                assert_eq!(block.message, "limit");
                assert_eq!(
                    ProviderBlockReason::from_wire(*value).map(|reason| reason.as_str()),
                    Some(block.reason.as_str())
                );
            }
        }
    }
    #[test]
    fn resolves_the_original_provider_from_a_project_conversation() {
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:codex:project-1:thread-1"),
            Some(AgentProviderKind::Codex)
        );
        // Codex conversations stored before provider namespaces still resolve.
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
            AgentProviderKind::for_conversation_id("project-1", "briar:cursor:project-1:session-1"),
            Some(AgentProviderKind::Cursor)
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
            AgentProviderKind::for_conversation_id(
                "project-1",
                "briar:openrouter:project-1:session-1"
            ),
            Some(AgentProviderKind::Openrouter)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-2", "briar:project-1:thread-1"),
            None
        );
    }

    #[test]
    fn resolves_every_registered_conversation_namespace() {
        for (kind, namespace) in CONVERSATION_NAMESPACES {
            assert_eq!(
                AgentProviderKind::for_conversation_id(
                    "project-1",
                    &format!("briar:{namespace}:project-1:session-1"),
                ),
                Some(*kind),
                "{namespace} 네임스페이스가 provider로 해석되지 않았습니다."
            );
            assert_eq!(kind.conversation_namespace(), Some(*namespace));
        }
    }

    #[test]
    fn rejects_conversation_ids_without_a_session_id() {
        for (_, namespace) in CONVERSATION_NAMESPACES {
            assert_eq!(
                AgentProviderKind::for_conversation_id(
                    "project-1",
                    &format!("briar:{namespace}:project-1:"),
                ),
                None,
                "{namespace} 네임스페이스의 빈 세션 ID가 거절되지 않았습니다."
            );
        }
        // 레거시 Codex 형식도 세션 ID가 비어 있으면 인식하지 않는다.
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:project-1:"),
            None
        );
    }

    #[test]
    fn rejects_conversation_ids_from_another_project() {
        for (_, namespace) in CONVERSATION_NAMESPACES {
            assert_eq!(
                AgentProviderKind::for_conversation_id(
                    "project-1",
                    &format!("briar:{namespace}:project-2:session-1"),
                ),
                None,
                "{namespace} 네임스페이스가 다른 프로젝트의 대화를 받아들였습니다."
            );
        }
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:project-2:thread-1"),
            None
        );
    }

    #[test]
    fn does_not_treat_an_unknown_namespace_as_the_legacy_codex_format() {
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:foo:project-1:session-1"),
            None
        );
        // Codex는 이제 네임스페이스를 쓰지만, 네임스페이스 이전에 저장된 대화 ID도 계속 인식한다.
        assert_eq!(
            AgentProviderKind::Codex.conversation_namespace(),
            Some("codex")
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:project-1:thread-1"),
            Some(AgentProviderKind::Codex)
        );
    }

    #[test]
    fn treats_a_colon_in_the_project_id_as_part_of_the_prefix() {
        // 현재 동작을 그대로 기록해 둔다: 프로젝트 ID에 `:`가 들어 있으면 레거시
        // Codex 접두사(`briar:<project>:`)가 네임스페이스 자리까지 삼킬 수 있다.
        assert_eq!(
            AgentProviderKind::for_conversation_id(
                "claude:project-1",
                "briar:claude:project-1:session-1"
            ),
            Some(AgentProviderKind::Codex)
        );
        // 반대로 네임스페이스가 붙은 대화 ID는 세션 ID에 `:`가 있어도 그대로 해석된다.
        assert_eq!(
            AgentProviderKind::for_conversation_id("project-1", "briar:claude:project-1:session:1"),
            Some(AgentProviderKind::Claude)
        );
        assert_eq!(
            AgentProviderKind::for_conversation_id(
                "claude:project-1",
                "briar:claude:claude:project-1:session-1"
            ),
            Some(AgentProviderKind::Claude)
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

    #[test]
    fn covers_every_wire_provider() {
        use super::types_proto;
        use buffa::Enumeration as _;

        let wire_values = types_proto::AgentProvider::values();
        let providers = AgentProviderKind::all().collect::<Vec<_>>();
        assert_eq!(providers.len(), wire_values.len() - 1);

        for value in wire_values {
            let provider = AgentProviderKind::from_wire(*value);
            if *value == types_proto::AgentProvider::AGENT_PROVIDER_UNSPECIFIED {
                assert_eq!(provider, None);
                continue;
            }
            let provider = provider.unwrap_or_else(|| {
                panic!("{value:?} has no AgentProviderKind");
            });
            assert_eq!(provider.wire(), *value);
            assert!(
                providers.contains(&provider),
                "{value:?} missing from all()"
            );
        }
    }

    #[test]
    fn names_a_runner_bundle_for_every_sidecar_provider() {
        for provider in AgentProviderKind::all() {
            assert!(!provider.display_name().is_empty());
            assert!(!provider.skill_directory().is_empty());
            assert!(
                provider.runner_bundle_name().ends_with("-runner.js"),
                "{provider:?} has no runner bundle"
            );
        }
    }
}
