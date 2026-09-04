//! Codex model catalog probe.
//!
//! Codex still answers `model/list` over its own App Server JSON-RPC, so this
//! keeps a minimal one-shot client for the settings model picker. Agent turns
//! run through the shared Bun sidecar; nothing here is on that path.

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin},
    sync::{Arc, Mutex},
    thread,
};

use crate::host::{CommandRunner, CommandSpec};

const INITIALIZE_REQUEST_ID: u64 = 1;
const MODEL_LIST_REQUEST_ID: u64 = 4;

pub(crate) type ModelEffortEntry = (String, String, Option<String>, bool);
pub(crate) type ModelListEntry = (String, String, bool, Option<String>, Vec<ModelEffortEntry>);

pub(crate) fn list_models(
    runner: Arc<dyn CommandRunner>,
    binary: &str,
    workspace: &Path,
) -> Result<Vec<ModelListEntry>, String> {
    let mut connection = ModelListConnection::start(runner, binary, workspace)?;
    connection.send(&json!({
        "method": "initialize",
        "id": INITIALIZE_REQUEST_ID,
        "params": {
            "clientInfo": {
                "name": "briar",
                "title": "Briar",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    }))?;
    connection.read_response(INITIALIZE_REQUEST_ID)?;
    connection.send(&json!({ "method": "initialized", "params": {} }))?;

    let mut models = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        connection.send(&json!({
            "method": "model/list",
            "id": MODEL_LIST_REQUEST_ID,
            "params": params,
        }))?;
        let result = connection.read_response(MODEL_LIST_REQUEST_ID)?;
        let page = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| "Codex가 지원 모델 목록을 반환하지 않았습니다.".to_string())?;
        for model in page {
            let Some(id) = model.get("model").and_then(Value::as_str) else {
                continue;
            };
            let label = model
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(id);
            let is_default = model
                .get("isDefault")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let default_effort = model
                .get("defaultReasoningEffort")
                .and_then(Value::as_str)
                .map(str::to_string);
            let efforts = model
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|effort| {
                    let id = effort.get("reasoningEffort")?.as_str()?.to_string();
                    let description = effort
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let is_default_effort = default_effort.as_deref() == Some(id.as_str());
                    Some((id.clone(), id, description, is_default_effort))
                })
                .collect();
            models.push((
                id.to_string(),
                label.to_string(),
                is_default,
                default_effort,
                efforts,
            ));
        }
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .filter(|cursor| !cursor.is_empty())
            .map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    Ok(models)
}

struct ModelListConnection {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: std::io::Lines<BufReader<std::process::ChildStdout>>,
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl ModelListConnection {
    fn start(
        runner: Arc<dyn CommandRunner>,
        binary: &str,
        workspace: &Path,
    ) -> Result<Self, String> {
        let spec = CommandSpec::new(binary)
            .args(["app-server", "--listen", "stdio://"])
            .working_directory(workspace);
        let mut child = runner
            .spawn_piped(&spec)
            .map_err(|error| format!("Codex App Server를 시작하지 못했습니다: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex App Server 입력을 열지 못했습니다.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex App Server 출력을 열지 못했습니다.".to_string())?;
        let mut child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex App Server 오류 출력을 열지 못했습니다.".to_string())?;
        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_output = Arc::clone(&stderr);
        // Draining stderr keeps a chatty App Server from filling its pipe.
        let stderr_thread = thread::spawn(move || {
            let mut output = String::new();
            let _ = child_stderr.read_to_string(&mut output);
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

    fn exit_error(&mut self) -> String {
        const FALLBACK: &str = "Codex App Server가 응답 전에 종료되었습니다.";
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
            FALLBACK.to_string()
        } else {
            format!("{FALLBACK} {stderr}")
        }
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

    fn read_response(&mut self, request_id: u64) -> Result<Value, String> {
        loop {
            let message = match self.stdout.next() {
                Some(Ok(line)) => serde_json::from_str::<Value>(&line).map_err(|error| {
                    format!("Codex App Server가 잘못된 응답을 보냈습니다: {error}")
                })?,
                Some(Err(error)) => {
                    return Err(format!("Codex App Server 응답을 읽지 못했습니다: {error}"));
                }
                None => return Err(self.exit_error()),
            };
            if message.get("method").is_some() && message.get("id").is_some() {
                // Model listing never grants interactive tool requests.
                self.send(&json!({
                    "id": message["id"].clone(),
                    "error": {
                        "code": -32601,
                        "message": "Briar의 읽기 전용 LLM 대화에서는 대화형 도구 요청을 지원하지 않습니다."
                    }
                }))?;
                continue;
            }
            if message.get("id").and_then(Value::as_u64) != Some(request_id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let detail = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("알 수 없는 App Server 오류");
                return Err(format!("Codex App Server 요청에 실패했습니다: {detail}"));
            }
            return message
                .get("result")
                .cloned()
                .ok_or_else(|| "Codex App Server 응답에 결과가 없습니다.".to_string());
        }
    }
}

impl Drop for ModelListConnection {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
    }
}
