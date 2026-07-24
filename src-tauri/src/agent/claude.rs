use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::{OsStr, OsString},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use super::{
    AgentEvent, AgentEventDirection, AgentProviderEvent, AgentProviderKind, ApprovalPolicy,
    ChatExecution, ModelEffort, ProjectLlmRequest, ProjectLlmResponse, SandboxMode,
};

#[derive(Clone)]
pub(crate) struct ClaudeRuntime {
    bun_binary: PathBuf,
    claude_binary: PathBuf,
    runner: PathBuf,
    execution_path: OsString,
}

impl ClaudeRuntime {
    pub(crate) fn discover(
        home: &Path,
        execution_path: &OsStr,
        runner: &Path,
    ) -> Result<Self, String> {
        if !runner.is_file() {
            return Err(
                "Briar의 Claude Agent runner를 찾지 못했습니다. 앱을 다시 설치하세요.".to_string(),
            );
        }
        let bun_binary = which::which_in("bun", Some(execution_path), home)
            .map_err(|_| "Claude Agent SDK 실행에 필요한 Bun을 찾지 못했습니다.".to_string())?;
        let claude_binary = claude_binary(home, execution_path)?;
        Ok(Self {
            bun_binary,
            claude_binary,
            runner: runner.to_path_buf(),
            execution_path: execution_path.to_os_string(),
        })
    }

    #[cfg(test)]
    fn for_test(bun_binary: PathBuf, claude_binary: PathBuf, runner: PathBuf) -> Self {
        Self {
            bun_binary,
            claude_binary,
            runner,
            execution_path: std::env::var_os("PATH").unwrap_or_default(),
        }
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
    output_schema: Option<Value>,
    model: Option<&'a str>,
    effort: Option<ModelEffort>,
    approval_policy: ApprovalPolicy,
    sandbox_mode: SandboxMode,
    network_access: bool,
    claude_binary: &'a str,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClaudeRunnerMessage {
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

struct ClaudeConnection {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl ClaudeConnection {
    fn start(runtime: &ClaudeRuntime, workspace: &Path) -> Result<Self, String> {
        let mut child = Command::new(&runtime.bun_binary)
            .arg(&runtime.runner)
            .current_dir(workspace)
            .env("PATH", &runtime.execution_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Claude Agent runner를 시작하지 못했습니다: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Claude Agent runner 입력을 열지 못했습니다.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Claude Agent runner 출력을 열지 못했습니다.".to_string())?;
        let mut child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Claude Agent runner 오류 출력을 열지 못했습니다.".to_string())?;
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
            .map_err(|error| format!("Claude Agent runner 요청을 만들지 못했습니다: {error}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Claude Agent runner에 요청을 보내지 못했습니다: {error}"))
    }

    fn read(&mut self) -> Result<Option<ClaudeRunnerMessage>, String> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Claude Agent runner 응답을 읽지 못했습니다: {error}"))?;
        if bytes == 0 {
            return Ok(None);
        }
        serde_json::from_str(&line)
            .map(Some)
            .map_err(|error| format!("Claude Agent runner가 잘못된 응답을 보냈습니다: {error}"))
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
            "Claude Agent runner가 결과를 반환하지 않고 종료되었습니다.".to_string()
        } else {
            format!("Claude Agent runner가 종료되었습니다: {stderr}")
        }
    }
}

impl Drop for ClaudeConnection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(stderr_thread) = self.stderr_thread.take() {
            let _ = stderr_thread.join();
        }
    }
}

