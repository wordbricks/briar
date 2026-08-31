use briar_contracts::{
    proto::briar::{sidecar::v1 as sidecar_proto, types::v1 as types_proto},
    CONTRACTS_DESCRIPTOR_FINGERPRINT,
};
use buffa::{DecodeOptions, Message};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout},
    sync::{Arc, Mutex},
    thread,
};

const MAX_SIDECAR_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[cfg(test)]
use crate::host::LocalRunner;
use crate::host::{CommandRunner, CommandSpec};

use super::{
    AgentBackend, AgentEvent, AgentEventDirection, AgentEventSink, AgentProviderEvent,
    AgentProviderKind, ApprovalPolicy, BundledRunnerFile, ChatExecution, ProjectLlmRequest,
    ProjectLlmResponse, SandboxMode,
};

#[derive(Clone, Copy)]
pub(super) struct SidecarExecutableConfig {
    pub(super) name: &'static str,
    pub(super) home_candidates: &'static [&'static str],
    pub(super) absolute_candidates: &'static [&'static str],
    pub(super) missing_error: &'static str,
}

#[derive(Clone, Copy)]
pub(super) struct SidecarProviderConfig {
    pub(super) provider: AgentProviderKind,
    pub(super) conversation_namespace: &'static str,
    pub(super) runner_name: &'static str,
    pub(super) request_name: &'static str,
    pub(super) executable: SidecarExecutableConfig,
    pub(super) missing_bun_error: &'static str,
    pub(super) forwards_additional_directories: bool,
    pub(super) empty_session_error: &'static str,
    pub(super) missing_session_error: &'static str,
    pub(super) request_failure_prefix: &'static str,
    pub(super) blocked_prefix: &'static str,
    pub(super) invalid_conversation_error: &'static str,
}

struct SidecarRuntime {
    command_runner: Arc<dyn CommandRunner>,
    bun_binary: String,
    provider_binary: String,
    runner: BundledRunnerFile,
}

impl SidecarRuntime {
    fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
        config: SidecarProviderConfig,
    ) -> Result<Self, String> {
        let bun_binary = command_runner
            .resolve_binary("bun")
            .map_err(|_| config.missing_bun_error.to_string())?;
        let provider_binary = command_runner.resolve_binary(config.executable.name)?;
        let runner = BundledRunnerFile::prepare(runner_bundle)?;
        Ok(Self {
            command_runner,
            bun_binary,
            provider_binary,
            runner,
        })
    }

    #[cfg(test)]
    fn for_test(bun_binary: PathBuf, provider_binary: PathBuf, runner: PathBuf) -> Self {
        let command_runner: Arc<dyn CommandRunner> = Arc::new(LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            std::env::temp_dir(),
        ));
        let runner = BundledRunnerFile::prepare(&runner).expect("runner bundle should exist");
        Self {
            command_runner,
            bun_binary: bun_binary.to_string_lossy().into_owned(),
            provider_binary: provider_binary.to_string_lossy().into_owned(),
            runner,
        }
    }
}

pub(crate) struct SidecarBackend {
    config: SidecarProviderConfig,
    runtime: SidecarRuntime,
}

impl SidecarBackend {
    pub(super) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
        config: SidecarProviderConfig,
    ) -> Result<Self, String> {
        Ok(Self {
            config,
            runtime: SidecarRuntime::discover(command_runner, runner_bundle, config)?,
        })
    }
}

impl AgentBackend for SidecarBackend {
    fn run(
        &self,
        project_id: &str,
        workspace_root: &Path,
        execution: ChatExecution,
        request: ProjectLlmRequest,
        approve: &dyn Fn(&str, &Value) -> bool,
    ) -> Result<ProjectLlmResponse, String> {
        chat(
            &self.runtime,
            self.config,
            project_id,
            workspace_root,
            execution,
            request,
            approve,
        )
    }
}

pub(super) fn provider_binary(
    config: SidecarProviderConfig,
    home: &Path,
    execution_path: &OsStr,
) -> Result<PathBuf, String> {
    if let Ok(path) = which::which_in(config.executable.name, Some(execution_path), home) {
        return Ok(path);
    }
    for candidate in config
        .executable
        .home_candidates
        .iter()
        .map(|candidate| home.join(candidate))
        .chain(
            config
                .executable
                .absolute_candidates
                .iter()
                .map(PathBuf::from),
        )
    {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(config.executable.missing_error.to_string())
}

struct PreparedSidecarChat<'a> {
    message: &'a str,
    workspace_root: PathBuf,
    workspace: String,
    conversation_id: Option<&'a str>,
}

