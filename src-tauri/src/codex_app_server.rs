use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

const INITIALIZE_REQUEST_ID: u64 = 1;
const THREAD_REQUEST_ID: u64 = 2;
const TURN_REQUEST_ID: u64 = 3;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmSettings {
    #[serde(default)]
    pub(crate) approval_policy: ApprovalPolicy,
}

impl Default for ProjectLlmSettings {
    fn default() -> Self {
        Self {
            approval_policy: ApprovalPolicy::Never,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmRequest {
    pub(crate) message: String,
    #[serde(default)]
    pub(crate) conversation_id: Option<String>,
    #[serde(default)]
    pub(crate) instructions: Option<String>,
    #[serde(default)]
    pub(crate) output_schema: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectLlmResponse {
    pub(crate) conversation_id: String,
    pub(crate) message: String,
    pub(crate) workspace_root: String,
}

pub(crate) fn codex_binary(home: &Path) -> Result<PathBuf, String> {
    if let Ok(path) = which::which("codex") {
        return Ok(path);
    }
    for candidate in [
        home.join(".local/bin/codex"),
        home.join(".bun/bin/codex"),
        home.join(".cargo/bin/codex"),
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Codex CLI가 필요합니다. Codex를 설치하고 로그인한 뒤 Briar를 다시 여세요.".to_string())
}

pub(crate) fn chat(
    binary: &Path,
    execution_path: &std::ffi::OsStr,
    project_id: &str,
    workspace_root: &Path,
    approval_policy: ApprovalPolicy,
    request: ProjectLlmRequest,
    approve: &dyn Fn(&str, &Value) -> bool,
) -> Result<ProjectLlmResponse, String> {
    let message = request.message.trim();
    if message.is_empty() {
        return Err("LLM에 보낼 메시지를 입력하세요.".to_string());
    }
    let workspace_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("프로젝트 워크스페이스를 열지 못했습니다: {error}"))?;
    let workspace = workspace_root
        .to_str()
        .ok_or_else(|| "프로젝트 워크스페이스 경로를 표시할 수 없습니다.".to_string())?;
    let thread_id = request
        .conversation_id
        .as_deref()
        .map(|conversation_id| decode_conversation_id(project_id, conversation_id))
        .transpose()?;

    let mut connection = CodexConnection::start(binary, execution_path, &workspace_root)?;
    connection.send(&initialize_request())?;
    connection.read_response(INITIALIZE_REQUEST_ID)?;
    connection.send(&json!({ "method": "initialized", "params": {} }))?;

    connection.send(&thread_request(
        workspace,
        thread_id,
        request.instructions.as_deref(),
        approval_policy,
    ))?;
    let thread_result = connection.read_response(THREAD_REQUEST_ID)?;
    let active_thread_id = thread_result
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex App Server가 대화 ID를 반환하지 않았습니다.".to_string())?;
    let active_workspace = thread_result
        .get("cwd")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex App Server가 워크스페이스를 반환하지 않았습니다.".to_string())?;
    verify_workspace(&workspace_root, active_workspace)?;

    connection.send(&turn_request(
        active_thread_id,
        workspace,
        message,
        request.output_schema,
        approval_policy,
    ))?;
    let response_message = connection.read_turn(active_thread_id, approve)?;

    Ok(ProjectLlmResponse {
        conversation_id: encode_conversation_id(project_id, active_thread_id),
        message: response_message,
        workspace_root: workspace.to_string(),
    })
}

fn initialize_request() -> Value {
    json!({
        "method": "initialize",
        "id": INITIALIZE_REQUEST_ID,
        "params": {
            "clientInfo": {
                "name": "briar",
                "title": "Briar",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    })
}

fn thread_request(
    workspace: &str,
    thread_id: Option<&str>,
    instructions: Option<&str>,
    approval_policy: ApprovalPolicy,
) -> Value {
    let mut params = json!({
        "cwd": workspace,
        "sandbox": "read-only",
        "approvalPolicy": approval_policy.as_str()
    });
    if let Some(instructions) = instructions.filter(|value| !value.trim().is_empty()) {
        params["developerInstructions"] = Value::String(instructions.to_string());
    }
    let method = if let Some(thread_id) = thread_id {
        params["threadId"] = Value::String(thread_id.to_string());
        "thread/resume"
    } else {
        "thread/start"
    };
    json!({ "method": method, "id": THREAD_REQUEST_ID, "params": params })
}

fn turn_request(
    thread_id: &str,
    workspace: &str,
    message: &str,
    output_schema: Option<Value>,
    approval_policy: ApprovalPolicy,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "cwd": workspace,
        "approvalPolicy": approval_policy.as_str(),
        "input": [{ "type": "text", "text": message }]
    });
    if let Some(output_schema) = output_schema {
        params["outputSchema"] = output_schema;
    }
    json!({ "method": "turn/start", "id": TURN_REQUEST_ID, "params": params })
}

fn encode_conversation_id(project_id: &str, thread_id: &str) -> String {
    format!("briar:{project_id}:{thread_id}")
}

fn decode_conversation_id<'a>(
    project_id: &str,
    conversation_id: &'a str,
) -> Result<&'a str, String> {
    let prefix = format!("briar:{project_id}:");
    let thread_id = conversation_id.strip_prefix(&prefix).ok_or_else(|| {
        "이 대화는 현재 Briar 프로젝트에 속하지 않습니다. 새 대화를 시작하세요.".to_string()
    })?;
    if thread_id.trim().is_empty() {
        return Err("Briar 대화 ID가 올바르지 않습니다.".to_string());
    }
    Ok(thread_id)
}

fn verify_workspace(expected: &Path, actual: &str) -> Result<(), String> {
    let actual = fs::canonicalize(actual)
        .map_err(|error| format!("Codex 워크스페이스를 확인하지 못했습니다: {error}"))?;
    if actual != expected {
        return Err("Codex 대화가 프로젝트 워크스페이스에서 시작되지 않았습니다.".to_string());
    }
    Ok(())
}

struct CodexConnection {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: std::io::Lines<BufReader<std::process::ChildStdout>>,
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl CodexConnection {
    fn start(
        binary: &Path,
        execution_path: &std::ffi::OsStr,
        workspace: &Path,
    ) -> Result<Self, String> {
        let mut child = Command::new(binary)
            .args(["app-server", "--listen", "stdio://"])
            .current_dir(workspace)
            .env("PATH", execution_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Codex App Server를 시작하지 못했습니다: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex App Server 입력을 열지 못했습니다.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex App Server 출력을 열지 못했습니다.".to_string())?;
        let child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex App Server 오류 출력을 열지 못했습니다.".to_string())?;
        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_output = Arc::clone(&stderr);
        let stderr_thread = thread::spawn(move || {
            let mut reader = BufReader::new(child_stderr);
            let mut output = String::new();
            let _ = reader.read_to_string(&mut output);
            if let Ok(mut stored) = stderr_output.lock() {
                *stored = output;
            }
        });
        Ok(Self {
            child,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout).lines(),
            stderr,
            stderr_thread: Some(stderr_thread),
        })
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Codex App Server 연결이 닫혔습니다.".to_string())?;
        serde_json::to_writer(&mut *stdin, message)
            .map_err(|error| format!("Codex App Server 요청을 만들지 못했습니다: {error}"))?;
        stdin
            .write_all(b"\n")
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Codex App Server에 요청을 보내지 못했습니다: {error}"))
    }

    fn read_message(&mut self) -> Result<Value, String> {
        let line = match self.stdout.next() {
            Some(Ok(line)) => line,
            Some(Err(error)) => {
                return Err(format!("Codex App Server 응답을 읽지 못했습니다: {error}"));
            }
            None => {
                return Err(self.exit_error("Codex App Server가 응답 전에 종료되었습니다."));
            }
        };
        serde_json::from_str(&line)
            .map_err(|error| format!("Codex App Server가 잘못된 응답을 보냈습니다: {error}"))
    }

    fn read_response(&mut self, request_id: u64) -> Result<Value, String> {
        loop {
            let message = self.read_message()?;
            if self.reject_server_request(&message)? {
                continue;
            }
            if message.get("id").and_then(Value::as_u64) != Some(request_id) {
                continue;
            }
            return response_result(message);
        }
    }

    fn read_turn(
        &mut self,
        thread_id: &str,
        approve: &dyn Fn(&str, &Value) -> bool,
    ) -> Result<String, String> {
        let mut active_turn_id = None;
        let mut messages = AgentMessages::default();
        loop {
            let message = self.read_message()?;
            if self.handle_server_request(&message, approve)? {
                continue;
            }
            if message.get("id").and_then(Value::as_u64) == Some(TURN_REQUEST_ID) {
                let result = response_result(message)?;
                let turn_id = result
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        "Codex App Server가 turn ID를 반환하지 않았습니다.".to_string()
                    })?;
                active_turn_id = Some(turn_id.to_string());
                continue;
            }
            let method = message.get("method").and_then(Value::as_str);
            if method == Some("item/completed") {
                capture_completed_item(
                    message.get("params").unwrap_or(&Value::Null),
                    thread_id,
                    active_turn_id.as_deref(),
                    &mut messages,
                );
                continue;
            }
            if method != Some("turn/completed") {
                continue;
            }
            let params = message
                .get("params")
                .ok_or_else(|| "Codex 완료 응답에 결과가 없습니다.".to_string())?;
            if params.get("threadId").and_then(Value::as_str) != Some(thread_id) {
                continue;
            }
            let Some(active_turn_id) = active_turn_id.as_deref() else {
                return Err("Codex가 turn/start 응답 전에 대화를 완료했습니다.".to_string());
            };
            if params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
                != Some(active_turn_id)
            {
                continue;
            }
            return completed_message(params, messages);
        }
    }

    fn reject_server_request(&mut self, message: &Value) -> Result<bool, String> {
        if message.get("method").is_none() || message.get("id").is_none() {
            return Ok(false);
        }
        let response = json!({
            "id": message["id"].clone(),
            "error": {
                "code": -32601,
                "message": "Briar의 읽기 전용 LLM 대화에서는 대화형 도구 요청을 지원하지 않습니다."
            }
        });
        self.send(&response)?;
        Ok(true)
    }

    fn handle_server_request(
        &mut self,
        message: &Value,
        approve: &dyn Fn(&str, &Value) -> bool,
    ) -> Result<bool, String> {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return Ok(false);
        };
        if message.get("id").is_none() {
            return Ok(false);
        }
        if approval_decision(method, false).is_none() {
            return self.reject_server_request(message);
        }
        let params = message.get("params").unwrap_or(&Value::Null);
        let approved = approve(method, params);
        let decision = approval_decision(method, approved)
            .expect("approval methods are checked before requesting a decision");
        self.send(&json!({ "id": message["id"].clone(), "result": decision }))?;
        Ok(true)
    }

