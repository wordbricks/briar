mod agent;
mod agent_usage;
mod auto_hunt_dispatch;
mod host;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[cfg(target_os = "macos")]
use tauri::{webview::Color, WebviewUrl, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const SESSION_FILE_NAME: &str = "session.json";
const AUTO_HUNT_EVENT_DIRECTORY: &str = "auto-hunt-sessions";
const AUTO_HUNT_APP_SERVER_EVENT: &str = "auto-hunt-app-server-event";
const AUTO_HUNT_DISPATCH_EVENT: &str = "auto-hunt-dispatch-event";
const PROJECT_AGENT_SCHEDULE_POLL_EVENT: &str = "project-agent-schedule-poll";
const AGENT_SESSION_STOPPED_ERROR: &str = "사용자가 에이전트 세션을 중지했습니다.";
const DEFAULT_MAIN_WINDOW_SIZE: (f64, f64) = (1280.0, 820.0);
const ONBOARDING_MAIN_WINDOW_SIZE: (f64, f64) = (980.0, 680.0);
const DISCOVERED_SSH_HOST_ID_PREFIX: &str = "ssh-config-";

#[derive(Deserialize, Serialize)]
struct StoredSession {
    token: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliProject {
    id: String,
    repository_path: String,
    /// API environment that issued this project's agent token. Legacy entries
    /// omit it and remain readable until the next connection save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_url: Option<String>,
    /// Which machine this project executes on. Absent means the local machine,
    /// so configs written before remote hosts existed keep working unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution_host_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    repository_remote: Option<String>,
    agent_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    llm: Option<agent::ProjectLlmSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_hunt: Option<StoredAutoHuntConfig>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoHuntConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    velen_org: Option<String>,
    #[serde(
        default,
        alias = "velenDataSource",
        skip_serializing_if = "Option::is_none"
    )]
    data_source: Option<String>,
    linear_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    linear_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    linear_team: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    github_repository: Option<String>,
    #[serde(default = "repository_workflow_bootstrap")]
    workflow: WorkflowConfig,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowConfig {
    version: u8,
    stages: Vec<WorkflowStageConfig>,
    #[serde(default)]
    completion: WorkflowCompletionConfig,
    #[serde(default)]
    release: WorkflowReleaseConfig,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowStageConfig {
    id: String,
    label: String,
    required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    checks: Vec<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowCompletionConfig {
    #[serde(default)]
    required_stages: Vec<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowReleaseConfig {
    #[serde(default)]
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectedLocalProject {
    repository_path: String,
    workflow: WorkflowConfig,
}

/// Origin remote URL, read on whichever host owns the repository.
fn repository_remote_on(runner: &dyn host::CommandRunner, path: &Path) -> Option<String> {
    if !runner.is_remote() {
        return repository_remote(path);
    }
    let git = runner.resolve_binary("git").ok()?;
    let output = runner
        .run(
            &host::CommandSpec::new(git)
                .args(["remote", "get-url", "origin"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .working_directory(path),
        )
        .ok()?;
    let remote = output.stdout_trimmed();
    (output.success() && !remote.is_empty()).then_some(remote)
}

fn repository_workflow_bootstrap() -> WorkflowConfig {
    WorkflowConfig {
        version: 1,
        stages: vec![WorkflowStageConfig {
            id: "repository_workflow_pending".to_string(),
            label: "Repository workflow pending".to_string(),
            required: true,
            evidence: Vec::new(),
            checks: Vec::new(),
        }],
        completion: WorkflowCompletionConfig {
            required_stages: vec!["repository_workflow_pending".to_string()],
        },
        release: WorkflowReleaseConfig { enabled: false },
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAutoHuntConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    velen_org: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    linear: Option<StoredLinearConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    github_repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workflow: Option<WorkflowConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    worktrees: Option<StoredWorktreeConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sandbox: Option<StoredSandboxConfig>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

/// Auto Hunt filesystem access. Full access is the default; an explicit
/// `fullAccess: false` confines writes to the checkout and worktree root.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSandboxConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    full_access: Option<bool>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSandboxSettings {
    full_access: bool,
}

impl Default for ProjectSandboxSettings {
    fn default() -> Self {
        Self { full_access: true }
    }
}

/// Per-issue worktree settings owned by the CLI (`briar project configure`).
/// The app only reads them, to learn which directory agents must be able to
/// write in.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorktreeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    branch_prefix: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLinearConfig {
    enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    team_key: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

impl From<AutoHuntConfig> for StoredAutoHuntConfig {
    fn from(config: AutoHuntConfig) -> Self {
        Self {
            velen_org: config.velen_org,
            data_source: config.data_source,
            linear: Some(StoredLinearConfig {
                enabled: config.linear_enabled,
                source: config.linear_source,
                team_key: config.linear_team,
                extra: BTreeMap::new(),
            }),
            github_repository: config.github_repository,
            workflow: Some(config.workflow),
            // Worktree and sandbox settings belong to the CLI; callers carry the
            // stored values over instead of letting an app-side save erase them.
            worktrees: None,
            sandbox: None,
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VelenOrganization {
    name: String,
    slug: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VelenSource {
    source_key: String,
    source_ref: String,
    provider: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VelenInspection {
    authenticated: bool,
    email: Option<String>,
    current_org: Option<String>,
    organizations: Vec<VelenOrganization>,
    sources: Vec<VelenSource>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OnboardingPrerequisiteStatus {
    installed: bool,
    version: Option<String>,
    authenticated: bool,
}

#[derive(Serialize)]
struct OnboardingPrerequisites {
    git: OnboardingPrerequisiteStatus,
    codex: OnboardingPrerequisiteStatus,
    claude: OnboardingPrerequisiteStatus,
    grok: OnboardingPrerequisiteStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryReadiness {
    repository_path: String,
    git_installed: bool,
    git_version: Option<String>,
    repository_healthy: bool,
    remote: Option<String>,
    remote_reachable: bool,
    push_access: bool,
    requires_github: bool,
    github_repository: Option<String>,
    gh_installed: bool,
    gh_version: Option<String>,
    gh_authenticated: bool,
    gh_account: Option<String>,
    github_write_access: bool,
    git_ready: bool,
    pr_ready: bool,
    issues: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoHuntHealth {
    project_id: String,
    healthy: bool,
    repository_path: Option<String>,
    repository_remote: Option<String>,
    repository_healthy: bool,
    cli_path: String,
    cli_installed: bool,
    cli_version: Option<String>,
    cli_expected_version: String,
    cli_current: bool,
    skill_path: String,
    skill_installed: bool,
    skill_version: Option<String>,
    skill_expected_version: String,
    skill_current: bool,
    velen_org: Option<String>,
    velen_authenticated: bool,
    velen_email: Option<String>,
    velen_healthy: bool,
    issues: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliConfig {
    api_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_token: Option<String>,
    #[serde(default)]
    agent_providers: AppProviderSettings,
    #[serde(default)]
    app_settings: StoredAppRuntimeSettings,
    #[serde(default)]
    projects: Vec<CliProject>,
    /// Saved SSH execution hosts. Local to this machine: never sent to the
    /// Worker, and holding no secrets — OpenSSH owns key and agent resolution.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ssh_hosts: Vec<host::SshHost>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAppRuntimeSettings {
    #[serde(default)]
    prevent_sleep_while_running: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppRuntimeSettings {
    prevent_sleep_while_running: bool,
    prevent_sleep_supported: bool,
}

impl From<StoredAppRuntimeSettings> for AppRuntimeSettings {
    fn from(settings: StoredAppRuntimeSettings) -> Self {
        Self {
            prevent_sleep_while_running: settings.prevent_sleep_while_running,
            prevent_sleep_supported: cfg!(target_os = "macos"),
        }
    }
}

struct SleepPreventionState {
    enabled: AtomicBool,
    #[cfg(target_os = "macos")]
    process: Mutex<Option<Child>>,
}

#[derive(Clone, Default)]
struct AgentSessionCancellationState {
    sessions: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

struct AgentSessionCancellation {
    session_id: String,
    cancelled: Arc<AtomicBool>,
    sessions: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

impl AgentSessionCancellationState {
    fn register(&self, session_id: &str) -> Result<AgentSessionCancellation, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "에이전트 세션 중단 상태 잠금이 손상되었습니다.".to_string())?;
        if sessions.contains_key(session_id) {
            return Err("같은 ID의 에이전트 세션이 이미 실행 중입니다.".to_string());
        }
        sessions.insert(session_id.to_string(), Arc::clone(&cancelled));
        Ok(AgentSessionCancellation {
            session_id: session_id.to_string(),
            cancelled,
            sessions: Arc::clone(&self.sessions),
        })
    }

    fn stop(&self, session_id: &str) -> Result<bool, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "에이전트 세션 중단 상태 잠금이 손상되었습니다.".to_string())?;
        let Some(cancelled) = sessions.get(session_id) else {
            return Ok(false);
        };
        cancelled.store(true, Ordering::SeqCst);
        Ok(true)
    }
}

impl AgentSessionCancellation {
    fn signal(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

impl Drop for AgentSessionCancellation {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if sessions
                .get(&self.session_id)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancelled))
            {
                sessions.remove(&self.session_id);
            }
        }
    }
}

fn ensure_agent_session_running(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err(AGENT_SESSION_STOPPED_ERROR.to_string())
    } else {
        Ok(())
    }
}

impl Default for SleepPreventionState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            #[cfg(target_os = "macos")]
            process: Mutex::new(None),
        }
    }
}

impl SleepPreventionState {
    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.enabled.store(enabled, Ordering::SeqCst);
        self.refresh()
    }

    fn refresh(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let mut process = self
                .process
                .lock()
                .map_err(|_| "절전 방지 상태 잠금이 손상되었습니다.".to_string())?;
            if self.enabled.load(Ordering::SeqCst) {
                if process
                    .as_mut()
                    .is_some_and(|child| child.try_wait().is_ok_and(|status| status.is_none()))
                {
                    return Ok(());
                }
                if let Some(mut child) = process.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let app_process_id = std::process::id().to_string();
                *process = Some(
                    Command::new("/usr/bin/caffeinate")
                        .args(["-i", "-w", &app_process_id])
                        .spawn()
                        .map_err(|error| {
                            format!("macOS 절전 방지를 시작하지 못했습니다: {error}")
                        })?,
                );
            } else if let Some(mut child) = process.take() {
                child
                    .kill()
                    .map_err(|error| format!("macOS 절전 방지를 중지하지 못했습니다: {error}"))?;
                let _ = child.wait();
            }
        }
        Ok(())
    }
}

impl Drop for SleepPreventionState {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        if let Ok(process) = self.process.get_mut() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppProviderSettings {
    #[serde(default = "enabled_by_default")]
    codex: bool,
    #[serde(default = "enabled_by_default")]
    claude: bool,
    #[serde(default = "enabled_by_default")]
    grok: bool,
}

impl Default for AppProviderSettings {
    fn default() -> Self {
        Self {
            codex: true,
            claude: true,
            grok: true,
        }
    }
}

impl AppProviderSettings {
    fn is_enabled(self, provider: agent::AgentProviderKind) -> bool {
        match provider {
            agent::AgentProviderKind::Codex => self.codex,
            agent::AgentProviderKind::Claude => self.claude,
            agent::AgentProviderKind::Grok => self.grok,
        }
    }

    fn any_enabled(self) -> bool {
        self.codex || self.claude || self.grok
    }
}

fn enabled_by_default() -> bool {
    true
}

fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(SESSION_FILE_NAME))
}

fn read_session_token_from(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Briar 로그인 세션을 읽지 못했습니다: {error}"))?;
    let session = serde_json::from_str::<StoredSession>(&contents)
        .map_err(|error| format!("Briar 로그인 세션이 손상되었습니다: {error}"))?;
    if session.token.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(session.token))
}

fn write_session_token_to(path: &Path, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("session token cannot be empty".to_string());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Briar 설정 폴더를 찾을 수 없습니다.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Briar 설정 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Briar 설정 폴더 권한을 지정하지 못했습니다: {error}"))?;
    }

    let temporary_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec(&StoredSession { token })
        .map_err(|error| format!("Briar 로그인 세션을 만들지 못했습니다: {error}"))?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .map_err(|error| format!("Briar 로그인 세션을 열지 못했습니다: {error}"))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Briar 로그인 세션을 저장하지 못했습니다: {error}"))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("Briar 로그인 세션을 교체하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 로그인 세션 권한을 지정하지 못했습니다: {error}"))?;
    }
    Ok(())
}

fn clear_session_token_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Briar 로그인 세션을 삭제하지 못했습니다: {error}")),
    }
}

#[tauri::command]
fn read_session_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_session_token_from(&session_file_path(&app)?)
}

#[tauri::command]
fn write_session_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    write_session_token_to(&session_file_path(&app)?, token)
}

#[tauri::command]
fn clear_session_token(app: tauri::AppHandle) -> Result<(), String> {
    clear_session_token_at(&session_file_path(&app)?)
}

fn valid_app_icon(icon: &str) -> bool {
    matches!(icon, "purple" | "gray" | "pink" | "green")
}

#[cfg(target_os = "ios")]
unsafe extern "C" {
    fn briar_ios_current_app_icon(buffer: *mut std::ffi::c_char, length: usize) -> i32;
    fn briar_ios_set_app_icon(icon: *const std::ffi::c_char) -> i32;
}

#[tauri::command]
fn current_app_icon() -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let mut buffer = [0 as std::ffi::c_char; 32];
        let has_alternate_icon =
            unsafe { briar_ios_current_app_icon(buffer.as_mut_ptr(), buffer.len()) } == 1;
        if !has_alternate_icon {
            return Ok("purple".to_string());
        }
        let icon = unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }
            .to_str()
            .map_err(|_| "The selected iOS app icon is invalid.".to_string())?;
        return Ok(if valid_app_icon(icon) {
            icon.to_string()
        } else {
            "purple".to_string()
        });
    }
    #[cfg(not(target_os = "ios"))]
    Err("Native app icon selection is only handled by this command on iOS.".to_string())
}

#[tauri::command]
fn set_app_icon(icon: String) -> Result<(), String> {
    if !valid_app_icon(&icon) {
        return Err("Unsupported app icon.".to_string());
    }
    #[cfg(target_os = "ios")]
    {
        let icon_name = (icon != "purple")
            .then(|| std::ffi::CString::new(icon).expect("validated icon names contain no nulls"));
        let pointer = icon_name
            .as_ref()
            .map_or(std::ptr::null(), |name| name.as_ptr());
        if unsafe { briar_ios_set_app_icon(pointer) } == 1 {
            return Ok(());
        }
        return Err("This device does not support alternate app icons.".to_string());
    }
    #[cfg(not(target_os = "ios"))]
    Err("Native app icon selection is only handled by this command on iOS.".to_string())
}

#[tauri::command]
fn set_app_badge_count(window: tauri::Window, count: u32) -> Result<(), String> {
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| format!("App badge count update failed: {error}"))
}

fn git_repository_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("선택한 폴더를 찾을 수 없습니다.".to_string());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| format!("Git을 실행할 수 없습니다: {error}"))?;
    if !output.status.success() {
        return Err("Git 저장소 폴더를 선택하세요.".to_string());
    }
    let root = String::from_utf8(output.stdout)
        .map_err(|_| "Git 저장소 경로를 읽을 수 없습니다.".to_string())?;
    let root = PathBuf::from(root.trim());
    if !root.is_dir() {
        return Err("Git 저장소의 최상위 폴더를 찾을 수 없습니다.".to_string());
    }
    Ok(root)
}

fn repository_remote(path: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let remote = String::from_utf8(output.stdout).ok()?;
    let remote = remote.trim();
    (!remote.is_empty()).then(|| remote.to_string())
}

fn git_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("git", Some(cli_execution_path(home)?), home)
        .map_err(|_| "Git이 필요합니다. Git을 설치한 뒤 다시 확인하세요.".to_string())
}

fn gh_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("gh", Some(cli_execution_path(home)?), home)
        .map_err(|_| "GitHub CLI가 설치되지 않았습니다.".to_string())
}

fn parse_cli_version(stdout: &[u8]) -> Option<String> {
    let output = String::from_utf8_lossy(stdout);
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return value
            .pointer("/data/display")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .map(str::to_string);
    }
    trimmed.lines().next().map(str::trim).map(str::to_string)
}

fn inspect_cli(binary: Result<PathBuf, String>) -> OnboardingPrerequisiteStatus {
    let Ok(binary) = binary else {
        return OnboardingPrerequisiteStatus {
            installed: false,
            version: None,
            authenticated: false,
        };
    };
    let version = Command::new(&binary)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| parse_cli_version(&output.stdout));
    OnboardingPrerequisiteStatus {
        installed: true,
        version,
        authenticated: true,
    }
}

fn inspect_onboarding_prerequisites_sync(home: &Path) -> OnboardingPrerequisites {
    let execution_path = cli_execution_path(home).unwrap_or_default();
    OnboardingPrerequisites {
        git: inspect_cli(git_binary(home)),
        codex: inspect_cli(agent::codex_binary(home)),
        claude: inspect_cli(agent::claude_binary(home, &execution_path)),
        grok: inspect_cli(agent::grok_binary(home, &execution_path)),
    }
}

#[tauri::command]
async fn inspect_onboarding_prerequisites(
    app: tauri::AppHandle,
) -> Result<OnboardingPrerequisites, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || inspect_onboarding_prerequisites_sync(&home))
        .await
        .map_err(|error| error.to_string())
}

fn install_cli_package(home: &Path, package: &str) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let mut failures = Vec::new();
    for (manager, args) in [
        ("bun", vec!["add", "--global", package]),
        ("npm", vec!["install", "--global", package]),
    ] {
        let Ok(binary) = which::which_in(manager, Some(&execution_path), home) else {
            continue;
        };
        match Command::new(binary)
            .env("PATH", &execution_path)
            .args(args)
            .output()
        {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let message = String::from_utf8_lossy(&output.stderr);
                let message = message.trim();
                failures.push(if message.is_empty() {
                    format!("{manager} 설치 명령이 실패했습니다.")
                } else {
                    format!("{manager}: {message}")
                });
            }
            Err(error) => failures.push(format!("{manager}: {error}")),
        }
    }
    if failures.is_empty() {
        Err("설치에 필요한 Bun 또는 npm을 찾지 못했습니다.".to_string())
    } else {
        Err(format!(
            "CLI를 설치하지 못했습니다. {}",
            failures.join(" / ")
        ))
    }
}

fn install_brew_package(home: &Path, package: &str) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let brew = which::which_in("brew", Some(&execution_path), home).map_err(|_| {
        format!(
            "{package} 자동 설치에는 Homebrew가 필요합니다. Homebrew를 설치한 뒤 다시 시도하세요."
        )
    })?;
    let output = Command::new(brew)
        .env("PATH", execution_path)
        .args(["install", package])
        .output()
        .map_err(|error| format!("{package} 설치 명령을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "{package}를 설치하지 못했습니다: {}",
        message.trim()
    ))
}

fn install_grok_cli(home: &Path) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let shell = which::which_in("bash", Some(&execution_path), home)
        .or_else(|_| which::which_in("sh", Some(&execution_path), home))
        .map_err(|_| "Grok 설치에 필요한 shell을 찾지 못했습니다.".to_string())?;
    let output = Command::new(shell)
        .env("PATH", &execution_path)
        .env("HOME", home)
        .args(["-c", "curl -fsSL https://x.ai/cli/install.sh | bash"])
        .output()
        .map_err(|error| format!("Grok CLI 설치 명령을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = [stderr.trim(), stdout.trim()]
        .into_iter()
        .find(|part| !part.is_empty())
        .unwrap_or("unknown error");
    Err(format!("Grok CLI를 설치하지 못했습니다: {message}"))
}

#[tauri::command]
async fn install_onboarding_prerequisite(
    app: tauri::AppHandle,
    prerequisite: String,
) -> Result<OnboardingPrerequisites, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        match prerequisite.as_str() {
            "git" => install_brew_package(&home, "git")?,
            "codex" => install_cli_package(&home, "@openai/codex")?,
            "claude" => install_cli_package(&home, "@anthropic-ai/claude-code")?,
            "grok" => install_grok_cli(&home)?,
            _ => return Err("지원하지 않는 필수 도구입니다.".to_string()),
        }
        let prerequisites = inspect_onboarding_prerequisites_sync(&home);
        let installed = match prerequisite.as_str() {
            "git" => prerequisites.git.installed,
            "codex" => prerequisites.codex.installed,
            "claude" => prerequisites.claude.installed,
            "grok" => prerequisites.grok.installed,
            _ => false,
        };
        if !installed {
            return Err(
                "설치는 완료됐지만 CLI를 찾지 못했습니다. Briar를 다시 열어 주세요.".to_string(),
            );
        }
        Ok(prerequisites)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn bundled_runtime_directories(executable: &Path) -> Vec<PathBuf> {
    let Some(directory) = executable.parent() else {
        return Vec::new();
    };
    let mut directories = vec![directory.to_path_buf()];
    if directory.file_name() == Some(OsStr::new("deps")) {
        if let Some(target_profile) = directory.parent() {
            directories.push(target_profile.to_path_buf());
        }
    }
    directories
}

pub(crate) fn bundled_bun_binary() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .into_iter()
        .flat_map(|executable| bundled_runtime_directories(&executable))
        .map(|directory| directory.join("bun"))
        .find(|candidate| candidate.is_file())
}

