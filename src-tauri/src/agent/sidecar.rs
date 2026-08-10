use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
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
    AgentEvent, AgentEventDirection, AgentEventSink, AgentProviderEvent, AgentProviderKind,
    BundledRunnerFile, ProjectLlmRequest, ProjectLlmResponse,
};

#[derive(Clone, Copy)]
pub(super) struct SidecarProviderConfig {
    pub(super) provider: AgentProviderKind,
    pub(super) conversation_namespace: &'static str,
    pub(super) runner_name: &'static str,
    pub(super) request_name: &'static str,
    pub(super) empty_session_error: &'static str,
    pub(super) missing_session_error: &'static str,
    pub(super) request_failure_prefix: &'static str,
    pub(super) blocked_prefix: &'static str,
    pub(super) invalid_conversation_error: &'static str,
}

pub(super) struct SidecarRuntime {
    command_runner: Arc<dyn CommandRunner>,
    bun_binary: String,
    provider_binary: String,
    runner: BundledRunnerFile,
}

impl SidecarRuntime {
    pub(super) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
        provider_binary_name: &str,
        missing_bun_error: &str,
    ) -> Result<Self, String> {
        let bun_binary = command_runner
            .resolve_binary("bun")
            .map_err(|_| missing_bun_error.to_string())?;
        let provider_binary = command_runner.resolve_binary(provider_binary_name)?;
        let runner = BundledRunnerFile::prepare(runner_bundle)?;
        Ok(Self {
            command_runner,
            bun_binary,
            provider_binary,
            runner,
        })
    }

    pub(super) fn provider_binary(&self) -> &str {
        &self.provider_binary
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

pub(super) struct PreparedSidecarChat<'a> {
    pub(super) message: &'a str,
    pub(super) workspace_root: PathBuf,
    pub(super) workspace: String,
    pub(super) conversation_id: Option<&'a str>,
}

pub(super) fn prepare_chat<'a>(
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

pub(super) fn serialize_request(
    config: SidecarProviderConfig,
    request: &impl Serialize,
) -> Result<Value, String> {
    serde_json::to_value(request)
        .map_err(|error| format!("{} 요청을 만들지 못했습니다: {error}", config.request_name))
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

pub(super) struct SidecarChatExecution<'a> {
    pub(super) environment: &'a [(String, String)],
    pub(super) event_sink: Option<&'a AgentEventSink>,
}

pub(super) fn run_chat(
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
    use crate::agent::{ApprovalPolicy, ChatExecution, ModelEffort, SandboxMode};
    use std::fs;

    const TEST_CONFIG: SidecarProviderConfig = SidecarProviderConfig {
        provider: AgentProviderKind::Opencode,
        conversation_namespace: "opencode",
        runner_name: "OpenCode runner",
        request_name: "OpenCode",
        empty_session_error: "OpenCode가 빈 대화 ID를 반환했습니다.",
        missing_session_error: "OpenCode가 대화 ID를 반환하지 않았습니다.",
        request_failure_prefix: "OpenCode 요청에 실패했습니다",
        blocked_prefix: "OpenCode 요청이 차단되었습니다",
        invalid_conversation_error:
            "이 OpenCode 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.",
    };

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
            effort: Some(ModelEffort::High),
            event_sink,
            environment: Vec::new(),
            workspace_write_roots: Vec::new(),
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
        let request = request();
        let execution = execution(Some(Arc::new(move |event| {
            captured_events
                .lock()
                .expect("events should lock")
                .push(event);
            Ok(())
        })));
        let prepared = prepare_chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            directory.path(),
            &request,
        )
        .expect("chat should prepare");
        let response = run_chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            prepared,
            json!({"type": "run", "effort": "high"}),
            SidecarChatExecution {
                environment: &execution.environment,
                event_sink: execution.event_sink.as_ref(),
            },
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
        let request = request();
        let execution = execution(None);
        let prepared = prepare_chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            directory.path(),
            &request,
        )
        .expect("chat should prepare");
        let error = run_chat(
            &runtime,
            TEST_CONFIG,
            "project-1",
            prepared,
            json!({"type": "run"}),
            SidecarChatExecution {
                environment: &execution.environment,
                event_sink: None,
            },
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
        assert_eq!(
            decode_conversation_id(
                TEST_CONFIG,
                "project-1",
                "briar:opencode:project-1:session-1"
            ),
            Ok("session-1")
        );
        assert!(decode_conversation_id(
            TEST_CONFIG,
            "project-2",
            "briar:opencode:project-1:session-1"
        )
        .is_err());
        assert!(
            decode_conversation_id(TEST_CONFIG, "project-1", "briar:project-1:thread-1").is_err()
        );
    }
}
