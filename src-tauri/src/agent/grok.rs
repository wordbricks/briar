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
    AgentEvent, AgentEventDirection, AgentProviderEvent, AgentProviderKind, ApprovalPolicy,
    BundledRunnerFile, ChatExecution, ModelEffort, ProjectLlmRequest, ProjectLlmResponse,
    SandboxMode,
};

pub(crate) struct GrokRuntime {
    command_runner: Arc<dyn CommandRunner>,
    bun_binary: String,
    grok_binary: String,
    runner: BundledRunnerFile,
}

impl GrokRuntime {
    pub(crate) fn discover(
        command_runner: Arc<dyn CommandRunner>,
        runner_bundle: &Path,
    ) -> Result<Self, String> {
        let bun_binary = command_runner.resolve_binary("bun").map_err(|_| {
            "Grok runner 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.".to_string()
        })?;
        let grok_binary = command_runner.resolve_binary("grok")?;
        let runner = BundledRunnerFile::prepare(runner_bundle)?;
        Ok(Self {
            command_runner,
            bun_binary,
            grok_binary,
            runner,
        })
    }

    #[cfg(test)]
    fn for_test(bun_binary: PathBuf, grok_binary: PathBuf, runner: PathBuf) -> Self {
        let command_runner: Arc<dyn CommandRunner> = Arc::new(LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            std::env::temp_dir(),
        ));
        let runner = BundledRunnerFile::prepare(&runner).unwrap();
        Self {
            command_runner,
            bun_binary: bun_binary.to_string_lossy().into_owned(),
            grok_binary: grok_binary.to_string_lossy().into_owned(),
            runner,
        }
    }
}

pub(crate) fn grok_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    if let Ok(path) = which::which_in("grok", Some(execution_path), home) {
        return Ok(path);
    }
    for candidate in [
        home.join(".local/bin/grok"),
        home.join(".grok/bin/grok"),
        home.join(".bun/bin/grok"),
        PathBuf::from("/opt/homebrew/bin/grok"),
        PathBuf::from("/usr/local/bin/grok"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(
        "Grok CLI가 필요합니다. Grok을 설치하고 `grok login`을 실행한 뒤 다시 시도하세요."
            .to_string(),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrokRunnerRequest<'a> {
    r#type: &'static str,
    message: &'a str,
    workspace_root: &'a str,
    conversation_id: Option<&'a str>,
    instructions: Option<&'a str>,
    output_schema: Option<Value>,
    model: Option<&'a str>,
    effort: Option<ModelEffort>,
    approval_policy: ApprovalPolicy,
    sandbox_mode: SandboxMode,
    network_access: bool,
    grok_binary: &'a str,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum GrokRunnerMessage {
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
    Error {
        message: String,
    },
}

struct GrokConnection {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl GrokConnection {
    fn start(
        runtime: &GrokRuntime,
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
            .map_err(|error| format!("Grok Agent runner를 시작하지 못했습니다: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Grok Agent runner 입력을 열지 못했습니다.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Grok Agent runner 출력을 열지 못했습니다.".to_string())?;
        let mut child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Grok Agent runner 오류 출력을 열지 못했습니다.".to_string())?;
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
        })
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, message)
            .map_err(|error| format!("Grok Agent runner 요청을 만들지 못했습니다: {error}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Grok Agent runner에 요청을 보내지 못했습니다: {error}"))
    }

    fn read(&mut self) -> Result<Option<GrokRunnerMessage>, String> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Grok Agent runner 응답을 읽지 못했습니다: {error}"))?;
        if bytes == 0 {
            return Ok(None);
        }
        serde_json::from_str(&line)
            .map(Some)
            .map_err(|error| format!("Grok Agent runner가 잘못된 응답을 보냈습니다: {error}"))
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
            "Grok Agent runner가 결과를 반환하지 않고 종료되었습니다.".to_string()
        } else {
            format!("Grok Agent runner가 종료되었습니다: {stderr}")
        }
    }
}

impl Drop for GrokConnection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(stderr_thread) = self.stderr_thread.take() {
            let _ = stderr_thread.join();
        }
    }
}