fn prepare_chat<'a>(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    project_id: &str,
    workspace_root: &Path,
    request: &'a ProjectLlmRequest,
) -> Result<PreparedSidecarChat<'a>, String> {
    let message = request.message.trim();
    if message.is_empty() {
        return Err("LLM에 보낼 메시지를 입력하세요.".to_string());
    }
    let workspace_root = runtime
        .command_runner
        .canonicalize(workspace_root)
        .map_err(|error| format!("프로젝트 워크스페이스를 열지 못했습니다: {error}"))?;
    let workspace = workspace_root
        .to_str()
        .ok_or_else(|| "프로젝트 워크스페이스 경로를 표시할 수 없습니다.".to_string())?
        .to_string();
    let conversation_id = request
        .conversation_id
        .as_deref()
        .map(|id| decode_conversation_id(config, project_id, id))
        .transpose()?;
    Ok(PreparedSidecarChat {
        message,
        workspace_root,
        workspace,
        conversation_id,
    })
}

fn proto_approval_policy(policy: ApprovalPolicy) -> sidecar_proto::ApprovalPolicy {
    match policy {
        ApprovalPolicy::Untrusted => sidecar_proto::ApprovalPolicy::Untrusted,
        ApprovalPolicy::OnRequest => sidecar_proto::ApprovalPolicy::OnRequest,
        ApprovalPolicy::Never => sidecar_proto::ApprovalPolicy::Never,
    }
}

fn proto_sandbox_mode(mode: SandboxMode) -> sidecar_proto::SandboxMode {
    match mode {
        SandboxMode::ReadOnly => sidecar_proto::SandboxMode::ReadOnly,
        SandboxMode::WorkspaceWrite => sidecar_proto::SandboxMode::WorkspaceWrite,
        SandboxMode::DangerFullAccess => sidecar_proto::SandboxMode::DangerFullAccess,
    }
}

fn proto_json_schema(value: &Value) -> Result<sidecar_proto::JsonSchema, String> {
    let wrapped = match value {
        Value::Bool(value) => json!({ "boolean": value }),
        Value::Object(_) => json!({ "object": value }),
        _ => return Err("Agent output schema must be an object or boolean.".to_string()),
    };
    serde_json::from_value(wrapped)
        .map_err(|error| format!("Agent output schema를 protobuf로 만들지 못했습니다: {error}"))
}

fn runner_request(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    prepared: &PreparedSidecarChat<'_>,
    execution: &ChatExecution,
    request: &ProjectLlmRequest,
) -> Result<sidecar_proto::ParentToRunner, String> {
    let output_schema = request
        .output_schema
        .as_ref()
        .map(proto_json_schema)
        .transpose()?;
    let run = sidecar_proto::RunRequest {
        message: prepared.message.to_string(),
        workspace_root: prepared.workspace.clone(),
        conversation_id: prepared.conversation_id.map(str::to_string),
        instructions: request.instructions.clone(),
        output_schema: output_schema.into(),
        model: execution.model.clone(),
        effort: execution
            .effort
            .as_ref()
            .map(|effort| effort.as_str().to_string()),
        approval_policy: proto_approval_policy(execution.approval_policy).into(),
        sandbox_mode: proto_sandbox_mode(execution.sandbox_mode).into(),
        network_access: execution.network_access,
        attachments: Vec::new(),
        additional_directories: if config.forwards_additional_directories {
            execution.workspace_write_roots.clone()
        } else {
            Vec::new()
        },
        external_tools: None,
        provider_binary_path: runtime.provider_binary.clone(),
        protocol_fingerprint: CONTRACTS_DESCRIPTOR_FINGERPRINT.to_vec(),
        ..Default::default()
    };
    Ok(sidecar_proto::ParentToRunner {
        payload: Some(sidecar_proto::parent_to_runner::Payload::Run(Box::new(run))),
        ..Default::default()
    })
}

struct SidecarConnection {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
    runner_name: &'static str,
}

