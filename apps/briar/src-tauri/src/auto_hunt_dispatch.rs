use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const DISPATCH_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoHuntDispatchGroup {
    pub(crate) version: u8,
    pub(crate) dispatch_group_id: String,
    pub(crate) project_id: String,
    pub(crate) agent_id: String,
    #[serde(default)]
    pub(crate) coordinator_session_id: String,
    #[serde(default)]
    pub(crate) coordinator_conversation_id: Option<String>,
    pub(crate) status: AutoHuntDispatchStatus,
    pub(crate) max_issues: usize,
    pub(crate) started_at: String,
    pub(crate) completed_at: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) next_cursor: u64,
    pub(crate) workers: Vec<AutoHuntDispatchWorker>,
    pub(crate) events: Vec<AutoHuntDispatchEvent>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutoHuntDispatchStatus {
    Running,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoHuntDispatchWorker {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) source_key: String,
    pub(crate) title: String,
    pub(crate) workspace_root: Option<String>,
    pub(crate) conversation_id: Option<String>,
    pub(crate) status: AutoHuntWorkerStatus,
    pub(crate) summary: Option<String>,
    pub(crate) started_at: String,
    pub(crate) completed_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutoHuntWorkerStatus {
    Allocating,
    Running,
    NeedsInput,
    Completed,
    Blocked,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutoHuntRunEvidenceStatus {
    Pending,
    Passed,
    Failed,
    Skipped,
}

impl AutoHuntRunEvidenceStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoHuntRunEvidenceImage {
    pub(crate) id: String,
    pub(crate) filename: String,
    pub(crate) content_type: String,
    pub(crate) byte_size: u64,
    pub(crate) sha256: String,
    pub(crate) position: u32,
    pub(crate) url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoHuntRunEvidence {
    pub(crate) key: String,
    pub(crate) attempt: u32,
    pub(crate) revision: u32,
    pub(crate) stage: String,
    #[serde(rename = "type")]
    pub(crate) evidence_type: String,
    pub(crate) status: AutoHuntRunEvidenceStatus,
    pub(crate) detail: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) url: Option<String>,
    #[specta(type = Option<crate::ipc::JsonValue>)]
    pub(crate) metadata: Option<serde_json::Value>,
    pub(crate) actor: String,
    pub(crate) observed_at: String,
    pub(crate) recorded_at: String,
    pub(crate) images: Vec<AutoHuntRunEvidenceImage>,
    pub(crate) required_revision: u32,
    pub(crate) canonical: bool,
}

impl AutoHuntWorkerStatus {
    pub(crate) fn from_outcome(outcome: &str) -> Self {
        match outcome {
            "completed" => Self::Completed,
            "blocked" => Self::Blocked,
            "cancelled" => Self::Cancelled,
            _ => Self::Failed,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "auto-hunt-dispatch-event")]
pub(crate) struct AutoHuntDispatchEvent {
    pub(crate) dispatch_group_id: String,
    pub(crate) cursor: u64,
    #[serde(rename = "type")]
    pub(crate) event_type: String,
    pub(crate) worker_session_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) status: String,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) evidence: Option<AutoHuntRunEvidence>,
    pub(crate) occurred_at: String,
}

#[derive(Clone, Debug)]
pub(crate) struct AutoHuntDispatchStore {
    directory: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

impl AutoHuntDispatchStore {
    pub(crate) fn new(app_data_directory: &Path) -> Result<Self, String> {
        let directory = app_data_directory.join("auto-hunt-dispatches");
        fs::create_dir_all(&directory)
            .map_err(|error| format!("이슈 처리 실행 저장 폴더를 만들지 못했습니다: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(
                |error| format!("이슈 처리 실행 저장 폴더 권한을 지정하지 못했습니다: {error}"),
            )?;
        }
        Ok(Self {
            directory,
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    pub(crate) fn create(
        &self,
        dispatch_group_id: &str,
        project_id: &str,
        agent_id: &str,
        coordinator_conversation_id: Option<String>,
        max_issues: usize,
    ) -> Result<AutoHuntDispatchGroup, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "이슈 처리 실행 저장 잠금이 손상되었습니다.".to_string())?;
        validate_id(dispatch_group_id)?;
        let started_at = now();
        let mut group = AutoHuntDispatchGroup {
            version: DISPATCH_VERSION,
            dispatch_group_id: dispatch_group_id.to_string(),
            project_id: project_id.to_string(),
            agent_id: agent_id.to_string(),
            coordinator_session_id: format!("{dispatch_group_id}-coordinator"),
            coordinator_conversation_id,
            status: AutoHuntDispatchStatus::Running,
            max_issues,
            started_at: started_at.clone(),
            completed_at: None,
            error: None,
            next_cursor: 1,
            workers: Vec::new(),
            events: Vec::new(),
        };
        push_event(
            &mut group,
            "dispatch_started",
            None,
            None,
            "running",
            format!("최대 {max_issues}개 run dispatch를 시작했습니다."),
        );
        self.write_new(&group)?;
        Ok(group)
    }

    pub(crate) fn load(
        &self,
        dispatch_group_id: &str,
    ) -> Result<Option<AutoHuntDispatchGroup>, String> {
        validate_id(dispatch_group_id)?;
        let path = self.path(dispatch_group_id);
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(format!("이슈 처리 실행 상태를 읽지 못했습니다: {error}"));
            }
        };
        serde_json::from_str(&contents)
            .map(Some)
            .map_err(|error| format!("이슈 처리 실행 상태가 손상되었습니다: {error}"))
    }

    pub(crate) fn add_worker(
        &self,
        dispatch_group_id: &str,
        worker: AutoHuntDispatchWorker,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            if group
                .workers
                .iter()
                .any(|candidate| candidate.run_id == worker.run_id)
            {
                return Err(format!("run {}은 이미 dispatch되었습니다.", worker.run_id));
            }
            push_event(
                group,
                "worker_allocated",
                Some(&worker.session_id),
                Some(&worker.run_id),
                "allocating",
                format!("{} 전용 worktree 할당을 시작했습니다.", worker.source_key),
            );
            group.workers.push(worker);
            Ok(())
        })
    }

    pub(crate) fn transition_worker(
        &self,
        dispatch_group_id: &str,
        session_id: &str,
        status: AutoHuntWorkerStatus,
        workspace_root: Option<String>,
        conversation_id: Option<String>,
        summary: Option<String>,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            let worker = group
                .workers
                .iter_mut()
                .find(|worker| worker.session_id == session_id)
                .ok_or_else(|| format!("worker session {session_id}을 찾지 못했습니다."))?;
            worker.status = status;
            if workspace_root.is_some() {
                worker.workspace_root = workspace_root;
            }
            if conversation_id.is_some() {
                worker.conversation_id = conversation_id;
            }
            if summary.is_some() {
                worker.summary = summary.clone();
            }
            if matches!(
                status,
                AutoHuntWorkerStatus::Completed
                    | AutoHuntWorkerStatus::Blocked
                    | AutoHuntWorkerStatus::Failed
                    | AutoHuntWorkerStatus::Cancelled
            ) {
                worker.completed_at = Some(now());
            }
            let run_id = worker.run_id.clone();
            let source_key = worker.source_key.clone();
            push_event(
                group,
                "worker_status",
                Some(session_id),
                Some(&run_id),
                worker_status_name(status),
                summary.unwrap_or_else(|| {
                    format!(
                        "{source_key} 워커가 {} 상태가 되었습니다.",
                        worker_status_name(status)
                    )
                }),
            );
            Ok(())
        })
    }

    pub(crate) fn record_worker_progress(
        &self,
        dispatch_group_id: &str,
        session_id: &str,
        event_type: &str,
        message: String,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            let worker = group
                .workers
                .iter()
                .find(|worker| worker.session_id == session_id)
                .ok_or_else(|| format!("worker session {session_id}을 찾지 못했습니다."))?;
            let run_id = worker.run_id.clone();
            push_event(
                group,
                event_type,
                Some(session_id),
                Some(&run_id),
                worker_status_name(worker.status),
                message,
            );
            Ok(())
        })
    }

    pub(crate) fn record_worker_evidence(
        &self,
        dispatch_group_id: &str,
        session_id: &str,
        evidence: AutoHuntRunEvidence,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            let worker = group
                .workers
                .iter()
                .find(|worker| worker.session_id == session_id)
                .ok_or_else(|| format!("worker session {session_id}을 찾지 못했습니다."))?;
            let run_id = worker.run_id.clone();
            let status = evidence.status.as_str();
            push_event(
                group,
                "worker_evidence",
                Some(session_id),
                Some(&run_id),
                status,
                format!(
                    "{} 단계의 {} 증거가 {status} 상태로 기록되었습니다.",
                    evidence.stage, evidence.evidence_type
                ),
            );
            if let Some(event) = group.events.last_mut() {
                event.evidence = Some(evidence);
            }
            Ok(())
        })
    }

    pub(crate) fn record_coordinator_event(
        &self,
        dispatch_group_id: &str,
        event_type: &str,
        status: &str,
        message: String,
        conversation_id: Option<String>,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            if conversation_id.is_some() {
                group.coordinator_conversation_id = conversation_id;
            }
            let coordinator_session_id = group.coordinator_session_id.clone();
            push_event(
                group,
                event_type,
                Some(&coordinator_session_id),
                None,
                status,
                message,
            );
            Ok(())
        })
    }

    pub(crate) fn finish(
        &self,
        dispatch_group_id: &str,
        status: AutoHuntDispatchStatus,
        error: Option<String>,
    ) -> Result<AutoHuntDispatchGroup, String> {
        self.update(dispatch_group_id, |group| {
            if status == AutoHuntDispatchStatus::Interrupted {
                let completed_at = now();
                for worker in &mut group.workers {
                    if matches!(
                        worker.status,
                        AutoHuntWorkerStatus::Allocating
                            | AutoHuntWorkerStatus::Running
                            | AutoHuntWorkerStatus::NeedsInput
                    ) {
                        worker.status = AutoHuntWorkerStatus::Cancelled;
                        worker.summary = Some("사용자가 에이전트 세션을 중지했습니다.".to_string());
                        worker.completed_at = Some(completed_at.clone());
                    }
                }
            }
            group.status = status;
            group.completed_at = Some(now());
            group.error = error.clone();
            push_event(
                group,
                "dispatch_finished",
                None,
                None,
                dispatch_status_name(status),
                error.unwrap_or_else(|| "모든 dispatch 워커가 종료되었습니다.".to_string()),
            );
            Ok(())
        })
    }

    /// Reconcile state left by a previous desktop process. Agent app-server
    /// children cannot survive their owning app process, so a persisted
    /// `running` group is interrupted rather than silently presented as live.
    /// The server-side claim lease remains authoritative and can be reaped or
    /// retried independently.
    #[cfg(desktop)]
    pub(crate) fn interrupt_orphaned_groups(&self) -> Result<Vec<AutoHuntDispatchGroup>, String> {
        let entries = fs::read_dir(&self.directory)
            .map_err(|error| format!("이슈 처리 실행 폴더를 읽지 못했습니다: {error}"))?;
        let mut recovered = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("이슈 처리 실행 항목을 읽지 못했습니다: {error}"))?;
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let contents = fs::read_to_string(&path)
                .map_err(|error| format!("이슈 처리 실행 상태를 읽지 못했습니다: {error}"))?;
            let mut group: AutoHuntDispatchGroup = serde_json::from_str(&contents)
                .map_err(|error| format!("이슈 처리 실행 상태가 손상되었습니다: {error}"))?;
            if group.status != AutoHuntDispatchStatus::Running {
                continue;
            }
            let completed_at = now();
            for worker in &mut group.workers {
                if matches!(
                    worker.status,
                    AutoHuntWorkerStatus::Allocating
                        | AutoHuntWorkerStatus::Running
                        | AutoHuntWorkerStatus::NeedsInput
                ) {
                    worker.status = AutoHuntWorkerStatus::Failed;
                    worker.summary =
                        Some("Briar 앱이 종료되어 워커 세션이 중단되었습니다.".to_string());
                    worker.completed_at = Some(completed_at.clone());
                }
            }
            group.status = AutoHuntDispatchStatus::Interrupted;
            group.completed_at = Some(completed_at);
            group.error =
                Some("Briar 앱 재시작으로 실행 중인 워커 연결이 종료되었습니다.".to_string());
            push_event(
                &mut group,
                "dispatch_interrupted",
                None,
                None,
                "interrupted",
                "이전 앱 프로세스의 실행 중 dispatch를 중단 상태로 복구했습니다.".to_string(),
            );
            self.write_replace(&group)?;
            recovered.push(group);
        }
        Ok(recovered)
    }

    fn update(
        &self,
        dispatch_group_id: &str,
        mutate: impl FnOnce(&mut AutoHuntDispatchGroup) -> Result<(), String>,
    ) -> Result<AutoHuntDispatchGroup, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "이슈 처리 실행 저장 잠금이 손상되었습니다.".to_string())?;
        let mut group = self
            .load(dispatch_group_id)?
            .ok_or_else(|| "이슈 처리 실행 상태를 찾지 못했습니다.".to_string())?;
        mutate(&mut group)?;
        self.write_replace(&group)?;
        Ok(group)
    }

    fn write_new(&self, group: &AutoHuntDispatchGroup) -> Result<(), String> {
        let bytes = serialize(group)?;
        let path = self.path(&group.dispatch_group_id);
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "같은 dispatchGroupId의 이슈 처리 실행이 이미 존재합니다.".to_string()
            } else {
                format!("이슈 처리 실행 상태를 만들지 못했습니다: {error}")
            }
        })?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("이슈 처리 실행 상태를 저장하지 못했습니다: {error}"))
    }

    fn write_replace(&self, group: &AutoHuntDispatchGroup) -> Result<(), String> {
        let bytes = serialize(group)?;
        let path = self.path(&group.dispatch_group_id);
        let temporary = self
            .directory
            .join(format!(".{}.tmp", group.dispatch_group_id));
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("이슈 처리 실행의 임시 상태를 만들지 못했습니다: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .and_then(|_| fs::rename(&temporary, &path))
            .map_err(|error| format!("이슈 처리 실행 상태를 갱신하지 못했습니다: {error}"))
    }

    fn path(&self, dispatch_group_id: &str) -> PathBuf {
        self.directory.join(format!("{dispatch_group_id}.json"))
    }
}