pub(crate) fn chat(
    runtime: &GrokRuntime,
    project_id: &str,
    workspace_root: &Path,
    execution: ChatExecution,
    request: ProjectLlmRequest,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
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
        .ok_or_else(|| "프로젝트 워크스페이스 경로를 표시할 수 없습니다.".to_string())?;
    let conversation_id = request
        .conversation_id
        .as_deref()
        .map(|id| decode_conversation_id(project_id, id))
        .transpose()?;
    let runner_request = GrokRunnerRequest {
        r#type: "run",
        message,
        workspace_root: workspace,
        conversation_id,
        instructions: request.instructions.as_deref(),
        output_schema: request.output_schema,
        model: execution.model.as_deref(),
        effort: execution.effort,
        approval_policy: execution.approval_policy,
        sandbox_mode: execution.sandbox_mode,
        network_access: execution.network_access,
        grok_binary: &runtime.grok_binary,
    };
    let raw_request = serde_json::to_value(&runner_request)
        .map_err(|error| format!("Grok Agent 요청을 만들지 못했습니다: {error}"))?;
    if let Some(event_sink) = execution.event_sink.as_ref() {
        event_sink(AgentProviderEvent {
            provider: AgentProviderKind::Grok,
            direction: AgentEventDirection::Client,
            raw: raw_request.clone(),
            event: None,
        })?;
    }

    let mut connection = GrokConnection::start(runtime, &workspace_root, &execution.environment)?;
    connection.send(&raw_request)?;
    loop {
        match connection.read()? {
            Some(GrokRunnerMessage::Session { session_id }) => {
                if session_id.trim().is_empty() {
                    return Err("Grok Agent가 빈 대화 ID를 반환했습니다.".to_string());
                }
                if let Some(event_sink) = execution.event_sink.as_ref() {
                    let conversation_id = encode_conversation_id(project_id, &session_id);
                    event_sink(AgentProviderEvent {
                        provider: AgentProviderKind::Grok,
                        direction: AgentEventDirection::Server,
                        raw: json!({
                            "type": "conversationStarted",
                            "conversationId": conversation_id.clone(),
                        }),
                        event: Some(AgentEvent::ConversationStarted { conversation_id }),
                    })?;
                }
            }
            Some(GrokRunnerMessage::Event { raw, event }) => {
                if let Some(event_sink) = execution.event_sink.as_ref() {
                    event_sink(AgentProviderEvent {
                        provider: AgentProviderKind::Grok,
                        direction: AgentEventDirection::Server,
                        raw,
                        event,
                    })?;
                }
            }
            Some(GrokRunnerMessage::Approval {
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
            Some(GrokRunnerMessage::Result {
                session_id,
                message,
            }) => {
                if session_id.trim().is_empty() {
                    return Err("Grok Agent가 대화 ID를 반환하지 않았습니다.".to_string());
                }
                return Ok(ProjectLlmResponse {
                    conversation_id: encode_conversation_id(project_id, &session_id),
                    message,
                    workspace_root: workspace.to_string(),
                });
            }
            Some(GrokRunnerMessage::Error { message }) => {
                return Err(format!("Grok Agent 요청에 실패했습니다: {message}"));
            }
            None => return Err(connection.exit_error()),
        }
    }
}

fn encode_conversation_id(project_id: &str, session_id: &str) -> String {
    format!("briar:grok:{project_id}:{session_id}")
}

fn decode_conversation_id<'a>(
    project_id: &str,
    conversation_id: &'a str,
) -> Result<&'a str, String> {
    let prefix = format!("briar:grok:{project_id}:");
    conversation_id
        .strip_prefix(&prefix)
        .filter(|session_id| !session_id.is_empty())
        .ok_or_else(|| {
            "이 Grok 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다.".to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    #[test]
    fn runs_the_grok_runner_and_maps_events_and_approvals() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("fake-runner.sh");
        fs::write(
            &runner,
            r#"#!/bin/sh
read request
echo '{"type":"session","sessionId":"session-1"}'
echo '{"type":"event","raw":{"type":"assistant"},"event":{"type":"messageCompleted","id":"message-1","phase":"commentary","text":"working"}}'
echo '{"type":"approval","id":"1","toolName":"bash","input":{"command":"bun test"},"title":"Run tests"}'
read approval
echo '{"type":"result","sessionId":"session-1","message":"done"}'
"#,
        )
        .expect("runner should be written");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700))
            .expect("runner should be executable");
        let runtime = GrokRuntime::for_test(
            PathBuf::from("/bin/sh"),
            PathBuf::from("/usr/bin/true"),
            runner,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = events.clone();
        let response = chat(
            &runtime,
            "project-1",
            directory.path(),
            ChatExecution {
                approval_policy: ApprovalPolicy::OnRequest,
                sandbox_mode: SandboxMode::WorkspaceWrite,
                network_access: true,
                model: Some("grok-4.5".to_string()),
                effort: Some(ModelEffort::High),
                event_sink: Some(Arc::new(move |event| {
                    captured_events
                        .lock()
                        .expect("events should lock")
                        .push(event);
                    Ok(())
                })),
                environment: Vec::new(),
                workspace_write_roots: Vec::new(),
            },
            ProjectLlmRequest {
                message: "hello".to_string(),
                progress_id: None,
                conversation_id: None,
                instructions: None,
                output_schema: None,
            },
            &|_, _| true,
        )
        .expect("chat should succeed");

        assert_eq!(response.conversation_id, "briar:grok:project-1:session-1");
        assert_eq!(response.message, "done");
        let events = events.lock().expect("events should lock");
        assert_eq!(events[0].provider, AgentProviderKind::Grok);
        assert!(matches!(
            events[1].event,
            Some(AgentEvent::ConversationStarted { ref conversation_id })
                if conversation_id == "briar:grok:project-1:session-1"
        ));
    }

    #[test]
    fn scopes_conversation_ids_to_grok_and_the_project() {
        assert_eq!(
            decode_conversation_id("project-1", "briar:grok:project-1:session-1"),
            Ok("session-1")
        );
        assert!(decode_conversation_id("project-2", "briar:grok:project-1:session-1").is_err());
    }
}
