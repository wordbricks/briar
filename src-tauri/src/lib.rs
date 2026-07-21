use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;

const SESSION_FILE_NAME: &str = "session.json";

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
    auto_hunt: Option<AutoHuntConfig>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
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

fn run_velen_json(args: &[&str]) -> Result<serde_json::Value, String> {
    let output = Command::new(velen_binary()?)
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
        auto_hunt: Some(auto_hunt),
        extra: BTreeMap::new(),
    });

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
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 열지 못했습니다: {error}"))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Briar 로컬 설정을 저장하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 로컬 설정 권한을 지정하지 못했습니다: {error}"))?;
    }
    Ok(())
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
async fn connect_local_project(
    app: tauri::AppHandle,
    api_url: String,
    project_id: String,
    agent_token: String,
    repository_path: String,
    auto_hunt: AutoHuntConfig,
) -> Result<String, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = git_repository_root(Path::new(&repository_path))?;
        let remote = repository_remote(&root);
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
        Ok(root_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert_eq!(saved["projects"][1]["id"], "new-project");
        assert_eq!(saved["projects"][1]["repositoryPath"], "/new/repository");

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
        assert!(home
            .join(".codex/skills/briar-auto-hunt/SKILL.md")
            .is_file());
        fs::remove_dir_all(home).expect("test home should be removed");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_session_token,
            write_session_token,
            clear_session_token,
            validate_repository_path,
            connected_project_ids,
            connect_local_project,
            inspect_velen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Briar");
}