impl SidecarConnection {
    fn start(
        runtime: &SidecarRuntime,
        config: SidecarProviderConfig,
        workspace: &Path,
        environment: &[(String, String)],
    ) -> Result<Self, String> {
        let mut spec = CommandSpec::new(&runtime.bun_binary)
            .args([runtime.runner.path()])
            .working_directory(workspace);
        for (key, value) in environment {
            spec = spec.env(key, value);
        }
        let mut child = runtime
            .command_runner
            .spawn_piped(&spec)
            .map_err(|error| format!("{}를 시작하지 못했습니다: {error}", config.runner_name))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{} 입력을 열지 못했습니다.", config.runner_name))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{} 출력을 열지 못했습니다.", config.runner_name))?;
        let mut child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("{} 오류 출력을 열지 못했습니다.", config.runner_name))?;
        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_capture = stderr.clone();
        let stderr_thread = thread::spawn(move || {
            let mut output = String::new();
            let _ = child_stderr.read_to_string(&mut output);
            if let Ok(mut captured) = stderr_capture.lock() {
                *captured = output;
            }
        });
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr,
            stderr_thread: Some(stderr_thread),
            runner_name: config.runner_name,
        })
    }

    fn send(&mut self, message: &sidecar_proto::ParentToRunner) -> Result<(), String> {
        let mut frame = Vec::new();
        message
            .try_encode_length_delimited(&mut frame)
            .map_err(|error| format!("{} 요청이 너무 큽니다: {error}", self.runner_name))?;
        if frame.len() > MAX_SIDECAR_FRAME_BYTES {
            return Err(format!(
                "{} 요청이 최대 protobuf frame 크기를 초과했습니다.",
                self.runner_name
            ));
        }
        self.stdin
            .write_all(&frame)
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("{}에 요청을 보내지 못했습니다: {error}", self.runner_name))
    }

    fn read(&mut self) -> Result<Option<sidecar_proto::RunnerToParent>, String> {
        if self
            .stdout
            .fill_buf()
            .map_err(|error| format!("{} 응답을 읽지 못했습니다: {error}", self.runner_name))?
            .is_empty()
        {
            return Ok(None);
        }
        DecodeOptions::new()
            .with_max_message_size(MAX_SIDECAR_FRAME_BYTES)
            .decode_length_delimited_reader(&mut self.stdout)
            .map(Some)
            .map_err(|error| {
                format!(
                    "{}가 잘못된 protobuf 응답을 보냈습니다: {error}",
                    self.runner_name
                )
            })
    }

    fn exit_error(&mut self) -> String {
        let _ = self.child.wait();
        if let Some(stderr_thread) = self.stderr_thread.take() {
            let _ = stderr_thread.join();
        }
        let stderr = self
            .stderr
            .lock()
            .map(|output| output.trim().to_string())
            .unwrap_or_default();
        if stderr.is_empty() {
            format!(
                "{}가 결과를 반환하지 않고 종료되었습니다.",
                self.runner_name
            )
        } else {
            format!("{}가 종료되었습니다: {stderr}", self.runner_name)
        }
    }
}

impl Drop for SidecarConnection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(stderr_thread) = self.stderr_thread.take() {
            let _ = stderr_thread.join();
        }
    }
}

fn agent_activity_kind(
    kind: buffa::EnumValue<types_proto::AgentActivityKind>,
) -> Result<super::AgentActivityKind, String> {
    match kind.as_known() {
        Some(types_proto::AgentActivityKind::Command) => Ok(super::AgentActivityKind::Command),
        Some(types_proto::AgentActivityKind::FileChange) => {
            Ok(super::AgentActivityKind::FileChange)
        }
        Some(types_proto::AgentActivityKind::WebSearch) => Ok(super::AgentActivityKind::WebSearch),
        Some(types_proto::AgentActivityKind::Tool) => Ok(super::AgentActivityKind::Tool),
        _ => Err("Runner가 알 수 없는 agent activity kind를 보냈습니다.".to_string()),
    }
}

fn agent_activity_status(
    status: buffa::EnumValue<types_proto::AgentActivityStatus>,
) -> Result<super::AgentActivityStatus, String> {
    match status.as_known() {
        Some(types_proto::AgentActivityStatus::Completed) => {
            Ok(super::AgentActivityStatus::Completed)
        }
        Some(types_proto::AgentActivityStatus::Failed) => Ok(super::AgentActivityStatus::Failed),
        Some(types_proto::AgentActivityStatus::Cancelled) => {
            Ok(super::AgentActivityStatus::Cancelled)
        }
        _ => Err("Runner가 알 수 없는 agent activity status를 보냈습니다.".to_string()),
    }
}

fn agent_event(event: types_proto::NormalizedAgentEvent) -> Result<AgentEvent, String> {
    use types_proto::normalized_agent_event::Event;

    match event
        .event
        .ok_or_else(|| "Runner normalized event payload가 비어 있습니다.".to_string())?
    {
        Event::ConversationStarted(value) => Ok(AgentEvent::ConversationStarted {
            conversation_id: value.conversation_id,
        }),
        Event::MessageStarted(value) => Ok(AgentEvent::MessageStarted {
            id: value.id,
            phase: value.phase,
            text: value.text,
        }),
        Event::MessageDelta(value) => Ok(AgentEvent::MessageDelta {
            id: value.id,
            delta: value.delta,
        }),
        Event::MessageCompleted(value) => Ok(AgentEvent::MessageCompleted {
            id: value.id,
            phase: value.phase,
            text: value.text,
        }),
        Event::ActivityStarted(value) => Ok(AgentEvent::ActivityStarted {
            id: value.id,
            kind: agent_activity_kind(value.kind)?,
            title: value.title,
            text: value.text,
        }),
        Event::ActivityDelta(value) => Ok(AgentEvent::ActivityDelta {
            id: value.id,
            delta: value.delta,
        }),
        Event::ActivityCompleted(value) => Ok(AgentEvent::ActivityCompleted {
            id: value.id,
            kind: agent_activity_kind(value.kind)?,
            title: value.title,
            text: value.text,
            status: agent_activity_status(value.status)?,
        }),
        Event::TurnCompleted(value) => Ok(AgentEvent::TurnCompleted {
            status: value.status,
        }),
    }
}

