use crate::agent::ProjectAgentRunRequest;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

const RECOVERY_VERSION: u8 = 1;
const RECOVERY_MAX_AGE_MINUTES: i64 = 10;
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannedUpdateAgentRecovery {
    version: u8,
    pub(crate) project_id: String,
    pub(crate) started_at: String,
    pub(crate) request: ProjectAgentRunRequest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlannedUpdateMarker {
    version: u8,
    prepared_at: String,
    session_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct PlannedUpdateRecoveryStore {
    directory: PathBuf,
}

impl PlannedUpdateRecoveryStore {
    pub(crate) fn new(app_data_directory: &Path) -> Result<Self, String> {
        let directory = app_data_directory.join("planned-update-recovery");
        let active_directory = directory.join("active");
        fs::create_dir_all(&active_directory)
            .map_err(|error| format!("업데이트 복구 폴더를 만들지 못했습니다: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .and_then(|_| {
                    fs::set_permissions(&active_directory, fs::Permissions::from_mode(0o700))
                })
                .map_err(|error| {
                    format!("업데이트 복구 폴더 권한을 지정하지 못했습니다: {error}")
                })?;
        }
        Ok(Self { directory })
    }

    pub(crate) fn begin(
        &self,
        project_id: &str,
        request: &ProjectAgentRunRequest,
    ) -> Result<(), String> {
        validate_session_id(&request.session_id)?;
        let recovery = PlannedUpdateAgentRecovery {
            version: RECOVERY_VERSION,
            project_id: project_id.to_string(),
            started_at: Utc::now().to_rfc3339(),
            request: request.clone(),
        };
        let _guard = store_lock()?;
        write_json_replace(&self.active_path(&request.session_id), &recovery)
    }

    pub(crate) fn record_conversation(
        &self,
        session_id: &str,
        conversation_id: &str,
    ) -> Result<(), String> {
        validate_session_id(session_id)?;
        if conversation_id.trim().is_empty() {
            return Err("업데이트 복구 대화 ID가 비어 있습니다.".to_string());
        }
        let _guard = store_lock()?;
        let path = self.active_path(session_id);
        let Some(mut recovery) = read_json_optional::<PlannedUpdateAgentRecovery>(&path)? else {
            return Ok(());
        };
        recovery.request.conversation_id = Some(conversation_id.to_string());
        write_json_replace(&path, &recovery)
    }

    pub(crate) fn finish(&self, session_id: &str) -> Result<(), String> {
        validate_session_id(session_id)?;
        let _guard = store_lock()?;
        remove_if_exists(&self.active_path(session_id))
    }

    pub(crate) fn prepare_for_update(
        &self,
        active_session_ids: &[String],
    ) -> Result<usize, String> {
        let _guard = store_lock()?;
        let active_session_ids = active_session_ids
            .iter()
            .filter(|session_id| validate_session_id(session_id).is_ok())
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        let mut session_ids = Vec::new();
        for entry in fs::read_dir(self.active_directory())
            .map_err(|error| format!("실행 중인 업데이트 복구 작업을 읽지 못했습니다: {error}"))?
        {
            let entry = entry
                .map_err(|error| format!("업데이트 복구 작업 항목을 읽지 못했습니다: {error}"))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(session_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if active_session_ids.contains(session_id) {
                session_ids.push(session_id.to_string());
            } else {
                remove_if_exists(&path)?;
            }
        }
        session_ids.sort();
        let marker = PlannedUpdateMarker {
            version: RECOVERY_VERSION,
            prepared_at: Utc::now().to_rfc3339(),
            session_ids,
        };
        let count = marker.session_ids.len();
        write_json_replace(&self.marker_path(), &marker)?;
        Ok(count)
    }

    pub(crate) fn take_prepared(&self) -> Result<Vec<PlannedUpdateAgentRecovery>, String> {
        let _guard = store_lock()?;
        let marker_path = self.marker_path();
        let Some(marker) = read_json_optional::<PlannedUpdateMarker>(&marker_path)? else {
            return Ok(Vec::new());
        };
        remove_if_exists(&marker_path)?;

        let fresh = marker_is_fresh(&marker);

        let mut recoveries = Vec::new();
        for session_id in marker.session_ids {
            if validate_session_id(&session_id).is_err() {
                continue;
            }
            let path = self.active_path(&session_id);
            let recovery = read_json_optional::<PlannedUpdateAgentRecovery>(&path)?;
            remove_if_exists(&path)?;
            if fresh {
                if let Some(recovery) = recovery.filter(|value| value.version == RECOVERY_VERSION) {
                    recoveries.push(recovery);
                }
            }
        }
        recoveries.sort_by(|left, right| left.started_at.cmp(&right.started_at));
        Ok(recoveries)
    }

    pub(crate) fn cleanup_unprepared(&self) -> Result<usize, String> {
        let _guard = store_lock()?;
        let marker_path = self.marker_path();
        if let Some(marker) = read_json_optional::<PlannedUpdateMarker>(&marker_path)? {
            if marker_is_fresh(&marker) {
                return Ok(0);
            }
            remove_if_exists(&marker_path)?;
        }
        let mut removed = 0;
        for entry in fs::read_dir(self.active_directory())
            .map_err(|error| format!("업데이트 복구 임시 작업을 읽지 못했습니다: {error}"))?
        {
            let entry = entry.map_err(|error| {
                format!("업데이트 복구 임시 작업 항목을 읽지 못했습니다: {error}")
            })?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            remove_if_exists(&path)?;
            removed += 1;
        }
        Ok(removed)
    }

    fn active_directory(&self) -> PathBuf {
        self.directory.join("active")
    }

    fn active_path(&self, session_id: &str) -> PathBuf {
        self.active_directory().join(format!("{session_id}.json"))
    }

    fn marker_path(&self) -> PathBuf {
        self.directory.join("prepared.json")
    }
}

fn store_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .lock()
        .map_err(|_| "업데이트 복구 저장소 잠금이 손상되었습니다.".to_string())
}

fn marker_is_fresh(marker: &PlannedUpdateMarker) -> bool {
    let prepared_at = DateTime::parse_from_rfc3339(&marker.prepared_at)
        .map(|value| value.with_timezone(&Utc))
        .ok();
    marker.version == RECOVERY_VERSION
        && prepared_at.is_some_and(|value| {
            let age = Utc::now().signed_duration_since(value);
            age >= Duration::zero() && age <= Duration::minutes(RECOVERY_MAX_AGE_MINUTES)
        })
}

fn validate_session_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
    {
        return Err("업데이트 복구 세션 ID가 올바르지 않습니다.".to_string());
    }
    Ok(())
}