pub(crate) fn chat(
    runtime: &ClaudeRuntime,
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
    let workspace_root = std::fs::canonicalize(workspace_root)
        .map_err(|error| format!("프로젝트 워크스페이스를 열지 못했습니다: {error}"))?;
    let workspace = workspace_root
        .to_str()
        .ok_or_else(|| "프로젝트 워크스페이스 경로를 표시할 수 없습니다.".to_string())?;
    let conversation_id = request
        .conversation_id
        .as_deref()
        .map(|id| decode_conversation_id(project_id, id))
        .transpose()?;
    let claude_binary = runtime
        .claude_binary
        .to_str()
        .ok_or_else(|| "Claude Code 실행 경로를 표시할 수 없습니다.".to_string())?;
    let runner_request = ClaudeRunnerRequest {
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
        claude_binary,
    };
    let raw_request = serde_json::to_value(&runner_request)
        .map_err(|error| format!("Claude Agent 요청을 만들지 못했습니다: {error}"))?;
    if let Some(event_sink) = execution.event_sink.as_ref() {
        event_sink(AgentProviderEvent {
            provider: AgentProviderKind::Claude,
            direction: AgentEventDirection::Client,
            raw: raw_request.clone(),
            event: None,
        })?;
    }

    let mut connection = ClaudeConnection::start(runtime, &workspace_root)?;
    connection.send(&raw_request)?;
    loop {
        match connection.read()? {
            Some(ClaudeRunnerMessage::Event { raw, event }) => {
                if let Some(event_sink) = execution.event_sink.as_ref() {
                    event_sink(AgentProviderEvent {
                        provider: AgentProviderKind::Claude,
                        direction: AgentEventDirection::Server,
                        raw,
                        event,
                    })?;
                }
            }
            Some(ClaudeRunnerMessage::Approval {
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
            Some(ClaudeRunnerMessage::Result {
                session_id,
                message,
            }) => {
                if session_id.trim().is_empty() {
                    return Err("Claude Agent SDK가 대화 ID를 반환하지 않았습니다.".to_string());
                }
                return Ok(ProjectLlmResponse {
                    conversation_id: encode_conversation_id(project_id, &session_id),
                    message,
                    workspace_root: workspace.to_string(),
                });
            }
            Some(ClaudeRunnerMessage::Error { message }) => {
                return Err(format!("Claude Agent SDK 요청에 실패했습니다: {message}"));
            }
            None => return Err(connection.exit_error()),
        }
    }
}

fn encode_conversation_id(project_id: &str, session_id: &str) -> String {
    format!("briar:claude:{project_id}:{session_id}")
}

fn decode_conversation_id<'a>(
    project_id: &str,
    conversation_id: &'a str,
) -> Result<&'a str, String> {
    let prefix = format!("briar:claude:{project_id}:");
    conversation_id
        .strip_prefix(&prefix)
        .filter(|session_id| !session_id.is_empty())
        .ok_or_else(|| {
            "이 Claude 대화는 다른 프로젝트 또는 에이전트에 속해 있어 이어갈 수 없습니다."
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    #[test]
    fn runs_the_claude_runner_and_maps_events_and_approvals() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp directory should exist");
        let runner = directory.path().join("fake-runner.sh");
        fs::write(
            &runner,
            r#"#!/bin/sh
read request
echo '{"type":"event","raw":{"type":"assistant"},"event":{"type":"messageCompleted","id":"message-1","phase":"commentary","text":"working"}}'
echo '{"type":"approval","id":"1","toolName":"Bash","input":{"command":"bun test"},"title":"Run tests"}'
read approval
echo '{"type":"result","sessionId":"session-1","message":"done"}'
"#,
        )
        .expect("runner should be written");
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700))
            .expect("runner should be executable");
        let runtime = ClaudeRuntime::for_test(
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
                model: Some("sonnet".to_string()),
                effort: Some(ModelEffort::High),
                event_sink: Some(Arc::new(move |event| {
                    captured_events
                        .lock()
                        .expect("events should lock")
                        .push(event);
                    Ok(())
                })),
            },
            ProjectLlmRequest {
                message: "Fix it".to_string(),
                conversation_id: None,
                instructions: None,
                output_schema: None,
            },
            &|method, input| method == "Bash" && input["command"] == "bun test",
        )
        .expect("Claude runner should complete");

        assert_eq!(response.conversation_id, "briar:claude:project-1:session-1");
        assert_eq!(response.message, "done");
        let events = events.lock().expect("events should lock");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].provider, AgentProviderKind::Claude);
        assert_eq!(events[0].raw["effort"], "high");
        assert!(matches!(
            events[1].event,
            Some(AgentEvent::MessageCompleted { .. })
        ));
    }

    #[test]
    fn scopes_conversation_ids_to_claude_and_the_project() {
        assert_eq!(
            decode_conversation_id("project-1", "briar:claude:project-1:session-1"),
            Ok("session-1")
        );
        assert!(decode_conversation_id("project-2", "briar:claude:project-1:session-1").is_err());
        assert!(decode_conversation_id("project-1", "briar:project-1:thread-1").is_err());
    }
}