fn serialize(group: &AutoHuntDispatchGroup) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(group)
        .map_err(|error| format!("이슈 처리 실행 상태를 직렬화하지 못했습니다: {error}"))
}

fn push_event(
    group: &mut AutoHuntDispatchGroup,
    event_type: &str,
    worker_session_id: Option<&str>,
    run_id: Option<&str>,
    status: &str,
    message: String,
) {
    let cursor = group.next_cursor;
    group.next_cursor += 1;
    group.events.push(AutoHuntDispatchEvent {
        dispatch_group_id: group.dispatch_group_id.clone(),
        cursor,
        event_type: event_type.to_string(),
        worker_session_id: worker_session_id.map(str::to_string),
        run_id: run_id.map(str::to_string),
        status: status.to_string(),
        message,
        evidence: None,
        occurred_at: now(),
    });
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
    {
        return Err("이슈 처리 실행의 dispatchGroupId가 올바르지 않습니다.".to_string());
    }
    Ok(())
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn worker_status_name(status: AutoHuntWorkerStatus) -> &'static str {
    match status {
        AutoHuntWorkerStatus::Allocating => "allocating",
        AutoHuntWorkerStatus::Running => "running",
        AutoHuntWorkerStatus::NeedsInput => "needs_input",
        AutoHuntWorkerStatus::Completed => "completed",
        AutoHuntWorkerStatus::Blocked => "blocked",
        AutoHuntWorkerStatus::Failed => "failed",
        AutoHuntWorkerStatus::Cancelled => "cancelled",
    }
}

