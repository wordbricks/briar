mod agent;

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
use tauri::{webview::Color, WebviewUrl, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const SESSION_FILE_NAME: &str = "session.json";
const AUTO_HUNT_EVENT_DIRECTORY: &str = "auto-hunt-sessions";
const AUTO_HUNT_APP_SERVER_EVENT: &str = "auto-hunt-app-server-event";
const DEFAULT_MAIN_WINDOW_SIZE: (f64, f64) = (1280.0, 820.0);
const ONBOARDING_MAIN_WINDOW_SIZE: (f64, f64) = (980.0, 680.0);

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
    llm: Option<agent::ProjectLlmSettings>,
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
struct OnboardingPrerequisiteStatus {
    installed: bool,
    version: Option<String>,
    authenticated: bool,
}

#[derive(Serialize)]
struct OnboardingPrerequisites {
    git: OnboardingPrerequisiteStatus,
    codex: OnboardingPrerequisiteStatus,
    velen: OnboardingPrerequisiteStatus,
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

fn git_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("git", Some(cli_execution_path(home)?), home)
        .map_err(|_| "Git이 필요합니다. Git을 설치한 뒤 다시 확인하세요.".to_string())
}

fn gh_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("gh", Some(cli_execution_path(home)?), home)
        .map_err(|_| "GitHub CLI가 설치되지 않았습니다.".to_string())
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

fn inspect_velen_prerequisite_with(
    binary: Result<PathBuf, String>,
    home: &Path,
) -> OnboardingPrerequisiteStatus {
    let Ok(binary) = binary else {
        return OnboardingPrerequisiteStatus {
            installed: false,
            version: None,
            authenticated: false,
        };
    };
    let mut status = inspect_cli(Ok(binary.clone()));
    status.authenticated = run_velen_json_with(&binary, home, &["auth", "whoami"]).is_ok();
    status
}

fn inspect_onboarding_prerequisites_sync(home: &Path) -> OnboardingPrerequisites {
    OnboardingPrerequisites {
        git: inspect_cli(git_binary(home)),
        codex: inspect_cli(agent::codex_binary(home)),
        velen: inspect_velen_prerequisite_with(velen_binary(), home),
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
            "velen" => install_cli_package(&home, "@wordbricks/velen")?,
            _ => return Err("지원하지 않는 필수 도구입니다.".to_string()),
        }
        let prerequisites = inspect_onboarding_prerequisites_sync(&home);
        let installed = match prerequisite.as_str() {
            "git" => prerequisites.git.installed,
            "codex" => prerequisites.codex.installed,
            "velen" => prerequisites.velen.installed,
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

#[tauri::command]
async fn login_onboarding_velen(app: tauri::AppHandle) -> Result<OnboardingPrerequisites, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let binary = velen_binary()?;
        run_velen_json_with(&binary, &home, &["auth", "login"])?;
        let prerequisites = inspect_onboarding_prerequisites_sync(&home);
        if !prerequisites.velen.authenticated {
            return Err(
                "Velen OAuth 로그인은 완료됐지만 인증 상태를 확인하지 못했습니다.".to_string(),
            );
        }
        Ok(prerequisites)
    })
    .await
    .map_err(|error| error.to_string())?
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

fn inspect_repository_readiness_at(
    repository_path: &Path,
    workflow: &WorkflowConfig,
    home: &Path,
) -> RepositoryReadiness {
    let mut issues = Vec::new();
    let requires_github = workflow_requires_github(workflow);
    let git = git_binary(home);
    let git_installed = git.is_ok();
    let git_version = git
        .as_ref()
        .ok()
        .and_then(|binary| Command::new(binary).arg("--version").output().ok())
        .filter(|output| output.status.success())
        .and_then(|output| parse_cli_version(&output.stdout));
    if !git_installed {
        issues.push("Git이 설치되지 않았습니다.".to_string());
    }

    let root = git
        .as_ref()
        .ok()
        .and_then(|binary| {
            Command::new(binary)
                .arg("-C")
                .arg(repository_path)
                .args(["rev-parse", "--show-toplevel"])
                .output()
                .ok()
        })
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|root| PathBuf::from(root.trim()));
    let repository_healthy = root.as_ref().is_some_and(|root| root.is_dir());
    if git_installed && !repository_healthy {
        issues.push("선택한 폴더가 유효한 Git 저장소가 아닙니다.".to_string());
    }
    let resolved_path = root.as_deref().unwrap_or(repository_path);
    let remote = repository_healthy
        .then(|| repository_remote(resolved_path))
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
            Command::new(binary)
                .env("GIT_TERMINAL_PROMPT", "0")
                .env("GCM_INTERACTIVE", "Never")
                .env(
                    "GIT_SSH_COMMAND",
                    "ssh -o BatchMode=yes -o ConnectTimeout=8",
                )
                .args(["-c", "http.lowSpeedLimit=1"])
                .args(["-c", "http.lowSpeedTime=8"])
                .arg("-C")
                .arg(resolved_path)
                .args(["ls-remote", "--exit-code", "origin", "HEAD"])
                .output()
                .ok()
        })
        .is_some_and(|output| output.status.success());
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
            let sha = Command::new(binary)
                .arg("-C")
                .arg(resolved_path)
                .args(["rev-parse", "--short=12", "HEAD"])
                .output()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())?;
            let target = format!("HEAD:refs/heads/briar-access-check-{}", sha.trim());
            Command::new(binary)
                .env("GIT_TERMINAL_PROMPT", "0")
                .env("GCM_INTERACTIVE", "Never")
                .env(
                    "GIT_SSH_COMMAND",
                    "ssh -o BatchMode=yes -o ConnectTimeout=8",
                )
                .arg("-c")
                .arg("core.hooksPath=/dev/null")
                .args(["-c", "http.lowSpeedLimit=1"])
                .args(["-c", "http.lowSpeedTime=8"])
                .arg("-C")
                .arg(resolved_path)
                .args(["push", "--dry-run", "--porcelain", "origin"])
                .arg(target)
                .output()
                .ok()
        })
        .is_some_and(|output| output.status.success());
    if remote_reachable && !push_access {
        issues.push("origin에 브랜치를 push할 권한을 확인하지 못했습니다.".to_string());
    }

    let github_repository = remote.as_deref().and_then(github_repository_from_remote);
    if requires_github && github_repository.is_none() {
        issues.push("PR 단계에는 GitHub origin 저장소가 필요합니다.".to_string());
    }
    let gh = if requires_github {
        gh_binary(home)
    } else {
        Err("현재 워크플로우에는 GitHub CLI가 필요하지 않습니다.".to_string())
    };
    let gh_installed = gh.is_ok();
    let gh_version = gh
        .as_ref()
        .ok()
        .and_then(|binary| Command::new(binary).arg("--version").output().ok())
        .filter(|output| output.status.success())
        .and_then(|output| parse_cli_version(&output.stdout));
    let gh_authenticated = gh
        .as_ref()
        .ok()
        .and_then(|binary| {
            Command::new(binary)
                .env("PATH", cli_execution_path(home).ok()?)
                .args(["auth", "status", "--hostname", "github.com"])
                .output()
                .ok()
        })
        .is_some_and(|output| output.status.success());
    let gh_account = gh
        .as_ref()
        .ok()
        .filter(|_| gh_authenticated)
        .and_then(|binary| {
            Command::new(binary)
                .env("PATH", cli_execution_path(home).ok()?)
                .args(["api", "user", "--jq", ".login"])
                .output()
                .ok()
        })
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|account| account.trim().to_string())
        .filter(|account| !account.is_empty());
    let github_write_access = gh
        .as_ref()
        .ok()
        .filter(|_| gh_authenticated)
        .zip(github_repository.as_ref())
        .and_then(|(binary, repository)| {
            Command::new(binary)
                .env("PATH", cli_execution_path(home).ok()?)
                .args([
                    "repo",
                    "view",
                    repository,
                    "--json",
                    "viewerPermission",
                    "--jq",
                    ".viewerPermission",
                ])
                .output()
                .ok()
        })
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .is_some_and(|permission| matches!(permission.trim(), "WRITE" | "MAINTAIN" | "ADMIN"));
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
        .unwrap_or_else(default_workflow);
    Ok(inspect_repository_readiness_at(
        Path::new(&project.repository_path),
        &workflow,
        home,
    ))
}