fn cli_execution_path_with_runtime(
    home: &Path,
    runtime_directories: impl IntoIterator<Item = PathBuf>,
) -> Result<OsString, String> {
    let mut paths = runtime_directories.into_iter().collect::<Vec<_>>();
    paths.extend([
        home.join(".local/bin"),
        home.join(".grok/bin"),
        home.join("bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        home.join(".volta/bin"),
        home.join(".asdf/shims"),
        home.join(".asdf/bin"),
        home.join(".local/share/mise/shims"),
        home.join(".mise/shims"),
        home.join(".nodenv/shims"),
        home.join(".nodenv/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
    }
    env::join_paths(paths).map_err(|error| format!("CLI 실행 경로를 구성하지 못했습니다: {error}"))
}

fn cli_execution_path(home: &Path) -> Result<OsString, String> {
    let runtime_directories = env::current_exe()
        .map(|executable| bundled_runtime_directories(&executable))
        .unwrap_or_default();
    cli_execution_path_with_runtime(home, runtime_directories)
}

fn workflow_requires_github(workflow: &WorkflowConfig) -> bool {
    workflow.stages.iter().any(|stage| {
        stage.id == "pr_open"
            || stage
                .evidence
                .iter()
                .any(|evidence| evidence == "pull_request")
    })
}

fn github_repository_from_remote(remote: &str) -> Option<String> {
    let trimmed = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = if let Some(path) = trimmed.strip_prefix("https://github.com/") {
        path
    } else if let Some(path) = trimmed.strip_prefix("http://github.com/") {
        path
    } else if let Some(path) = trimmed.strip_prefix("ssh://git@github.com/") {
        path
    } else {
        trimmed.strip_prefix("git@github.com:")?
    };
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?;
    let repository = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repository}"))
}

fn command_failure(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if message.is_empty() {
        "명령이 실패했습니다.".to_string()
    } else {
        message.lines().next().unwrap_or(message).to_string()
    }
}

fn inspect_repository_readiness_on(
    runner: &dyn host::CommandRunner,
    repository_path: &Path,
    workflow: &WorkflowConfig,
) -> RepositoryReadiness {
    let mut issues = Vec::new();
    let requires_github = workflow_requires_github(workflow);
    let git = runner.resolve_binary("git");
    let git_installed = git.is_ok();
    let git_version = git
        .as_ref()
        .ok()
        .and_then(|binary| {
            runner
                .run(&host::CommandSpec::new(binary).args(["--version"]))
                .ok()
        })
        .filter(host::CommandOutput::success)
        .and_then(|output| parse_cli_version(output.stdout.as_bytes()));
    if !git_installed {
        issues.push("Git이 설치되지 않았습니다.".to_string());
    }

    let root = git
        .as_ref()
        .ok()
        .and_then(|binary| {
            runner
                .run(
                    &host::CommandSpec::new(binary)
                        .args(["rev-parse", "--show-toplevel"])
                        .working_directory(repository_path),
                )
                .ok()
        })
        .filter(host::CommandOutput::success)
        .map(|output| PathBuf::from(output.stdout_trimmed()))
        .and_then(|path| runner.canonicalize(&path).ok());
    let repository_healthy = root.is_some();
    if git_installed && !repository_healthy {
        issues.push("선택한 폴더가 유효한 Git 저장소가 아닙니다.".to_string());
    }
    let resolved_path = root.as_deref().unwrap_or(repository_path);
    let remote = repository_healthy
        .then(|| repository_remote_on(runner, resolved_path))
        .flatten();
    if remote.is_none() {
        issues.push("origin 원격 저장소가 설정되지 않았습니다.".to_string());
    }

    let safe_remote = remote.as_deref().is_some_and(|remote| {
        remote.starts_with("https://")
            || remote.starts_with("http://")
            || remote.starts_with("ssh://")
            || remote.starts_with("git@")
    });
    let remote_reachable = git
        .as_ref()
        .ok()
        .filter(|_| repository_healthy && safe_remote)
        .and_then(|binary| {
            runner
                .run(
                    &host::CommandSpec::new(binary)
                        .env("GIT_TERMINAL_PROMPT", "0")
                        .env("GCM_INTERACTIVE", "Never")
                        .env(
                            "GIT_SSH_COMMAND",
                            "ssh -o BatchMode=yes -o ConnectTimeout=8",
                        )
                        .args(["-c", "http.lowSpeedLimit=1"])
                        .args(["-c", "http.lowSpeedTime=8"])
                        .args(["ls-remote", "--exit-code", "origin", "HEAD"])
                        .working_directory(resolved_path),
                )
                .ok()
        })
        .is_some_and(|output| output.success());
    if remote.is_some() && !remote_reachable {
        issues.push("origin에 인증된 상태로 접근할 수 없습니다.".to_string());
    }

    // `--dry-run` validates the receive-pack transport without updating a
    // remote ref. Hooks are disabled because connected repositories are
    // untrusted input during onboarding.
    let push_access = git
        .as_ref()
        .ok()
        .filter(|_| repository_healthy && remote_reachable)
        .and_then(|binary| {
            let sha = runner
                .run(
                    &host::CommandSpec::new(binary)
                        .args(["rev-parse", "--short=12", "HEAD"])
                        .working_directory(resolved_path),
                )
                .ok()
                .filter(host::CommandOutput::success)?
                .stdout_trimmed();
            let target = format!("HEAD:refs/heads/briar-access-check-{sha}");
            runner
                .run(
                    &host::CommandSpec::new(binary)
                        .env("GIT_TERMINAL_PROMPT", "0")
                        .env("GCM_INTERACTIVE", "Never")
                        .env(
                            "GIT_SSH_COMMAND",
                            "ssh -o BatchMode=yes -o ConnectTimeout=8",
                        )
                        .args(["-c", "core.hooksPath=/dev/null"])
                        .args(["-c", "http.lowSpeedLimit=1"])
                        .args(["-c", "http.lowSpeedTime=8"])
                        .args(["push", "--dry-run", "--porcelain", "origin"])
                        .args([target])
                        .working_directory(resolved_path),
                )
                .ok()
        })
        .is_some_and(|output| output.success());
    if remote_reachable && !push_access {
        issues.push("origin에 브랜치를 push할 권한을 확인하지 못했습니다.".to_string());
    }

    let github_repository = remote.as_deref().and_then(github_repository_from_remote);
    if requires_github && github_repository.is_none() {
        issues.push("PR 단계에는 GitHub origin 저장소가 필요합니다.".to_string());
    }
    let gh = if requires_github {
        runner.resolve_binary("gh")
    } else {
        Err("현재 워크플로우에는 GitHub CLI가 필요하지 않습니다.".to_string())
    };
    let gh_installed = gh.is_ok();
    let gh_version = gh
        .as_ref()
        .ok()
        .and_then(|binary| {
            runner
                .run(&host::CommandSpec::new(binary).args(["--version"]))
                .ok()
        })
        .filter(host::CommandOutput::success)
        .and_then(|output| parse_cli_version(output.stdout.as_bytes()));
    let gh_authenticated = gh
        .as_ref()
        .ok()
        .and_then(|binary| {
            runner
                .run(&host::CommandSpec::new(binary).args([
                    "auth",
                    "status",
                    "--hostname",
                    "github.com",
                ]))
                .ok()
        })
        .is_some_and(|output| output.success());
    let gh_account = gh
        .as_ref()
        .ok()
        .filter(|_| gh_authenticated)
        .and_then(|binary| {
            runner
                .run(&host::CommandSpec::new(binary).args(["api", "user", "--jq", ".login"]))
                .ok()
        })
        .filter(host::CommandOutput::success)
        .map(|output| output.stdout_trimmed())
        .filter(|account| !account.is_empty());
    let github_write_access = gh
        .as_ref()
        .ok()
        .filter(|_| gh_authenticated)
        .zip(github_repository.as_ref())
        .and_then(|(binary, repository)| {
            runner
                .run(&host::CommandSpec::new(binary).args([
                    "repo",
                    "view",
                    repository,
                    "--json",
                    "viewerPermission",
                    "--jq",
                    ".viewerPermission",
                ]))
                .ok()
        })
        .filter(host::CommandOutput::success)
        .is_some_and(|output| matches!(output.stdout.trim(), "WRITE" | "MAINTAIN" | "ADMIN"));
    if requires_github && !gh_installed {
        issues.push("PR 단계 실행에 필요한 GitHub CLI가 설치되지 않았습니다.".to_string());
    } else if requires_github && !gh_authenticated {
        issues.push("GitHub CLI 로그인이 필요합니다.".to_string());
    } else if requires_github && !github_write_access {
        issues.push("GitHub 저장소 쓰기 권한을 확인하지 못했습니다.".to_string());
    }

    let git_ready = git_installed && repository_healthy;
    let pr_ready = git_ready
        && remote_reachable
        && push_access
        && github_repository.is_some()
        && gh_installed
        && gh_authenticated
        && github_write_access;

    RepositoryReadiness {
        repository_path: resolved_path.to_string_lossy().into_owned(),
        git_installed,
        git_version,
        repository_healthy,
        remote,
        remote_reachable,
        push_access,
        requires_github,
        github_repository,
        gh_installed,
        gh_version,
        gh_authenticated,
        gh_account,
        github_write_access,
        git_ready,
        pr_ready,
        issues,
    }
}

fn project_repository_readiness_at(
    config_path: &Path,
    project_id: &str,
    home: &Path,
) -> Result<RepositoryReadiness, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let workflow = project
        .auto_hunt
        .as_ref()
        .and_then(|auto_hunt| auto_hunt.workflow.as_ref())
        .cloned()
        .unwrap_or_else(repository_workflow_bootstrap);
    let runner = project_runner(&config, project_id, home)?;
    Ok(inspect_repository_readiness_on(
        runner.as_ref(),
        Path::new(&project.repository_path),
        &workflow,
    ))
}

#[tauri::command]
async fn inspect_repository_readiness(
    app: tauri::AppHandle,
    repository_path: String,
    workflow: WorkflowConfig,
    execution_host_id: Option<String>,
) -> Result<RepositoryReadiness, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let execution_host = host::ExecutionHostId::parse(execution_host_id.as_deref());
        let runner = host::runner_for(
            &execution_host,
            &config.ssh_hosts,
            cli_execution_path(&home)?,
            &home,
            host::SshAuth::default(),
        )?;
        Ok(inspect_repository_readiness_on(
            runner.as_ref(),
            Path::new(&repository_path),
            &workflow,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_repository_readiness(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RepositoryReadiness, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        project_repository_readiness_at(&config_path, &project_id, &home)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_project_github_cli(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RepositoryReadiness, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if gh_binary(&home).is_err() {
            install_brew_package(&home, "gh")?;
        }
        let readiness = project_repository_readiness_at(&config_path, &project_id, &home)?;
        if !readiness.gh_installed {
            return Err(
                "설치는 완료됐지만 GitHub CLI를 찾지 못했습니다. Briar를 다시 열어 주세요."
                    .to_string(),
            );
        }
        Ok(readiness)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn login_project_github(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RepositoryReadiness, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let binary = gh_binary(&home)?;
        let execution_path = cli_execution_path(&home)?;
        let authenticated = Command::new(&binary)
            .env("PATH", &execution_path)
            .args(["auth", "status", "--hostname", "github.com"])
            .output()
            .is_ok_and(|output| output.status.success());
        if !authenticated {
            let help = Command::new(&binary)
                .env("PATH", &execution_path)
                .args(["auth", "login", "--help"])
                .output()
                .ok();
            let supports_clipboard = help.as_ref().is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout).contains("--clipboard")
            });
            let mut command = Command::new(&binary);
            command.env("PATH", &execution_path).args([
                "auth",
                "login",
                "--hostname",
                "github.com",
                "--git-protocol",
                "https",
                "--web",
            ]);
            if supports_clipboard {
                command.arg("--clipboard");
            }
            let output = command
                .output()
                .map_err(|error| format!("GitHub 로그인을 시작하지 못했습니다: {error}"))?;
            if !output.status.success() {
                return Err(format!(
                    "GitHub 로그인에 실패했습니다: {}",
                    command_failure(&output)
                ));
            }
        }
        let setup = Command::new(&binary)
            .env("PATH", &execution_path)
            .args(["auth", "setup-git", "--hostname", "github.com"])
            .output()
            .map_err(|error| format!("Git push 인증을 설정하지 못했습니다: {error}"))?;
        if !setup.status.success() {
            return Err(format!(
                "Git push 인증을 설정하지 못했습니다: {}",
                command_failure(&setup)
            ));
        }
        let readiness = project_repository_readiness_at(&config_path, &project_id, &home)?;
        if !readiness.gh_authenticated {
            return Err("GitHub 로그인은 완료됐지만 인증 상태를 확인하지 못했습니다.".to_string());
        }
        Ok(readiness)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
fn run_velen_json_with(
    binary: &Path,
    home: &Path,
    args: &[&str],
) -> Result<serde_json::Value, String> {
    let output = Command::new(binary)
        .env("PATH", cli_execution_path(home)?)
        .args(["--output", "json"])
        .args(args)
        .output()
        .map_err(|error| format!("Velen CLI를 실행하지 못했습니다: {error}"))?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| String::from_utf8_lossy(&output.stderr).trim().to_string())?;
    if !output.status.success() || value.get("ok").and_then(|ok| ok.as_bool()) == Some(false) {
        let message = value
            .pointer("/error/message")
            .or_else(|| value.get("message"))
            .and_then(|message| message.as_str())
            .unwrap_or("Velen CLI 요청에 실패했습니다.");
        return Err(message.to_string());
    }
    Ok(value)
}

fn run_velen_json_on(
    runner: &dyn host::CommandRunner,
    args: &[&str],
) -> Result<serde_json::Value, String> {
    let binary = runner.resolve_binary("velen")?;
    let output = runner.run(
        &host::CommandSpec::new(binary)
            .args(["--output", "json"])
            .args(args.iter().copied()),
    )?;
    let value: serde_json::Value =
        serde_json::from_str(&output.stdout).map_err(|_| output.failure_message())?;
    if !output.success() || value.get("ok").and_then(|ok| ok.as_bool()) == Some(false) {
        let message = value
            .pointer("/error/message")
            .or_else(|| value.get("message"))
            .and_then(|message| message.as_str())
            .unwrap_or("Velen CLI 요청에 실패했습니다.");
        return Err(message.to_string());
    }
    Ok(value)
}

fn inspect_velen_sync(org: Option<String>) -> Result<VelenInspection, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾을 수 없습니다.".to_string())?;
    let runner = host::LocalRunner::new(cli_execution_path(&home)?, home);
    inspect_velen_on(&runner, org)
}

fn inspect_velen_on(
    runner: &dyn host::CommandRunner,
    org: Option<String>,
) -> Result<VelenInspection, String> {
    let whoami = run_velen_json_on(runner, &["auth", "whoami"])?;
    let authenticated = whoami
        .pointer("/data/authenticated")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !authenticated {
        return Err("Velen CLI 로그인이 필요합니다.".to_string());
    }
    let email = whoami
        .pointer("/data/user/email")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let current_org = whoami
        .pointer("/data/effectiveOrg")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let organizations = run_velen_json_on(runner, &["org", "list"])?
        .pointer("/data/organizations")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|organization| {
            Some(VelenOrganization {
                name: organization.get("name")?.as_str()?.to_string(),
                slug: organization.get("slug")?.as_str()?.to_string(),
            })
        })
        .collect();
    let selected_org = org.or_else(|| current_org.clone());
    let sources = if let Some(selected_org) = selected_org.as_deref() {
        run_velen_json_on(runner, &["--org", selected_org, "source", "list"])?
            .pointer("/data/sources")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|source| {
                let provider = source.get("provider")?.as_str()?.to_string();
                let source_key = source.get("sourceKey")?.as_str()?.to_string();
                Some(VelenSource {
                    source_ref: format!("{provider}://{source_key}"),
                    source_key,
                    provider,
                    status: source.get("status")?.as_str()?.to_string(),
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(VelenInspection {
        authenticated,
        email,
        current_org,
        organizations,
        sources,
    })
}

#[tauri::command]
async fn inspect_velen(
    app: tauri::AppHandle,
    org: Option<String>,
    execution_host_id: Option<String>,
) -> Result<VelenInspection, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let execution_host = host::ExecutionHostId::parse(execution_host_id.as_deref());
        let runner = host::runner_for(
            &execution_host,
            &config.ssh_hosts,
            cli_execution_path(&home)?,
            &home,
            host::SshAuth::default(),
        )?;
        inspect_velen_on(runner.as_ref(), org)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn validate_repository_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = git_repository_root(Path::new(&path))?;
        root.into_os_string()
            .into_string()
            .map_err(|_| "Git 저장소 경로를 표시할 수 없습니다.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Folder that holds the repositories Briar creates for brand-new projects.
fn briar_workspace_root(home: &Path) -> PathBuf {
    home.join("Briar")
}

/// Turns a project name into a folder name that is safe on every platform.
fn project_folder_name(name: &str) -> Result<String, String> {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || character.is_whitespace()
                || "/\\:*?\"<>|".contains(character)
            {
                '-'
            } else {
                character
            }
        })
        .collect();
    let folder = sanitized
        .trim_matches(|character| matches!(character, '-' | '.'))
        .to_string();
    if folder.is_empty() {
        return Err("이 이름으로는 폴더를 만들 수 없습니다. 다른 이름을 입력하세요.".to_string());
    }
    Ok(folder)
}

/// Resolves a folder the same way repository checks do, so the stored path matches.
fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("프로젝트 폴더를 열지 못했습니다: {error}"))
}

fn path_display_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "경로를 표시할 수 없습니다.".to_string())
}

fn init_git_repository(git: &Path, path: &Path, name: &str) -> Result<(), String> {
    let init = Command::new(git)
        .arg("-C")
        .arg(path)
        .args(["init", "-b", "main"])
        .output()
        .map_err(|error| format!("Git을 실행할 수 없습니다: {error}"))?;
    if !init.status.success() {
        // Git older than 2.28 has no -b, so fall back to its default branch name.
        let fallback = Command::new(git)
            .arg("-C")
            .arg(path)
            .arg("init")
            .output()
            .map_err(|error| format!("Git을 실행할 수 없습니다: {error}"))?;
        if !fallback.status.success() {
            return Err(format!(
                "Git 저장소를 초기화하지 못했습니다: {}",
                String::from_utf8_lossy(&fallback.stderr).trim()
            ));
        }
    }
    let readme = path.join("README.md");
    if !readme.exists() {
        fs::write(&readme, format!("# {name}\n"))
            .map_err(|error| format!("README.md를 만들지 못했습니다: {error}"))?;
    }
    // The first commit needs a Git identity, so leave the file staged when it is missing.
    let _ = Command::new(git)
        .arg("-C")
        .arg(path)
        .args(["add", "README.md"])
        .output();
    let _ = Command::new(git)
        .arg("-C")
        .arg(path)
        .args(["commit", "-m", "chore: initialize project"])
        .output();
    Ok(())
}

fn create_project_workspace_in(
    git: &Path,
    root: &Path,
    name: &str,
) -> Result<CreatedProjectWorkspace, String> {
    let folder = project_folder_name(name)?;
    let target = root.join(&folder);
    if target.exists() {
        if !target.is_dir() {
            return Err(format!(
                "{} 경로에 이미 파일이 있습니다. 다른 이름을 입력하세요.",
                target.display()
            ));
        }
        if target.join(".git").exists() {
            // Retrying after a failed project creation should reuse what we already made.
            return Ok(CreatedProjectWorkspace {
                repository_path: path_display_string(canonical_directory(&target)?)?,
                created: false,
            });
        }
        let is_empty = fs::read_dir(&target)
            .map_err(|error| format!("폴더를 읽지 못했습니다: {error}"))?
            .next()
            .is_none();
        if !is_empty {
            return Err(format!(
                "{} 폴더가 이미 있습니다. 기존 저장소 연결을 사용하거나 다른 이름을 입력하세요.",
                target.display()
            ));
        }
    }
    fs::create_dir_all(&target)
        .map_err(|error| format!("프로젝트 폴더를 만들지 못했습니다: {error}"))?;
    if let Err(error) = init_git_repository(git, &target, name) {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    Ok(CreatedProjectWorkspace {
        repository_path: path_display_string(canonical_directory(&target)?)?,
        created: true,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedProjectWorkspace {
    repository_path: String,
    /// False when an earlier attempt already created the repository.
    created: bool,
}

#[tauri::command]
async fn project_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    path_display_string(briar_workspace_root(&home))
}

#[tauri::command]
async fn create_project_workspace(
    app: tauri::AppHandle,
    name: String,
) -> Result<CreatedProjectWorkspace, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let git = git_binary(&home)?;
        create_project_workspace_in(&git, &briar_workspace_root(&home), &name)
    })
    .await
    .map_err(|error| error.to_string())?
}

struct LocalProjectAgentConfig {
    llm: agent::ProjectLlmSettings,
    auto_hunt: AutoHuntConfig,
}

/// Everything a project connection records about where and how it runs.
struct CliConnectionInput {
    api_url: String,
    project_id: String,
    agent_token: String,
    repository_path: String,
    repository_remote: Option<String>,
    execution_host: Option<host::ExecutionHostId>,
}

fn write_cli_connection(
    config_path: &Path,
    connection: CliConnectionInput,
    agent_config: LocalProjectAgentConfig,
) -> Result<(), String> {
    let CliConnectionInput {
        api_url,
        project_id,
        agent_token,
        repository_path,
        repository_remote,
        execution_host,
    } = connection;
    if api_url.trim().is_empty() || project_id.trim().is_empty() {
        return Err("Briar 프로젝트 연결 정보가 올바르지 않습니다.".to_string());
    }
    if !agent_token.starts_with("briar_agent_") {
        return Err("Agent 토큰이 올바르지 않습니다.".to_string());
    }
    let mut config = if config_path.exists() {
        let contents = fs::read_to_string(config_path)
            .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
        serde_json::from_str::<CliConfig>(&contents)
            .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?
    } else {
        CliConfig {
            api_url: api_url.clone(),
            user_token: None,
            agent_providers: AppProviderSettings::default(),
            app_settings: StoredAppRuntimeSettings::default(),
            projects: Vec::new(),
            ssh_hosts: Vec::new(),
            extra: BTreeMap::new(),
        }
    };
    if !config.api_url.trim().is_empty()
        && config.api_url.trim_end_matches('/') != api_url.trim_end_matches('/')
    {
        config.user_token = None;
    }
    config.api_url = api_url.clone();
    // Preserve CLI-owned worktree settings and the project sandbox choice when
    // the app refreshes the rest of the connection record.
    let stored_auto_hunt = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref());
    let stored_worktrees = stored_auto_hunt.and_then(|auto_hunt| auto_hunt.worktrees.clone());
    let stored_sandbox = stored_auto_hunt.and_then(|auto_hunt| auto_hunt.sandbox.clone());
    let mut auto_hunt: StoredAutoHuntConfig = agent_config.auto_hunt.into();
    auto_hunt.worktrees = stored_worktrees;
    auto_hunt.sandbox = Some(stored_sandbox.unwrap_or_else(|| StoredSandboxConfig {
        full_access: Some(ProjectSandboxSettings::default().full_access),
        extra: BTreeMap::new(),
    }));
    config.projects.retain(|project| project.id != project_id);
    config.projects.push(CliProject {
        id: project_id,
        repository_path,
        api_url: Some(api_url),
        execution_host_id: execution_host
            .filter(|host| !host.is_local())
            .map(|host| host.as_stored()),
        repository_remote,
        agent_token,
        llm: Some(agent_config.llm),
        auto_hunt: Some(auto_hunt),
        extra: BTreeMap::new(),
    });

    write_cli_config(config_path, &config)
}

fn write_cli_config(config_path: &Path, config: &CliConfig) -> Result<(), String> {
    let config_directory = config_path
        .parent()
        .ok_or_else(|| "Briar 설정 폴더를 찾을 수 없습니다.".to_string())?;
    fs::create_dir_all(config_directory)
        .map_err(|error| format!("Briar 설정 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Briar 설정 폴더 권한을 지정하지 못했습니다: {error}"))?;
    }

    let mut serialized = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("Briar 로컬 설정을 만들지 못했습니다: {error}"))?;
    serialized.push(b'\n');
    let temporary_path = config_path.with_extension("json.tmp");
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .map_err(|error| format!("Briar 로컬 설정을 열지 못했습니다: {error}"))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Briar 로컬 설정을 저장하지 못했습니다: {error}"))?;
    fs::rename(&temporary_path, config_path)
        .map_err(|error| format!("Briar 로컬 설정을 교체하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 로컬 설정 권한을 지정하지 못했습니다: {error}"))?;
    }
    Ok(())
}

fn remove_cli_connection(config_path: &Path, project_id: &str) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let previous_count = config.projects.len();
    config.projects.retain(|project| project.id != project_id);
    if config.projects.len() == previous_count {
        return Ok(());
    }

    write_cli_config(config_path, &config)
}

fn cli_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".config")
        .join("briar")
        .join("config.json"))
}

fn read_cli_config(config_path: &Path) -> Result<CliConfig, String> {
    if !config_path.exists() {
        return Ok(CliConfig {
            api_url: String::new(),
            user_token: None,
            agent_providers: AppProviderSettings::default(),
            app_settings: StoredAppRuntimeSettings::default(),
            projects: Vec::new(),
            ssh_hosts: Vec::new(),
            extra: BTreeMap::new(),
        });
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))
}

/// Execution host a project is bound to. Unknown or missing values resolve to
/// the local machine, so a config from another build never blocks startup.
fn project_execution_host(
    config: &CliConfig,
    project_id: &str,
) -> Result<host::ExecutionHostId, String> {
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    Ok(host::ExecutionHostId::parse(
        project.execution_host_id.as_deref(),
    ))
}

fn project_repository_path(config: &CliConfig, project_id: &str) -> Result<PathBuf, String> {
    config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| PathBuf::from(&project.repository_path))
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())
}

/// Build the runner for a project's host. Local projects keep the exact
/// binary-resolution behaviour they had before hosts existed.
fn project_runner(
    config: &CliConfig,
    project_id: &str,
    home: &Path,
) -> Result<Arc<dyn host::CommandRunner>, String> {
    let execution_host = project_execution_host(config, project_id)?;
    host::runner_for(
        &execution_host,
        &config.ssh_hosts,
        cli_execution_path(home)?,
        home,
        host::SshAuth::default(),
    )
}