fn read_json_optional<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("업데이트 복구 상태를 읽지 못했습니다: {error}")),
    };
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("업데이트 복구 상태가 손상되었습니다: {error}"))
}

fn write_json_replace(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("업데이트 복구 상태를 직렬화하지 못했습니다: {error}"))?;
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("업데이트 복구 임시 상태를 만들지 못했습니다: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temporary, path))
        .map_err(|error| format!("업데이트 복구 상태를 저장하지 못했습니다: {error}"))
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("업데이트 복구 상태를 정리하지 못했습니다: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentProviderKind;

    fn request(session_id: &str) -> ProjectAgentRunRequest {
        ProjectAgentRunRequest {
            session_id: session_id.to_string(),
            agent_id: "agent-1".to_string(),
            agent_name: "Release agent".to_string(),
            agent_provider: AgentProviderKind::Claude,
            agent_model: Some("sonnet".to_string()),
            agent_effort: None,
            responsibility: "Maintain releases".to_string(),
            skill: "Release safely".to_string(),
            message: "Prepare the release".to_string(),
            conversation_id: None,
            runs: Vec::new(),
            resume_after_update: true,
        }
    }

    #[test]
    fn returns_only_sessions_marked_by_a_planned_update() {
        let directory = tempfile::tempdir().expect("recovery fixture");
        let store = PlannedUpdateRecoveryStore::new(directory.path()).expect("store");
        store
            .begin("project-1", &request("session-1"))
            .expect("begin");

        assert!(store.take_prepared().expect("not prepared").is_empty());
        assert_eq!(
            store
                .prepare_for_update(&["session-1".to_string()])
                .expect("prepare"),
            1
        );
        let recoveries = store.take_prepared().expect("take");
        assert_eq!(recoveries.len(), 1);
        assert_eq!(recoveries[0].request.session_id, "session-1");
        assert!(store.take_prepared().expect("take once").is_empty());
    }

    #[test]
    fn checkpoints_the_provider_conversation_before_completion() {
        let directory = tempfile::tempdir().expect("recovery fixture");
        let store = PlannedUpdateRecoveryStore::new(directory.path()).expect("store");
        store
            .begin("project-1", &request("session-1"))
            .expect("begin");
        store
            .record_conversation("session-1", "briar:claude:project-1:thread-1")
            .expect("conversation");
        store
            .prepare_for_update(&["session-1".to_string()])
            .expect("prepare");

        let recovery = store.take_prepared().expect("take").remove(0);
        assert_eq!(
            recovery.request.conversation_id.as_deref(),
            Some("briar:claude:project-1:thread-1")
        );
    }

    #[test]
    fn completed_sessions_are_not_recovered() {
        let directory = tempfile::tempdir().expect("recovery fixture");
        let store = PlannedUpdateRecoveryStore::new(directory.path()).expect("store");
        store
            .begin("project-1", &request("session-1"))
            .expect("begin");
        store.finish("session-1").expect("finish");
        assert_eq!(
            store
                .prepare_for_update(&["session-1".to_string()])
                .expect("prepare"),
            0
        );
        assert!(store.take_prepared().expect("take").is_empty());
    }

    #[test]
    fn ignores_checkpoint_files_left_by_an_ordinary_crash() {
        let directory = tempfile::tempdir().expect("recovery fixture");
        let store = PlannedUpdateRecoveryStore::new(directory.path()).expect("store");
        store
            .begin("project-1", &request("stale-session"))
            .expect("begin");

        assert_eq!(store.prepare_for_update(&[]).expect("prepare"), 0);
        assert!(store.take_prepared().expect("take").is_empty());
        assert!(!store.active_path("stale-session").exists());
    }

    #[test]
    fn startup_cleans_unmarked_crash_checkpoints_but_keeps_update_recoveries() {
        let directory = tempfile::tempdir().expect("recovery fixture");
        let store = PlannedUpdateRecoveryStore::new(directory.path()).expect("store");
        store
            .begin("project-1", &request("crash-session"))
            .expect("begin");
        assert_eq!(store.cleanup_unprepared().expect("cleanup"), 1);

        store
            .begin("project-1", &request("update-session"))
            .expect("begin");
        store
            .prepare_for_update(&["update-session".to_string()])
            .expect("prepare");
        assert_eq!(store.cleanup_unprepared().expect("keep prepared"), 0);
        assert!(store.active_path("update-session").exists());
    }
}