    fn exit_error(&mut self, fallback: &str) -> String {
        let _ = self.child.wait();
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
        let stderr = self
            .stderr
            .lock()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if stderr.is_empty() {
            fallback.to_string()
        } else {
            format!("{fallback} {stderr}")
        }
    }
}

impl Drop for CodexConnection {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
    }
}

fn response_result(message: Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        let detail = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("알 수 없는 App Server 오류");
        return Err(format!("Codex App Server 요청에 실패했습니다: {detail}"));
    }
    message
        .get("result")
        .cloned()
        .ok_or_else(|| "Codex App Server 응답에 결과가 없습니다.".to_string())
}

#[derive(Clone, Debug, Default)]
struct AgentMessages {
    fallback: Option<String>,
    final_answer: Option<String>,
}

impl AgentMessages {
    fn capture(&mut self, item: &Value) {
        if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
            return;
        }
        let Some(text) = item.get("text").and_then(Value::as_str) else {
            return;
        };
        if text.trim().is_empty() {
            return;
        }
        self.fallback = Some(text.to_string());
        if item.get("phase").and_then(Value::as_str) == Some("final_answer") {
            self.final_answer = Some(text.to_string());
        }
    }

    fn into_message(self) -> Option<String> {
        self.final_answer.or(self.fallback)
    }
}