fn dispatch_status_name(status: AutoHuntDispatchStatus) -> &'static str {
    match status {
        AutoHuntDispatchStatus::Running => "running",
        AutoHuntDispatchStatus::Completed => "completed",
        AutoHuntDispatchStatus::Failed => "failed",
        AutoHuntDispatchStatus::Interrupted => "interrupted",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worker() -> AutoHuntDispatchWorker {
        AutoHuntDispatchWorker {
            session_id: "group-1-w1".to_string(),
            run_id: "run-1".to_string(),
            source_key: "BRIAR-1".to_string(),
            title: "Host dispatch".to_string(),
            workspace_root: None,
            conversation_id: None,
            status: AutoHuntWorkerStatus::Allocating,
            summary: None,
            started_at: now(),
            completed_at: None,
        }
    }

    fn evidence() -> AutoHuntRunEvidence {
        AutoHuntRunEvidence {
            key: "local-ci".to_string(),
            attempt: 1,
            revision: 2,
            stage: "local_qa".to_string(),
            evidence_type: "local_ci".to_string(),
            status: AutoHuntRunEvidenceStatus::Passed,
            detail: None,
            command: None,
            url: None,
            metadata: None,
            actor: "test".to_string(),
            observed_at: "2026-01-01T00:00:00Z".to_string(),
            recorded_at: "2026-01-01T00:00:01Z".to_string(),
            images: Vec::new(),
            required_revision: 2,
            canonical: true,
        }
    }

    #[test]
    fn persists_worker_transitions_with_monotonic_cursors() {
        let directory = tempfile::tempdir().expect("dispatch fixture");
        let store = AutoHuntDispatchStore::new(directory.path()).expect("store");
        store
            .create("group-1", "project-1", "agent-1", None, 2)
            .expect("group");
        store.add_worker("group-1", worker()).expect("worker");
        store
            .transition_worker(
                "group-1",
                "group-1-w1",
                AutoHuntWorkerStatus::Running,
                Some("/worktree".to_string()),
                None,
                None,
            )
            .expect("running");
        store
            .transition_worker(
                "group-1",
                "group-1-w1",
                AutoHuntWorkerStatus::Completed,
                None,
                Some("thread-1".to_string()),
                Some("done".to_string()),
            )
            .expect("completed");
        store
            .record_worker_evidence("group-1", "group-1-w1", evidence())
            .expect("evidence");
        let group = store.load("group-1").expect("load").expect("saved group");
        assert_eq!(group.workers[0].status, AutoHuntWorkerStatus::Completed);
        assert_eq!(
            group.workers[0].workspace_root.as_deref(),
            Some("/worktree")
        );
        assert_eq!(
            group
                .events
                .iter()
                .map(|event| event.cursor)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );
        let evidence = group.events.last().expect("evidence event");
        assert_eq!(evidence.event_type, "worker_evidence");
        assert_eq!(
            evidence.evidence.as_ref().map(|value| value.status),
            Some(AutoHuntRunEvidenceStatus::Passed)
        );
    }

    #[test]
    fn rejects_duplicate_group_and_run_dispatches() {
        let directory = tempfile::tempdir().expect("dispatch fixture");
        let store = AutoHuntDispatchStore::new(directory.path()).expect("store");
        store
            .create("group-1", "project-1", "agent-1", None, 1)
            .expect("group");
        assert!(store
            .create("group-1", "project-1", "agent-1", None, 1)
            .is_err());
        store.add_worker("group-1", worker()).expect("worker");
        assert!(store.add_worker("group-1", worker()).is_err());
    }

    #[test]
    fn marks_running_groups_interrupted_after_a_runtime_restart() {
        let directory = tempfile::tempdir().expect("dispatch fixture");
        let store = AutoHuntDispatchStore::new(directory.path()).expect("store");
        store
            .create("group-1", "project-1", "agent-1", None, 1)
            .expect("group");
        store.add_worker("group-1", worker()).expect("worker");
        store
            .transition_worker(
                "group-1",
                "group-1-w1",
                AutoHuntWorkerStatus::Running,
                Some("/worktree".to_string()),
                None,
                None,
            )
            .expect("running");

        let recovered = store.interrupt_orphaned_groups().expect("recovery");
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].status, AutoHuntDispatchStatus::Interrupted);
        assert_eq!(recovered[0].workers[0].status, AutoHuntWorkerStatus::Failed);
        assert_eq!(
            store
                .interrupt_orphaned_groups()
                .expect("idempotent recovery")
                .len(),
            0
        );
    }

    #[test]
    fn cancels_active_workers_when_a_dispatch_is_stopped() {
        let directory = tempfile::tempdir().expect("dispatch fixture");
        let store = AutoHuntDispatchStore::new(directory.path()).expect("store");
        store
            .create("group-1", "project-1", "agent-1", None, 1)
            .expect("group");
        store.add_worker("group-1", worker()).expect("worker");
        store
            .transition_worker(
                "group-1",
                "group-1-w1",
                AutoHuntWorkerStatus::Running,
                Some("/worktree".to_string()),
                None,
                None,
            )
            .expect("running");

        let stopped = store
            .finish("group-1", AutoHuntDispatchStatus::Interrupted, None)
            .expect("stopped");

        assert_eq!(stopped.status, AutoHuntDispatchStatus::Interrupted);
        assert_eq!(stopped.workers[0].status, AutoHuntWorkerStatus::Cancelled);
        assert_eq!(
            stopped.workers[0].summary.as_deref(),
            Some("사용자가 에이전트 세션을 중지했습니다.")
        );
        assert!(stopped.workers[0].completed_at.is_some());
    }
}