fn event_direction(
    direction: buffa::EnumValue<types_proto::AgentEventDirection>,
) -> Result<AgentEventDirection, String> {
    match direction.as_known() {
        Some(types_proto::AgentEventDirection::Client) => Ok(AgentEventDirection::Client),
        Some(types_proto::AgentEventDirection::Server) => Ok(AgentEventDirection::Server),
        _ => Err("Runner가 알 수 없는 event direction을 보냈습니다.".to_string()),
    }
}

fn block_reason(
    reason: buffa::EnumValue<sidecar_proto::BlockReason>,
) -> Result<&'static str, String> {
    match reason.as_known() {
        Some(sidecar_proto::BlockReason::McpAuthRequired) => Ok("mcp_auth_required"),
        Some(sidecar_proto::BlockReason::UsageExhausted) => Ok("usage_exhausted"),
        Some(sidecar_proto::BlockReason::UpstreamOverloaded) => Ok("upstream_overloaded"),
        Some(sidecar_proto::BlockReason::FreeTierLimit) => Ok("free_tier_limit"),
        _ => Err("Runner가 알 수 없는 block reason을 보냈습니다.".to_string()),
    }
}

struct SidecarChatExecution<'a> {
    environment: &'a [(String, String)],
    event_sink: Option<&'a AgentEventSink>,
}

fn chat(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    project_id: &str,
    workspace_root: &Path,
    execution: ChatExecution,
    request: ProjectLlmRequest,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
    let prepared = prepare_chat(runtime, config, project_id, workspace_root, &request)?;
    let runner_request = runner_request(runtime, config, &prepared, &execution, &request)?;
    run_chat(
        runtime,
        config,
        project_id,
        prepared,
        runner_request,
        SidecarChatExecution {
            environment: &execution.environment,
            event_sink: execution.event_sink.as_ref(),
        },
        approve,
    )
}