fn capture_completed_item(
    params: &Value,
    thread_id: &str,
    turn_id: Option<&str>,
    messages: &mut AgentMessages,
) {
    if params.get("threadId").and_then(Value::as_str) != Some(thread_id) {
        return;
    }
    if turn_id.is_some() && params.get("turnId").and_then(Value::as_str) != turn_id {
        return;
    }
    if let Some(item) = params.get("item") {
        messages.capture(item);
    }
}

fn completed_message(params: &Value, mut messages: AgentMessages) -> Result<String, String> {
    let turn = params
        .get("turn")
        .ok_or_else(|| "Codex 완료 응답에 turn이 없습니다.".to_string())?;
    let status = turn
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("failed");
    if status != "completed" {
        let detail = turn
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or(status);
        return Err(format!("Codex 대화가 완료되지 않았습니다: {detail}"));
    }
    for item in turn
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        messages.capture(item);
    }
    messages
        .into_message()
        .ok_or_else(|| "Codex가 최종 메시지를 반환하지 않았습니다.".to_string())
}

fn approval_decision(method: &str, approved: bool) -> Option<Value> {
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            Some(json!({ "decision": if approved { "accept" } else { "decline" } }))
        }
        "execCommandApproval" | "applyPatchApproval" => {
            Some(json!({ "decision": if approved { "approved" } else { "denied" } }))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scopes_conversation_ids_to_the_project() {
        let encoded = encode_conversation_id("project-a", "thread-1");
        assert_eq!(encoded, "briar:project-a:thread-1");
        assert_eq!(
            decode_conversation_id("project-a", &encoded).expect("same project should decode"),
            "thread-1"
        );
        assert!(decode_conversation_id("project-b", &encoded).is_err());
    }

    #[test]
    fn pins_new_and_resumed_threads_to_a_read_only_workspace() {
        let started = thread_request("/repo", None, Some("Be concise"), ApprovalPolicy::OnRequest);
        assert_eq!(started["method"], "thread/start");
        assert_eq!(started["params"]["cwd"], "/repo");
        assert_eq!(started["params"]["sandbox"], "read-only");
        assert_eq!(started["params"]["approvalPolicy"], "on-request");
        assert_eq!(started["params"]["developerInstructions"], "Be concise");

        let resumed = thread_request("/repo", Some("thread-1"), None, ApprovalPolicy::Untrusted);
        assert_eq!(resumed["method"], "thread/resume");
        assert_eq!(resumed["params"]["threadId"], "thread-1");
        assert_eq!(resumed["params"]["cwd"], "/repo");
        assert_eq!(resumed["params"]["approvalPolicy"], "untrusted");
    }

    #[test]
    fn sends_turns_to_the_same_workspace_with_optional_structured_output() {
        let request = turn_request(
            "thread-1",
            "/repo",
            "Summarize this project",
            Some(json!({ "type": "object" })),
            ApprovalPolicy::Never,
        );
        assert_eq!(request["method"], "turn/start");
        assert_eq!(request["params"]["threadId"], "thread-1");
        assert_eq!(request["params"]["cwd"], "/repo");
        assert_eq!(request["params"]["approvalPolicy"], "never");
        assert_eq!(request["params"]["input"][0]["type"], "text");
        assert_eq!(request["params"]["outputSchema"]["type"], "object");
    }

    #[test]
    fn prefers_the_final_answer_from_a_completed_turn() {
        let params = json!({
            "turn": {
                "status": "completed",
                "items": [
                    { "type": "agentMessage", "phase": "commentary", "text": "Working" },
                    { "type": "agentMessage", "phase": "final_answer", "text": "Done" }
                ]
            }
        });
        assert_eq!(
            completed_message(&params, AgentMessages::default()).expect("turn should complete"),
            "Done"
        );
    }

    #[cfg(unix)]
    #[test]
    fn completes_the_app_server_handshake_and_project_turn() {
        use std::os::unix::fs::PermissionsExt;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-codex-test-{unique}"));
        let workspace = directory.join("workspace");
        let binary = directory.join("fake-codex");
        let log = directory.join("requests.jsonl");
        fs::create_dir_all(&workspace).expect("workspace should be created");
        let workspace_json = serde_json::to_string(
            workspace
                .canonicalize()
                .expect("workspace should canonicalize")
                .to_str()
                .expect("workspace should be utf-8"),
        )
        .expect("workspace should serialize");
        let script = r#"#!/bin/sh
read line
printf '%s\n' "$line" >> __LOG__
printf '%s\n' '{"id":1,"result":{"userAgent":"fake"}}'
read line
printf '%s\n' "$line" >> __LOG__
read line
printf '%s\n' "$line" >> __LOG__
printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-1"},"cwd":__WORKSPACE__}}'
read line
printf '%s\n' "$line" >> __LOG__
printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-1","items":[],"status":"inProgress"}}}'
printf '%s\n' '{"id":4,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","startedAtMs":1,"command":"git status"}}'
read line
printf '%s\n' "$line" >> __LOG__
printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","completedAtMs":1,"item":{"id":"message-1","type":"agentMessage","phase":"final_answer","text":"Repository summary"}}}'
printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","items":[],"itemsView":"notLoaded","status":"completed"}}}'
"#
        .replace("__LOG__", &format!("'{}'", log.to_string_lossy()))
        .replace("__WORKSPACE__", &workspace_json);
        fs::write(&binary, script).expect("fake Codex should be written");
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))
            .expect("fake Codex should be executable");

        let response = chat(
            &binary,
            std::env::var_os("PATH")
                .expect("PATH should exist")
                .as_os_str(),
            "project-1",
            &workspace,
            ApprovalPolicy::OnRequest,
            ProjectLlmRequest {
                message: "Summarize the repository".to_string(),
                conversation_id: None,
                instructions: None,
                output_schema: None,
            },
            &|_, _| true,
        )
        .expect("fake Codex chat should complete");

        assert_eq!(response.conversation_id, "briar:project-1:thread-1");
        assert_eq!(response.message, "Repository summary");
        let requests: Vec<Value> = fs::read_to_string(&log)
            .expect("request log should be readable")
            .lines()
            .map(|line| serde_json::from_str(line).expect("request should be json"))
            .collect();
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[1]["method"], "initialized");
        assert_eq!(requests[2]["method"], "thread/start");
        assert_eq!(
            requests[2]["params"]["cwd"],
            workspace_json.trim_matches('"')
        );
        assert_eq!(requests[3]["method"], "turn/start");
        assert_eq!(requests[3]["params"]["approvalPolicy"], "on-request");
        assert_eq!(
            requests[3]["params"]["cwd"],
            workspace_json.trim_matches('"')
        );
        assert_eq!(requests[4]["id"], 4);
        assert_eq!(requests[4]["result"]["decision"], "accept");

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn maps_app_server_approval_requests_to_protocol_decisions() {
        let approved = json!({
            "id": 9,
            "method": "item/commandExecution/requestApproval",
            "params": { "command": "git status" }
        });
        let legacy = json!({
            "id": 10,
            "method": "applyPatchApproval",
            "params": { "reason": "update a file" }
        });
        let unknown = json!({
            "id": 11,
            "method": "item/tool/requestUserInput",
            "params": {}
        });

        assert_eq!(
            approval_decision(approved["method"].as_str().unwrap(), true).unwrap()["decision"],
            "accept"
        );
        assert_eq!(
            approval_decision(approved["method"].as_str().unwrap(), false).unwrap()["decision"],
            "decline"
        );
        assert_eq!(
            approval_decision(legacy["method"].as_str().unwrap(), true).unwrap()["decision"],
            "approved"
        );
        assert!(approval_decision(unknown["method"].as_str().unwrap(), true).is_none());
    }
}