/// Resolve a repository root through a runner: the configured path must be the
/// git root on that host. Mirrors the original local-only check.
fn resolve_workspace_with(
    runner: &dyn host::CommandRunner,
    repository_path: &Path,
) -> Result<PathBuf, String> {
    let configured = runner
        .canonicalize(repository_path)
        .map_err(|error| format!("연결된 프로젝트 폴더를 열지 못했습니다: {error}"))?;
    let git = runner.resolve_binary("git")?;
    let output = runner.run(
        &host::CommandSpec::new(git)
            .args(["rev-parse", "--show-toplevel"])
            // Never let git stop for credentials on a host with no terminal.
            .env("GIT_TERMINAL_PROMPT", "0")
            .working_directory(&configured),
    )?;
    if !output.success() {
        return Err(format!(
            "Git 저장소 폴더를 선택하세요. ({})",
            output.failure_message()
        ));
    }
    let root = runner
        .canonicalize(Path::new(&output.stdout_trimmed()))
        .map_err(|error| format!("프로젝트 Git 루트를 열지 못했습니다: {error}"))?;
    if configured != root {
        return Err("연결된 프로젝트 경로가 Git 저장소 루트가 아닙니다.".to_string());
    }
    Ok(root)
}

fn connected_project_workspace(config_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    let config = read_cli_config(config_path)?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let configured = fs::canonicalize(&project.repository_path)
        .map_err(|error| format!("연결된 프로젝트 폴더를 열지 못했습니다: {error}"))?;
    let root = fs::canonicalize(git_repository_root(&configured)?)
        .map_err(|error| format!("프로젝트 Git 루트를 열지 못했습니다: {error}"))?;
    if configured != root {
        return Err("연결된 프로젝트 경로가 Git 저장소 루트가 아닙니다.".to_string());
    }
    Ok(root)
}

/// Workspace root for a project on whichever host owns it.
fn connected_project_workspace_on_host(
    config_path: &Path,
    project_id: &str,
    home: &Path,
) -> Result<(Arc<dyn host::CommandRunner>, PathBuf), String> {
    let config = read_cli_config(config_path)?;
    let runner = project_runner(&config, project_id, home)?;
    if !runner.is_remote() {
        return Ok((
            runner,
            connected_project_workspace(config_path, project_id)?,
        ));
    }
    let repository_path = project_repository_path(&config, project_id)?;
    let workspace = resolve_workspace_with(runner.as_ref(), &repository_path)?;
    Ok((runner, workspace))
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ProjectWorkspaceMode {
    #[default]
    Connected,
    LatestRemoteBase,
    IssueWorktree,
    IssueContext,
}

#[derive(Debug, PartialEq, Eq)]
struct RegisteredGitWorktree {
    path: PathBuf,
    branch: Option<String>,
}

fn parse_registered_git_worktrees(output: &str) -> Vec<RegisteredGitWorktree> {
    let mut worktrees = Vec::new();
    let mut path = None;
    let mut branch = None;
    let flush = |worktrees: &mut Vec<RegisteredGitWorktree>,
                 path: &mut Option<PathBuf>,
                 branch: &mut Option<String>| {
        if let Some(path) = path.take() {
            worktrees.push(RegisteredGitWorktree {
                path,
                branch: branch.take(),
            });
        } else {
            branch.take();
        }
    };

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            flush(&mut worktrees, &mut path, &mut branch);
            path = Some(PathBuf::from(value.trim()));
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(
                value
                    .trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value.trim())
                    .to_string(),
            );
        }
    }
    flush(&mut worktrees, &mut path, &mut branch);
    worktrees
}

fn auto_hunt_run_token(run_id: &str) -> Result<String, String> {
    let compact = run_id.replace('-', "").to_ascii_lowercase();
    if compact.len() != 32
        || !compact
            .bytes()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("이슈 run ID가 올바르지 않습니다.".to_string());
    }
    Ok(compact[..8].to_string())
}

