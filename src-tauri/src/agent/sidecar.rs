use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout},
    sync::{Arc, Mutex},
    thread,
};

#[cfg(test)]
use crate::host::LocalRunner;
use crate::host::{CommandRunner, CommandSpec};

use super::{
    AgentBackend, AgentEvent, AgentEventDirection, AgentEventSink, AgentProviderEvent,
    AgentProviderKind, ApprovalPolicy, BundledRunnerFile, ChatExecution, ModelEffort,
    ProjectLlmRequest, ProjectLlmResponse, SandboxMode,
};

#[derive(Clone, Copy)]
pub(super) struct SidecarExecutableConfig {
    pub(super) name: &'static str,
    pub(super) request_key: &'static str,
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

fn serialize_request(
    config: SidecarProviderConfig,
    request: &impl Serialize,
) -> Result<Value, String> {
    serde_json::to_value(request)
        .map_err(|error| format!("{} 요청을 만들지 못했습니다: {error}", config.request_name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRunnerRequest<'a> {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    additional_directories: Option<&'a [String]>,
}

fn runner_request(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    prepared: &PreparedSidecarChat<'_>,
    execution: &ChatExecution,
    request: &ProjectLlmRequest,
) -> Result<Value, String> {
    let runner_request = SidecarRunnerRequest {
        r#type: "run",
        message: prepared.message,
        workspace_root: &prepared.workspace,
        conversation_id: prepared.conversation_id,
        instructions: request.instructions.as_deref(),
        output_schema: request.output_schema.as_ref(),
        model: execution.model.as_deref(),
        effort: execution.effort.clone(),
        approval_policy: execution.approval_policy,
        sandbox_mode: execution.sandbox_mode,
        network_access: execution.network_access,
        additional_directories: config
            .forwards_additional_directories
            .then_some(execution.workspace_write_roots.as_slice()),
    };
    let mut raw_request = serialize_request(config, &runner_request)?;
    raw_request
        .as_object_mut()
        .expect("sidecar runner request should serialize as an object")
        .insert(
            config.executable.request_key.to_string(),
            Value::String(runtime.provider_binary.clone()),
        );
    Ok(raw_request)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SidecarRunnerMessage {
    Session {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Event {
        raw: Value,
        event: Option<AgentEvent>,
    },
    Approval {
        id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: Value,
        title: Option<String>,
    },
    Result {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
    },
    Blocked {
        reason: String,
        message: String,
        provider: Option<String>,
        #[serde(rename = "nextRetryAt")]
        next_retry_at: Option<String>,
        #[serde(rename = "statusCode")]
        status_code: Option<u16>,
    },
    Error {
        message: String,
    },
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

    fn send(&mut self, message: &Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, message)
            .map_err(|error| format!("{} 요청을 만들지 못했습니다: {error}", self.runner_name))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("{}에 요청을 보내지 못했습니다: {error}", self.runner_name))
    }

    fn read(&mut self) -> Result<Option<SidecarRunnerMessage>, String> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("{} 응답을 읽지 못했습니다: {error}", self.runner_name))?;
        if bytes == 0 {
            return Ok(None);
        }
        serde_json::from_str(&line)
            .map(Some)
            .map_err(|error| format!("{}가 잘못된 응답을 보냈습니다: {error}", self.runner_name))
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
    let raw_request = runner_request(runtime, config, &prepared, &execution, &request)?;
    run_chat(
        runtime,
        config,
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

fn run_chat(
    runtime: &SidecarRuntime,
    config: SidecarProviderConfig,
    project_id: &str,
    prepared: PreparedSidecarChat<'_>,
    raw_request: Value,
    execution: SidecarChatExecution<'_>,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
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
    connection.send(&raw_request)?;
    loop {
        match connection.read()? {
            Some(SidecarRunnerMessage::Session { session_id }) => {
                if session_id.trim().is_empty() {
                    return Err(config.empty_session_error.to_string());
                }
                if let Some(event_sink) = execution.event_sink {
                    let conversation_id = encode_conversation_id(config, project_id, &session_id);
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
            Some(SidecarRunnerMessage::Event { raw, event }) => {
                if let Some(event_sink) = execution.event_sink {
                    event_sink(AgentProviderEvent {
                        provider: config.provider,
                        direction: AgentEventDirection::Server,
                        raw,
                        event,
                    })?;
                }
            }
            Some(SidecarRunnerMessage::Approval {
                id,
                tool_name,
                input,
                title,
            }) => {
                let mut approval_input = input;
                if let Some(title) = title {
                    approval_input["reason"] = Value::String(title);
                }
                let approved = approve(&tool_name, &approval_input);
                connection.send(&json!({
                    "type": "approvalResponse",
                    "id": id,
                    "approved": approved
                }))?;
            }
            Some(SidecarRunnerMessage::Result {
                session_id,
                message,
            }) => {
                if session_id.trim().is_empty() {
                    return Err(config.missing_session_error.to_string());
                }
                return Ok(ProjectLlmResponse {
                    conversation_id: encode_conversation_id(config, project_id, &session_id),
                    message,
                    workspace_root: prepared.workspace,
                });
            }
            Some(SidecarRunnerMessage::Blocked {
                reason,
                message,
                provider,
                next_retry_at,
                status_code,
            }) => {
                let mut details = vec![format!("reason={reason}")];
                if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) {
                    details.push(format!("provider={provider}"));
                }
                if let Some(next_retry_at) = next_retry_at.filter(|value| !value.trim().is_empty())
                {
                    details.push(format!("nextRetryAt={next_retry_at}"));
                }
                if let Some(status_code) = status_code {
                    details.push(format!("statusCode={status_code}"));
                }
                return Err(format!(
                    "{}: {message} ({})",
                    config.blocked_prefix,
                    details.join(", ")
                ));
            }
            Some(SidecarRunnerMessage::Error { message }) => {
                return Err(format!("{}: {message}", config.request_failure_prefix));
            }
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
        agent::{claude, grok, opencode},
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

    fn provider_configs() -> [SidecarProviderConfig; 3] {
        [claude::CONFIG, grok::CONFIG, opencode::CONFIG]
    }

    #[test]
    fn serializes_each_provider_request_contract() {
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

        for config in provider_configs() {
            let prepared = prepare_chat(&runtime, config, "project-1", directory.path(), &request)
                .expect("chat should prepare");
            let raw = runner_request(&runtime, config, &prepared, &execution, &request)
                .expect("request should serialize");

            assert_eq!(raw["type"], "run");
            assert_eq!(raw["message"], "Fix it");
            assert_eq!(raw["workspaceRoot"], prepared.workspace);
            assert!(raw["conversationId"].is_null());
            assert_eq!(raw["instructions"], "Be careful");
            assert_eq!(raw["outputSchema"], json!({"type": "object"}));
            assert_eq!(raw["model"], "test-model");
            assert_eq!(raw["effort"], "high");
            assert_eq!(raw["approvalPolicy"], "on-request");
            assert_eq!(raw["sandboxMode"], "workspaceWrite");
            assert_eq!(raw["networkAccess"], true);
            assert_eq!(raw[config.executable.request_key], "/provider/bin");

            for key in ["claudeBinary", "grokBinary", "opencodeBinary"] {
                assert_eq!(
                    raw.get(key).is_some(),
                    key == config.executable.request_key,
                    "unexpected executable key for {}",
                    config.executable.name
                );
            }
            if config.forwards_additional_directories {
                assert_eq!(raw["additionalDirectories"], json!(["/tmp/auto-hunt"]));
            } else {
                assert!(raw.get("additionalDirectories").is_none());
            }
        }
    }

    #[test]
    fn keeps_empty_additional_directories_for_claude_only() {
        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("runner.js");
        fs::write(&runner, "").expect("runner should be written");
        let runtime = SidecarRuntime::for_test(
            PathBuf::from("/bin/sh"),
            PathBuf::from("/provider/bin"),
            runner,
        );
        let request = request();
        let execution = execution(None);

        for config in provider_configs() {
            let prepared = prepare_chat(&runtime, config, "project-1", directory.path(), &request)
                .expect("chat should prepare");
            let raw = runner_request(&runtime, config, &prepared, &execution, &request)
                .expect("request should serialize");
            if config.provider == AgentProviderKind::Claude {
                assert_eq!(raw["additionalDirectories"], json!([]));
            } else {
                assert!(raw.get("additionalDirectories").is_none());
            }
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

    #[cfg(unix)]
    #[test]
    fn runs_the_shared_sidecar_and_maps_events_and_approvals() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("fake-runner.sh");
        fs::write(
            &runner,
            r#"#!/bin/sh
read request
echo '{"type":"session","sessionId":"session-1"}'
echo '{"type":"event","raw":{"type":"assistant"},"event":{"type":"messageCompleted","id":"message-1","phase":"commentary","text":"working"}}'
echo '{"type":"approval","id":"1","toolName":"Bash","input":{"command":"bun test"},"title":"Run tests"}'
read approval
echo '{"type":"result","sessionId":"session-1","message":"done"}'
"#,
        )
        .expect("runner should be written");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700))
            .expect("runner should be executable");
        let runtime = SidecarRuntime::for_test(
            PathBuf::from("/bin/sh"),
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
        assert_eq!(events[0].raw["opencodeBinary"], "/usr/bin/true");
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

    #[cfg(unix)]
    #[test]
    fn reports_blocked_output_without_treating_it_as_malformed_json() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("blocked-runner.sh");
        fs::write(
            &runner,
            r#"#!/bin/sh
read request
echo '{"type":"blocked","reason":"free_tier_limit","provider":"opencode","message":"Subscribe to continue.","nextRetryAt":"2026-08-11T00:00:00Z"}'
"#,
        )
        .expect("runner should be written");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700))
            .expect("runner should be executable");
        let runtime = SidecarRuntime::for_test(
            PathBuf::from("/bin/sh"),
            PathBuf::from("/usr/bin/true"),
            runner,
        );
        let execution = execution(None);
        let error = chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            directory.path(),
            execution,
            request(),
            &|_, _| false,
        )
        .expect_err("blocked sidecar output should stop the request");

        assert!(error.contains("OpenCode 요청이 차단되었습니다"));
        assert!(error.contains("reason=free_tier_limit"));
        assert!(error.contains("nextRetryAt=2026-08-11T00:00:00Z"));
        assert!(!error.contains("잘못된 응답"));
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