fn run_chat(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    project_id: &str,
    prepared: PreparedSidecarChat<'_>,
    runner_request: sidecar_proto::ParentToRunner,
    execution: SidecarChatExecution<'_>,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
    let raw_request = match runner_request.payload.as_ref() {
        Some(sidecar_proto::parent_to_runner::Payload::Run(request)) => {
            serde_json::to_value(request.as_ref()).map_err(|error| {
                format!(
                    "{} 요청을 기록하지 못했습니다: {error}",
                    config.request_name
                )
            })?
        }
        _ => return Err("Sidecar run request payload가 비어 있습니다.".to_string()),
    };
    if let Some(event_sink) = execution.event_sink {
        event_sink(AgentProviderEvent {
            provider: config.provider,
            direction: AgentEventDirection::Client,
            raw: raw_request.clone(),
            event: None,
        })?;
    }

    let mut connection = SidecarConnection::start(
        runtime,
        config,
        &prepared.workspace_root,
        execution.environment,
    )?;
    connection.send(&runner_request)?;
    loop {
        match connection.read()? {
            Some(message) => match message
                .payload
                .ok_or_else(|| format!("{}가 빈 protobuf 응답을 보냈습니다.", config.runner_name))?
            {
                sidecar_proto::runner_to_parent::Payload::SessionStarted(session) => {
                    if session.session_id.trim().is_empty() {
                        return Err(config.empty_session_error.to_string());
                    }
                    if let Some(event_sink) = execution.event_sink {
                        let conversation_id =
                            encode_conversation_id(config, project_id, &session.session_id);
                        event_sink(AgentProviderEvent {
                            provider: config.provider,
                            direction: AgentEventDirection::Server,
                            raw: json!({
                                "type": "conversationStarted",
                                "conversationId": conversation_id.clone(),
                            }),
                            event: Some(AgentEvent::ConversationStarted { conversation_id }),
                        })?;
                    }
                }
                sidecar_proto::runner_to_parent::Payload::Event(event) => {
                    let raw = event
                        .raw
                        .into_option()
                        .map(serde_json::to_value)
                        .transpose()
                        .map_err(|error| {
                            format!("{} event를 읽지 못했습니다: {error}", config.runner_name)
                        })?
                        .unwrap_or(Value::Null);
                    let normalized = event
                        .normalized
                        .into_option()
                        .map(agent_event)
                        .transpose()?;
                    let direction = event_direction(event.direction)?;
                    if let Some(event_sink) = execution.event_sink {
                        event_sink(AgentProviderEvent {
                            provider: config.provider,
                            direction,
                            raw,
                            event: normalized,
                        })?;
                    }
                }
                sidecar_proto::runner_to_parent::Payload::Approval(approval) => {
                    if approval.id.trim().is_empty() {
                        return Err(format!(
                            "{}가 ID 없는 approval을 보냈습니다.",
                            config.runner_name
                        ));
                    }
                    let mut approval_input = approval
                        .input
                        .into_option()
                        .map(serde_json::to_value)
                        .transpose()
                        .map_err(|error| {
                            format!(
                                "{} approval 입력을 읽지 못했습니다: {error}",
                                config.runner_name
                            )
                        })?
                        .unwrap_or_else(|| json!({}));
                    if let Some(title) = approval.title {
                        approval_input["reason"] = Value::String(title);
                    }
                    let approved = approve(&approval.tool_name, &approval_input);
                    connection.send(&sidecar_proto::ParentToRunner {
                        payload: Some(sidecar_proto::parent_to_runner::Payload::ApprovalResponse(
                            Box::new(sidecar_proto::ApprovalResponse {
                                id: approval.id,
                                approved,
                                ..Default::default()
                            }),
                        )),
                        ..Default::default()
                    })?;
                }
                sidecar_proto::runner_to_parent::Payload::Result(result) => {
                    if result.session_id.trim().is_empty() {
                        return Err(config.missing_session_error.to_string());
                    }
                    return Ok(ProjectLlmResponse {
                        conversation_id: encode_conversation_id(
                            config,
                            project_id,
                            &result.session_id,
                        ),
                        message: result.message,
                        workspace_root: prepared.workspace,
                    });
                }
                sidecar_proto::runner_to_parent::Payload::Blocked(blocked) => {
                    let mut details = vec![format!("reason={}", block_reason(blocked.reason)?)];
                    if let Some(provider) = blocked.provider {
                        details.push(format!("provider={provider}"));
                    }
                    if !blocked.server_names.is_empty() {
                        details.push(format!("serverNames={}", blocked.server_names.join(",")));
                    }
                    if let Some(next_retry_at) = blocked.next_retry_at.into_option() {
                        let timestamp = serde_json::to_value(next_retry_at).map_err(|error| {
                            format!(
                                "{} retry timestamp를 읽지 못했습니다: {error}",
                                config.runner_name
                            )
                        })?;
                        if let Some(timestamp) = timestamp.as_str() {
                            details.push(format!("nextRetryAt={timestamp}"));
                        }
                    }
                    if let Some(status_code) = blocked.status_code {
                        details.push(format!("statusCode={status_code}"));
                    }
                    return Err(format!(
                        "{}: {} ({})",
                        config.blocked_prefix,
                        blocked.message,
                        details.join(", ")
                    ));
                }
                sidecar_proto::runner_to_parent::Payload::Error(error) => {
                    let code = error
                        .code
                        .as_known()
                        .map(|code| format!("{code:?}"))
                        .unwrap_or_else(|| format!("unknown({})", error.code.to_i32()));
                    return Err(format!(
                        "{}: {} (code={code})",
                        config.request_failure_prefix, error.message
                    ));
                }
            },
            None => return Err(connection.exit_error()),
        }
    }
}

fn encode_conversation_id(
    config: SidecarProviderConfig,
    project_id: &str,
    session_id: &str,
) -> String {
    format!(
        "briar:{}:{project_id}:{session_id}",
        config.conversation_namespace
    )
}

