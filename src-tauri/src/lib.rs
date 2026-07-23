mod codex_app_server;

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[cfg(target_os = "macos")]
use tauri::{webview::Color, AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const SESSION_FILE_NAME: &str = "session.json";
const AUTO_HUNT_EVENT_DIRECTORY: &str = "auto-hunt-sessions";
const AUTO_HUNT_APP_SERVER_EVENT: &str = "auto-hunt-app-server-event";

#[derive(Deserialize, Serialize)]
struct StoredSession {
    token: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliProject {
    id: String,
    repository_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    repository_remote: Option<String>,
    agent_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    llm: Option<codex_app_server::ProjectLlmSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_hunt: Option<StoredAutoHuntConfig>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoHuntConfig {
    velen_org: String,
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
    #[serde(default = "default_workflow")]
    workflow: WorkflowConfig,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowConfig {
    version: u8,
    #[serde(default = "custom_workflow_preset")]
    preset: String,
    stages: Vec<WorkflowStageConfig>,
    #[serde(default)]
    completion: WorkflowCompletionConfig,
    #[serde(default)]
    release: WorkflowReleaseConfig,
}

fn custom_workflow_preset() -> String {
    "custom".to_string()
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

fn infer_repository_checks(repository: &Path, workflow: &mut WorkflowConfig) {
    let Some(stage) = workflow
        .stages
        .iter_mut()
        .find(|stage| stage.id == "local_qa")
    else {
        return;
    };
    let package_json = repository.join("package.json");
    if package_json.exists() {
        let Ok(contents) = fs::read_to_string(package_json) else {
            return;
        };
        let Ok(package) = serde_json::from_str::<serde_json::Value>(&contents) else {
            return;
        };
        let Some(scripts) = package
            .get("scripts")
            .and_then(serde_json::Value::as_object)
        else {
            return;
        };
        let runner =
            if repository.join("bun.lock").exists() || repository.join("bun.lockb").exists() {
                "bun run"
            } else if repository.join("pnpm-lock.yaml").exists() {
                "pnpm"
            } else if repository.join("yarn.lock").exists() {
                "yarn"
            } else {
                "npm run"
            };
        stage.checks = ["test", "build"]
            .into_iter()
            .filter(|name| scripts.contains_key(*name))
            .map(|name| format!("{runner} {name}"))
            .collect();
    } else if repository.join("Cargo.toml").exists() {
        stage.checks = vec!["cargo test".to_string(), "cargo build".to_string()];
    }
}

fn default_workflow() -> WorkflowConfig {
    WorkflowConfig {
        version: 1,
        preset: "local".to_string(),
        stages: vec![
            WorkflowStageConfig {
                id: "analyzing".to_string(),
                label: "분석".to_string(),
                required: true,
                evidence: vec!["velen".to_string(), "repository".to_string()],
                checks: Vec::new(),
            },
            WorkflowStageConfig {
                id: "implementing".to_string(),
                label: "구현".to_string(),
                required: true,
                evidence: vec!["diff".to_string()],
                checks: Vec::new(),
            },
            WorkflowStageConfig {
                id: "local_qa".to_string(),
                label: "로컬 검증".to_string(),
                required: true,
                evidence: Vec::new(),
                checks: vec!["bun run test".to_string(), "bun run build".to_string()],
            },
        ],
        completion: WorkflowCompletionConfig {
            required_stages: vec![
                "analyzing".to_string(),
                "implementing".to_string(),
                "local_qa".to_string(),
            ],
        },
        release: WorkflowReleaseConfig { enabled: false },
    }
}

#[derive(Deserialize, Serialize)]
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
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
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
            velen_org: Some(config.velen_org),
            data_source: config.data_source,
            linear: Some(StoredLinearConfig {
                enabled: config.linear_enabled,
                source: config.linear_source,
                team_key: config.linear_team,
                extra: BTreeMap::new(),
            }),
            github_repository: config.github_repository,
            workflow: Some(config.workflow),
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
    projects: Vec<CliProject>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
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

fn velen_binary() -> Result<PathBuf, String> {
    if let Ok(path) = which::which("velen") {
        return Ok(path);
    }
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾을 수 없습니다.".to_string())?;
    for relative in [".local/bin/velen", ".bun/bin/velen"] {
        let candidate = home.join(relative);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Velen CLI가 필요합니다. Velen CLI를 설치한 뒤 Briar를 다시 여세요.".to_string())
}

fn cli_execution_path(home: &Path) -> Result<OsString, String> {
    let mut paths = vec![
        home.join(".local/bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
    }
    env::join_paths(paths).map_err(|error| format!("CLI 실행 경로를 구성하지 못했습니다: {error}"))
}

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

fn run_velen_json(args: &[&str]) -> Result<serde_json::Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾을 수 없습니다.".to_string())?;
    run_velen_json_with(&velen_binary()?, &home, args)
}

fn inspect_velen_sync(org: Option<String>) -> Result<VelenInspection, String> {
    let whoami = run_velen_json(&["auth", "whoami"])?;
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
    let organizations = run_velen_json(&["org", "list"])?
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
        run_velen_json(&["--org", selected_org, "source", "list"])?
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
async fn inspect_velen(org: Option<String>) -> Result<VelenInspection, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_velen_sync(org))
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

fn write_cli_connection(
    config_path: &Path,
    api_url: String,
    project_id: String,
    agent_token: String,
    repository_path: String,
    repository_remote: Option<String>,
    auto_hunt: AutoHuntConfig,
) -> Result<(), String> {
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
            projects: Vec::new(),
            extra: BTreeMap::new(),
        }
    };
    config.api_url = api_url;
    config.projects.retain(|project| project.id != project_id);
    config.projects.push(CliProject {
        id: project_id,
        repository_path,
        repository_remote,
        agent_token,
        llm: Some(codex_app_server::ProjectLlmSettings::default()),
        auto_hunt: Some(auto_hunt.into()),
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

fn connected_project_workspace(config_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
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

fn project_llm_settings_from(
    config_path: &Path,
    project_id: &str,
) -> Result<codex_app_server::ProjectLlmSettings, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.llm.unwrap_or_default())
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())
}

fn approval_request_message(method: &str, params: &serde_json::Value) -> String {
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
    format!("Codex가 다음 작업의 승인을 요청했습니다.\n\n{action}{cwd}")
}

fn update_project_llm_settings_at(
    config_path: &Path,
    project_id: &str,
    settings: codex_app_server::ProjectLlmSettings,
) -> Result<codex_app_server::ProjectLlmSettings, String> {
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    let mut config = serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    project.llm = Some(settings);
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
        "skills/briar-auto-hunt",
        "skills/briar-auto-hunt",
    );
    if !skill_source.is_dir() {
        return Err("Briar Auto Hunt 스킬 번들을 찾지 못했습니다.".to_string());
    }
    let skill_destination = home.join(".codex").join("skills").join("briar-auto-hunt");
    copy_directory(&skill_source, &skill_destination)?;

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
        let skill_launcher = skill_destination.join("scripts").join("briar");
        if skill_launcher.exists() {
            fs::set_permissions(skill_launcher, fs::Permissions::from_mode(0o755))
                .map_err(|error| error.to_string())?;
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
    let mut issues = Vec::new();

    let repository_path = Path::new(&project.repository_path);
    let repository_healthy = git_repository_root(repository_path)
        .map(|root| {
            fs::canonicalize(repository_path)
                .map(|configured| configured == root)
                .unwrap_or(false)
        })
        .unwrap_or(false);
    if !repository_healthy {
        issues.push("연결된 Git 저장소 경로를 사용할 수 없습니다.".to_string());
    }

    let expected_version = env!("CARGO_PKG_VERSION").to_string();
    let cli_path = home.join(".local").join("bin").join("briar");
    let cli_installed = cli_path.is_file();
    let cli_version = read_trimmed_file(
        &home
            .join(".local")
            .join("share")
            .join("briar")
            .join("VERSION"),
    );
    let cli_current = cli_version.as_deref() == Some(expected_version.as_str());
    if !cli_installed {
        issues.push("Briar CLI가 설치되지 않았습니다.".to_string());
    } else if !cli_current {
        issues.push("Briar CLI 버전이 앱 번들과 다릅니다.".to_string());
    }

    let skill_source = bundled_path(
        resource_directory,
        "skills/briar-auto-hunt",
        "skills/briar-auto-hunt",
    );
    let skill_expected_version = read_trimmed_file(&skill_source.join("VERSION"))
        .unwrap_or_else(|| expected_version.clone());
    let skill_path = home.join(".codex").join("skills").join("briar-auto-hunt");
    let skill_installed = skill_path.join("SKILL.md").is_file();
    let skill_version = read_trimmed_file(&skill_path.join("VERSION"));
    let skill_current = skill_version.as_deref() == Some(skill_expected_version.as_str());
    if !skill_installed {
        issues.push("Briar Auto Hunt 스킬이 설치되지 않았습니다.".to_string());
    } else if !skill_current {
        issues.push("Auto Hunt 스킬 버전이 앱 번들과 다릅니다.".to_string());
    }

    let velen_org = project
        .auto_hunt
        .as_ref()
        .and_then(|auto_hunt| auto_hunt.velen_org.clone());
    let (velen_authenticated, velen_email, velen_healthy) = if let Some(org) = velen_org.as_deref()
    {
        match inspect_velen(Some(org.to_string())) {
            Ok(inspection) => (inspection.authenticated, inspection.email, true),
            Err(error) => {
                issues.push(format!("Velen 연결 확인 실패: {error}"));
                (false, None, false)
            }
        }
    } else {
        issues.push("Auto Hunt에 Velen 조직이 설정되지 않았습니다.".to_string());
        (false, None, false)
    };

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
    request: codex_app_server::ProjectLlmRequest,
) -> Result<codex_app_server::ProjectLlmResponse, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = connected_project_workspace(&config_path, &project_id)?;
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let binary = codex_app_server::codex_binary(&home)?;
        let execution_path = cli_execution_path(&home)?;
        let approve = |method: &str, params: &serde_json::Value| {
            approval_app
                .dialog()
                .message(approval_request_message(method, params))
                .title("Codex 작업 승인")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "승인".to_string(),
                    "거절".to_string(),
                ))
                .blocking_show()
        };
        codex_app_server::chat(
            &binary,
            &execution_path,
            &project_id,
            &workspace,
            codex_app_server::ChatExecution {
                approval_policy: settings.approval_policy,
                sandbox_mode: codex_app_server::SandboxMode::ReadOnly,
                network_access: false,
                event_sink: None,
            },
            request,
            &approve,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_project_auto_hunt(
    app: tauri::AppHandle,
    project_id: String,
    request: codex_app_server::ProjectAutoHuntRequest,
) -> Result<codex_app_server::ProjectAutoHuntResponse, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let event_sink = create_auto_hunt_event_sink(&app, &request.session_id)?;
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = connected_project_workspace(&config_path, &project_id)?;
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let binary = codex_app_server::codex_binary(&home)?;
        let execution_path = cli_execution_path(&home)?;
        let cli_environment =
            codex_app_server::AutoHuntCliEnvironment::prepare(&home, &execution_path, &workspace)?;
        let approve = |method: &str, params: &serde_json::Value| {
            approval_app
                .dialog()
                .message(approval_request_message(method, params))
                .title("Codex 자동사냥 승인")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "승인".to_string(),
                    "거절".to_string(),
                ))
                .blocking_show()
        };
        codex_app_server::start_auto_hunt(
            &binary,
            cli_environment.execution_path(),
            &project_id,
            &workspace,
            codex_app_server::AutoHuntExecution {
                approval_policy: settings.approval_policy,
                event_sink,
            },
            request,
            &approve,
        )
    })
    .await
    .map_err(|error| error.to_string())?
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
) -> Result<codex_app_server::AppServerEventSink, String> {
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

    Ok(Arc::new(move |direction, message| {
        let record = codex_app_server::AppServerEventRecord::new(
            session_id.clone(),
            sequence.fetch_add(1, Ordering::Relaxed) + 1,
            direction,
            message.clone(),
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
) -> Result<Vec<codex_app_server::AppServerEventRecord>, String> {
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
async fn load_project_llm_settings(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<codex_app_server::ProjectLlmSettings, String> {
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
    settings: codex_app_server::ProjectLlmSettings,
) -> Result<codex_app_server::ProjectLlmSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_project_llm_settings_at(&config_path, &project_id, settings)
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
    mut auto_hunt: AutoHuntConfig,
) -> Result<ConnectedLocalProject, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = git_repository_root(Path::new(&repository_path))?;
        let remote = repository_remote(&root);
        infer_repository_checks(&root, &mut auto_hunt.workflow);
        let workflow = auto_hunt.workflow.clone();
        let root_string = root
            .into_os_string()
            .into_string()
            .map_err(|_| "Git 저장소 경로를 표시할 수 없습니다.".to_string())?;
        let inspection = inspect_velen_sync(Some(auto_hunt.velen_org.clone()))?;
        if auto_hunt.linear_enabled {
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
        install_auto_hunt_assets(&resource_directory, &home)?;
        write_cli_connection(
            &config_path,
            api_url,
            project_id,
            agent_token,
            root_string.clone(),
            remote,
            auto_hunt,
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

#[cfg(target_os = "macos")]
fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Briar main window is unavailable".to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(main) = app.get_webview_window("main") {
                main.hide()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prepare_launch_intro,
            show_main_window,
            reveal_main_window,
            finish_launch_intro,
            read_session_token,
            write_session_token,
            clear_session_token,
            validate_repository_path,
            connected_project_ids,
            project_llm_chat,
            start_project_auto_hunt,
            load_auto_hunt_app_server_events,
            load_project_llm_settings,
            update_project_llm_settings,
            update_local_project_workflow,
            disconnect_local_project,
            connect_local_project,
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
    fn validates_auto_hunt_session_ids_before_building_log_paths() {
        assert!(validate_auto_hunt_session_id("019f8a9c-2c95-7591-a096-fcbf930cf122").is_ok());
        assert!(validate_auto_hunt_session_id("../session").is_err());
        assert!(validate_auto_hunt_session_id("session.jsonl").is_err());
        assert!(validate_auto_hunt_session_id("").is_err());
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
    fn writes_cli_connection_without_losing_existing_config() {
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
            "https://briar.example.com".to_string(),
            "new-project".to_string(),
            "briar_agent_new".to_string(),
            "/new/repository".to_string(),
            Some("git@github.com:example/repository.git".to_string()),
            AutoHuntConfig {
                velen_org: "example".to_string(),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: None,
                workflow: default_workflow(),
            },
        )
        .expect("connection should be saved");

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be valid json");
        assert_eq!(saved["apiUrl"], "https://briar.example.com");
        assert_eq!(saved["userToken"], "existing-user-token");
        assert_eq!(saved["customSetting"], true);
        assert_eq!(saved["projects"].as_array().map(Vec::len), Some(2));
        assert_eq!(saved["projects"][0]["label"], "keep me");
        assert_eq!(saved["projects"][0]["autoHunt"]["linear"]["enabled"], true);
        assert_eq!(
            saved["projects"][0]["autoHunt"]["linear"]["customLinearSetting"],
            true
        );
        assert_eq!(
            saved["projects"][0]["autoHunt"]["customAutoHuntSetting"],
            true
        );
        assert_eq!(saved["projects"][1]["id"], "new-project");
        assert_eq!(saved["projects"][1]["repositoryPath"], "/new/repository");
        assert_eq!(saved["projects"][1]["llm"]["approvalPolicy"], "never");
        assert_eq!(saved["projects"][1]["autoHunt"]["linear"]["enabled"], false);
        assert_eq!(
            saved["projects"][1]["autoHunt"]["workflow"]["preset"],
            "local"
        );
        assert_eq!(
            saved["projects"][1]["autoHunt"]["workflow"]["stages"]
                .as_array()
                .map(Vec::len),
            Some(3)
        );
        assert!(saved["projects"][1]["autoHunt"]["linearEnabled"].is_null());

        fs::remove_dir_all(directory).expect("test config directory should be removed");
    }

    #[test]
    fn infers_local_validation_commands_from_the_repository() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("briar-workflow-test-{unique}"));
        fs::create_dir_all(&directory).expect("test repository should be created");
        fs::write(directory.join("bun.lock"), "").expect("bun lock should be written");
        fs::write(
            directory.join("package.json"),
            r#"{"scripts":{"test":"vitest run","build":"vite build","lint":"eslint ."}}"#,
        )
        .expect("package manifest should be written");
        let mut workflow = default_workflow();

        infer_repository_checks(&directory, &mut workflow);

        let validation = workflow
            .stages
            .iter()
            .find(|stage| stage.id == "local_qa")
            .expect("local validation stage should exist");
        assert_eq!(validation.checks, vec!["bun run test", "bun run build"]);
        fs::remove_dir_all(directory).expect("test repository should be removed");
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
            codex_app_server::ApprovalPolicy::Never
        );
        update_project_llm_settings_at(
            &config_path,
            "project-1",
            codex_app_server::ProjectLlmSettings {
                approval_policy: codex_app_server::ApprovalPolicy::OnRequest,
            },
        )
        .expect("approval policy should save");

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&config_path).expect("saved config should be readable"),
        )
        .expect("saved config should be json");
        assert_eq!(saved["customSetting"], true);
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
        "preset": "local",
        "stages": [{"id":"analyzing","label":"Analyze","required":true}],
        "completion": {"requiredStages":["analyzing"]},
        "release": {"enabled":false}
      }
    }
  }]
}"#,
        )
        .expect("test config should be written");

        let mut workflow = default_workflow();
        workflow.preset = "custom".to_string();
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
            saved["projects"][0]["autoHunt"]["workflow"]["preset"],
            "custom"
        );
        assert_eq!(
            saved["projects"][0]["autoHunt"]["workflow"]["stages"][0]["checks"][0],
            "cargo test"
        );

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
    fn installs_cli_and_skill_assets() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("briar-assets-test-{unique}"));
        let resources = home.join("missing-resources");

        install_auto_hunt_assets(&resources, &home).expect("assets should install");

        assert!(home.join(".local/bin/briar").is_file());
        assert!(home.join(".local/share/briar/briar.js").is_file());
        assert_eq!(
            read_trimmed_file(&home.join(".local/share/briar/VERSION")),
            Some(env!("CARGO_PKG_VERSION").to_string())
        );
        assert!(home
            .join(".codex/skills/briar-auto-hunt/SKILL.md")
            .is_file());
        assert_eq!(
            read_trimmed_file(&home.join(".codex/skills/briar-auto-hunt/VERSION")),
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
            "https://briar.example.com".to_string(),
            "11111111-1111-4111-8111-111111111111".to_string(),
            "briar_agent_test".to_string(),
            repository,
            Some("https://github.com/wordbricks/briar.git".to_string()),
            AutoHuntConfig {
                velen_org: "wordbricks".to_string(),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: Some("wordbricks/briar".to_string()),
                workflow: default_workflow(),
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
        fs::remove_dir_all(home).expect("test home should be removed");
    }
}