fn branch_matches_auto_hunt_run(branch: &str, run_token: &str) -> bool {
    let leaf = branch.rsplit('/').next().unwrap_or(branch);
    let marker = format!("-{run_token}");
    if leaf.ends_with(&marker) {
        return true;
    }
    leaf.rsplit_once(&format!("{marker}-"))
        .is_some_and(|(_, suffix)| {
            !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn select_issue_worktree(
    worktree_list: &str,
    run_id: &str,
    recorded_branch: Option<&str>,
) -> Result<PathBuf, String> {
    let run_token = auto_hunt_run_token(run_id)?;
    let recorded_branch = recorded_branch
        .map(str::trim)
        .filter(|branch| !branch.is_empty());
    let matches = parse_registered_git_worktrees(worktree_list)
        .into_iter()
        .filter(|worktree| {
            worktree.branch.as_deref().is_some_and(|branch| {
                recorded_branch
                    .map(|recorded| branch == recorded)
                    .unwrap_or_else(|| branch_matches_auto_hunt_run(branch, &run_token))
            })
        })
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [worktree] => Ok(worktree.path.clone()),
        [] => Err(
            "이 이슈의 원래 Auto Hunt 워크트리를 찾지 못했습니다. 워크트리가 삭제되었는지 확인해 주세요."
                .to_string(),
        ),
        _ => Err(
            "이슈 run과 일치하는 Auto Hunt 워크트리가 여러 개라서 안전하게 선택할 수 없습니다."
                .to_string(),
        ),
    }
}

fn resolve_issue_worktree(
    runner: &dyn host::CommandRunner,
    connected_workspace: &Path,
    run_id: &str,
    recorded_branch: Option<&str>,
) -> Result<PathBuf, String> {
    let git = runner.resolve_binary("git")?;
    let output = runner.run(
        &host::CommandSpec::new(git)
            .args(["worktree", "list", "--porcelain"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .working_directory(connected_workspace),
    )?;
    if !output.success() {
        return Err(format!(
            "Auto Hunt 워크트리 목록을 읽지 못했습니다: {}",
            output.failure_message()
        ));
    }
    let selected = select_issue_worktree(&output.stdout, run_id, recorded_branch)?;
    let selected = runner
        .canonicalize(&selected)
        .map_err(|error| format!("이슈의 Auto Hunt 워크트리를 열지 못했습니다: {error}"))?;
    let connected = runner.canonicalize(connected_workspace)?;
    if selected == connected {
        return Err("연결된 공용 저장소는 이슈 워크트리로 사용할 수 없습니다.".to_string());
    }
    Ok(selected)
}

struct LatestRemoteWorkspace {
    root: PathBuf,
    checkout: PathBuf,
}

fn remote_head_branch(output: &str) -> Option<&str> {
    output.lines().find_map(|line| {
        let (reference, target) = line.split_once('\t')?;
        if target.trim() != "HEAD" {
            return None;
        }
        reference.trim().strip_prefix("ref: refs/heads/")
    })
}

fn create_analysis_temp_root(runner: &dyn host::CommandRunner) -> Result<PathBuf, String> {
    if !runner.is_remote() {
        return tempfile::Builder::new()
            .prefix("briar-workflow-analysis-")
            .tempdir()
            .map(|directory| directory.keep())
            .map_err(|error| format!("워크플로우 분석 임시 폴더를 만들지 못했습니다: {error}"));
    }

    let mktemp = runner.resolve_binary("mktemp")?;
    let output = runner.run(&host::CommandSpec::new(mktemp).args(["-d"]))?;
    if !output.success() {
        return Err(format!(
            "원격 워크플로우 분석 임시 폴더를 만들지 못했습니다: {}",
            output.failure_message()
        ));
    }
    let root = PathBuf::from(output.stdout_trimmed());
    if !root.is_absolute() {
        return Err("원격 호스트가 절대 임시 경로를 반환하지 않았습니다.".to_string());
    }
    Ok(root)
}

fn remove_analysis_temp_root(runner: &dyn host::CommandRunner, root: &Path) -> Result<(), String> {
    if !runner.is_remote() {
        return fs::remove_dir(root)
            .map_err(|error| format!("워크플로우 분석 임시 폴더를 정리하지 못했습니다: {error}"));
    }
    let rmdir = runner.resolve_binary("rmdir")?;
    let output =
        runner.run(&host::CommandSpec::new(rmdir).args([root.to_string_lossy().into_owned()]))?;
    if output.success() {
        Ok(())
    } else {
        Err(format!(
            "원격 워크플로우 분석 임시 폴더를 정리하지 못했습니다: {}",
            output.failure_message()
        ))
    }
}

fn prepare_latest_remote_workspace(
    runner: &dyn host::CommandRunner,
    connected_workspace: &Path,
) -> Result<Option<LatestRemoteWorkspace>, String> {
    let git = runner.resolve_binary("git")?;
    let origin = runner.run(
        &host::CommandSpec::new(git.clone())
            .args(["remote", "get-url", "origin"])
            .working_directory(connected_workspace),
    )?;
    if !origin.success() {
        // A newly initialized local project has no remote yet. Its connected
        // checkout is the only available source of truth.
        return Ok(None);
    }

    let remote_head = runner.run(
        &host::CommandSpec::new(git.clone())
            .args(["ls-remote", "--symref", "origin", "HEAD"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "Never")
            .working_directory(connected_workspace),
    )?;
    if !remote_head.success() {
        return Err(format!(
            "최신 origin 기본 브랜치를 확인하지 못했습니다: {}",
            remote_head.failure_message()
        ));
    }
    let branch = remote_head_branch(&remote_head.stdout)
        .ok_or_else(|| "origin의 기본 브랜치를 확인하지 못했습니다.".to_string())?;
    let remote_ref = format!("refs/remotes/origin/{branch}");
    let refspec = format!("+refs/heads/{branch}:{remote_ref}");
    let fetch = runner.run(
        &host::CommandSpec::new(git.clone())
            .args([
                "-c",
                "maintenance.auto=false",
                "-c",
                "gc.auto=0",
                "fetch",
                "--no-tags",
                "origin",
                refspec.as_str(),
            ])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "Never")
            .working_directory(connected_workspace),
    )?;
    if !fetch.success() {
        return Err(format!(
            "최신 origin/{branch} 코드를 가져오지 못했습니다: {}",
            fetch.failure_message()
        ));
    }
    let revision = runner.run(
        &host::CommandSpec::new(git.clone())
            .args(["rev-parse", "--verify", remote_ref.as_str()])
            .working_directory(connected_workspace),
    )?;
    if !revision.success() {
        return Err(format!(
            "가져온 origin/{branch} 커밋을 확인하지 못했습니다: {}",
            revision.failure_message()
        ));
    }
    let commit = revision.stdout_trimmed();
    let root = create_analysis_temp_root(runner)?;
    let checkout = root.join("repository");
    let add = runner.run(
        &host::CommandSpec::new(git)
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "worktree",
                "add",
                "--detach",
                checkout.to_string_lossy().as_ref(),
                commit.as_str(),
            ])
            .working_directory(connected_workspace),
    )?;
    if !add.success() {
        let cleanup = remove_analysis_temp_root(runner, &root).err();
        return Err(format!(
            "최신 origin/{branch} 분석 워크트리를 만들지 못했습니다: {}{}",
            add.failure_message(),
            cleanup
                .map(|error| format!(" ({error})"))
                .unwrap_or_default()
        ));
    }
    Ok(Some(LatestRemoteWorkspace { root, checkout }))
}

fn remove_latest_remote_workspace(
    runner: &dyn host::CommandRunner,
    connected_workspace: &Path,
    workspace: &LatestRemoteWorkspace,
) -> Result<(), String> {
    let git = runner.resolve_binary("git")?;
    let remove = runner.run(
        &host::CommandSpec::new(git)
            .args([
                "worktree",
                "remove",
                "--force",
                workspace.checkout.to_string_lossy().as_ref(),
            ])
            .working_directory(connected_workspace),
    )?;
    if !remove.success() {
        return Err(format!(
            "워크플로우 분석 워크트리를 정리하지 못했습니다: {}",
            remove.failure_message()
        ));
    }
    remove_analysis_temp_root(runner, &workspace.root)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionHostSummary {
    id: String,
    label: String,
    kind: host::ExecutionHostKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectExecutionConnection {
    execution_host_id: String,
    repository_path: String,
    repository_remote: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDirectoryEntry {
    name: String,
    path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDirectoryListing {
    path: String,
    parent_path: Option<String>,
    entries: Vec<RemoteDirectoryEntry>,
    git_repository: bool,
    repository_remote: Option<String>,
}

fn execution_host_summaries(config: &CliConfig) -> Vec<ExecutionHostSummary> {
    let mut hosts = vec![ExecutionHostSummary {
        id: host::LOCAL_EXECUTION_HOST_ID.to_string(),
        label: "이 컴퓨터".to_string(),
        kind: host::ExecutionHostKind::Local,
        alias: None,
        hostname: None,
        username: None,
        port: None,
    }];
    hosts.extend(config.ssh_hosts.iter().map(|ssh| ExecutionHostSummary {
        id: host::ssh_execution_host_id(&ssh.id),
        label: ssh.label.clone(),
        kind: host::ExecutionHostKind::Ssh,
        alias: Some(ssh.alias.clone()),
        hostname: ssh.hostname.clone(),
        username: ssh.username.clone(),
        port: ssh.port,
    }));
    hosts
}

fn discovered_ssh_host_id(alias: &str) -> String {
    let digest = Sha256::digest(alias.to_ascii_lowercase().as_bytes());
    let suffix = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{DISCOVERED_SSH_HOST_ID_PREFIX}{suffix}")
}

fn sync_discovered_ssh_hosts_with<F>(
    config_path: &Path,
    aliases: Vec<String>,
    mut resolve: F,
) -> Result<CliConfig, String>
where
    F: FnMut(&str) -> Option<host::SshResolvedTarget>,
{
    let mut config = read_cli_config(config_path)?;
    let discovered_aliases = aliases
        .iter()
        .map(|alias| alias.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let stale_host_ids = config
        .ssh_hosts
        .iter()
        .filter(|saved| {
            saved.id.starts_with(DISCOVERED_SSH_HOST_ID_PREFIX)
                && !discovered_aliases.contains(&saved.alias.to_ascii_lowercase())
        })
        .map(|saved| host::ssh_execution_host_id(&saved.id))
        .collect::<BTreeSet<_>>();
    let previous_host_count = config.ssh_hosts.len();
    config.ssh_hosts.retain(|saved| {
        !saved.id.starts_with(DISCOVERED_SSH_HOST_ID_PREFIX)
            || discovered_aliases.contains(&saved.alias.to_ascii_lowercase())
    });
    let mut changed = config.ssh_hosts.len() != previous_host_count;
    if !stale_host_ids.is_empty() {
        for project in &mut config.projects {
            if project
                .execution_host_id
                .as_ref()
                .is_some_and(|host_id| stale_host_ids.contains(host_id))
            {
                project.execution_host_id = None;
                changed = true;
            }
        }
    }

    for alias in aliases {
        let resolved = resolve(&alias);
        if let Some(saved) = config
            .ssh_hosts
            .iter_mut()
            .find(|saved| saved.alias.eq_ignore_ascii_case(&alias))
        {
            if let Some(target) = resolved {
                let next = host::SshHost {
                    id: saved.id.clone(),
                    label: if saved.id.starts_with(DISCOVERED_SSH_HOST_ID_PREFIX) {
                        alias.clone()
                    } else {
                        saved.label.clone()
                    },
                    alias,
                    hostname: Some(target.hostname),
                    username: target.username,
                    port: target.port,
                    last_required_passphrase: saved.last_required_passphrase,
                };
                if *saved != next {
                    *saved = next;
                    changed = true;
                }
            }
            continue;
        }
        let (hostname, username, port) = resolved
            .map(|target| (Some(target.hostname), target.username, target.port))
            .unwrap_or((None, None, None));
        config.ssh_hosts.push(host::SshHost {
            id: discovered_ssh_host_id(&alias),
            label: alias.clone(),
            alias,
            hostname,
            username,
            port,
            last_required_passphrase: None,
        });
        changed = true;
    }

    if changed {
        write_cli_config(config_path, &config)?;
    }
    Ok(config)
}

fn sync_discovered_ssh_hosts(config_path: &Path, home: &Path) -> Result<CliConfig, String> {
    let aliases = host::discover_ssh_config_aliases(home)?;
    sync_discovered_ssh_hosts_with(config_path, aliases, |alias| resolve_ssh_alias(alias).ok())
}

/// Ask OpenSSH what an alias actually resolves to, instead of parsing
/// `~/.ssh/config` ourselves: ProxyJump, Match blocks, and Include all apply.
fn resolve_ssh_alias(alias: &str) -> Result<host::SshResolvedTarget, String> {
    let trimmed = alias.trim();
    if trimmed.is_empty() {
        return Err("SSH 호스트 별칭을 입력하세요.".to_string());
    }
    if trimmed.starts_with('-') {
        return Err("SSH 호스트 별칭이 올바르지 않습니다.".to_string());
    }
    let output = Command::new(host::ssh_command())
        .args(["-G", trimmed])
        .output()
        .map_err(|error| format!("ssh 명령을 실행하지 못했습니다: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "SSH 설정에서 호스트를 확인하지 못했습니다.".to_string()
        } else {
            stderr
        });
    }
    Ok(host::parse_ssh_resolve_output(
        trimmed,
        &String::from_utf8_lossy(&output.stdout),
    ))
}

fn add_ssh_host_to(
    config_path: &Path,
    label: String,
    resolved: host::SshResolvedTarget,
) -> Result<host::SshHost, String> {
    let label = label.trim().to_string();
    if label.is_empty() || label.chars().count() > 100 {
        return Err("SSH 호스트 이름은 1자 이상 100자 이하여야 합니다.".to_string());
    }
    let mut config = read_cli_config(config_path)?;
    let existing_id = config
        .ssh_hosts
        .iter()
        .find(|existing| existing.alias.eq_ignore_ascii_case(&resolved.alias))
        .map(|existing| existing.id.clone());
    let entry = host::SshHost {
        id: existing_id.unwrap_or_else(|| {
            format!(
                "ssh-{}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis())
                    .unwrap_or_default(),
                config.ssh_hosts.len()
            )
        }),
        label,
        alias: resolved.alias,
        hostname: Some(resolved.hostname),
        username: resolved.username,
        port: resolved.port,
        last_required_passphrase: None,
    };
    // Re-adding the same alias replaces the stale record rather than stacking
    // duplicates that all point at one machine.
    config
        .ssh_hosts
        .retain(|existing| existing.alias != entry.alias);
    config.ssh_hosts.push(entry.clone());
    write_cli_config(config_path, &config)?;
    Ok(entry)
}

/// Removing a host unbinds the projects pinned to it so they fall back to the
/// local machine instead of stranding on an id that no longer resolves.
fn remove_ssh_host_from(config_path: &Path, host_id: &str) -> Result<Vec<String>, String> {
    let mut config = read_cli_config(config_path)?;
    let before = config.ssh_hosts.len();
    config.ssh_hosts.retain(|existing| existing.id != host_id);
    if config.ssh_hosts.len() == before {
        return Err("삭제할 SSH 호스트를 찾지 못했습니다.".to_string());
    }
    let stored = host::ssh_execution_host_id(host_id);
    let mut unbound = Vec::new();
    for project in &mut config.projects {
        if project.execution_host_id.as_deref() == Some(stored.as_str()) {
            project.execution_host_id = None;
            unbound.push(project.id.clone());
        }
    }
    write_cli_config(config_path, &config)?;
    Ok(unbound)
}

#[tauri::command]
async fn list_execution_hosts(app: tauri::AppHandle) -> Result<Vec<ExecutionHostSummary>, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(execution_host_summaries(&sync_discovered_ssh_hosts(
            &config_path,
            &home,
        )?))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_project_execution_connection(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectExecutionConnection, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let project = config
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
        Ok(ProjectExecutionConnection {
            execution_host_id: host::ExecutionHostId::parse(project.execution_host_id.as_deref())
                .as_stored(),
            repository_path: project.repository_path.clone(),
            repository_remote: project.repository_remote.clone(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn remote_directory_listing(
    runner: &dyn host::CommandRunner,
    local_home: &Path,
    requested_path: Option<&str>,
) -> Result<RemoteDirectoryListing, String> {
    if !runner.is_remote() {
        return Err("원격 폴더 탐색에는 SSH 실행 호스트를 선택해야 합니다.".to_string());
    }
    let requested = requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or(host_home_directory(runner, local_home)?);
    let path = runner.canonicalize(&requested)?;
    let find = runner
        .resolve_binary("find")
        .map_err(|_| "원격 호스트에서 find 명령을 찾지 못했습니다.".to_string())?;
    let output = runner.run(&host::CommandSpec::new(find).args([
        path.to_string_lossy().into_owned(),
        "-mindepth".to_string(),
        "1".to_string(),
        "-maxdepth".to_string(),
        "1".to_string(),
        "-type".to_string(),
        "d".to_string(),
        "-print0".to_string(),
    ]))?;
    if !output.success() {
        return Err(format!(
            "원격 폴더 목록을 불러오지 못했습니다: {}",
            output.failure_message()
        ));
    }
    let mut entries = output
        .stdout
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let entry_path = PathBuf::from(entry);
            let name = entry_path.file_name()?.to_string_lossy().into_owned();
            (name != ".git").then(|| RemoteDirectoryEntry {
                name,
                path: entry_path.to_string_lossy().into_owned(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    entries.truncate(500);

    let repository_root = resolve_workspace_with(runner, &path).ok();
    let git_repository = repository_root.as_ref() == Some(&path);
    let repository_remote = git_repository
        .then(|| repository_remote_on(runner, &path))
        .flatten();
    let parent_path = path
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned());
    Ok(RemoteDirectoryListing {
        path: path.to_string_lossy().into_owned(),
        parent_path,
        entries,
        git_repository,
        repository_remote,
    })
}

#[tauri::command]
async fn list_remote_directory(
    app: tauri::AppHandle,
    execution_host_id: String,
    path: Option<String>,
) -> Result<RemoteDirectoryListing, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let execution_host = host::ExecutionHostId::parse(Some(&execution_host_id));
        let runner = host::runner_for(
            &execution_host,
            &config.ssh_hosts,
            cli_execution_path(&home)?,
            &home,
            host::SshAuth::default(),
        )?;
        remote_directory_listing(runner.as_ref(), &home, path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_project_execution_connection(
    app: tauri::AppHandle,
    project_id: String,
    execution_host_id: String,
    repository_path: String,
) -> Result<ProjectExecutionConnection, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = read_cli_config(&config_path)?;
        let execution_host = host::ExecutionHostId::parse(Some(&execution_host_id));
        if execution_host.is_local() {
            return Err("Remote connection에는 SSH 실행 호스트를 선택해야 합니다.".to_string());
        }
        let runner = host::runner_for(
            &execution_host,
            &config.ssh_hosts,
            cli_execution_path(&home)?,
            &home,
            host::SshAuth::default(),
        )?;
        let root = resolve_workspace_with(runner.as_ref(), Path::new(&repository_path))?;
        let remote = repository_remote_on(runner.as_ref(), &root);
        let root = root
            .into_os_string()
            .into_string()
            .map_err(|_| "원격 Git 저장소 경로를 표시할 수 없습니다.".to_string())?;
        let project = config
            .projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
        project.execution_host_id = Some(execution_host.as_stored());
        project.repository_path = root.clone();
        project.repository_remote = remote.clone();
        write_cli_config(&config_path, &config)?;
        Ok(ProjectExecutionConnection {
            execution_host_id: execution_host.as_stored(),
            repository_path: root,
            repository_remote: remote,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn resolve_ssh_host(alias: String) -> Result<host::SshResolvedTarget, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_ssh_alias(&alias))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn add_ssh_host(
    app: tauri::AppHandle,
    alias: String,
    label: Option<String>,
) -> Result<ExecutionHostSummary, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_ssh_alias(&alias)?;
        let label = label
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| resolved.alias.clone());
        let saved = add_ssh_host_to(&config_path, label, resolved)?;
        Ok(ExecutionHostSummary {
            id: host::ssh_execution_host_id(&saved.id),
            label: saved.label,
            kind: host::ExecutionHostKind::Ssh,
            alias: Some(saved.alias),
            hostname: saved.hostname,
            username: saved.username,
            port: saved.port,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn remove_ssh_host(app: tauri::AppHandle, host_id: String) -> Result<Vec<String>, String> {
    let config_path = cli_config_path(&app)?;
    let host_id = host::ExecutionHostId::parse(Some(&host_id))
        .ssh_host_id()
        .map(str::to_string)
        .unwrap_or(host_id);
    tauri::async_runtime::spawn_blocking(move || remove_ssh_host_from(&config_path, &host_id))
        .await
        .map_err(|error| error.to_string())?
}

fn project_llm_settings_from(
    config_path: &Path,
    project_id: &str,
) -> Result<agent::ProjectLlmSettings, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.llm.clone().unwrap_or_default())
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())
}

fn app_provider_settings_from(config_path: &Path) -> Result<AppProviderSettings, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    Ok(config.agent_providers)
}

fn app_runtime_settings_from(config_path: &Path) -> Result<StoredAppRuntimeSettings, String> {
    Ok(read_cli_config(config_path)?.app_settings)
}

fn update_app_runtime_settings_at(
    config_path: &Path,
    settings: StoredAppRuntimeSettings,
) -> Result<StoredAppRuntimeSettings, String> {
    let mut config = read_cli_config(config_path)?;
    config.app_settings = settings;
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

fn update_app_provider_settings_at(
    config_path: &Path,
    settings: AppProviderSettings,
) -> Result<AppProviderSettings, String> {
    if !settings.any_enabled() {
        return Err("하나 이상의 에이전트 프로바이더를 활성화해야 합니다.".to_string());
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    config.agent_providers = settings;
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

fn approval_request_message(
    provider: agent::AgentProviderKind,
    method: &str,
    params: &serde_json::Value,
) -> String {
    let action = params
        .get("command")
        .and_then(|command| {
            command.as_str().map(str::to_string).or_else(|| {
                command.as_array().map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| part.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
            })
        })
        .filter(|command| !command.is_empty())
        .or_else(|| {
            params
                .get("reason")
                .and_then(|reason| reason.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            if method.contains("fileChange") || method == "applyPatchApproval" {
                "프로젝트 파일 변경".to_string()
            } else {
                "프로젝트 명령 실행".to_string()
            }
        });
    let cwd = params
        .get("cwd")
        .and_then(|cwd| cwd.as_str())
        .map(|cwd| format!("\n\n위치: {cwd}"))
        .unwrap_or_default();
    let provider_name = provider.display_name();
    format!("{provider_name}가 다음 작업의 승인을 요청했습니다.\n\n{action}{cwd}")
}

fn update_project_llm_settings_at(
    config_path: &Path,
    project_id: &str,
    mut settings: agent::ProjectLlmSettings,
) -> Result<agent::ProjectLlmSettings, String> {
    settings.model = settings
        .model
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty());
    if settings
        .model
        .as_deref()
        .is_some_and(|model| model.len() > 128 || model.chars().any(char::is_whitespace))
    {
        return Err("모델 ID는 공백 없이 128자 이하여야 합니다.".to_string());
    }
    if settings.provider == agent::AgentProviderKind::Claude
        && settings.effort == Some(agent::ModelEffort::Ultra)
    {
        return Err("Claude는 ultra effort를 지원하지 않습니다.".to_string());
    }
    if settings.provider == agent::AgentProviderKind::Grok
        && matches!(
            settings.effort,
            Some(agent::ModelEffort::Ultra | agent::ModelEffort::Xhigh | agent::ModelEffort::Max)
        )
    {
        // Grok maps these to high server-side; keep the stricter client message for clarity.
        return Err("Grok effort는 low, medium, high만 지원합니다.".to_string());
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    if !config.agent_providers.is_enabled(settings.provider) {
        return Err("앱 설정에서 먼저 이 에이전트 프로바이더를 활성화하세요.".to_string());
    }
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    project.llm = Some(settings.clone());
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

fn update_project_workflow_at(
    config_path: &Path,
    project_id: &str,
    workflow: WorkflowConfig,
) -> Result<WorkflowConfig, String> {
    validate_generated_workflow(&workflow)?;
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let auto_hunt = project
        .auto_hunt
        .as_mut()
        .ok_or_else(|| "이 프로젝트에 Auto Hunt 설정이 없습니다.".to_string())?;
    auto_hunt.workflow = Some(workflow.clone());
    write_cli_config(config_path, &config)?;
    Ok(workflow)
}

fn update_project_linear_at(
    config_path: &Path,
    project_id: &str,
    mut linear: StoredLinearConfig,
    inspect_velen: &dyn Fn(Option<String>) -> Result<VelenInspection, String>,
) -> Result<StoredLinearConfig, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let auto_hunt = project
        .auto_hunt
        .as_mut()
        .ok_or_else(|| "이 프로젝트에 Auto Hunt 설정이 없습니다.".to_string())?;

    if linear.enabled {
        let source = linear
            .source
            .as_deref()
            .map(str::trim)
            .filter(|source| !source.is_empty())
            .ok_or_else(|| "Linear 소스를 선택하세요.".to_string())?;
        let org = auto_hunt
            .velen_org
            .as_deref()
            .map(str::trim)
            .filter(|org| !org.is_empty())
            .ok_or_else(|| "Linear 연결에 사용할 Velen 조직이 없습니다.".to_string())?;
        let inspection = inspect_velen(Some(org.to_string()))?;
        let selected = inspection
            .sources
            .iter()
            .find(|candidate| {
                candidate.provider == "linear"
                    && candidate.status == "active"
                    && (candidate.source_ref == source || candidate.source_key == source)
            })
            .ok_or_else(|| "선택한 Linear 소스를 Velen에서 사용할 수 없습니다.".to_string())?;
        linear.source = Some(selected.source_ref.clone());
        linear.team_key = linear
            .team_key
            .take()
            .map(|team_key| team_key.trim().to_string())
            .filter(|team_key| !team_key.is_empty());
    } else {
        linear.source = None;
        linear.team_key = None;
    }

    auto_hunt.linear = Some(linear.clone());
    write_cli_config(config_path, &config)?;
    Ok(linear)
}

fn update_project_velen_org_at(
    config_path: &Path,
    project_id: &str,
    org: Option<String>,
    inspect_velen: &dyn Fn(Option<String>) -> Result<VelenInspection, String>,
) -> Result<Option<String>, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let auto_hunt = project
        .auto_hunt
        .as_mut()
        .ok_or_else(|| "이 프로젝트에 Auto Hunt 설정이 없습니다.".to_string())?;
    let org = org
        .map(|org| org.trim().to_string())
        .filter(|org| !org.is_empty());

    if org.is_none()
        && auto_hunt
            .linear
            .as_ref()
            .is_some_and(|linear| linear.enabled)
    {
        return Err("Linear 연결을 먼저 끈 뒤 Velen 연결을 해제하세요.".to_string());
    }
    if let Some(org) = org.as_ref() {
        inspect_velen(Some(org.clone()))?;
    }

    auto_hunt.velen_org = org.clone();
    if org.is_none() {
        auto_hunt.data_source = None;
    }
    write_cli_config(config_path, &config)?;
    Ok(org)
}

fn validate_generated_workflow(workflow: &WorkflowConfig) -> Result<(), String> {
    if workflow.version != 1 || workflow.stages.is_empty() || workflow.stages.len() > 30 {
        return Err("생성된 워크플로우 버전 또는 단계 수가 올바르지 않습니다.".to_string());
    }
    let mut ids = BTreeSet::new();
    for stage in &workflow.stages {
        if stage.id.trim().is_empty()
            || stage.label.trim().is_empty()
            || !ids.insert(stage.id.as_str())
        {
            return Err("생성된 워크플로우 단계가 올바르지 않습니다.".to_string());
        }
    }
    let required = workflow
        .stages
        .iter()
        .filter(|stage| stage.required)
        .map(|stage| stage.id.as_str())
        .collect::<Vec<_>>();
    let completion = workflow
        .completion
        .required_stages
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if completion != required {
        return Err("생성된 워크플로우의 필수 단계와 완료 조건이 일치하지 않습니다.".to_string());
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() && fs::canonicalize(source).ok() == fs::canonicalize(destination).ok() {
        return Ok(());
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("설치 폴더를 만들지 못했습니다: {error}"))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("번들 파일을 읽지 못했습니다: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("번들 파일을 설치하지 못했습니다: {error}"))?;
        }
    }
    Ok(())
}

fn bundled_path(resource_directory: &Path, bundled: &str, development: &str) -> PathBuf {
    let bundled_path = resource_directory.join(bundled);
    if bundled_path.exists() {
        return bundled_path;
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(development)
}

fn install_auto_hunt_assets(resource_directory: &Path, home: &Path) -> Result<(), String> {
    let skill_source = bundled_path(
        resource_directory,
        "skills/briar-workflow",
        "skills/briar-workflow",
    );
    if !skill_source.is_dir() {
        return Err("Briar Workflow 스킬 번들을 찾지 못했습니다.".to_string());
    }
    let skill_destinations = [".codex", ".claude", ".grok"]
        .map(|directory| home.join(directory).join("skills").join("briar-workflow"));
    for skill_destination in &skill_destinations {
        let stale_references = skill_destination.join("references");
        if stale_references.exists() {
            fs::remove_dir_all(&stale_references)
                .map_err(|error| format!("이전 스킬 참조를 제거하지 못했습니다: {error}"))?;
        }
        copy_directory(&skill_source, skill_destination)?;
    }

    let cli_source = bundled_path(resource_directory, "cli/briar.js", "dist-cli/briar.js");
    let launcher_source = bundled_path(resource_directory, "cli/briar", "scripts/briar-launcher");
    if !cli_source.is_file() || !launcher_source.is_file() {
        return Err("Briar CLI 번들을 찾지 못했습니다.".to_string());
    }
    let library_directory = home.join(".local").join("share").join("briar");
    let binary_directory = home.join(".local").join("bin");
    fs::create_dir_all(&library_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&binary_directory).map_err(|error| error.to_string())?;
    fs::copy(cli_source, library_directory.join("briar.js"))
        .map_err(|error| format!("Briar CLI를 설치하지 못했습니다: {error}"))?;
    fs::write(
        library_directory.join("VERSION"),
        format!("{}\n", env!("CARGO_PKG_VERSION")),
    )
    .map_err(|error| format!("Briar CLI 버전을 설치하지 못했습니다: {error}"))?;
    let launcher_destination = binary_directory.join("briar");
    fs::copy(launcher_source, &launcher_destination)
        .map_err(|error| format!("Briar CLI 런처를 설치하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&launcher_destination, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
        for skill_destination in &skill_destinations {
            let skill_launcher = skill_destination.join("scripts").join("briar");
            if skill_launcher.exists() {
                fs::set_permissions(skill_launcher, fs::Permissions::from_mode(0o755))
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn read_trimmed_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn auto_hunt_assets_are_current(resource_directory: &Path, home: &Path) -> bool {
    let cli_directory = home.join(".local").join("share").join("briar");
    let cli_current = home.join(".local").join("bin").join("briar").is_file()
        && cli_directory.join("briar.js").is_file()
        && read_trimmed_file(&cli_directory.join("VERSION")).as_deref()
            == Some(env!("CARGO_PKG_VERSION"));
    if !cli_current {
        return false;
    }

    let skill_source = bundled_path(
        resource_directory,
        "skills/briar-workflow",
        "skills/briar-workflow",
    );
    let expected_version = read_trimmed_file(&skill_source.join("VERSION"))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    [".codex", ".claude", ".grok"].iter().all(|directory| {
        let skill = home.join(directory).join("skills").join("briar-workflow");
        skill.join("SKILL.md").is_file()
            && read_trimmed_file(&skill.join("VERSION")).as_deref()
                == Some(expected_version.as_str())
    })
}

fn sync_auto_hunt_assets(resource_directory: &Path, home: &Path) -> Result<bool, String> {
    if auto_hunt_assets_are_current(resource_directory, home) {
        return Ok(false);
    }
    install_auto_hunt_assets(resource_directory, home)?;
    Ok(true)
}

fn read_trimmed_file_on(runner: &dyn host::CommandRunner, path: &Path) -> Option<String> {
    let shell = runner.resolve_binary("sh").ok()?;
    let output = runner
        .run(&host::CommandSpec::new(shell).args([
            "-c".to_string(),
            "test -f \"$1\" && cat -- \"$1\"".to_string(),
            "briar-read-file".to_string(),
            path.to_string_lossy().into_owned(),
        ]))
        .ok()?;
    output
        .success()
        .then(|| output.stdout_trimmed())
        .filter(|value| !value.is_empty())
}

fn host_home_directory(
    runner: &dyn host::CommandRunner,
    local_home: &Path,
) -> Result<PathBuf, String> {
    if !runner.is_remote() {
        return Ok(local_home.to_path_buf());
    }
    let shell = runner.resolve_binary("sh")?;
    let output =
        runner.run(&host::CommandSpec::new(shell).args(["-c", "printf '%s' \"$HOME\""]))?;
    if !output.success() || output.stdout.is_empty() {
        return Err(format!(
            "원격 홈 폴더를 확인하지 못했습니다: {}",
            output.failure_message()
        ));
    }
    Ok(PathBuf::from(output.stdout_trimmed()))
}

fn auto_hunt_health_sync(
    config_path: &Path,
    resource_directory: &Path,
    home: &Path,
    project_id: &str,
) -> Result<AutoHuntHealth, String> {
    auto_hunt_health_sync_with(
        config_path,
        resource_directory,
        home,
        project_id,
        &inspect_velen_sync,
    )
}

fn auto_hunt_health_sync_with(
    config_path: &Path,
    resource_directory: &Path,
    home: &Path,
    project_id: &str,
    inspect_velen: &dyn Fn(Option<String>) -> Result<VelenInspection, String>,
) -> Result<AutoHuntHealth, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let runner = project_runner(&config, project_id, home)?;
    let execution_home = host_home_directory(runner.as_ref(), home)?;
    let mut issues = Vec::new();

    let repository_path = Path::new(&project.repository_path);
    let repository_healthy = resolve_workspace_with(runner.as_ref(), repository_path).is_ok();
    if !repository_healthy {
        issues.push("연결된 Git 저장소 경로를 사용할 수 없습니다.".to_string());
    }

    let expected_version = env!("CARGO_PKG_VERSION").to_string();
    let cli_path = execution_home.join(".local").join("bin").join("briar");
    let cli_installed = runner.resolve_binary("briar").is_ok();
    let cli_version = read_trimmed_file(
        &execution_home
            .join(".local")
            .join("share")
            .join("briar")
            .join("VERSION"),
    )
    .filter(|_| !runner.is_remote())
    .or_else(|| {
        read_trimmed_file_on(
            runner.as_ref(),
            &execution_home
                .join(".local")
                .join("share")
                .join("briar")
                .join("VERSION"),
        )
    });
    let cli_current = cli_version.as_deref() == Some(expected_version.as_str());
    if !cli_installed {
        issues.push("Briar CLI가 설치되지 않았습니다.".to_string());
    } else if !cli_current {
        issues.push("Briar CLI 버전이 앱 번들과 다릅니다.".to_string());
    }

    let skill_source = bundled_path(
        resource_directory,
        "skills/briar-workflow",
        "skills/briar-workflow",
    );
    let skill_expected_version = read_trimmed_file(&skill_source.join("VERSION"))
        .unwrap_or_else(|| expected_version.clone());
    let skill_directory = match project.llm.clone().unwrap_or_default().provider {
        agent::AgentProviderKind::Codex => ".codex",
        agent::AgentProviderKind::Claude => ".claude",
        agent::AgentProviderKind::Grok => ".grok",
    };
    let skill_path = execution_home
        .join(skill_directory)
        .join("skills")
        .join("briar-workflow");
    let skill_installed =
        read_trimmed_file_on(runner.as_ref(), &skill_path.join("SKILL.md")).is_some();
    let skill_version = read_trimmed_file_on(runner.as_ref(), &skill_path.join("VERSION"));
    let skill_current = skill_version.as_deref() == Some(skill_expected_version.as_str());
    if !skill_installed {
        issues.push("Briar Workflow 스킬이 설치되지 않았습니다.".to_string());
    } else if !skill_current {
        issues.push("Workflow 스킬 버전이 앱 번들과 다릅니다.".to_string());
    }

    let velen_org = project
        .auto_hunt
        .as_ref()
        .and_then(|auto_hunt| auto_hunt.velen_org.clone());
    let (velen_authenticated, velen_email, velen_healthy) = if let Some(org) = velen_org.as_deref()
    {
        let inspection = if runner.is_remote() {
            inspect_velen_on(runner.as_ref(), Some(org.to_string()))
        } else {
            inspect_velen(Some(org.to_string()))
        };
        match inspection {
            Ok(inspection) => (inspection.authenticated, inspection.email, true),
            Err(error) => {
                issues.push(format!("Velen 연결 확인 실패: {error}"));
                (false, None, false)
            }
        }
    } else {
        (false, None, true)
    };

    if runner.is_remote() {
        if runner.resolve_binary("bun").is_err() {
            issues.push("원격 호스트에 Bun이 설치되지 않았습니다.".to_string());
        }
        if cli_installed && repository_healthy {
            let cli_connected = runner
                .resolve_binary("briar")
                .and_then(|binary| {
                    runner.run(
                        &host::CommandSpec::new(binary)
                            .args(["project", "doctor"])
                            .env("BRIAR_PROJECT_ID", project_id)
                            .env("BRIAR_API_URL", &config.api_url)
                            .working_directory(repository_path),
                    )
                })
                .is_ok_and(|output| output.success());
            if !cli_connected {
                issues.push(
                    "원격 Briar CLI가 이 프로젝트에 연결되지 않았습니다. 원격 저장소에서 `briar connect`와 `briar project configure`를 실행해 주세요."
                        .to_string(),
                );
            }
        }
        let (agent_name, auth_args): (&str, &[&str]) =
            match project.llm.clone().unwrap_or_default().provider {
                agent::AgentProviderKind::Codex => ("codex", &["login", "status"]),
                agent::AgentProviderKind::Claude => ("claude", &["auth", "status"]),
                agent::AgentProviderKind::Grok => ("grok", &["--version"]),
            };
        match runner.resolve_binary(agent_name) {
            Ok(binary) => {
                let authenticated = runner
                    .run(&host::CommandSpec::new(binary).args(auth_args.iter().copied()))
                    .is_ok_and(|output| output.success());
                if !authenticated {
                    issues.push(format!(
                        "원격 {} 에이전트가 인증되지 않았습니다. 호스트에서 직접 로그인해 주세요.",
                        match agent_name {
                            "codex" => "Codex",
                            "claude" => "Claude",
                            "grok" => "Grok",
                            other => other,
                        }
                    ));
                }
            }
            Err(_) => {
                issues.push(format!(
                    "원격 호스트에서 {} CLI를 찾지 못했습니다.",
                    match agent_name {
                        "codex" => "Codex",
                        "claude" => "Claude",
                        "grok" => "Grok",
                        other => other,
                    }
                ));
            }
        }
    }

    Ok(AutoHuntHealth {
        project_id: project.id.clone(),
        healthy: issues.is_empty(),
        repository_path: Some(project.repository_path.clone()),
        repository_remote: project.repository_remote.clone(),
        repository_healthy,
        cli_path: cli_path.to_string_lossy().into_owned(),
        cli_installed,
        cli_version,
        cli_expected_version: expected_version,
        cli_current,
        skill_path: skill_path.to_string_lossy().into_owned(),
        skill_installed,
        skill_version,
        skill_expected_version,
        skill_current,
        velen_org,
        velen_authenticated,
        velen_email,
        velen_healthy,
        issues,
    })
}

#[tauri::command]
async fn auto_hunt_health(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<AutoHuntHealth, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        auto_hunt_health_sync(&config_path, &resource_directory, &home, &project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn repair_auto_hunt(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<AutoHuntHealth, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let runner = project_runner(&config, &project_id, &home)?;
        if runner.is_remote() {
            return Err(format!(
                "{}에서 `briar` CLI와 Briar Workflow 스킬을 설치하거나 업데이트한 뒤 다시 검사해 주세요.",
                runner.label()
            ));
        }
        install_auto_hunt_assets(&resource_directory, &home)?;
        auto_hunt_health_sync(&config_path, &resource_directory, &home, &project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn connected_project_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !config_path.exists() {
            return Ok(Vec::new());
        }
        let contents = fs::read_to_string(config_path)
            .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
        let config = serde_json::from_str::<CliConfig>(&contents)
            .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
        Ok(config
            .projects
            .into_iter()
            .map(|project| project.id)
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_llm_chat(
    app: tauri::AppHandle,
    project_id: String,
    full_access: Option<bool>,
    workspace_mode: Option<ProjectWorkspaceMode>,
    workspace_run_id: Option<String>,
    workspace_branch: Option<String>,
    request: agent::ProjectLlmRequest,
) -> Result<agent::ProjectLlmResponse, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let claude_runner = bundled_path(
        &resource_directory,
        "agent/claude-runner.js",
        "dist-agent/claude-runner.js",
    );
    let grok_runner = bundled_path(
        &resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (runner, connected_workspace) =
            connected_project_workspace_on_host(&config_path, &project_id, &home)?;
        let readiness = project_repository_readiness_at(&config_path, &project_id, &home)?;
        if readiness.requires_github && !readiness.pr_ready {
            return Err(format!(
                "PR 단계 실행 준비가 필요합니다: {}",
                readiness.issues.join(" ")
            ));
        }
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let provider = request
            .conversation_id
            .as_deref()
            .and_then(|conversation_id| {
                agent::AgentProviderKind::for_conversation_id(&project_id, conversation_id)
            })
            .unwrap_or(settings.provider);
        if !app_provider_settings_from(&config_path)?.is_enabled(provider) {
            return Err(
                "이 대화의 에이전트 프로바이더가 앱 설정에서 비활성화되어 있습니다.".to_string(),
            );
        }
        let workspace_mode = workspace_mode.unwrap_or_default();
        let mut issue_workspace_error = None;
        let issue_workspace = match workspace_mode {
            ProjectWorkspaceMode::IssueWorktree => Some(resolve_issue_worktree(
                runner.as_ref(),
                &connected_workspace,
                workspace_run_id
                    .as_deref()
                    .ok_or_else(|| "이슈 워크트리 실행에는 run ID가 필요합니다.".to_string())?,
                workspace_branch.as_deref(),
            )?),
            ProjectWorkspaceMode::IssueContext => {
                let run_id = workspace_run_id
                    .as_deref()
                    .ok_or_else(|| "이슈 컨텍스트 실행에는 run ID가 필요합니다.".to_string())?;
                match resolve_issue_worktree(
                    runner.as_ref(),
                    &connected_workspace,
                    run_id,
                    workspace_branch.as_deref(),
                ) {
                    Ok(workspace) => Some(workspace),
                    Err(error) => {
                        issue_workspace_error = Some(error);
                        None
                    }
                }
            }
            ProjectWorkspaceMode::Connected | ProjectWorkspaceMode::LatestRemoteBase => None,
        };
        let latest_workspace = match workspace_mode {
            ProjectWorkspaceMode::LatestRemoteBase => {
                prepare_latest_remote_workspace(runner.as_ref(), &connected_workspace)?
            }
            ProjectWorkspaceMode::IssueContext if issue_workspace.is_none() => {
                prepare_latest_remote_workspace(runner.as_ref(), &connected_workspace).map_err(
                    |fallback_error| {
                        format!(
                            "{} 최신 저장소 컨텍스트도 준비하지 못했습니다: {fallback_error}",
                            issue_workspace_error
                                .as_deref()
                                .unwrap_or("이슈 워크트리를 사용할 수 없습니다.")
                        )
                    },
                )?
            }
            ProjectWorkspaceMode::Connected
            | ProjectWorkspaceMode::IssueWorktree
            | ProjectWorkspaceMode::IssueContext => None,
        };
        let workspace = issue_workspace
            .as_deref()
            .or_else(|| {
                latest_workspace
                    .as_ref()
                    .map(|workspace| workspace.checkout.as_path())
            })
            .unwrap_or(connected_workspace.as_path());
        let backend = agent::discover_backend(
            provider,
            runner.clone(),
            agent::AgentRunnerBundles {
                claude: &claude_runner,
                grok: &grok_runner,
            },
        )?;
        let (model, effort) = if provider == settings.provider {
            (settings.model, settings.effort)
        } else {
            (None, None)
        };
        let approve = |method: &str, params: &serde_json::Value| {
            let provider_name = provider.display_name();
            approval_app
                .dialog()
                .message(approval_request_message(provider, method, params))
                .title(format!("{provider_name} 작업 승인"))
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "승인".to_string(),
                    "거절".to_string(),
                ))
                .blocking_show()
        };
        let result = agent::AgentBackend::run(
            &backend,
            &project_id,
            workspace,
            project_chat_execution(
                full_access.unwrap_or(false),
                settings.approval_policy,
                model,
                effort,
            ),
            request,
            &approve,
        );
        let cleanup = latest_workspace.as_ref().map(|workspace| {
            remove_latest_remote_workspace(runner.as_ref(), &connected_workspace, workspace)
        });
        match (result, cleanup) {
            (Ok(response), None | Some(Ok(()))) => Ok(response),
            (Err(error), None | Some(Ok(()))) => Err(error),
            (Ok(_), Some(Err(cleanup))) => Err(cleanup),
            (Err(error), Some(Err(cleanup))) => {
                Err(format!("{error} (분석 워크트리 정리 실패: {cleanup})"))
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_project_agent(
    app: tauri::AppHandle,
    session_cancellations: tauri::State<'_, AgentSessionCancellationState>,
    project_id: String,
    request: agent::ProjectAgentRunRequest,
) -> Result<agent::ProjectAgentRunResponse, String> {
    validate_auto_hunt_session_id(&request.session_id)?;
    if request.agent_id.trim().is_empty()
        || request.agent_id.len() > 128
        || request.agent_name.trim().is_empty()
        || request.agent_name.len() > 100
        || request
            .agent_model
            .as_ref()
            .is_some_and(|model| model.trim().is_empty() || model.len() > 100)
        || request.responsibility.trim().is_empty()
        || request.responsibility.len() > 2_000
        || request.skill.trim().is_empty()
        || request.skill.len() > 10_000
        || request.message.trim().is_empty()
        || request.message.len() > 20_000
    {
        return Err("에이전트 실행 요청이 올바르지 않습니다.".to_string());
    }
    let cancellation = session_cancellations.register(&request.session_id)?;
    let cancellation_signal = cancellation.signal();
    if request
        .conversation_id
        .as_deref()
        .is_some_and(|conversation_id| {
            agent::AgentProviderKind::for_conversation_id(&project_id, conversation_id)
                != Some(request.agent_provider)
        })
    {
        return Err("이 대화는 선택한 에이전트 프로바이더와 일치하지 않습니다.".to_string());
    }
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let claude_runner = bundled_path(
        &resource_directory,
        "agent/claude-runner.js",
        "dist-agent/claude-runner.js",
    );
    let grok_runner = bundled_path(
        &resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let event_sink =
        create_auto_hunt_event_sink(&app, &request.session_id, Arc::clone(&cancellation_signal))?;
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _cancellation = cancellation;
        ensure_agent_session_running(&cancellation_signal)?;
        let (runner, workspace) =
            connected_project_workspace_on_host(&config_path, &project_id, &home)?;
        let provider = request.agent_provider;
        if !app_provider_settings_from(&config_path)?.is_enabled(provider) {
            return Err(
                "선택한 에이전트 프로바이더가 앱 설정에서 비활성화되어 있습니다.".to_string(),
            );
        }
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let full_access = project_auto_hunt_full_access(&config_path, &project_id)?;
        let workflow_json = project_auto_hunt_workflow_json(&config_path, &project_id)?;
        let backend = agent::discover_backend(
            provider,
            runner,
            agent::AgentRunnerBundles {
                claude: &claude_runner,
                grok: &grok_runner,
            },
        )?;
        let model = request
            .agent_model
            .clone()
            .filter(|value| !value.trim().is_empty());
        let effort = (provider == settings.provider)
            .then_some(settings.effort)
            .flatten();
        let approve = |method: &str, params: &serde_json::Value| {
            let provider_name = provider.display_name();
            approval_app
                .dialog()
                .message(approval_request_message(provider, method, params))
                .title(format!("{provider_name} 에이전트 작업 승인"))
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "승인".to_string(),
                    "거절".to_string(),
                ))
                .blocking_show()
        };
        agent::run_project_agent(
            &backend,
            &project_id,
            &workspace,
            agent::ChatExecution {
                approval_policy: settings.approval_policy,
                sandbox_mode: project_agent_sandbox_mode(full_access),
                network_access: true,
                model,
                effort,
                event_sink: Some(event_sink),
                environment: Vec::new(),
                workspace_write_roots: Vec::new(),
            },
            &workflow_json,
            request,
            &approve,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn stop_project_agent_session(
    session_cancellations: tauri::State<'_, AgentSessionCancellationState>,
    session_id: String,
) -> Result<bool, String> {
    validate_auto_hunt_session_id(&session_id)?;
    session_cancellations.stop(&session_id)
}

/// Directory that holds this project's per-issue worktrees. Must mirror the
/// CLI's own resolution (`worktreeSettings` in src-cli/index.ts): env override,
/// then project config, then `~/briar/workspaces`, all suffixed by project id.
#[cfg(test)]
fn project_worktree_root(
    config_path: &Path,
    project_id: &str,
    home: &Path,
) -> Result<Option<PathBuf>, String> {
    let config = read_cli_config(config_path)?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let settings = project
        .auto_hunt
        .as_ref()
        .and_then(|auto_hunt| auto_hunt.worktrees.as_ref());
    if settings.and_then(|settings| settings.enabled) == Some(false) {
        return Ok(None);
    }
    let root = std::env::var("BRIAR_WORKTREE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            settings
                .and_then(|settings| settings.root.clone())
                .filter(|root| !root.trim().is_empty())
        })
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("briar").join("workspaces"));
    Ok(Some(root.join(project_id)))
}

/// Whether this project's Auto Hunt sessions run without a filesystem sandbox.
/// Full access is the default; `autoHunt.sandbox.fullAccess: false` opts into
/// workspace-confined writes.
fn project_auto_hunt_full_access(config_path: &Path, project_id: &str) -> Result<bool, String> {
    Ok(read_cli_config(config_path)?
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref())
        .and_then(|auto_hunt| auto_hunt.sandbox.as_ref())
        .and_then(|sandbox| sandbox.full_access)
        .unwrap_or(true))
}

fn project_sandbox_settings_from(
    config_path: &Path,
    project_id: &str,
) -> Result<ProjectSandboxSettings, String> {
    let config = read_cli_config(config_path)?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    Ok(ProjectSandboxSettings {
        full_access: project
            .auto_hunt
            .as_ref()
            .and_then(|auto_hunt| auto_hunt.sandbox.as_ref())
            .and_then(|sandbox| sandbox.full_access)
            .unwrap_or(true),
    })
}

fn update_project_sandbox_settings_at(
    config_path: &Path,
    project_id: &str,
    settings: ProjectSandboxSettings,
) -> Result<ProjectSandboxSettings, String> {
    let mut config = read_cli_config(config_path)?;
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let auto_hunt = project
        .auto_hunt
        .get_or_insert_with(StoredAutoHuntConfig::default);
    let sandbox = auto_hunt
        .sandbox
        .get_or_insert_with(StoredSandboxConfig::default);
    sandbox.full_access = Some(settings.full_access);
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

fn project_auto_hunt_uses_velen(config_path: &Path, project_id: &str) -> Result<bool, String> {
    Ok(read_cli_config(config_path)?
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref())
        .and_then(|auto_hunt| auto_hunt.velen_org.as_deref())
        .is_some_and(|org| !org.trim().is_empty()))
}

fn project_auto_hunt_workflow_json(config_path: &Path, project_id: &str) -> Result<String, String> {
    let config = read_cli_config(config_path)?;
    let workflow = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref())
        .and_then(|auto_hunt| auto_hunt.workflow.as_ref())
        .ok_or_else(|| "저장소 기반 워크플로우가 생성되지 않았습니다.".to_string())?;
    if workflow
        .stages
        .iter()
        .any(|stage| stage.id == "repository_workflow_pending")
    {
        return Err("저장소 기반 워크플로우가 생성되지 않았습니다.".to_string());
    }
    serde_json::to_string_pretty(workflow)
        .map_err(|error| format!("프로젝트 워크플로우를 직렬화하지 못했습니다: {error}"))
}

fn project_chat_execution(
    full_access: bool,
    approval_policy: agent::ApprovalPolicy,
    model: Option<String>,
    effort: Option<agent::ModelEffort>,
) -> agent::ChatExecution {
    agent::ChatExecution {
        approval_policy: if full_access {
            agent::ApprovalPolicy::Never
        } else {
            approval_policy
        },
        sandbox_mode: if full_access {
            agent::SandboxMode::DangerFullAccess
        } else {
            agent::SandboxMode::ReadOnly
        },
        network_access: full_access,
        model,
        effort,
        event_sink: None,
        environment: Vec::new(),
        // Project chat runs in the checkout only; Auto Hunt widens this.
        workspace_write_roots: Vec::new(),
    }
}

fn project_agent_sandbox_mode(full_access: bool) -> agent::SandboxMode {
    if full_access {
        agent::SandboxMode::DangerFullAccess
    } else {
        agent::SandboxMode::WorkspaceWrite
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostClaimResponse {
    work: Option<HostClaimedRun>,
    #[serde(default)]
    workspace_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostClaimedRun {
    run_id: String,
    run_number: u64,
    source_key: String,
    title: String,
    workflow: serde_json::Value,
    #[serde(default)]
    workspace: Option<HostClaimedWorkspace>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostClaimedWorkspace {
    #[serde(rename = "type")]
    workspace_type: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostRunEvidenceResponse {
    evidence: Vec<serde_json::Value>,
}

fn claim_auto_hunt_run_on_host(
    runner: &dyn host::CommandRunner,
    cli_environment: &agent::AutoHuntCliEnvironment,
    connected_workspace: &Path,
    run_id: &str,
) -> Result<HostClaimResponse, String> {
    let arguments = auto_hunt_claim_arguments(run_id);
    let output = cli_environment.run_briar(runner, connected_workspace, arguments)?;
    if !output.success() {
        return Err(format!(
            "호스트가 자동사냥 작업을 claim하지 못했습니다: {}",
            output.failure_message()
        ));
    }
    serde_json::from_str(output.stdout.trim())
        .map_err(|error| format!("호스트 claim 결과를 읽지 못했습니다: {error}"))
}

fn auto_hunt_claim_arguments(run_id: &str) -> Vec<String> {
    vec![
        "queue".to_string(),
        "claim".to_string(),
        "--run".to_string(),
        run_id.to_string(),
        "--workspace".to_string(),
        "worktree".to_string(),
        "--actor".to_string(),
        "briar-auto-hunt-runtime".to_string(),
        "--runtime-dispatch".to_string(),
    ]
}

fn record_auto_hunt_terminal_event(
    runner: &dyn host::CommandRunner,
    cli_environment: &agent::AutoHuntCliEnvironment,
    workspace: &Path,
    run: &HostClaimedRun,
    status: &str,
    cause: &str,
    detail: &str,
) -> Result<(), String> {
    let event_key = format!("{}:{status}:{cause}", run.source_key);
    let output = cli_environment.run_briar(
        runner,
        workspace,
        [
            "run",
            "event",
            "add",
            "--run",
            run.run_id.as_str(),
            "--status",
            status,
            "--event-key",
            event_key.as_str(),
            "--status-detail",
            detail,
            "--actor",
            "briar-auto-hunt-runtime",
        ],
    )?;
    if output.success() {
        Ok(())
    } else {
        Err(format!(
            "run {status} 상태를 기록하지 못했습니다: {}",
            output.failure_message()
        ))
    }
}

struct AutoHuntEvidenceCapture<'a> {
    runner: &'a dyn host::CommandRunner,
    cli_environment: &'a agent::AutoHuntCliEnvironment,
    store: &'a auto_hunt_dispatch::AutoHuntDispatchStore,
    app: &'a tauri::AppHandle,
    dispatch_group_id: &'a str,
}

impl AutoHuntEvidenceCapture<'_> {
    fn capture(
        &self,
        workspace: &Path,
        run_id: &str,
        worker_session_id: &str,
    ) -> Vec<serde_json::Value> {
        let result = self
            .cli_environment
            .run_briar(
                self.runner,
                workspace,
                ["run", "evidence", "list", "--run", run_id],
            )
            .and_then(|output| {
                if !output.success() {
                    return Err(output.failure_message());
                }
                serde_json::from_str::<HostRunEvidenceResponse>(output.stdout.trim())
                    .map(|response| response.evidence)
                    .map_err(|error| format!("run evidence 결과를 읽지 못했습니다: {error}"))
            });
        match result {
            Ok(evidence) => {
                for item in &evidence {
                    if let Ok(group) = self.store.record_worker_evidence(
                        self.dispatch_group_id,
                        worker_session_id,
                        item.clone(),
                    ) {
                        emit_latest_auto_hunt_dispatch_event(self.app, &group);
                    }
                }
                evidence
            }
            Err(error) => {
                if let Ok(group) = self.store.record_worker_progress(
                    self.dispatch_group_id,
                    worker_session_id,
                    "worker_evidence_sync_failed",
                    format!("canonical run evidence를 불러오지 못했습니다: {error}"),
                ) {
                    emit_latest_auto_hunt_dispatch_event(self.app, &group);
                }
                Vec::new()
            }
        }
    }
}

fn emit_latest_auto_hunt_dispatch_event(
    app: &tauri::AppHandle,
    group: &auto_hunt_dispatch::AutoHuntDispatchGroup,
) {
    if let Some(event) = group.events.last() {
        let _ = app.emit(AUTO_HUNT_DISPATCH_EVENT, event);
    }
}

fn validate_project_auto_hunt_request(
    project_id: &str,
    request: &agent::ProjectAutoHuntRequest,
) -> Result<(), String> {
    validate_auto_hunt_session_id(&request.session_id)?;
    if request.issues.is_empty() {
        return Err("대기 상태인 이슈가 없습니다.".to_string());
    }
    if request.issues.len() > agent::MAX_AUTO_HUNT_ISSUES {
        return Err(format!(
            "한 번의 자동사냥 세션에서는 최대 {}개의 이슈만 처리할 수 있습니다.",
            agent::MAX_AUTO_HUNT_ISSUES
        ));
    }
    if request
        .issues
        .iter()
        .any(|issue| auto_hunt_run_token(&issue.run_id).is_err())
    {
        return Err("자동사냥 대상 이슈 ID가 올바르지 않습니다.".to_string());
    }
    if request.agent_id.trim().is_empty()
        || request.agent_id.len() > 128
        || request.agent_name.trim().is_empty()
        || request.agent_name.len() > 100
        || request
            .agent_model
            .as_ref()
            .is_some_and(|model| model.trim().is_empty() || model.len() > 100)
        || request.responsibility.trim().is_empty()
        || request.responsibility.len() > 2_000
        || request.skill.trim().is_empty()
        || request.skill.len() > 10_000
    {
        return Err("자동사냥 에이전트 설정이 올바르지 않습니다.".to_string());
    }
    if request
        .coordinator_conversation_id
        .as_deref()
        .is_some_and(|conversation_id| {
            agent::AgentProviderKind::for_conversation_id(project_id, conversation_id)
                != Some(request.agent_provider)
        })
    {
        return Err("조정 대화가 선택한 프로젝트와 프로바이더에 속하지 않습니다.".to_string());
    }
    Ok(())
}

fn create_auto_hunt_worker_event_sink(
    base: agent::AgentEventSink,
    store: auto_hunt_dispatch::AutoHuntDispatchStore,
    app: tauri::AppHandle,
    dispatch_group_id: String,
    worker_session_id: String,
) -> agent::AgentEventSink {
    Arc::new(move |provider_event| {
        let progress = match provider_event.event.as_ref() {
            Some(agent::AgentEvent::MessageCompleted { text, phase, .. })
                if !text.trim().is_empty() =>
            {
                Some((
                    "worker_progress",
                    match phase.as_deref() {
                        Some(phase) if !phase.trim().is_empty() => {
                            format!("[{phase}] {}", text.trim())
                        }
                        _ => text.trim().to_string(),
                    },
                ))
            }
            Some(agent::AgentEvent::TurnCompleted { status }) => Some((
                "worker_turn_completed",
                format!("에이전트 turn이 {status} 상태로 종료되었습니다."),
            )),
            _ => None,
        };
        base(provider_event)?;
        if let Some((event_type, message)) = progress {
            let group = store.record_worker_progress(
                &dispatch_group_id,
                &worker_session_id,
                event_type,
                message,
            )?;
            emit_latest_auto_hunt_dispatch_event(&app, &group);
        }
        Ok(())
    })
}

#[tauri::command]
async fn start_project_auto_hunt(
    app: tauri::AppHandle,
    session_cancellations: tauri::State<'_, AgentSessionCancellationState>,
    project_id: String,
    mut request: agent::ProjectAutoHuntRequest,
) -> Result<agent::ProjectAutoHuntResponse, String> {
    validate_project_auto_hunt_request(&project_id, &request)?;
    let cancellation = session_cancellations.register(&request.session_id)?;
    let cancellation_signal = cancellation.signal();
    let api_url = request.api_url.trim();
    if api_url.is_empty()
        || api_url.chars().any(char::is_whitespace)
        || !(api_url.starts_with("http://") || api_url.starts_with("https://"))
    {
        return Err("자동사냥 API URL이 올바르지 않습니다.".to_string());
    }
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let claude_runner = bundled_path(
        &resource_directory,
        "agent/claude-runner.js",
        "dist-agent/claude-runner.js",
    );
    let grok_runner = bundled_path(
        &resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let dispatch_store = auto_hunt_dispatch::AutoHuntDispatchStore::new(&app_data_directory)?;
    let created_dispatch = dispatch_store.create(
        &request.session_id,
        &project_id,
        &request.agent_id,
        request.coordinator_conversation_id.clone(),
        request.issues.len(),
    )?;
    emit_latest_auto_hunt_dispatch_event(&app, &created_dispatch);
    let dispatch_group_id = request.session_id.clone();
    let completion_store = dispatch_store.clone();
    let dispatch_app = app.clone();
    let event_sink =
        create_auto_hunt_event_sink(&app, &request.session_id, Arc::clone(&cancellation_signal))?;
    let approval_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _cancellation = cancellation;
        ensure_agent_session_running(&cancellation_signal)?;
        let (runner, workspace) =
            connected_project_workspace_on_host(&config_path, &project_id, &home)?;
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let provider = request.agent_provider;
        if !app_provider_settings_from(&config_path)?.is_enabled(provider) {
            return Err(
                "선택한 에이전트 프로바이더가 앱 설정에서 비활성화되어 있습니다.".to_string(),
            );
        }
        let execution_path = cli_execution_path(&home)?;
        let include_velen = project_auto_hunt_uses_velen(&config_path, &project_id)?;
        request.workflow_json = project_auto_hunt_workflow_json(&config_path, &project_id)?;
        let full_access = project_auto_hunt_full_access(&config_path, &project_id)?;
        let backend = agent::discover_backend(
            provider,
            runner.clone(),
            agent::AgentRunnerBundles {
                claude: &claude_runner,
                grok: &grok_runner,
            },
        )?;
        let model = request
            .agent_model
            .clone()
            .filter(|value| !value.trim().is_empty());
        let effort = (provider == settings.provider)
            .then_some(settings.effort)
            .flatten();
        let requested_count = request.issues.len();
        let mut workers = Vec::new();
        let mut issue_results = Vec::new();
        let mut first_conversation_id = None;
        let mut first_workspace = None;

        for index in 0..requested_count {
            ensure_agent_session_running(&cancellation_signal)?;
            // One isolated config snapshot per worker allows several runs to be
            // claimed without sharing the CLI's activeClaim state.
            let cli_environment = agent::AutoHuntCliEnvironment::prepare_on_host(
                runner.clone(),
                &home,
                &execution_path,
                &workspace,
                &project_id,
                &request.api_url,
                include_velen,
            )?;
            let requested_issue = &request.issues[index];
            let claim = claim_auto_hunt_run_on_host(
                runner.as_ref(),
                &cli_environment,
                &workspace,
                &requested_issue.run_id,
            )?;
            let Some(claimed) = claim.work else {
                return Err(format!(
                    "요청한 이슈 {}을 claim할 수 없습니다. 대기 상태와 기존 실행 여부를 확인해 주세요.",
                    requested_issue.source_key
                ));
            };
            if claimed.run_id != requested_issue.run_id {
                return Err(format!(
                    "호스트가 요청한 run {} 대신 {}을 claim했습니다.",
                    requested_issue.run_id, claimed.run_id
                ));
            }
            let worker_session_id = format!("{}-w{}", request.session_id, index + 1);
            let issue = agent::ProjectAutoHuntIssue {
                run_id: claimed.run_id.clone(),
                run_number: claimed.run_number,
                source_key: claimed.source_key.clone(),
                title: claimed.title.clone(),
            };
            let dispatch = dispatch_store.add_worker(
                &request.session_id,
                auto_hunt_dispatch::AutoHuntDispatchWorker {
                    session_id: worker_session_id.clone(),
                    run_id: claimed.run_id.clone(),
                    source_key: claimed.source_key.clone(),
                    title: claimed.title.clone(),
                    workspace_root: claimed
                        .workspace
                        .as_ref()
                        .map(|workspace| workspace.path.clone()),
                    conversation_id: None,
                    status: auto_hunt_dispatch::AutoHuntWorkerStatus::Allocating,
                    summary: None,
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: None,
                },
            )?;
            emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
            if cancellation_signal.load(Ordering::SeqCst) {
                let detail = AGENT_SESSION_STOPPED_ERROR;
                let _ = record_auto_hunt_terminal_event(
                    runner.as_ref(),
                    &cli_environment,
                    &workspace,
                    &claimed,
                    "cancelled",
                    "session-stopped",
                    detail,
                );
                let dispatch = dispatch_store.transition_worker(
                    &request.session_id,
                    &worker_session_id,
                    auto_hunt_dispatch::AutoHuntWorkerStatus::Cancelled,
                    claimed
                        .workspace
                        .as_ref()
                        .map(|workspace| workspace.path.clone()),
                    None,
                    Some(detail.to_string()),
                )?;
                emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                return Err(detail.to_string());
            }

            let Some(claimed_workspace) = claimed.workspace.as_ref() else {
                let detail = claim
                    .workspace_error
                    .as_deref()
                    .unwrap_or("호스트가 claim한 run의 전용 worktree를 반환하지 않았습니다.");
                let record_error = record_auto_hunt_terminal_event(
                    runner.as_ref(),
                    &cli_environment,
                    &workspace,
                    &claimed,
                    "blocked",
                    "workspace-allocation",
                    detail,
                )
                .err();
                let summary = match record_error {
                    Some(error) => format!("{detail} ({error})"),
                    None => detail.to_string(),
                };
                issue_results.push(agent::ProjectAutoHuntIssueResult {
                    source_key: claimed.source_key.clone(),
                    title: claimed.title.clone(),
                    outcome: "blocked".to_string(),
                    summary: summary.clone(),
                });
                workers.push(agent::ProjectAutoHuntWorkerResponse {
                    session_id: worker_session_id.clone(),
                    run_id: claimed.run_id,
                    source_key: claimed.source_key,
                    conversation_id: None,
                    workspace_root: None,
                    outcome: "blocked".to_string(),
                    summary,
                    evidence: Vec::new(),
                });
                let dispatch = dispatch_store.transition_worker(
                    &request.session_id,
                    &worker_session_id,
                    auto_hunt_dispatch::AutoHuntWorkerStatus::Blocked,
                    None,
                    None,
                    workers.last().map(|worker| worker.summary.clone()),
                )?;
                emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                continue;
            };
            if claimed_workspace.workspace_type != "worktree" {
                return Err("호스트가 전용 worktree가 아닌 workspace를 할당했습니다.".to_string());
            }
            let worker_workspace = PathBuf::from(&claimed_workspace.path);
            let dispatch = dispatch_store.transition_worker(
                &request.session_id,
                &worker_session_id,
                auto_hunt_dispatch::AutoHuntWorkerStatus::Running,
                Some(claimed_workspace.path.clone()),
                None,
                Some(format!("{} 워커를 시작했습니다.", claimed.source_key)),
            )?;
            emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
            let mut worker_request = request.clone();
            worker_request.issues = vec![issue.clone()];
            worker_request.workflow_json = serde_json::to_string_pretty(&claimed.workflow)
                .map_err(|error| format!("claim workflow를 직렬화하지 못했습니다: {error}"))?;
            let worker_event_sink = create_auto_hunt_worker_event_sink(
                event_sink.clone(),
                dispatch_store.clone(),
                dispatch_app.clone(),
                request.session_id.clone(),
                worker_session_id.clone(),
            );
            let approve = |method: &str, params: &serde_json::Value| {
                if let Ok(dispatch) = dispatch_store.transition_worker(
                    &request.session_id,
                    &worker_session_id,
                    auto_hunt_dispatch::AutoHuntWorkerStatus::NeedsInput,
                    None,
                    None,
                    Some("사용자 승인을 기다리고 있습니다.".to_string()),
                ) {
                    emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                }
                let provider_name = provider.display_name();
                let approved = approval_app
                    .dialog()
                    .message(approval_request_message(provider, method, params))
                    .title(format!("{provider_name} 자동사냥 승인"))
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "승인".to_string(),
                        "거절".to_string(),
                    ))
                    .blocking_show();
                if let Ok(dispatch) = dispatch_store.transition_worker(
                    &request.session_id,
                    &worker_session_id,
                    auto_hunt_dispatch::AutoHuntWorkerStatus::Running,
                    None,
                    None,
                    Some(if approved {
                        "사용자가 작업을 승인했습니다.".to_string()
                    } else {
                        "사용자가 작업을 거절했습니다.".to_string()
                    }),
                ) {
                    emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                }
                approved
            };

            match agent::start_auto_hunt_worker(
                &backend,
                &project_id,
                &worker_workspace,
                agent::AutoHuntExecution {
                    approval_policy: settings.approval_policy,
                    model: model.clone(),
                    effort,
                    event_sink: worker_event_sink,
                    environment: cli_environment.environment().to_vec(),
                    // The worker starts inside its final worktree. Codex grants
                    // that checkout and its linked Git metadata together.
                    workspace_write_roots: Vec::new(),
                    full_access,
                },
                worker_request,
                issue,
                &approve,
            ) {
                Ok(response) => {
                    let result = response
                        .result
                        .issues
                        .into_iter()
                        .next()
                        .ok_or_else(|| "워커 결과가 비어 있습니다.".to_string())?;
                    first_conversation_id.get_or_insert_with(|| response.conversation_id.clone());
                    first_workspace.get_or_insert_with(|| response.workspace_root.clone());
                    let evidence = AutoHuntEvidenceCapture {
                        runner: runner.as_ref(),
                        cli_environment: &cli_environment,
                        store: &dispatch_store,
                        app: &dispatch_app,
                        dispatch_group_id: &request.session_id,
                    }
                    .capture(
                        &worker_workspace,
                        &claimed.run_id,
                        &worker_session_id,
                    );
                    workers.push(agent::ProjectAutoHuntWorkerResponse {
                        session_id: worker_session_id.clone(),
                        run_id: claimed.run_id.clone(),
                        source_key: claimed.source_key.clone(),
                        conversation_id: Some(response.conversation_id.clone()),
                        workspace_root: Some(response.workspace_root.clone()),
                        outcome: result.outcome.clone(),
                        summary: result.summary.clone(),
                        evidence,
                    });
                    let dispatch = dispatch_store.transition_worker(
                        &request.session_id,
                        &worker_session_id,
                        auto_hunt_dispatch::AutoHuntWorkerStatus::from_outcome(&result.outcome),
                        Some(claimed_workspace.path.clone()),
                        Some(response.conversation_id),
                        Some(result.summary.clone()),
                    )?;
                    emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                    issue_results.push(result);
                }
                Err(error) => {
                    if cancellation_signal.load(Ordering::SeqCst) {
                        let detail = AGENT_SESSION_STOPPED_ERROR.to_string();
                        let _ = record_auto_hunt_terminal_event(
                            runner.as_ref(),
                            &cli_environment,
                            &worker_workspace,
                            &claimed,
                            "cancelled",
                            "session-stopped",
                            &detail,
                        );
                        let dispatch = dispatch_store.transition_worker(
                            &request.session_id,
                            &worker_session_id,
                            auto_hunt_dispatch::AutoHuntWorkerStatus::Cancelled,
                            Some(claimed_workspace.path.clone()),
                            None,
                            Some(detail.clone()),
                        )?;
                        emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                        return Err(detail);
                    }
                    let record_error = record_auto_hunt_terminal_event(
                        runner.as_ref(),
                        &cli_environment,
                        &worker_workspace,
                        &claimed,
                        "failed",
                        "worker-execution",
                        &error,
                    )
                    .err();
                    let summary = match record_error {
                        Some(record_error) => format!("{error} ({record_error})"),
                        None => error,
                    };
                    let evidence = AutoHuntEvidenceCapture {
                        runner: runner.as_ref(),
                        cli_environment: &cli_environment,
                        store: &dispatch_store,
                        app: &dispatch_app,
                        dispatch_group_id: &request.session_id,
                    }
                    .capture(
                        &worker_workspace,
                        &claimed.run_id,
                        &worker_session_id,
                    );
                    issue_results.push(agent::ProjectAutoHuntIssueResult {
                        source_key: claimed.source_key.clone(),
                        title: claimed.title.clone(),
                        outcome: "failed".to_string(),
                        summary: summary.clone(),
                    });
                    workers.push(agent::ProjectAutoHuntWorkerResponse {
                        session_id: worker_session_id.clone(),
                        run_id: claimed.run_id.clone(),
                        source_key: claimed.source_key.clone(),
                        conversation_id: None,
                        workspace_root: Some(claimed_workspace.path.clone()),
                        outcome: "failed".to_string(),
                        summary,
                        evidence,
                    });
                    let dispatch = dispatch_store.transition_worker(
                        &request.session_id,
                        &worker_session_id,
                        auto_hunt_dispatch::AutoHuntWorkerStatus::Failed,
                        Some(claimed_workspace.path.clone()),
                        None,
                        workers.last().map(|worker| worker.summary.clone()),
                    )?;
                    emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                }
            }
        }

        let completed = issue_results
            .iter()
            .filter(|result| result.outcome == "completed")
            .count();
        let fallback_summary = format!(
            "{}개 run을 dispatch해 {completed}개를 완료했습니다.",
            issue_results.len()
        );
        let coordinator_started = dispatch_store.record_coordinator_event(
            &request.session_id,
            "coordinator_started",
            "running",
            "모든 워커가 종료되어 조정 에이전트가 결과를 종합합니다.".to_string(),
            None,
        )?;
        emit_latest_auto_hunt_dispatch_event(&dispatch_app, &coordinator_started);
        let coordinator = agent::summarize_auto_hunt_dispatch(
            &backend,
            &project_id,
            &workspace,
            agent::AutoHuntExecution {
                approval_policy: agent::ApprovalPolicy::Never,
                model: model.clone(),
                effort,
                event_sink: event_sink.clone(),
                environment: Vec::new(),
                workspace_write_roots: Vec::new(),
                full_access: false,
            },
            &request,
            &workers,
            &|_, _| false,
        );
        let (summary, coordinator_conversation_id, coordinator_workspace) = match coordinator {
            Ok(coordinator) => {
                let dispatch = dispatch_store.record_coordinator_event(
                    &request.session_id,
                    "coordinator_completed",
                    "completed",
                    coordinator.summary.clone(),
                    Some(coordinator.conversation_id.clone()),
                )?;
                emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                (
                    coordinator.summary,
                    Some(coordinator.conversation_id),
                    Some(coordinator.workspace_root),
                )
            }
            Err(error) => {
                let dispatch = dispatch_store.record_coordinator_event(
                    &request.session_id,
                    "coordinator_failed",
                    "failed",
                    format!("조정 에이전트 요약에 실패해 runtime 요약을 사용합니다: {error}"),
                    None,
                )?;
                emit_latest_auto_hunt_dispatch_event(&dispatch_app, &dispatch);
                (fallback_summary, None, None)
            }
        };
        Ok(agent::ProjectAutoHuntResponse {
            dispatch_group_id: request.session_id,
            conversation_id: coordinator_conversation_id
                .or(first_conversation_id)
                .unwrap_or_default(),
            workspace_root: coordinator_workspace
                .or(first_workspace)
                .unwrap_or_else(|| path_display_string(workspace.clone()).unwrap_or_default()),
            workers,
            result: agent::ProjectAutoHuntResult {
                summary,
                issues: issue_results,
            },
        })
    })
    .await;
    match outcome {
        Ok(Ok(response)) => {
            let dispatch = completion_store.finish(
                &dispatch_group_id,
                auto_hunt_dispatch::AutoHuntDispatchStatus::Completed,
                None,
            )?;
            emit_latest_auto_hunt_dispatch_event(&app, &dispatch);
            Ok(response)
        }
        Ok(Err(error)) if error == AGENT_SESSION_STOPPED_ERROR => {
            let dispatch = completion_store.finish(
                &dispatch_group_id,
                auto_hunt_dispatch::AutoHuntDispatchStatus::Interrupted,
                None,
            )?;
            emit_latest_auto_hunt_dispatch_event(&app, &dispatch);
            Err(error)
        }
        Ok(Err(error)) => {
            let persisted = completion_store.finish(
                &dispatch_group_id,
                auto_hunt_dispatch::AutoHuntDispatchStatus::Failed,
                Some(error.clone()),
            );
            match persisted {
                Ok(dispatch) => {
                    emit_latest_auto_hunt_dispatch_event(&app, &dispatch);
                    Err(error)
                }
                Err(store_error) => Err(format!("{error} ({store_error})")),
            }
        }
        Err(join_error) => {
            let error = format!("자동사냥 runtime 작업이 비정상 종료되었습니다: {join_error}");
            let persisted = completion_store.finish(
                &dispatch_group_id,
                auto_hunt_dispatch::AutoHuntDispatchStatus::Failed,
                Some(error.clone()),
            );
            match persisted {
                Ok(dispatch) => {
                    emit_latest_auto_hunt_dispatch_event(&app, &dispatch);
                    Err(error)
                }
                Err(store_error) => Err(format!("{error} ({store_error})")),
            }
        }
    }
}

fn validate_auto_hunt_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
    {
        return Err("자동사냥 세션 ID가 올바르지 않습니다.".to_string());
    }
    Ok(())
}

fn auto_hunt_event_path(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    validate_auto_hunt_session_id(session_id)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(AUTO_HUNT_EVENT_DIRECTORY)
        .join(format!("{session_id}.jsonl")))
}

fn create_auto_hunt_event_sink(
    app: &tauri::AppHandle,
    session_id: &str,
    cancelled: Arc<AtomicBool>,
) -> Result<agent::AgentEventSink, String> {
    let path = auto_hunt_event_path(app, session_id)?;
    let directory = path
        .parent()
        .ok_or_else(|| "자동사냥 이벤트 저장 경로가 올바르지 않습니다.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("자동사냥 이벤트 저장 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("자동사냥 이벤트 저장 폴더 권한을 지정하지 못했습니다: {error}")
        })?;
    }
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("자동사냥 이벤트 로그를 열지 못했습니다: {error}"))?;
    let file = Arc::new(Mutex::new(file));
    let sequence = Arc::new(AtomicU64::new(0));
    let session_id = session_id.to_string();
    let event_app = app.clone();

    Ok(Arc::new(move |provider_event| {
        ensure_agent_session_running(&cancelled)?;
        let record = agent::AppServerEventRecord::new(
            session_id.clone(),
            sequence.fetch_add(1, Ordering::Relaxed) + 1,
            provider_event,
        );
        let serialized = serde_json::to_vec(&record)
            .map_err(|error| format!("자동사냥 이벤트를 직렬화하지 못했습니다: {error}"))?;
        {
            let mut file = file
                .lock()
                .map_err(|_| "자동사냥 이벤트 로그 잠금이 손상되었습니다.".to_string())?;
            file.write_all(&serialized)
                .and_then(|_| file.write_all(b"\n"))
                .and_then(|_| file.flush())
                .map_err(|error| format!("자동사냥 이벤트를 저장하지 못했습니다: {error}"))?;
        }
        let _ = event_app.emit(AUTO_HUNT_APP_SERVER_EVENT, &record);
        Ok(())
    }))
}

#[tauri::command]
async fn load_auto_hunt_app_server_events(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Vec<agent::AppServerEventRecord>, String> {
    let path = auto_hunt_event_path(&app, &session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!("자동사냥 이벤트 로그를 읽지 못했습니다: {error}"));
            }
        };
        contents
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(index, line)| {
                serde_json::from_str(line).map_err(|error| {
                    format!(
                        "자동사냥 이벤트 로그의 {}번째 줄이 손상되었습니다: {error}",
                        index + 1
                    )
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_auto_hunt_dispatch(
    app: tauri::AppHandle,
    dispatch_group_id: String,
    after_cursor: Option<u64>,
) -> Result<Option<auto_hunt_dispatch::AutoHuntDispatchGroup>, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = auto_hunt_dispatch::AutoHuntDispatchStore::new(&app_data_directory)?;
        let mut group = match store.load(&dispatch_group_id)? {
            Some(group) => group,
            None => return Ok(None),
        };
        let cursor = after_cursor.unwrap_or(0);
        group.events.retain(|event| event.cursor > cursor);
        Ok(Some(group))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_app_provider_settings(app: tauri::AppHandle) -> Result<AppProviderSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || app_provider_settings_from(&config_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_app_runtime_settings(app: tauri::AppHandle) -> Result<AppRuntimeSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        app_runtime_settings_from(&config_path).map(AppRuntimeSettings::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_agent_usage(
    app: tauri::AppHandle,
) -> Result<agent_usage::AgentUsageSnapshot, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    Ok(agent_usage::load(home).await)
}

#[tauri::command]
async fn update_app_provider_settings(
    app: tauri::AppHandle,
    settings: AppProviderSettings,
) -> Result<AppProviderSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_app_provider_settings_at(&config_path, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_app_runtime_settings(
    app: tauri::AppHandle,
    sleep_prevention: tauri::State<'_, SleepPreventionState>,
    settings: StoredAppRuntimeSettings,
) -> Result<AppRuntimeSettings, String> {
    let config_path = cli_config_path(&app)?;
    let saved = tauri::async_runtime::spawn_blocking(move || {
        update_app_runtime_settings_at(&config_path, settings)
    })
    .await
    .map_err(|error| error.to_string())??;
    sleep_prevention.set_enabled(saved.prevent_sleep_while_running)?;
    Ok(saved.into())
}

#[tauri::command]
async fn load_project_llm_settings(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<agent::ProjectLlmSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        project_llm_settings_from(&config_path, &project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_project_llm_settings(
    app: tauri::AppHandle,
    project_id: String,
    settings: agent::ProjectLlmSettings,
) -> Result<agent::ProjectLlmSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_llm_settings_at(&config_path, &project_id, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_project_sandbox_settings(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectSandboxSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        project_sandbox_settings_from(&config_path, &project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_project_sandbox_settings(
    app: tauri::AppHandle,
    project_id: String,
    settings: ProjectSandboxSettings,
) -> Result<ProjectSandboxSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_sandbox_settings_at(&config_path, &project_id, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_local_project_workflow(
    app: tauri::AppHandle,
    project_id: String,
    workflow: WorkflowConfig,
) -> Result<WorkflowConfig, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_workflow_at(&config_path, &project_id, workflow)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_local_project_linear(
    app: tauri::AppHandle,
    project_id: String,
    linear: StoredLinearConfig,
) -> Result<StoredLinearConfig, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_linear_at(&config_path, &project_id, linear, &inspect_velen_sync)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_local_project_velen_org(
    app: tauri::AppHandle,
    project_id: String,
    org: Option<String>,
) -> Result<Option<String>, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_velen_org_at(&config_path, &project_id, org, &inspect_velen_sync)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn disconnect_local_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove_cli_connection(&config_path, &project_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn connect_local_project(
    app: tauri::AppHandle,
    api_url: String,
    project_id: String,
    agent_token: String,
    repository_path: String,
    execution_host_id: Option<String>,
    mut auto_hunt: AutoHuntConfig,
) -> Result<ConnectedLocalProject, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let execution_host = host::ExecutionHostId::parse(execution_host_id.as_deref());
        let config = read_cli_config(&config_path)?;
        let runner = host::runner_for(
            &execution_host,
            &config.ssh_hosts,
            cli_execution_path(&home)?,
            &home,
            host::SshAuth::default(),
        )?;
        let root = if runner.is_remote() {
            resolve_workspace_with(runner.as_ref(), Path::new(&repository_path))?
        } else {
            git_repository_root(Path::new(&repository_path))?
        };
        let remote = repository_remote_on(runner.as_ref(), &root);
        let workflow = auto_hunt.workflow.clone();
        let root_string = root
            .into_os_string()
            .into_string()
            .map_err(|_| "Git 저장소 경로를 표시할 수 없습니다.".to_string())?;
        auto_hunt.velen_org = auto_hunt
            .velen_org
            .take()
            .map(|org| org.trim().to_string())
            .filter(|org| !org.is_empty());
        if auto_hunt.data_source.is_some() && auto_hunt.velen_org.is_none() {
            return Err("Velen data source를 사용하려면 Velen 조직을 설정하세요.".to_string());
        }
        let inspection = auto_hunt
            .velen_org
            .as_ref()
            .map(|org| inspect_velen_on(runner.as_ref(), Some(org.clone())))
            .transpose()?;
        if auto_hunt.linear_enabled {
            let inspection = inspection
                .as_ref()
                .ok_or_else(|| "Linear 연결에는 Velen 조직이 필요합니다.".to_string())?;
            let source = auto_hunt
                .linear_source
                .as_deref()
                .ok_or_else(|| "Linear 소스를 선택하세요.".to_string())?;
            if !inspection.sources.iter().any(|candidate| {
                candidate.provider == "linear"
                    && candidate.status == "active"
                    && (candidate.source_ref == source || candidate.source_key == source)
            }) {
                return Err("선택한 Linear 소스를 Velen에서 사용할 수 없습니다.".to_string());
            }
        }
        if !runner.is_remote() {
            install_auto_hunt_assets(&resource_directory, &home)?;
        }
        let provider = if runner.resolve_binary("codex").is_ok() {
            agent::AgentProviderKind::Codex
        } else if runner.resolve_binary("claude").is_ok() {
            agent::AgentProviderKind::Claude
        } else if runner.resolve_binary("grok").is_ok() {
            agent::AgentProviderKind::Grok
        } else {
            agent::AgentProviderKind::Codex
        };
        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url,
                project_id,
                agent_token,
                repository_path: root_string.clone(),
                repository_remote: remote,
                execution_host: Some(execution_host),
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings {
                    provider,
                    ..agent::ProjectLlmSettings::default()
                },
                auto_hunt,
            },
        )?;
        Ok(ConnectedLocalProject {
            repository_path: root_string,
            workflow,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn launch_intro_bounds(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    work_area_y: i32,
) -> (i32, i32, u32, u32) {
    let top_inset = work_area_y.saturating_sub(monitor_y).max(0) as u32;
    (
        monitor_x,
        monitor_y.saturating_add(top_inset as i32),
        monitor_width,
        monitor_height.saturating_sub(top_inset).max(1),
    )
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Briar main window is unavailable".to_string())
}

fn main_window_size(compact: bool) -> (f64, f64) {
    if compact {
        ONBOARDING_MAIN_WINDOW_SIZE
    } else {
        DEFAULT_MAIN_WINDOW_SIZE
    }
}

#[tauri::command]
fn set_main_window_onboarding_mode(app: tauri::AppHandle, compact: bool) -> Result<(), String> {
    let main = main_window(&app)?;
    let (width, height) = main_window_size(compact);
    main.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    #[cfg(desktop)]
    main.center().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn display_main_window(app: &AppHandle, focus: bool) -> Result<(), String> {
    let main = main_window(app)?;
    main.center().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    if focus {
        main.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        display_main_window(&app, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        display_main_window(&app, false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn finish_launch_intro(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(intro) = app.get_webview_window("launch-intro") {
            intro.destroy().map_err(|error| error.to_string())?;
        }
        display_main_window(&app, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn prepare_launch_intro(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if app.get_webview_window("launch-intro").is_some() {
            return Ok(());
        }

        let main = main_window(&app)?;
        main.center().map_err(|error| error.to_string())?;
        main.hide().map_err(|error| error.to_string())?;

        let monitor = match main.current_monitor().map_err(|error| error.to_string())? {
            Some(monitor) => monitor,
            None => main
                .primary_monitor()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "No macOS display is available".to_string())?,
        };
        let position = monitor.position();
        let size = monitor.size();
        let work_area = monitor.work_area();
        let (x, y, width, height) = launch_intro_bounds(
            position.x,
            position.y,
            size.width,
            size.height,
            work_area.position.y,
        );
        let scale_factor = monitor.scale_factor();

        let build_result = WebviewWindowBuilder::new(
            &app,
            "launch-intro",
            WebviewUrl::App("index.html?launchIntro=native".into()),
        )
        .title("")
        .position(x as f64 / scale_factor, y as f64 / scale_factor)
        .inner_size(width as f64 / scale_factor, height as f64 / scale_factor)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .closable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .shadow(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .initialization_script("document.documentElement.classList.add('launch-intro-document');")
        .focused(true)
        .visible(true)
        .build();

        if let Err(error) = build_result {
            let _ = display_main_window(&app, true);
            return Err(error.to_string());
        }

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("The native launch intro is only available on macOS".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(SleepPreventionState::default())
        .manage(AgentSessionCancellationState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_auth_session::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|_app| {
            #[cfg(desktop)]
            {
                if let Ok(config_path) = cli_config_path(_app.handle()) {
                    match app_runtime_settings_from(&config_path) {
                        Ok(settings) => {
                            if let Err(error) = _app
                                .state::<SleepPreventionState>()
                                .set_enabled(settings.prevent_sleep_while_running)
                            {
                                eprintln!("Sleep prevention startup failed: {error}");
                            }
                        }
                        Err(error) => {
                            eprintln!("App runtime settings startup failed: {error}");
                        }
                    }
                }
                let schedule_poll_app = _app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    let _ = schedule_poll_app.emit(PROJECT_AGENT_SCHEDULE_POLL_EVENT, ());
                });
                let resource_directory = _app.path().resource_dir()?;
                let home = _app.path().home_dir()?;
                let app_data_directory = _app.path().app_data_dir()?;
                if let Err(error) =
                    auto_hunt_dispatch::AutoHuntDispatchStore::new(&app_data_directory)
                        .and_then(|store| store.interrupt_orphaned_groups())
                {
                    eprintln!("Auto Hunt dispatch recovery failed: {error}");
                }
                if let Err(error) = sync_auto_hunt_assets(&resource_directory, &home) {
                    eprintln!(
                        "Briar CLI and Auto Hunt skill automatic synchronization failed: {error}"
                    );
                }
            }
            #[cfg(all(target_os = "macos", not(dev)))]
            if let Some(main) = _app.get_webview_window("main") {
                main.hide()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prepare_launch_intro,
            show_main_window,
            reveal_main_window,
            finish_launch_intro,
            set_main_window_onboarding_mode,
            inspect_onboarding_prerequisites,
            install_onboarding_prerequisite,
            read_session_token,
            write_session_token,
            clear_session_token,
            current_app_icon,
            set_app_icon,
            set_app_badge_count,
            validate_repository_path,
            project_workspace_root,
            create_project_workspace,
            inspect_repository_readiness,
            connected_project_ids,
            project_llm_chat,
            run_project_agent,
            stop_project_agent_session,
            start_project_auto_hunt,
            load_auto_hunt_app_server_events,
            load_auto_hunt_dispatch,
            load_app_provider_settings,
            load_app_runtime_settings,
            load_agent_usage,
            update_app_provider_settings,
            update_app_runtime_settings,
            load_project_llm_settings,
            update_project_llm_settings,
            load_project_sandbox_settings,
            update_project_sandbox_settings,
            update_local_project_workflow,
            update_local_project_linear,
            update_local_project_velen_org,
            project_repository_readiness,
            install_project_github_cli,
            login_project_github,
            disconnect_local_project,
            connect_local_project,
            list_execution_hosts,
            load_project_execution_connection,
            list_remote_directory,
            update_project_execution_connection,
            resolve_ssh_host,
            add_ssh_host,
            remove_ssh_host,
            inspect_velen,
            auto_hunt_health,
            repair_auto_hunt
        ])
        .run(tauri::generate_context!())
        .expect("error while running Briar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn stops_only_the_registered_agent_session_and_cleans_it_up() {
        let state = AgentSessionCancellationState::default();
        let registration = state.register("session-1").expect("registration");
        assert!(!registration.cancelled.load(Ordering::SeqCst));
        assert!(state.stop("session-1").expect("stop"));
        assert!(registration.cancelled.load(Ordering::SeqCst));
        assert!(!state.stop("missing-session").expect("missing"));

        assert!(state.register("session-1").is_err());
        assert!(registration.cancelled.load(Ordering::SeqCst));
        drop(registration);
        assert!(!state.stop("session-1").expect("cleaned up"));
    }

    #[cfg(unix)]
    #[test]
    fn resolves_cli_tools_installed_through_mise_shims_as_a_fallback() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().expect("fixture home should exist");
        let shims = home.path().join(".local/share/mise/shims");
        fs::create_dir_all(&shims).expect("mise shims directory should exist");
        let bun = shims.join("bun");
        fs::write(&bun, "#!/bin/sh\nexit 0\n").expect("fixture Bun should be written");
        fs::set_permissions(&bun, fs::Permissions::from_mode(0o700))
            .expect("fixture Bun should be executable");

        let resolved = which::which_in(
            "bun",
            Some(
                cli_execution_path_with_runtime(home.path(), Vec::new())
                    .expect("CLI PATH should resolve"),
            ),
            home.path(),
        )
        .expect("Bun should resolve through the mise shim directory");

        assert_eq!(resolved, bun);
    }

    #[cfg(unix)]
    #[test]
    fn prefers_the_bundled_bun_over_user_installed_runtimes() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().expect("fixture home should exist");
        let bundled = tempfile::tempdir().expect("bundled runtime directory should exist");
        let user_shims = home.path().join(".local/share/mise/shims");
        fs::create_dir_all(&user_shims).expect("mise shims directory should exist");
        for bun in [bundled.path().join("bun"), user_shims.join("bun")] {
            fs::write(&bun, "#!/bin/sh\nexit 0\n").expect("fixture Bun should be written");
            fs::set_permissions(&bun, fs::Permissions::from_mode(0o700))
                .expect("fixture Bun should be executable");
        }

        let resolved = which::which_in(
            "bun",
            Some(
                cli_execution_path_with_runtime(home.path(), [bundled.path().to_path_buf()])
                    .expect("CLI PATH should resolve"),
            ),
            home.path(),
        )
        .expect("Bun should resolve through the bundled runtime directory");

        assert_eq!(resolved, bundled.path().join("bun"));
    }

    #[test]
    fn resolves_the_sidecar_next_to_apps_and_test_binaries() {
        assert_eq!(
            bundled_runtime_directories(Path::new("/Applications/Briar.app/Contents/MacOS/briar")),
            vec![PathBuf::from("/Applications/Briar.app/Contents/MacOS")]
        );
        assert_eq!(
            bundled_runtime_directories(Path::new(
                "/repo/src-tauri/target/debug/deps/briar_lib-test"
            )),
            vec![
                PathBuf::from("/repo/src-tauri/target/debug/deps"),
                PathBuf::from("/repo/src-tauri/target/debug")
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_the_prepared_bun_sidecar_from_the_test_target() {
        let bundled = bundled_bun_binary().expect("prepared Bun sidecar should resolve");
        assert_eq!(bundled.file_name(), Some(OsStr::new("bun")));
        let output = Command::new(bundled)
            .arg("--version")
            .output()
            .expect("bundled Bun should execute");
        assert!(output.status.success());
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package should parse");
        let expected = package["packageManager"]
            .as_str()
            .and_then(|value| value.strip_prefix("bun@"))
            .expect("packageManager should pin Bun");
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), expected);
    }

    #[test]
    fn selects_an_issue_worktree_by_recorded_branch() {
        let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111
";

        assert_eq!(
            select_issue_worktree(
                output,
                "11111111-2222-3333-4444-555555555555",
                Some("briar/fix-login-11111111"),
            )
            .expect("recorded branch should resolve"),
            PathBuf::from("/worktrees/fix-login-11111111")
        );
    }

    #[test]
    fn recovers_an_issue_worktree_from_the_run_token_without_a_recorded_branch() {
        let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111-2
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111-2
";

        assert_eq!(
            select_issue_worktree(output, "11111111-2222-3333-4444-555555555555", None,)
                .expect("run token should resolve"),
            PathBuf::from("/worktrees/fix-login-11111111-2")
        );
    }

    #[test]
    fn refuses_to_fall_back_when_the_issue_worktree_is_missing_or_ambiguous() {
        let missing = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main
";
        assert!(
            select_issue_worktree(missing, "11111111-2222-3333-4444-555555555555", None,).is_err()
        );

        let ambiguous = "\
worktree /worktrees/first-11111111
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/briar/first-11111111

worktree /worktrees/second-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/second-11111111
";
        assert!(
            select_issue_worktree(ambiguous, "11111111-2222-3333-4444-555555555555", None,)
                .is_err()
        );
    }

    #[test]
    fn deserializes_the_issue_context_workspace_mode() {
        assert!(matches!(
            serde_json::from_str::<ProjectWorkspaceMode>("\"issueContext\"")
                .expect("issue context mode should deserialize"),
            ProjectWorkspaceMode::IssueContext
        ));
    }

    #[test]
    fn unrestricted_project_chat_bypasses_approvals_and_sandboxing() {
        let execution = project_chat_execution(
            true,
            agent::ApprovalPolicy::OnRequest,
            Some("model".to_string()),
            Some(agent::ModelEffort::High),
        );

        assert_eq!(execution.approval_policy, agent::ApprovalPolicy::Never);
        assert_eq!(execution.sandbox_mode, agent::SandboxMode::DangerFullAccess);
        assert!(execution.network_access);
        assert_eq!(execution.model.as_deref(), Some("model"));
        assert_eq!(execution.effort, Some(agent::ModelEffort::High));
    }

    #[test]
    fn ordinary_project_chat_stays_read_only() {
        let execution = project_chat_execution(false, agent::ApprovalPolicy::OnRequest, None, None);

        assert_eq!(execution.approval_policy, agent::ApprovalPolicy::OnRequest);
        assert_eq!(execution.sandbox_mode, agent::SandboxMode::ReadOnly);
        assert!(!execution.network_access);
    }

    #[test]
    fn parses_the_remote_default_branch_from_ls_remote() {
        assert_eq!(
            remote_head_branch(
                "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n"
            ),
            Some("main")
        );
        assert_eq!(
            remote_head_branch("0123456789abcdef0123456789abcdef01234567\tHEAD\n"),
            None
        );
    }

    #[test]
    fn workflow_analysis_uses_and_removes_the_latest_remote_checkout() {
        let Ok(git) = which::which("git") else {
            return;
        };
        let root = tempfile::tempdir().expect("temporary repository root");
        let remote = root.path().join("remote.git");
        let publisher = root.path().join("publisher");
        let connected = root.path().join("connected");

        let run = |cwd: &Path, args: &[&str]| {
            let output = Command::new(&git)
                .arg("-C")
                .arg(cwd)
                .args(args)
                .output()
                .expect("git command");
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };

        fs::create_dir_all(&publisher).expect("publisher directory");
        run(&publisher, &["init", "-b", "main"]);
        run(&publisher, &["config", "user.name", "Briar Test"]);
        run(
            &publisher,
            &["config", "user.email", "briar-test@example.com"],
        );
        fs::write(publisher.join("version.txt"), "old\n").expect("old version");
        run(&publisher, &["add", "version.txt"]);
        run(&publisher, &["commit", "-m", "old version"]);

        let init_remote = Command::new(&git)
            .args(["init", "--bare", "-b", "main"])
            .arg(&remote)
            .output()
            .expect("bare remote");
        assert!(
            init_remote.status.success(),
            "{}",
            String::from_utf8_lossy(&init_remote.stderr)
        );
        run(
            &publisher,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );
        run(&publisher, &["push", "-u", "origin", "main"]);

        let clone = Command::new(&git)
            .arg("clone")
            .arg(&remote)
            .arg(&connected)
            .output()
            .expect("connected clone");
        assert!(
            clone.status.success(),
            "{}",
            String::from_utf8_lossy(&clone.stderr)
        );
        fs::write(publisher.join("version.txt"), "latest\n").expect("latest version");
        run(&publisher, &["add", "version.txt"]);
        run(&publisher, &["commit", "-m", "latest version"]);
        let latest_sha = run(&publisher, &["rev-parse", "HEAD"]);
        run(&publisher, &["push", "origin", "main"]);

        assert_eq!(
            fs::read_to_string(connected.join("version.txt")).expect("connected version"),
            "old\n"
        );
        let runner = host::LocalRunner::new(
            env::var_os("PATH").unwrap_or_default(),
            root.path().to_path_buf(),
        );
        let latest = prepare_latest_remote_workspace(&runner, &connected)
            .expect("latest workspace")
            .expect("origin workspace");
        assert_eq!(
            fs::read_to_string(latest.checkout.join("version.txt")).expect("analysis version"),
            "latest\n"
        );
        assert_eq!(run(&latest.checkout, &["rev-parse", "HEAD"]), latest_sha);

        remove_latest_remote_workspace(&runner, &connected, &latest).expect("cleanup");
        assert!(!latest.root.exists());
    }

    #[test]
    fn workflow_analysis_uses_the_connected_checkout_without_an_origin() {
        let Ok(git) = which::which("git") else {
            return;
        };
        let repository = tempfile::tempdir().expect("temporary repository");
        let init = Command::new(&git)
            .arg("-C")
            .arg(repository.path())
            .args(["init", "-b", "main"])
            .output()
            .expect("git init");
        assert!(
            init.status.success(),
            "{}",
            String::from_utf8_lossy(&init.stderr)
        );
        let runner = host::LocalRunner::new(
            env::var_os("PATH").unwrap_or_default(),
            repository.path().to_path_buf(),
        );

        assert!(prepare_latest_remote_workspace(&runner, repository.path())
            .expect("connected fallback")
            .is_none());
    }

    #[test]
    fn project_folder_names_stay_filesystem_safe() {
        assert_eq!(project_folder_name("  briar  ").as_deref(), Ok("briar"));
        assert_eq!(
            project_folder_name("my new project").as_deref(),
            Ok("my-new-project")
        );
        assert_eq!(
            project_folder_name("../etc/passwd").as_deref(),
            Ok("etc-passwd")
        );
        assert!(project_folder_name("   ").is_err());
        assert!(project_folder_name("///").is_err());
    }

    #[test]
    fn new_projects_get_an_initialized_git_repository() {
        let Ok(git) = which::which("git") else {
            return;
        };
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = env::temp_dir().join(format!("briar-workspace-{unique}"));

        let created = create_project_workspace_in(&git, &root, "Sample Project").expect("created");
        assert!(created.created);
        assert!(created.repository_path.ends_with("Sample-Project"));
        assert!(Path::new(&created.repository_path).join(".git").is_dir());
        assert!(Path::new(&created.repository_path)
            .join("README.md")
            .is_file());

        let reused = create_project_workspace_in(&git, &root, "Sample Project").expect("reused");
        assert!(!reused.created);
        assert_eq!(reused.repository_path, created.repository_path);

        let occupied = root.join("Taken");
        fs::create_dir_all(&occupied).expect("directory");
        fs::write(occupied.join("notes.md"), "hello").expect("file");
        assert!(create_project_workspace_in(&git, &root, "Taken").is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn launch_intro_covers_the_desktop_below_the_menu_bar() {
        assert_eq!(
            launch_intro_bounds(0, 0, 3024, 1964, 48),
            (0, 48, 3024, 1916)
        );
        assert_eq!(
            launch_intro_bounds(-2560, -120, 2560, 1440, -120),
            (-2560, -120, 2560, 1440)
        );
    }

    #[test]
    fn uses_compact_window_dimensions_only_during_onboarding() {
        assert_eq!(main_window_size(true), ONBOARDING_MAIN_WINDOW_SIZE);
        assert_eq!(main_window_size(false), DEFAULT_MAIN_WINDOW_SIZE);
    }

    #[test]
    fn parses_plain_and_json_cli_versions() {
        assert_eq!(
            parse_cli_version(b"codex-cli 0.144.1\n"),
            Some("codex-cli 0.144.1".to_string())
        );
        assert_eq!(
            parse_cli_version(
                br#"{"command":"version","data":{"display":"velen 0.2.43\n"},"ok":true}"#
            ),
            Some("velen 0.2.43".to_string())
        );
        assert_eq!(parse_cli_version(b""), None);
    }

    #[test]
    fn validates_auto_hunt_session_ids_before_building_log_paths() {
        assert!(validate_auto_hunt_session_id("019f8a9c-2c95-7591-a096-fcbf930cf122").is_ok());
        assert!(validate_auto_hunt_session_id("../session").is_err());
        assert!(validate_auto_hunt_session_id("session.jsonl").is_err());
        assert!(validate_auto_hunt_session_id("").is_err());
    }

    #[test]
    fn targets_the_requested_run_when_claiming_auto_hunt_work() {
        let arguments = auto_hunt_claim_arguments("515b7a2c-8918-5a8f-a292-f0b95090281c");

        assert_eq!(
            arguments,
            vec![
                "queue",
                "claim",
                "--run",
                "515b7a2c-8918-5a8f-a292-f0b95090281c",
                "--workspace",
                "worktree",
                "--actor",
                "briar-auto-hunt-runtime",
                "--runtime-dispatch",
            ],
        );
    }

    #[test]
    fn persists_and_clears_session_without_a_keychain() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-session-test-{unique}"));
        let session_path = directory.join(SESSION_FILE_NAME);

        assert_eq!(
            read_session_token_from(&session_path).expect("missing session should be valid"),
            None
        );
        write_session_token_to(&session_path, "persistent-session-token".to_string())
            .expect("session should be saved");
        assert_eq!(
            read_session_token_from(&session_path).expect("session should be readable"),
            Some("persistent-session-token".to_string())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&session_path)
                    .expect("session metadata should be readable")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        clear_session_token_at(&session_path).expect("session should be cleared");
        assert_eq!(
            read_session_token_from(&session_path).expect("cleared session should be valid"),
            None
        );
        fs::remove_dir_all(directory).expect("test session directory should be removed");
    }

    #[test]
    fn writes_cli_connection_without_losing_non_auth_config() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-connect-test-{unique}"));
        let config_path = directory.join("config.json");
        fs::create_dir_all(&directory).expect("test config directory should be created");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://old.example.com",
  "userToken": "existing-user-token",
  "customSetting": true,
  "projects": [
    {
      "id": "existing-project",
      "repositoryPath": "/existing/repository",
      "agentToken": "briar_agent_existing",
      "autoHunt": {
        "velenOrg": "existing",
        "dataSource": "postgres://existing",
        "linear": {
          "enabled": true,
          "source": "linear://existing",
          "teamKey": "OLD",
          "customLinearSetting": true
        },
        "githubRepository": "example/existing",
        "customAutoHuntSetting": true
      },
      "label": "keep me"
    }
  ]
}"#,
        )
        .expect("test config should be written");

        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url: "https://briar.example.com".to_string(),
                project_id: "new-project".to_string(),
                agent_token: "briar_agent_new".to_string(),
                repository_path: "/new/repository".to_string(),
                repository_remote: Some("git@github.com:example/repository.git".to_string()),
                execution_host: None,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings::default(),
                auto_hunt: AutoHuntConfig {
                    velen_org: Some("example".to_string()),
                    data_source: None,
                    linear_enabled: false,
                    linear_source: None,
                    linear_team: None,
                    github_repository: None,
                    workflow: repository_workflow_bootstrap(),
                },
            },
        )
        .expect("connection should be saved");

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be valid json");
        assert_eq!(saved["apiUrl"], "https://briar.example.com");
        assert!(saved["userToken"].is_null());
        assert_eq!(saved["customSetting"], true);
        assert_eq!(saved["projects"].as_array().map(Vec::len), Some(2));
        assert_eq!(saved["projects"][0]["label"], "keep me");
        assert_eq!(saved["projects"][0]["autoHunt"]["linear"]["enabled"], true);
        assert_eq!(
            saved["projects"][0]["autoHunt"]["linear"]["customLinearSetting"],
            true
        );
        assert_eq!(saved["projects"][1]["apiUrl"], "https://briar.example.com");
        assert_eq!(
            saved["projects"][0]["autoHunt"]["customAutoHuntSetting"],
            true
        );
        assert_eq!(saved["projects"][1]["id"], "new-project");
        assert_eq!(saved["projects"][1]["repositoryPath"], "/new/repository");
        assert_eq!(saved["projects"][1]["llm"]["approvalPolicy"], "never");
        assert_eq!(saved["projects"][1]["autoHunt"]["linear"]["enabled"], false);
        assert_eq!(
            saved["projects"][1]["autoHunt"]["sandbox"]["fullAccess"],
            true
        );
        assert_eq!(
            saved["projects"][1]["autoHunt"]["workflow"]["stages"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert!(saved["projects"][1]["autoHunt"]["linearEnabled"].is_null());

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn removes_only_the_selected_cli_connection() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-disconnect-test-{unique}"));
        let config_path = directory.join("config.json");
        fs::create_dir_all(&directory).expect("test config directory should be created");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [
    {"id":"keep","repositoryPath":"/keep","agentToken":"briar_agent_keep"},
    {"id":"delete","repositoryPath":"/delete","agentToken":"briar_agent_delete"}
  ]
}"#,
        )
        .expect("test config should be written");

        remove_cli_connection(&config_path, "delete").expect("connection should be removed");
        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be valid json");
        assert_eq!(saved["projects"].as_array().map(Vec::len), Some(1));
        assert_eq!(saved["projects"][0]["id"], "keep");

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn stores_project_approval_policy_locally() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-llm-settings-test-{unique}"));
        let config_path = directory.join("config.json");
        fs::create_dir_all(&directory).expect("test config directory should be created");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://briar.example.com",
  "customSetting": true,
  "projects": [
    {"id":"project-1","repositoryPath":"/repo","agentToken":"briar_agent_test"}
  ]
}"#,
        )
        .expect("test config should be written");

        assert_eq!(
            project_llm_settings_from(&config_path, "project-1")
                .expect("legacy project settings should load")
                .approval_policy,
            agent::ApprovalPolicy::Never
        );
        assert_eq!(
            project_llm_settings_from(&config_path, "project-1")
                .expect("legacy project settings should load")
                .effort,
            None
        );
        assert!(
            app_provider_settings_from(&config_path)
                .expect("legacy provider settings should load")
                .codex
        );
        assert!(
            !app_runtime_settings_from(&config_path)
                .expect("legacy runtime settings should load")
                .prevent_sleep_while_running
        );
        update_app_provider_settings_at(
            &config_path,
            AppProviderSettings {
                codex: false,
                claude: true,
                grok: true,
            },
        )
        .expect("provider settings should save");
        update_app_runtime_settings_at(
            &config_path,
            StoredAppRuntimeSettings {
                prevent_sleep_while_running: true,
            },
        )
        .expect("runtime settings should save");
        update_project_llm_settings_at(
            &config_path,
            "project-1",
            agent::ProjectLlmSettings {
                provider: agent::AgentProviderKind::Claude,
                model: Some("sonnet".to_string()),
                effort: Some(agent::ModelEffort::High),
                approval_policy: agent::ApprovalPolicy::OnRequest,
            },
        )
        .expect("approval policy should save");

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be json");
        assert_eq!(saved["customSetting"], true);
        assert_eq!(saved["agentProviders"]["codex"], false);
        assert_eq!(saved["agentProviders"]["claude"], true);
        assert_eq!(saved["appSettings"]["preventSleepWhileRunning"], true);
        assert_eq!(saved["projects"][0]["llm"]["provider"], "claude");
        assert_eq!(saved["projects"][0]["llm"]["model"], "sonnet");
        assert_eq!(saved["projects"][0]["llm"]["effort"], "high");
        assert_eq!(saved["projects"][0]["llm"]["approvalPolicy"], "on-request");

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn updates_the_connected_project_workflow_locally() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-workflow-update-test-{unique}"));
        let config_path = directory.join("config.json");
        fs::create_dir_all(&directory).expect("test config directory should be created");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [{
    "id": "project-1",
    "repositoryPath": "/repo",
    "agentToken": "briar_agent_test",
    "autoHunt": {
      "velenOrg": "wordbricks",
      "workflow": {
        "version": 1,
        "stages": [{"id":"analyzing","label":"Analyze","required":true}],
        "completion": {"requiredStages":["analyzing"]},
        "release": {"enabled":false}
      }
    }
  }]
}"#,
        )
        .expect("test config should be written");

        let mut workflow = repository_workflow_bootstrap();
        workflow.stages = vec![WorkflowStageConfig {
            id: "repository_qa".to_string(),
            label: "Repository QA".to_string(),
            required: true,
            evidence: vec!["diff".to_string()],
            checks: vec!["cargo test".to_string()],
        }];
        workflow.completion.required_stages = vec!["repository_qa".to_string()];

        update_project_workflow_at(&config_path, "project-1", workflow)
            .expect("workflow should save");

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be json");
        assert_eq!(
            saved["projects"][0]["autoHunt"]["workflow"]["stages"][0]["checks"][0],
            "cargo test"
        );
        let runtime_workflow = project_auto_hunt_workflow_json(&config_path, "project-1")
            .expect("runtime workflow should load");
        assert!(runtime_workflow.contains("repository_qa"));
        assert!(runtime_workflow.contains("cargo test"));

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn updates_the_connected_project_linear_source_locally() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-linear-update-test-{unique}"));
        let config_path = directory.join("config.json");
        fs::create_dir_all(&directory).expect("test config directory should be created");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [{
    "id": "project-1",
    "repositoryPath": "/repo",
    "agentToken": "briar_agent_test",
    "autoHunt": {
      "velenOrg": "wordbricks",
      "linear": {"enabled": false},
      "customAutoHuntSetting": true
    }
  }]
}"#,
        )
        .expect("test config should be written");
        let inspect = |org: Option<String>| {
            assert_eq!(org.as_deref(), Some("wordbricks"));
            Ok(VelenInspection {
                authenticated: true,
                email: Some("jay@example.com".to_string()),
                current_org: Some("wordbricks".to_string()),
                organizations: Vec::new(),
                sources: vec![VelenSource {
                    source_key: "linear-wordbricks".to_string(),
                    source_ref: "linear://linear-wordbricks".to_string(),
                    provider: "linear".to_string(),
                    status: "active".to_string(),
                }],
            })
        };

        let saved_linear = update_project_linear_at(
            &config_path,
            "project-1",
            StoredLinearConfig {
                enabled: true,
                source: Some("linear-wordbricks".to_string()),
                team_key: Some(" BRIAR ".to_string()),
                extra: BTreeMap::new(),
            },
            &inspect,
        )
        .expect("Linear settings should save");
        assert_eq!(
            saved_linear.source.as_deref(),
            Some("linear://linear-wordbricks")
        );
        assert_eq!(saved_linear.team_key.as_deref(), Some("BRIAR"));

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be json");
        assert_eq!(
            saved["projects"][0]["autoHunt"]["linear"]["source"],
            "linear://linear-wordbricks"
        );
        assert_eq!(
            saved["projects"][0]["autoHunt"]["linear"]["teamKey"],
            "BRIAR"
        );
        assert_eq!(
            saved["projects"][0]["autoHunt"]["customAutoHuntSetting"],
            true
        );

        assert!(update_project_velen_org_at(&config_path, "project-1", None, &inspect,).is_err());
        update_project_linear_at(
            &config_path,
            "project-1",
            StoredLinearConfig {
                enabled: false,
                source: None,
                team_key: None,
                extra: BTreeMap::new(),
            },
            &inspect,
        )
        .expect("Linear should disconnect");
        assert_eq!(
            update_project_velen_org_at(&config_path, "project-1", None, &inspect)
                .expect("optional Velen should disconnect"),
            None
        );
        let disconnected: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("disconnected config should be readable"),
        )
        .expect("disconnected config should be json");
        assert!(disconnected["projects"][0]["autoHunt"]["velenOrg"].is_null());

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn resolves_the_workspace_git_root() {
        let root = git_repository_root(Path::new(env!("CARGO_MANIFEST_DIR")))
            .expect("workspace should be a git repository");
        assert_eq!(
            root,
            Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
        );
    }

    #[test]
    fn recognizes_pr_workflows_and_github_remotes() {
        let mut workflow = repository_workflow_bootstrap();
        assert!(!workflow_requires_github(&workflow));
        workflow.stages.push(WorkflowStageConfig {
            id: "pr_open".to_string(),
            label: "PR validation".to_string(),
            required: true,
            evidence: vec!["pull_request".to_string()],
            checks: Vec::new(),
        });
        assert!(workflow_requires_github(&workflow));
        assert_eq!(
            github_repository_from_remote("git@github.com:wordbricks/briar.git"),
            Some("wordbricks/briar".to_string())
        );
        assert_eq!(
            github_repository_from_remote("https://github.com/wordbricks/briar.git"),
            Some("wordbricks/briar".to_string())
        );
        assert_eq!(
            github_repository_from_remote("git@gitlab.com:wordbricks/briar.git"),
            None
        );
    }

    #[test]
    fn installs_cli_and_skill_assets() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("briar-assets-test-{unique}"));
        let resources = home.join("missing-resources");
        let stale_references = home.join(".codex/skills/briar-workflow/references");
        fs::create_dir_all(&stale_references).expect("stale references should be created");
        fs::write(stale_references.join("lifecycle.md"), "stale")
            .expect("stale reference should be written");

        install_auto_hunt_assets(&resources, &home).expect("assets should install");

        assert!(home.join(".local/bin/briar").is_file());
        assert!(home.join(".local/share/briar/briar.js").is_file());
        assert_eq!(
            read_trimmed_file(&home.join(".local/share/briar/VERSION")),
            Some(env!("CARGO_PKG_VERSION").to_string())
        );
        assert!(home.join(".codex/skills/briar-workflow/SKILL.md").is_file());
        assert!(home
            .join(".claude/skills/briar-workflow/SKILL.md")
            .is_file());
        assert!(home.join(".grok/skills/briar-workflow/SKILL.md").is_file());
        assert!(!stale_references.exists());
        assert_eq!(
            read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
            Some(env!("CARGO_PKG_VERSION").to_string())
        );
        assert!(
            !sync_auto_hunt_assets(&resources, &home).expect("current assets should be checked")
        );

        fs::write(home.join(".local/share/briar/VERSION"), "0.0.0\n")
            .expect("CLI version should be made stale");
        assert!(
            sync_auto_hunt_assets(&resources, &home).expect("stale assets should be synchronized")
        );
        assert_eq!(
            read_trimmed_file(&home.join(".local/share/briar/VERSION")),
            Some(env!("CARGO_PKG_VERSION").to_string())
        );

        fs::write(home.join(".codex/skills/briar-workflow/VERSION"), "0.0.0\n")
            .expect("skill version should be made stale");
        assert!(
            sync_auto_hunt_assets(&resources, &home).expect("stale skill should be synchronized")
        );
        assert_eq!(
            read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
            Some(env!("CARGO_PKG_VERSION").to_string())
        );
        fs::remove_dir_all(home).expect("test home should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn runs_node_based_velen_from_a_gui_style_path() {
        use std::os::unix::fs::PermissionsExt;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("briar-velen-path-test-{unique}"));
        let local_bin = home.join(".local/bin");
        fs::create_dir_all(&local_bin).expect("test bin should be created");
        let node = local_bin.join("node");
        let velen = home.join("velen");
        fs::write(
            &node,
            "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true,\"runtime\":\"node\"}'\n",
        )
        .expect("fake node should be written");
        fs::write(&velen, "#!/usr/bin/env node\n").expect("fake Velen should be written");
        fs::set_permissions(&node, fs::Permissions::from_mode(0o755))
            .expect("fake node should be executable");
        fs::set_permissions(&velen, fs::Permissions::from_mode(0o755))
            .expect("fake Velen should be executable");

        let result = run_velen_json_with(&velen, &home, &["auth", "whoami"])
            .expect("Velen should find node through the augmented GUI path");
        assert_eq!(
            result.get("runtime").and_then(|value| value.as_str()),
            Some("node")
        );

        fs::remove_dir_all(home).expect("test home should be removed");
    }

    #[test]
    fn reports_health_drift_and_repairs_bundled_assets() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("briar-health-test-{unique}"));
        let resources = home.join("missing-resources");
        let config_path = home.join(".config/briar/config.json");
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root should exist")
            .to_string_lossy()
            .into_owned();
        install_auto_hunt_assets(&resources, &home).expect("assets should install");
        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url: "https://briar.example.com".to_string(),
                project_id: "11111111-1111-4111-8111-111111111111".to_string(),
                agent_token: "briar_agent_test".to_string(),
                repository_path: repository,
                repository_remote: Some("https://github.com/wordbricks/briar.git".to_string()),
                execution_host: None,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings::default(),
                auto_hunt: AutoHuntConfig {
                    velen_org: Some("wordbricks".to_string()),
                    data_source: None,
                    linear_enabled: false,
                    linear_source: None,
                    linear_team: None,
                    github_repository: Some("wordbricks/briar".to_string()),
                    workflow: repository_workflow_bootstrap(),
                },
            },
        )
        .expect("connection should be saved");
        let inspect = |_: Option<String>| {
            Ok(VelenInspection {
                authenticated: true,
                email: Some("jay@example.com".to_string()),
                current_org: Some("wordbricks".to_string()),
                organizations: Vec::new(),
                sources: Vec::new(),
            })
        };

        let healthy = auto_hunt_health_sync_with(
            &config_path,
            &resources,
            &home,
            "11111111-1111-4111-8111-111111111111",
            &inspect,
        )
        .expect("health should be readable");
        assert!(healthy.healthy);
        assert!(healthy.repository_healthy);
        assert!(healthy.cli_current);
        assert!(healthy.skill_current);
        assert!(healthy.velen_healthy);

        fs::remove_file(home.join(".local/share/briar/VERSION"))
            .expect("version marker should be removable");
        let drifted = auto_hunt_health_sync_with(
            &config_path,
            &resources,
            &home,
            "11111111-1111-4111-8111-111111111111",
            &inspect,
        )
        .expect("drifted health should be readable");
        assert!(!drifted.healthy);
        assert!(!drifted.cli_current);

        install_auto_hunt_assets(&resources, &home).expect("repair should reinstall assets");
        let repaired = auto_hunt_health_sync_with(
            &config_path,
            &resources,
            &home,
            "11111111-1111-4111-8111-111111111111",
            &inspect,
        )
        .expect("repaired health should be readable");
        assert!(repaired.healthy);
        assert!(repaired.cli_current);

        let mut config = read_cli_config(&config_path).expect("config should be readable");
        config.projects[0]
            .auto_hunt
            .as_mut()
            .expect("Auto Hunt settings should exist")
            .velen_org = None;
        write_cli_config(&config_path, &config).expect("optional Velen config should save");
        let no_inspect = |_: Option<String>| -> Result<VelenInspection, String> {
            panic!("unconfigured Velen should not be inspected")
        };
        let without_velen = auto_hunt_health_sync_with(
            &config_path,
            &resources,
            &home,
            "11111111-1111-4111-8111-111111111111",
            &no_inspect,
        )
        .expect("health without Velen should be readable");
        assert!(without_velen.healthy);
        assert!(without_velen.velen_healthy);
        assert!(without_velen.velen_org.is_none());

        fs::remove_dir_all(home).expect("test home should be removed");
    }

    fn host_test_config_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-host-test-{name}-{unique}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory.join("config.json")
    }

    #[test]
    fn a_config_without_host_fields_stays_local() {
        let config_path = host_test_config_path("legacy");
        fs::write(
            &config_path,
            r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [
    { "id": "project-1", "repositoryPath": "/repo", "agentToken": "briar_agent_x" }
  ]
}"#,
        )
        .expect("legacy config should be written");

        let config = read_cli_config(&config_path).expect("legacy config should load");
        assert!(config.ssh_hosts.is_empty());
        assert_eq!(
            project_execution_host(&config, "project-1").expect("host should resolve"),
            host::ExecutionHostId::Local
        );
        assert_eq!(
            execution_host_summaries(&config)
                .iter()
                .map(|host| host.id.clone())
                .collect::<Vec<_>>(),
            vec!["local".to_string()]
        );
    }

    #[test]
    fn saving_a_host_keeps_the_project_binding_readable() {
        let config_path = host_test_config_path("bind");
        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url: "https://briar.example.com".to_string(),
                project_id: "project-1".to_string(),
                agent_token: "briar_agent_x".to_string(),
                repository_path: "/repo".to_string(),
                repository_remote: None,
                execution_host: None,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings::default(),
                auto_hunt: AutoHuntConfig {
                    velen_org: Some("example".to_string()),
                    data_source: None,
                    linear_enabled: false,
                    linear_source: None,
                    linear_team: None,
                    github_repository: None,
                    workflow: repository_workflow_bootstrap(),
                },
            },
        )
        .expect("connection should be written");

        let saved = add_ssh_host_to(
            &config_path,
            "build box".to_string(),
            host::SshResolvedTarget {
                alias: "build-box".to_string(),
                hostname: "10.0.0.5".to_string(),
                username: Some("dev".to_string()),
                port: Some(2222),
            },
        )
        .expect("host should be saved");

        let mut config = read_cli_config(&config_path).expect("config should load");
        assert_eq!(config.ssh_hosts.len(), 1);
        assert_eq!(config.ssh_hosts[0].label, "build box");
        assert_eq!(config.ssh_hosts[0].port, Some(2222));

        // A local project stays local until it is explicitly rebound.
        assert!(project_execution_host(&config, "project-1")
            .expect("host should resolve")
            .is_local());

        config.projects[0].execution_host_id = Some(host::ssh_execution_host_id(&saved.id));
        write_cli_config(&config_path, &config).expect("config should be written");
        let rebound = read_cli_config(&config_path).expect("config should reload");
        assert_eq!(
            project_execution_host(&rebound, "project-1")
                .expect("host should resolve")
                .ssh_host_id(),
            Some(saved.id.as_str())
        );
        assert_eq!(
            project_repository_path(&rebound, "project-1").expect("path should resolve"),
            PathBuf::from("/repo")
        );
    }

    #[test]
    fn re_adding_the_same_alias_replaces_the_stale_record() {
        let config_path = host_test_config_path("realias");
        let target = |hostname: &str| host::SshResolvedTarget {
            alias: "build-box".to_string(),
            hostname: hostname.to_string(),
            username: None,
            port: None,
        };
        add_ssh_host_to(&config_path, "first".to_string(), target("10.0.0.5"))
            .expect("first host should be saved");
        add_ssh_host_to(&config_path, "second".to_string(), target("10.0.0.9"))
            .expect("second host should be saved");

        let config = read_cli_config(&config_path).expect("config should load");
        assert_eq!(config.ssh_hosts.len(), 1);
        assert_eq!(config.ssh_hosts[0].label, "second");
        assert_eq!(config.ssh_hosts[0].hostname.as_deref(), Some("10.0.0.9"));
    }

    #[test]
    fn syncs_literal_ssh_config_hosts_with_stable_ids() {
        let config_path = host_test_config_path("discover");
        add_ssh_host_to(
            &config_path,
            "Manual build box".to_string(),
            host::SshResolvedTarget {
                alias: "build-box".to_string(),
                hostname: "10.0.0.5".to_string(),
                username: Some("builder".to_string()),
                port: None,
            },
        )
        .expect("manual host should be saved");

        let first = sync_discovered_ssh_hosts_with(
            &config_path,
            vec!["kiwi".to_string(), "build-box".to_string()],
            |alias| {
                Some(host::SshResolvedTarget {
                    alias: alias.to_string(),
                    hostname: format!("{alias}.example.com"),
                    username: Some("dev".to_string()),
                    port: Some(22),
                })
            },
        )
        .expect("discovered hosts should sync");
        assert_eq!(first.ssh_hosts.len(), 2);
        let kiwi = first
            .ssh_hosts
            .iter()
            .find(|saved| saved.alias == "kiwi")
            .expect("kiwi should be discovered");
        assert!(kiwi.id.starts_with(DISCOVERED_SSH_HOST_ID_PREFIX));
        assert_eq!(kiwi.label, "kiwi");
        let kiwi_id = kiwi.id.clone();
        let manual = first
            .ssh_hosts
            .iter()
            .find(|saved| saved.alias == "build-box")
            .expect("manual host should remain");
        assert_eq!(manual.label, "Manual build box");
        assert_eq!(manual.hostname.as_deref(), Some("build-box.example.com"));

        let second =
            sync_discovered_ssh_hosts_with(&config_path, vec!["kiwi".to_string()], |alias| {
                Some(host::SshResolvedTarget {
                    alias: alias.to_string(),
                    hostname: "10.0.0.9".to_string(),
                    username: Some("dev".to_string()),
                    port: Some(2222),
                })
            })
            .expect("repeated discovery should update in place");
        let kiwi = second
            .ssh_hosts
            .iter()
            .find(|saved| saved.alias == "kiwi")
            .expect("kiwi should remain");
        assert_eq!(kiwi.id, kiwi_id);
        assert_eq!(kiwi.hostname.as_deref(), Some("10.0.0.9"));
        assert_eq!(kiwi.port, Some(2222));
        assert!(second
            .ssh_hosts
            .iter()
            .any(|saved| saved.alias == "build-box"));

        let final_config = sync_discovered_ssh_hosts_with(&config_path, Vec::new(), |_| None)
            .expect("stale discovered hosts should be removed");
        assert_eq!(final_config.ssh_hosts.len(), 1);
        assert_eq!(final_config.ssh_hosts[0].alias, "build-box");
    }

    #[test]
    fn removing_a_host_unbinds_the_projects_pinned_to_it() {
        let config_path = host_test_config_path("unbind");
        let saved = add_ssh_host_to(
            &config_path,
            "build box".to_string(),
            host::SshResolvedTarget {
                alias: "build-box".to_string(),
                hostname: "10.0.0.5".to_string(),
                username: None,
                port: None,
            },
        )
        .expect("host should be saved");
        let mut config = read_cli_config(&config_path).expect("config should load");
        config.projects.push(CliProject {
            id: "project-1".to_string(),
            repository_path: "/repo".to_string(),
            api_url: None,
            execution_host_id: Some(host::ssh_execution_host_id(&saved.id)),
            repository_remote: None,
            agent_token: "briar_agent_x".to_string(),
            llm: None,
            auto_hunt: None,
            extra: BTreeMap::new(),
        });
        write_cli_config(&config_path, &config).expect("config should be written");

        let unbound =
            remove_ssh_host_from(&config_path, &saved.id).expect("host should be removed");
        assert_eq!(unbound, vec!["project-1".to_string()]);

        let after = read_cli_config(&config_path).expect("config should reload");
        assert!(after.ssh_hosts.is_empty());
        assert!(project_execution_host(&after, "project-1")
            .expect("host should resolve")
            .is_local());
        assert!(remove_ssh_host_from(&config_path, &saved.id).is_err());
    }

    /// Write a project whose auto-hunt block carries CLI-owned worktree settings.
    fn config_with_worktree_settings(config_path: &Path, worktrees: StoredWorktreeConfig) {
        config_with_cli_owned_settings(config_path, Some(worktrees), None)
    }

    fn config_with_cli_owned_settings(
        config_path: &Path,
        worktrees: Option<StoredWorktreeConfig>,
        sandbox: Option<StoredSandboxConfig>,
    ) {
        let config = CliConfig {
            api_url: "http://127.0.0.1:8787".to_string(),
            user_token: None,
            agent_providers: AppProviderSettings::default(),
            app_settings: StoredAppRuntimeSettings::default(),
            projects: vec![CliProject {
                id: "project-1".to_string(),
                repository_path: "/repo".to_string(),
                api_url: Some("http://127.0.0.1:8787".to_string()),
                execution_host_id: None,
                repository_remote: None,
                agent_token: "briar_agent_x".to_string(),
                llm: None,
                auto_hunt: Some(StoredAutoHuntConfig {
                    velen_org: Some("wordbricks".to_string()),
                    data_source: None,
                    linear: None,
                    github_repository: None,
                    workflow: None,
                    worktrees,
                    sandbox,
                    extra: BTreeMap::new(),
                }),
                extra: BTreeMap::new(),
            }],
            ssh_hosts: Vec::new(),
            extra: BTreeMap::new(),
        };
        write_cli_config(config_path, &config).expect("config should be written");
    }

    #[test]
    fn resolves_the_configured_auto_hunt_worktree_root_per_project() {
        let config_path = host_test_config_path("worktree-root");
        config_with_worktree_settings(
            &config_path,
            StoredWorktreeConfig {
                enabled: None,
                root: Some("/custom/worktrees".to_string()),
                branch_prefix: None,
                extra: BTreeMap::new(),
            },
        );
        assert_eq!(
            project_worktree_root(&config_path, "project-1", Path::new("/Users/dev"))
                .expect("root should resolve"),
            Some(PathBuf::from("/custom/worktrees/project-1"))
        );
    }

    #[test]
    fn falls_back_to_the_default_worktree_root_and_honors_opt_out() {
        let config_path = host_test_config_path("worktree-default");
        config_with_worktree_settings(
            &config_path,
            StoredWorktreeConfig {
                enabled: None,
                root: None,
                branch_prefix: None,
                extra: BTreeMap::new(),
            },
        );
        assert_eq!(
            project_worktree_root(&config_path, "project-1", Path::new("/Users/dev"))
                .expect("root should resolve"),
            Some(PathBuf::from("/Users/dev/briar/workspaces/project-1"))
        );

        let disabled_path = host_test_config_path("worktree-disabled");
        config_with_worktree_settings(
            &disabled_path,
            StoredWorktreeConfig {
                enabled: Some(false),
                root: None,
                branch_prefix: None,
                extra: BTreeMap::new(),
            },
        );
        // Opted out: no extra writable root is granted to the agent.
        assert_eq!(
            project_worktree_root(&disabled_path, "project-1", Path::new("/Users/dev"))
                .expect("root should resolve"),
            None
        );
    }

    #[test]
    fn saving_project_settings_keeps_cli_owned_worktree_settings() {
        let config_path = host_test_config_path("worktree-preserve");
        config_with_worktree_settings(
            &config_path,
            StoredWorktreeConfig {
                enabled: None,
                root: Some("/custom/worktrees".to_string()),
                branch_prefix: Some("hunt".to_string()),
                extra: BTreeMap::new(),
            },
        );

        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url: "http://127.0.0.1:8787".to_string(),
                project_id: "project-1".to_string(),
                agent_token: "briar_agent_x".to_string(),
                repository_path: "/repo".to_string(),
                repository_remote: None,
                execution_host: None,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings::default(),
                auto_hunt: AutoHuntConfig {
                    velen_org: Some("wordbricks".to_string()),
                    data_source: None,
                    linear_enabled: false,
                    linear_source: None,
                    linear_team: None,
                    github_repository: None,
                    workflow: repository_workflow_bootstrap(),
                },
            },
        )
        .expect("settings should save");

        let worktrees = read_cli_config(&config_path)
            .expect("config should reload")
            .projects
            .into_iter()
            .find(|project| project.id == "project-1")
            .and_then(|project| project.auto_hunt)
            .and_then(|auto_hunt| auto_hunt.worktrees)
            .expect("worktree settings should survive an app-side save");
        assert_eq!(worktrees.root.as_deref(), Some("/custom/worktrees"));
        assert_eq!(worktrees.branch_prefix.as_deref(), Some("hunt"));
    }

    #[test]
    fn project_filesystem_access_controls_saved_agent_sandbox() {
        let config_path = host_test_config_path("sandbox-default");
        config_with_cli_owned_settings(&config_path, None, None);
        let full_access = project_auto_hunt_full_access(&config_path, "project-1")
            .expect("sandbox setting should resolve");
        assert!(full_access);
        assert_eq!(
            project_agent_sandbox_mode(full_access),
            agent::SandboxMode::DangerFullAccess
        );

        let sandboxed = host_test_config_path("sandbox-workspace-only");
        config_with_cli_owned_settings(
            &sandboxed,
            None,
            Some(StoredSandboxConfig {
                full_access: Some(false),
                extra: BTreeMap::new(),
            }),
        );
        let full_access = project_auto_hunt_full_access(&sandboxed, "project-1")
            .expect("sandbox setting should resolve");
        assert!(!full_access);
        assert_eq!(
            project_agent_sandbox_mode(full_access),
            agent::SandboxMode::WorkspaceWrite
        );
    }

    #[test]
    fn app_settings_can_change_and_preserve_the_workspace_sandbox() {
        let config_path = host_test_config_path("sandbox-preserve");
        config_with_cli_owned_settings(
            &config_path,
            None,
            Some(StoredSandboxConfig {
                full_access: Some(false),
                extra: BTreeMap::new(),
            }),
        );

        assert!(
            !project_sandbox_settings_from(&config_path, "project-1")
                .expect("sandbox setting should load")
                .full_access
        );
        update_project_sandbox_settings_at(
            &config_path,
            "project-1",
            ProjectSandboxSettings { full_access: true },
        )
        .expect("sandbox setting should update");
        assert!(project_auto_hunt_full_access(&config_path, "project-1")
            .expect("updated sandbox setting should resolve"));
        update_project_sandbox_settings_at(
            &config_path,
            "project-1",
            ProjectSandboxSettings { full_access: false },
        )
        .expect("sandbox setting should update");

        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url: "http://127.0.0.1:8787".to_string(),
                project_id: "project-1".to_string(),
                agent_token: "briar_agent_x".to_string(),
                repository_path: "/repo".to_string(),
                repository_remote: None,
                execution_host: None,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings::default(),
                auto_hunt: AutoHuntConfig {
                    velen_org: Some("wordbricks".to_string()),
                    data_source: None,
                    linear_enabled: false,
                    linear_source: None,
                    linear_team: None,
                    github_repository: None,
                    workflow: repository_workflow_bootstrap(),
                },
            },
        )
        .expect("settings should save");

        assert!(!project_auto_hunt_full_access(&config_path, "project-1")
            .expect("sandbox setting should survive an app-side save"));
    }

    #[test]
    fn rejects_unusable_host_labels_and_aliases() {
        let config_path = host_test_config_path("labels");
        let target = host::SshResolvedTarget {
            alias: "build-box".to_string(),
            hostname: "10.0.0.5".to_string(),
            username: None,
            port: None,
        };
        assert!(add_ssh_host_to(&config_path, "   ".to_string(), target.clone()).is_err());
        assert!(add_ssh_host_to(&config_path, "x".repeat(101), target).is_err());
        assert!(resolve_ssh_alias("  ").is_err());
        // A leading dash would otherwise be read by ssh as an option.
        assert!(resolve_ssh_alias("-oProxyCommand=touch /tmp/briar-pwned").is_err());
    }

    #[test]
    fn resolves_a_workspace_root_through_a_runner() {
        let runner = host::LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            std::env::temp_dir(),
        );
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root should exist");
        let resolved =
            resolve_workspace_with(&runner, repository).expect("git root should resolve");
        assert_eq!(
            resolved,
            fs::canonicalize(repository).expect("repository should canonicalize")
        );

        let not_a_repository = std::env::temp_dir();
        assert!(resolve_workspace_with(&runner, &not_a_repository).is_err());
    }
}