fn decode_conversation_id<'a>(
    config: SidecarProviderConfig,
    project_id: &str,
    conversation_id: &'a str,
) -> Result<&'a str, String> {
    let prefix = format!("briar:{}:{project_id}:", config.conversation_namespace);
    conversation_id
        .strip_prefix(&prefix)
        .filter(|session_id| !session_id.is_empty())
        .ok_or_else(|| config.invalid_conversation_error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent::{agy, claude, cursor, grok, opencode, ModelEffort},
        host::CommandOutput,
    };
    use std::fs;

    const TEST_CONFIG: SidecarProviderConfig = opencode::CONFIG;

    fn request() -> ProjectLlmRequest {
        ProjectLlmRequest {
            message: "Fix it".to_string(),
            progress_id: None,
            conversation_id: None,
            instructions: None,
            output_schema: None,
        }
    }

    fn execution(event_sink: Option<AgentEventSink>) -> ChatExecution {
        ChatExecution {
            approval_policy: ApprovalPolicy::OnRequest,
            sandbox_mode: SandboxMode::WorkspaceWrite,
            network_access: true,
            model: Some("test-model".to_string()),
            effort: Some(ModelEffort::new("high")),
            event_sink,
            environment: Vec::new(),
            workspace_write_roots: Vec::new(),
        }
    }

    fn provider_configs() -> [SidecarProviderConfig; 5] {
        [
            claude::CONFIG,
            cursor::CONFIG,
            grok::CONFIG,
            agy::CONFIG,
            opencode::CONFIG,
        ]
    }

    #[test]
    fn encodes_the_generated_run_request_and_descriptor_fingerprint() {
        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("runner.js");
        fs::write(&runner, "").expect("runner should be written");
        let runtime = SidecarRuntime::for_test(
            PathBuf::from("/bin/sh"),
            PathBuf::from("/provider/bin"),
            runner,
        );
        let request = ProjectLlmRequest {
            message: " Fix it ".to_string(),
            progress_id: None,
            conversation_id: None,
            instructions: Some("Be careful".to_string()),
            output_schema: Some(json!({"type": "object"})),
        };
        let mut execution = execution(None);
        execution.workspace_write_roots = vec!["/tmp/auto-hunt".to_string()];

        let prepared = prepare_chat(
            &runtime,
            claude::CONFIG,
            "project-1",
            directory.path(),
            &request,
        )
        .expect("chat should prepare");
        let envelope = runner_request(&runtime, claude::CONFIG, &prepared, &execution, &request)
            .expect("request should serialize");
        let run = match envelope.payload {
            Some(sidecar_proto::parent_to_runner::Payload::Run(run)) => run,
            _ => panic!("run payload should exist"),
        };

        assert_eq!(run.message, "Fix it");
        assert_eq!(run.workspace_root, prepared.workspace);
        assert_eq!(run.instructions.as_deref(), Some("Be careful"));
        assert_eq!(run.model.as_deref(), Some("test-model"));
        assert_eq!(run.effort.as_deref(), Some("high"));
        assert_eq!(
            run.approval_policy.as_known(),
            Some(sidecar_proto::ApprovalPolicy::OnRequest)
        );
        assert_eq!(
            run.sandbox_mode.as_known(),
            Some(sidecar_proto::SandboxMode::WorkspaceWrite)
        );
        assert!(run.network_access);
        assert_eq!(run.provider_binary_path, "/provider/bin");
        assert_eq!(run.additional_directories, ["/tmp/auto-hunt"]);
        assert_eq!(run.protocol_fingerprint, CONTRACTS_DESCRIPTOR_FINGERPRINT);
    }

    #[test]
    fn only_claude_forwards_additional_directories() {
        for config in provider_configs() {
            assert_eq!(
                config.forwards_additional_directories,
                config.provider == AgentProviderKind::Claude,
            );
        }
    }

    #[test]
    fn preserves_provider_executable_candidates_in_order() {
        assert_eq!(
            claude::CONFIG.executable.home_candidates,
            [".local/bin/claude", ".bun/bin/claude"]
        );
        assert_eq!(
            grok::CONFIG.executable.home_candidates,
            [".local/bin/grok", ".grok/bin/grok", ".bun/bin/grok"]
        );
        assert_eq!(
            cursor::CONFIG.executable.home_candidates,
            [".local/bin/cursor-agent", ".cursor/bin/cursor-agent"]
        );
        assert_eq!(
            opencode::CONFIG.executable.home_candidates,
            [
                ".opencode/bin/opencode",
                ".local/bin/opencode",
                ".bun/bin/opencode"
            ]
        );
        for config in provider_configs() {
            assert_eq!(
                config.executable.absolute_candidates,
                [
                    format!("/opt/homebrew/bin/{}", config.executable.name),
                    format!("/usr/local/bin/{}", config.executable.name),
                ]
            );
        }
    }

    #[test]
    fn preserves_provider_specific_error_text() {
        assert_eq!(
            claude::CONFIG.executable.missing_error,
            "Claude Code가 필요합니다. Claude를 설치하고 `claude auth login`을 실행한 뒤 다시 시도하세요."
        );
        assert_eq!(
            claude::CONFIG.missing_bun_error,
            "Claude Agent SDK 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다."
        );
        assert_eq!(
            grok::CONFIG.executable.missing_error,
            "Grok CLI가 필요합니다. Grok을 설치하고 `grok login`을 실행한 뒤 다시 시도하세요."
        );
        assert_eq!(
            grok::CONFIG.missing_bun_error,
            "Grok runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다."
        );
        assert_eq!(
            cursor::CONFIG.executable.missing_error,
            "Cursor CLI가 필요합니다. Cursor CLI를 설치하고 `agent login`을 실행한 뒤 다시 시도하세요."
        );
        assert_eq!(
            cursor::CONFIG.missing_bun_error,
            "Cursor Agent runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다."
        );
        assert_eq!(
            agy::CONFIG.executable.missing_error,
            "Google Antigravity CLI가 필요합니다. `agy`를 설치하고 로그인한 뒤 다시 시도하세요."
        );
        assert_eq!(
            agy::CONFIG.missing_bun_error,
            "Antigravity runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다."
        );
        assert_eq!(
            opencode::CONFIG.executable.missing_error,
            "OpenCode CLI가 필요합니다. OpenCode를 설치하고 `opencode auth login`을 실행한 뒤 다시 시도하세요."
        );
        assert_eq!(
            opencode::CONFIG.missing_bun_error,
            "OpenCode runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다."
        );
    }

    #[test]
    fn resolves_the_first_existing_provider_candidate() {
        for config in provider_configs() {
            let directory = tempfile::tempdir().expect("temp directory should exist");
            let home = directory.path();
            let first = home.join(config.executable.home_candidates[0]);
            let second = home.join(config.executable.home_candidates[1]);
            fs::create_dir_all(first.parent().expect("candidate should have a parent"))
                .expect("candidate directory should exist");
            fs::create_dir_all(second.parent().expect("candidate should have a parent"))
                .expect("candidate directory should exist");
            fs::write(&first, "first").expect("first candidate should exist");
            fs::write(&second, "second").expect("second candidate should exist");

            assert_eq!(provider_binary(config, home, OsStr::new("")), Ok(first));
        }
    }

    #[cfg(unix)]
    #[test]
    fn prefers_an_executable_on_path_over_provider_candidates() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp directory should exist");
        let path_directory = directory.path().join("path");
        let home = directory.path().join("home");
        fs::create_dir_all(&path_directory).expect("path directory should exist");
        let path_binary = path_directory.join("claude");
        fs::write(&path_binary, "#!/bin/sh\n").expect("path binary should exist");
        fs::set_permissions(&path_binary, fs::Permissions::from_mode(0o700))
            .expect("path binary should be executable");
        let fallback = home.join(".local/bin/claude");
        fs::create_dir_all(fallback.parent().expect("fallback should have a parent"))
            .expect("fallback directory should exist");
        fs::write(&fallback, "fallback").expect("fallback should exist");
        let execution_path = std::env::join_paths([&path_directory]).expect("valid path");

        assert_eq!(
            provider_binary(claude::CONFIG, &home, &execution_path),
            Ok(path_binary)
        );
    }

    struct RecordingRunner {
        resolutions: Arc<Mutex<Vec<String>>>,
        fail_bun: bool,
    }

    impl CommandRunner for RecordingRunner {
        fn resolve_binary(&self, tool: &str) -> Result<String, String> {
            self.resolutions
                .lock()
                .expect("resolutions should lock")
                .push(tool.to_string());
            if self.fail_bun && tool == "bun" {
                Err("missing bun".to_string())
            } else {
                Ok(format!("/resolved/{tool}"))
            }
        }

        fn run(&self, _spec: &CommandSpec) -> Result<CommandOutput, String> {
            panic!("run is not used during discovery")
        }

        fn spawn_piped(&self, _spec: &CommandSpec) -> Result<Child, String> {
            panic!("spawn is not used during discovery")
        }

        fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
            Ok(path.to_path_buf())
        }
    }

    #[test]
    fn discovers_each_runtime_from_its_provider_config() {
        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner_bundle = directory.path().join("runner.js");
        fs::write(&runner_bundle, "").expect("runner should be written");

        for config in provider_configs() {
            let resolutions = Arc::new(Mutex::new(Vec::new()));
            let command_runner: Arc<dyn CommandRunner> = Arc::new(RecordingRunner {
                resolutions: resolutions.clone(),
                fail_bun: false,
            });
            let runtime = SidecarRuntime::discover(command_runner, &runner_bundle, config)
                .expect("runtime should discover");

            assert_eq!(runtime.bun_binary, "/resolved/bun");
            assert_eq!(
                runtime.provider_binary,
                format!("/resolved/{}", config.executable.name)
            );
            assert_eq!(
                *resolutions.lock().expect("resolutions should lock"),
                ["bun", config.executable.name]
            );
        }
    }

    #[test]
    fn reports_each_provider_specific_missing_bun_error() {
        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner_bundle = directory.path().join("runner.js");
        fs::write(&runner_bundle, "").expect("runner should be written");

        for config in provider_configs() {
            let command_runner: Arc<dyn CommandRunner> = Arc::new(RecordingRunner {
                resolutions: Arc::new(Mutex::new(Vec::new())),
                fail_bun: true,
            });
            let error = match SidecarRuntime::discover(command_runner, &runner_bundle, config) {
                Ok(_) => panic!("missing bun should fail discovery"),
                Err(error) => error,
            };
            assert_eq!(error, config.missing_bun_error);
        }
    }

    #[test]
    fn runs_the_shared_sidecar_and_maps_events_and_approvals() {
        let app_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Tauri crate should be inside the Briar app");
        let directory = tempfile::Builder::new()
            .prefix(".sidecar-protobuf-test-")
            .tempdir_in(app_root)
            .expect("temp directory should exist");
        let runner = directory.path().join("fake-runner.ts");
        fs::write(
            &runner,
            r#"import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import { ParentToRunnerSchema } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentEventDirection } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { normalizedMessageCompleted } from "../src-agent/normalized-agent-event";
import {
  decodeSidecarRunRequest,
  encodeSidecarRunnerOutput,
  sidecarApprovalRequest,
  sidecarProviderEvent,
  sidecarRunResult,
  sidecarSessionStarted,
} from "../src-agent/sidecar-protocol";

let runReceived = false;
for await (const message of sizeDelimitedDecodeStream(
  ParentToRunnerSchema,
  process.stdin,
  { readMaxBytes: 16 * 1024 * 1024 },
)) {
  if (!runReceived) {
    const request = decodeSidecarRunRequest(message);
    if (request.providerBinaryPath !== "/usr/bin/true") {
      throw new Error(`unexpected provider binary: ${request.providerBinaryPath}`);
    }
    runReceived = true;
    process.stdout.write(encodeSidecarRunnerOutput(
      sidecarSessionStarted("session-1"),
    ));
    process.stdout.write(encodeSidecarRunnerOutput(sidecarProviderEvent({
      direction: AgentEventDirection.SERVER,
      raw: { type: "assistant" },
      event: normalizedMessageCompleted({
        id: "message-1",
        phase: "commentary",
        text: "working",
      }),
    })));
    process.stdout.write(encodeSidecarRunnerOutput(sidecarApprovalRequest({
      id: "approval-1",
      toolName: "Bash",
      input: { command: "bun test" },
      title: "Run tests",
    })));
    continue;
  }
  if (
    message.payload.case !== "approvalResponse" ||
    message.payload.value.id !== "approval-1" ||
    !message.payload.value.approved
  ) {
    throw new Error("expected an approved response");
  }
  process.stdout.write(encodeSidecarRunnerOutput(sidecarRunResult({
    sessionId: "session-1",
    message: "done",
  })));
  break;
}
"#,
        )
        .expect("runner should be written");
        let runtime = SidecarRuntime::for_test(
            which::which("bun").expect("Bun should be installed for the cross-language test"),
            PathBuf::from("/usr/bin/true"),
            runner,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = events.clone();
        let execution = execution(Some(Arc::new(move |event| {
            captured_events
                .lock()
                .expect("events should lock")
                .push(event);
            Ok(())
        })));
        let response = chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            directory.path(),
            execution,
            request(),
            &|method, input| {
                method == "Bash" && input["command"] == "bun test" && input["reason"] == "Run tests"
            },
        )
        .expect("sidecar should complete");

        assert_eq!(
            response.conversation_id,
            "briar:opencode:project-1:session-1"
        );
        assert_eq!(response.message, "done");
        let events = events.lock().expect("events should lock");
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].provider, AgentProviderKind::Opencode);
        assert_eq!(events[0].raw["effort"], "high");
        assert_eq!(events[0].raw["providerBinaryPath"], "/usr/bin/true");
        assert!(events[0].raw.get("additionalDirectories").is_none());
        assert!(matches!(
            events[1].event,
            Some(AgentEvent::ConversationStarted { ref conversation_id })
                if conversation_id == "briar:opencode:project-1:session-1"
        ));
        assert!(matches!(
            events[2].event,
            Some(AgentEvent::MessageCompleted { .. })
        ));
    }

    #[test]
    fn scopes_conversation_ids_to_the_provider_and_project() {
        for config in provider_configs() {
            let conversation_id = format!(
                "briar:{}:project-1:session-1",
                config.conversation_namespace
            );
            assert_eq!(
                decode_conversation_id(config, "project-1", &conversation_id),
                Ok("session-1")
            );
            assert!(decode_conversation_id(config, "project-2", &conversation_id).is_err());
            assert!(
                decode_conversation_id(config, "project-1", "briar:codex:project-1:thread-1")
                    .is_err()
            );
        }
    }
}