#[tauri::command]
async fn inspect_repository_readiness(
    app: tauri::AppHandle,
    repository_path: String,
    workflow: WorkflowConfig,
) -> Result<RepositoryReadiness, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(inspect_repository_readiness_at(
            Path::new(&repository_path),
            &workflow,
            &home,
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
        llm: Some(agent::ProjectLlmSettings::default()),
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
) -> Result<agent::ProjectLlmSettings, String> {
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
    settings: agent::ProjectLlmSettings,
) -> Result<agent::ProjectLlmSettings, String> {
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
    request: agent::ProjectLlmRequest,
) -> Result<agent::ProjectLlmResponse, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let readiness = project_repository_readiness_at(&config_path, &project_id, &home)?;
        if readiness.requires_github && !readiness.pr_ready {
            return Err(format!(
                "PR 단계 실행 준비가 필요합니다: {}",
                readiness.issues.join(" ")
            ));
        }
        let workspace = connected_project_workspace(&config_path, &project_id)?;
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let execution_path = cli_execution_path(&home)?;
        let backend = agent::CodexBackend::discover(&home, &execution_path)?;
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
        agent::AgentBackend::run(
            &backend,
            &project_id,
            &workspace,
            agent::ChatExecution {
                approval_policy: settings.approval_policy,
                sandbox_mode: agent::SandboxMode::ReadOnly,
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
    request: agent::ProjectAutoHuntRequest,
) -> Result<agent::ProjectAutoHuntResponse, String> {
    let api_url = request.api_url.trim();
    if api_url.is_empty()
        || api_url.chars().any(char::is_whitespace)
        || !(api_url.starts_with("http://") || api_url.starts_with("https://"))
    {
        return Err("자동사냥 API URL이 올바르지 않습니다.".to_string());
    }
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let event_sink = create_auto_hunt_event_sink(&app, &request.session_id)?;
    let approval_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = connected_project_workspace(&config_path, &project_id)?;
        let settings = project_llm_settings_from(&config_path, &project_id)?;
        let execution_path = cli_execution_path(&home)?;
        let cli_environment = agent::AutoHuntCliEnvironment::prepare(
            &home,
            &execution_path,
            &workspace,
            &project_id,
            &request.api_url,
        )?;
        let backend = agent::CodexBackend::discover(&home, cli_environment.execution_path())?;
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
        agent::start_auto_hunt(
            &backend,
            &project_id,
            &workspace,
            agent::AutoHuntExecution {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_auth_session::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|_app| {
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
            login_onboarding_velen,
            read_session_token,
            write_session_token,
            clear_session_token,
            validate_repository_path,
            inspect_repository_readiness,
            connected_project_ids,
            project_llm_chat,
            start_project_auto_hunt,
            load_auto_hunt_app_server_events,
            load_project_llm_settings,
            update_project_llm_settings,
            update_local_project_workflow,
            project_repository_readiness,
            install_project_github_cli,
            login_project_github,
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
    fn uses_compact_window_dimensions_only_during_onboarding() {
        assert_eq!(main_window_size(true), ONBOARDING_MAIN_WINDOW_SIZE);
        assert_eq!(main_window_size(false), DEFAULT_MAIN_WINDOW_SIZE);
    }

    #[cfg(unix)]
    #[test]
    fn onboarding_requires_an_authenticated_velen_session() {
        use std::os::unix::fs::PermissionsExt;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("briar-velen-onboarding-test-{unique}"));
        fs::create_dir_all(&home).expect("test home should be created");
        let velen = home.join("velen");
        fs::write(
            &velen,
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then\n\
               printf '%s\\n' 'velen 1.0.0'\n\
               exit 0\n\
             fi\n\
             printf '%s\\n' '{\"ok\":true,\"data\":{\"user\":{\"email\":\"jay@example.com\"}}}'\n",
        )
        .expect("authenticated fake Velen should be written");
        fs::set_permissions(&velen, fs::Permissions::from_mode(0o755))
            .expect("fake Velen should be executable");

        let authenticated = inspect_velen_prerequisite_with(Ok(velen.clone()), &home);
        assert!(authenticated.installed);
        assert!(authenticated.authenticated);
        assert_eq!(authenticated.version.as_deref(), Some("velen 1.0.0"));

        fs::write(
            &velen,
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then\n\
               printf '%s\\n' 'velen 1.0.0'\n\
               exit 0\n\
             fi\n\
             printf '%s\\n' '{\"ok\":false,\"error\":{\"message\":\"Not logged in\"}}'\n\
             exit 1\n",
        )
        .expect("unauthenticated fake Velen should be written");
        let unauthenticated = inspect_velen_prerequisite_with(Ok(velen), &home);
        assert!(unauthenticated.installed);
        assert!(!unauthenticated.authenticated);

        fs::remove_dir_all(home).expect("test home should be removed");
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
            agent::ApprovalPolicy::Never
        );
        update_project_llm_settings_at(
            &config_path,
            "project-1",
            agent::ProjectLlmSettings {
                approval_policy: agent::ApprovalPolicy::OnRequest,
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
    fn recognizes_pr_workflows_and_github_remotes() {
        let mut workflow = default_workflow();
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
