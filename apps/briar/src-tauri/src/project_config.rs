use super::*;

pub(super) struct LocalProjectAgentConfig {
    pub(super) llm: agent::ProjectLlmSettings,
    pub(super) auto_hunt: AutoHuntConfig,
}

/// Everything a local project connection records.
pub(super) struct CliConnectionInput {
    pub(super) api_url: String,
    pub(super) project_id: String,
    pub(super) agent_token: String,
    pub(super) repository_path: String,
    pub(super) repository_remote: Option<String>,
}

pub(super) fn write_cli_connection(
    config_path: &Path,
    connection: CliConnectionInput,
    agent_config: LocalProjectAgentConfig,
) -> Result<(), String> {
    validate_generated_workflow(&agent_config.auto_hunt.workflow)?;
    let CliConnectionInput {
        api_url,
        project_id,
        agent_token,
        repository_path,
        repository_remote,
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
            openrouter_api_key: None,
            app_settings: StoredAppRuntimeSettings::default(),
            projects: Vec::new(),
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
    let stored_project = config
        .projects
        .iter()
        .find(|project| project.id == project_id);
    let stored_auto_hunt = stored_project.and_then(|project| project.auto_hunt.as_ref());
    let stored_worktrees = stored_auto_hunt.and_then(|auto_hunt| auto_hunt.worktrees.clone());
    let stored_sandbox = stored_auto_hunt.and_then(|auto_hunt| auto_hunt.sandbox.clone());
    let stored_extra = stored_project
        .map(|project| project.extra.clone())
        .unwrap_or_default();
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
        repository_remote,
        agent_token,
        llm: Some(agent_config.llm),
        auto_hunt: Some(auto_hunt),
        extra: stored_extra,
    });

    write_cli_config(config_path, &config)
}

pub(super) fn write_cli_config(config_path: &Path, config: &CliConfig) -> Result<(), String> {
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

pub(super) fn remove_cli_connection(config_path: &Path, project_id: &str) -> Result<(), String> {
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

pub(super) fn cli_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".config")
        .join("briar")
        .join("config.json"))
}

pub(super) fn read_cli_config(config_path: &Path) -> Result<CliConfig, String> {
    if !config_path.exists() {
        return Ok(CliConfig {
            api_url: String::new(),
            user_token: None,
            agent_providers: AppProviderSettings::default(),
            openrouter_api_key: None,
            app_settings: StoredAppRuntimeSettings::default(),
            projects: Vec::new(),
            extra: BTreeMap::new(),
        });
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    serde_json::from_str::<CliConfig>(&contents)
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))
}

pub(super) fn project_repository_path(
    config: &CliConfig,
    project_id: &str,
) -> Result<PathBuf, String> {
    config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| PathBuf::from(&project.repository_path))
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())
}

pub(super) fn project_runner(
    config: &CliConfig,
    project_id: &str,
    home: &Path,
) -> Result<Arc<dyn host::CommandRunner>, String> {
    project_repository_path(config, project_id)?;
    Ok(Arc::new(
        LocalExecutionEnvironment::discover(home)?.runner(),
    ))
}

/// Resolve a repository root through a runner: the configured path must be the
/// git root on that host. Mirrors the original local-only check.
pub(super) fn resolve_workspace_with(
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

pub(super) fn connected_project_runtime(
    config_path: &Path,
    project_id: &str,
    home: &Path,
) -> Result<(Arc<dyn host::CommandRunner>, PathBuf), String> {
    let config = read_cli_config(config_path)?;
    let repository_path = project_repository_path(&config, project_id)?;
    let runner = project_runner(&config, project_id, home)?;
    let workspace = resolve_workspace_with(runner.as_ref(), &repository_path)?;
    Ok((runner, workspace))
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ProjectWorkspaceMode {
    #[default]
    Connected,
    LatestRemoteBase,
    IssueWorktree,
    IssueContext,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct RegisteredGitWorktree {
    pub(super) path: PathBuf,
    pub(super) branch: Option<String>,
}

pub(super) fn parse_registered_git_worktrees(output: &str) -> Vec<RegisteredGitWorktree> {
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

pub(super) fn auto_hunt_run_token(run_id: &str) -> Result<String, String> {
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

pub(super) fn branch_matches_auto_hunt_run(branch: &str, run_token: &str) -> bool {
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

pub(super) fn select_issue_worktree(
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
            "이 이슈를 처리하던 원래 워크트리를 찾지 못했습니다. 워크트리가 삭제되었는지 확인해 주세요."
                .to_string(),
        ),
        _ => Err(
            "이슈 run과 일치하는 처리용 워크트리가 여러 개라서 안전하게 선택할 수 없습니다."
                .to_string(),
        ),
    }
}

pub(super) fn resolve_issue_worktree(
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
            "이슈 처리용 워크트리 목록을 읽지 못했습니다: {}",
            output.failure_message()
        ));
    }
    let selected = select_issue_worktree(&output.stdout, run_id, recorded_branch)?;
    let selected = runner
        .canonicalize(&selected)
        .map_err(|error| format!("이슈 처리용 워크트리를 열지 못했습니다: {error}"))?;
    let connected = runner.canonicalize(connected_workspace)?;
    if selected == connected {
        return Err("연결된 공용 저장소는 이슈 워크트리로 사용할 수 없습니다.".to_string());
    }
    Ok(selected)
}

pub(super) struct LatestRemoteWorkspace {
    pub(super) root: PathBuf,
    pub(super) checkout: PathBuf,
}

pub(super) fn remote_head_branch(output: &str) -> Option<&str> {
    output.lines().find_map(|line| {
        let (reference, target) = line.split_once('\t')?;
        if target.trim() != "HEAD" {
            return None;
        }
        reference.trim().strip_prefix("ref: refs/heads/")
    })
}

pub(super) fn create_analysis_temp_root(
    _runner: &dyn host::CommandRunner,
) -> Result<PathBuf, String> {
    tempfile::Builder::new()
        .prefix("briar-workflow-analysis-")
        .tempdir()
        .map(|directory| directory.keep())
        .map_err(|error| format!("워크플로우 분석 임시 폴더를 만들지 못했습니다: {error}"))
}

pub(super) fn remove_analysis_temp_root(
    _runner: &dyn host::CommandRunner,
    root: &Path,
) -> Result<(), String> {
    fs::remove_dir(root)
        .map_err(|error| format!("워크플로우 분석 임시 폴더를 정리하지 못했습니다: {error}"))
}

pub(super) fn parse_worktree_include_file(contents: &str) -> Vec<PathBuf> {
    let mut entries = Vec::new();
    let mut seen = BTreeSet::new();
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with('!')
            || line.contains('*')
            || line.contains('?')
        {
            continue;
        }
        let normalized = line
            .replace('\\', "/")
            .trim_start_matches("./")
            .trim_end_matches('/')
            .to_string();
        if normalized.is_empty()
            || normalized.starts_with('/')
            || normalized
                .as_bytes()
                .get(1)
                .is_some_and(|character| *character == b':')
        {
            continue;
        }
        let segments = normalized.split('/').collect::<Vec<_>>();
        if segments
            .iter()
            .any(|segment| segment.is_empty() || *segment == "..")
            || segments.first() == Some(&".git")
            || !seen.insert(normalized.clone())
        {
            continue;
        }
        entries.push(PathBuf::from(normalized));
        if entries.len() >= WORKTREE_INCLUDE_MAX_ENTRIES {
            break;
        }
    }
    entries
}

pub(super) fn copy_worktree_include_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("{}을(를) 읽지 못했습니다: {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("{} 폴더를 만들지 못했습니다: {error}", parent.display())
            })?;
        }
        fs::copy(source, destination).map_err(|error| {
            format!(
                "{}을(를) {}에 복사하지 못했습니다: {error}",
                source.display(),
                destination.display()
            )
        })?;
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "{} 폴더를 만들지 못했습니다: {error}",
            destination.display()
        )
    })?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("{} 폴더를 읽지 못했습니다: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| {
            format!("{} 폴더 항목을 읽지 못했습니다: {error}", source.display())
        })?;
        copy_worktree_include_entry(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

pub(super) fn copy_worktree_includes(repository: &Path, worktree: &Path) -> Vec<PathBuf> {
    let include_path = repository.join(WORKTREE_INCLUDE_FILE);
    let Ok(metadata) = fs::metadata(&include_path) else {
        return Vec::new();
    };
    if !metadata.is_file() || metadata.len() > WORKTREE_INCLUDE_MAX_BYTES {
        return Vec::new();
    }
    let Ok(contents) = fs::read_to_string(include_path) else {
        return Vec::new();
    };
    let mut copied = Vec::new();
    for entry in parse_worktree_include_file(&contents) {
        let source = repository.join(&entry);
        let destination = worktree.join(&entry);
        if destination.exists() || !source.exists() {
            continue;
        }
        if copy_worktree_include_entry(&source, &destination).is_ok() {
            copied.push(entry);
        }
    }
    copied
}

pub(super) fn prepare_latest_remote_workspace(
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

pub(super) fn prepare_latest_project_agent_workspace(
    runner: &dyn host::CommandRunner,
    connected_workspace: &Path,
) -> Result<LatestRemoteWorkspace, String> {
    let workspace =
        prepare_latest_remote_workspace(runner, connected_workspace)?.ok_or_else(|| {
            "저장된 에이전트를 실행하려면 연결된 저장소에 origin 원격 저장소가 필요합니다."
                .to_string()
        })?;
    copy_worktree_includes(connected_workspace, &workspace.checkout);
    Ok(workspace)
}

pub(super) fn remove_latest_remote_workspace(
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

pub(super) fn project_llm_settings_from(
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

pub(super) fn app_provider_settings_from(
    config_path: &Path,
) -> Result<AppProviderSettings, String> {
    Ok(read_cli_config(config_path)?.agent_providers)
}

pub(super) const OPENROUTER_OPENCODE_CONFIG: &str =
    r#"{"provider":{"openrouter":{"options":{"apiKey":"{env:OPENROUTER_API_KEY}"}}}}"#;

pub(super) fn openrouter_api_key_from(config_path: &Path) -> Result<Option<String>, String> {
    Ok(read_cli_config(config_path)?
        .openrouter_api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty()))
}

pub(super) fn provider_environment_from(
    config_path: &Path,
    provider: agent::AgentProviderKind,
) -> Result<Vec<(String, String)>, String> {
    if provider != agent::AgentProviderKind::Openrouter {
        return Ok(Vec::new());
    }
    let api_key = openrouter_api_key_from(config_path)?
        .ok_or_else(|| "앱 설정에서 OpenRouter API 키를 먼저 저장하세요.".to_string())?;
    Ok(vec![
        ("OPENROUTER_API_KEY".to_string(), api_key),
        (
            "OPENCODE_CONFIG_CONTENT".to_string(),
            OPENROUTER_OPENCODE_CONFIG.to_string(),
        ),
    ])
}

pub(super) fn update_openrouter_api_key_at(
    config_path: &Path,
    api_key: Option<String>,
) -> Result<OpenRouterCredentialStatus, String> {
    let normalized = api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    if normalized.as_deref().is_some_and(|key| {
        key.len() < 10 || key.len() > 500 || key.chars().any(char::is_whitespace)
    }) {
        return Err("OpenRouter API 키는 공백 없이 10~500자로 입력하세요.".to_string());
    }
    let mut config = read_cli_config(config_path)?;
    config.openrouter_api_key = normalized;
    let configured = config.openrouter_api_key.is_some();
    write_cli_config(config_path, &config)?;
    Ok(OpenRouterCredentialStatus { configured })
}

pub(super) fn app_runtime_settings_from(
    config_path: &Path,
) -> Result<StoredAppRuntimeSettings, String> {
    Ok(read_cli_config(config_path)?.app_settings)
}

pub(super) fn update_app_runtime_settings_at(
    config_path: &Path,
    settings: AppRuntimeSettingsUpdate,
) -> Result<StoredAppRuntimeSettings, String> {
    let mut config = read_cli_config(config_path)?;
    config.app_settings.prevent_sleep_while_running = settings.prevent_sleep_while_running;
    let saved = config.app_settings;
    write_cli_config(config_path, &config)?;
    Ok(saved)
}

pub(super) fn browser_automation_settings_from(
    config_path: &Path,
) -> Result<BrowserAutomationSettings, String> {
    Ok(BrowserAutomationSettings {
        provider: read_cli_config(config_path)?
            .app_settings
            .browser_automation_provider,
    })
}

pub(super) fn update_browser_automation_settings_at(
    config_path: &Path,
    settings: BrowserAutomationSettings,
) -> Result<BrowserAutomationSettings, String> {
    let mut config = read_cli_config(config_path)?;
    config.app_settings.browser_automation_provider = settings.provider;
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

pub(super) fn update_app_provider_settings_at(
    config_path: &Path,
    settings: AppProviderSettings,
) -> Result<AppProviderSettings, String> {
    if !settings.any_enabled() {
        return Err("하나 이상의 에이전트 프로바이더를 활성화해야 합니다.".to_string());
    }
    let mut config = read_cli_config(config_path)?;
    config.agent_providers = settings;
    write_cli_config(config_path, &config)?;
    Ok(settings)
}

pub(super) fn approval_request_message(
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

pub(super) fn update_project_llm_settings_at(
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

pub(super) fn update_project_workflow_at(
    config_path: &Path,
    project_id: &str,
    workflow: WorkflowConfig,
) -> Result<WorkflowConfig, String> {
    let workflow = canonicalize_workflow(workflow);
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
        .ok_or_else(|| "이 프로젝트에 이슈 처리 설정이 없습니다.".to_string())?;
    auto_hunt.workflow = Some(workflow.clone());
    write_cli_config(config_path, &config)?;
    Ok(workflow)
}

pub(super) fn update_project_velen_org_at(
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
        .ok_or_else(|| "이 프로젝트에 이슈 처리 설정이 없습니다.".to_string())?;
    let org = org
        .map(|org| org.trim().to_string())
        .filter(|org| !org.is_empty());

    if let Some(org) = org.as_ref() {
        inspect_velen(Some(org.clone()))?;
    }

    auto_hunt.velen_org = org.clone();
    if org.is_none() {
        auto_hunt.data_source = None;
        auto_hunt.linear = Some(StoredLinearConfig {
            enabled: false,
            source: None,
            team_key: None,
            extra: BTreeMap::new(),
        });
    }
    write_cli_config(config_path, &config)?;
    Ok(org)
}

pub(super) fn validate_generated_workflow(workflow: &WorkflowConfig) -> Result<(), String> {
    if workflow.version != 2 || workflow.stages.is_empty() || workflow.stages.len() > 30 {
        return Err("생성된 워크플로우 버전 또는 단계 수가 올바르지 않습니다.".to_string());
    }
    if workflow.requirements.len() > 30 {
        return Err("생성된 워크플로우 도구 요구사항 수가 올바르지 않습니다.".to_string());
    }
    let valid_tool = |tool: &str| {
        !tool.is_empty()
            && tool.len() <= 80
            && tool
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_.+-".contains(character))
    };
    let mut requirement_ids = BTreeSet::new();
    for requirement in &workflow.requirements {
        let expected_tool = match requirement.kind {
            WorkflowRequirementKind::Executable => None,
            WorkflowRequirementKind::Xcode => Some("xcodebuild"),
            WorkflowRequirementKind::IosSimulator => Some("xcrun"),
            WorkflowRequirementKind::AndroidSdk => Some("adb"),
            WorkflowRequirementKind::AndroidEmulator => Some("emulator"),
        };
        if requirement.id.trim().is_empty()
            || requirement.label.trim().is_empty()
            || requirement.reason.trim().is_empty()
            || !valid_tool(requirement.tool.trim())
            || expected_tool.is_some_and(|tool| requirement.tool != tool)
            || !requirement_ids.insert(requirement.id.as_str())
        {
            return Err("생성된 워크플로우 도구 요구사항이 올바르지 않습니다.".to_string());
        }
    }
    let mut ids = BTreeSet::new();
    for stage in &workflow.stages {
        if stage.id.trim().is_empty()
            || stage.id.len() > 64
            || !stage.id.chars().enumerate().all(|(index, character)| {
                if index == 0 {
                    character.is_ascii_lowercase()
                } else {
                    character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || character == '_'
                        || character == '-'
                }
            })
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
    let mut checkpoint_keys = BTreeSet::new();
    let mut checkpoint_boundaries = BTreeSet::new();
    for checkpoint in &workflow.execution.checkpoints {
        if checkpoint.key.is_empty()
            || checkpoint.key.len() > WORKFLOW_CHECKPOINT_KEY_MAX_LENGTH
            || !checkpoint
                .key
                .chars()
                .enumerate()
                .all(|(index, character)| {
                    if index == 0 {
                        character.is_ascii_lowercase()
                    } else {
                        character.is_ascii_lowercase()
                            || character.is_ascii_digit()
                            || character == '_'
                            || character == '-'
                    }
                })
            || !ids.contains(checkpoint.stage.as_str())
            || !checkpoint_keys.insert(checkpoint.key.as_str())
            || !checkpoint_boundaries
                .insert(format!("{}:{:?}", checkpoint.stage, checkpoint.position))
        {
            return Err("생성된 워크플로우 checkpoint가 올바르지 않습니다.".to_string());
        }
    }
    let expected_order = workflow
        .execution
        .checkpoints
        .iter()
        .map(|checkpoint| {
            (
                workflow
                    .stages
                    .iter()
                    .position(|stage| stage.id == checkpoint.stage)
                    .unwrap_or(usize::MAX),
                match checkpoint.position {
                    WorkflowCheckpointPosition::Before => 0,
                    WorkflowCheckpointPosition::After => 1,
                },
            )
        })
        .collect::<Vec<_>>();
    if expected_order.windows(2).any(|pair| pair[0] > pair[1]) {
        return Err("생성된 워크플로우 checkpoint 순서가 canonical하지 않습니다.".to_string());
    }
    Ok(())
}

pub(super) fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
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

pub(super) fn bundled_path(resource_directory: &Path, bundled: &str, development: &str) -> PathBuf {
    let bundled_path = resource_directory.join(bundled);
    if bundled_path.exists() {
        return bundled_path;
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(development)
}

pub(super) fn install_auto_hunt_assets(
    resource_directory: &Path,
    home: &Path,
) -> Result<(), String> {
    let mut skill_destinations = Vec::new();
    for skill_name in ["briar-workflow", "browser"] {
        let relative_path = format!("skills/{skill_name}");
        let development_path = format!("../../{relative_path}");
        let skill_source = bundled_path(resource_directory, &relative_path, &development_path);
        if !skill_source.is_dir() {
            return Err(format!("{skill_name} 스킬 번들을 찾지 못했습니다."));
        }
        for skill_destination in [
            home.join(".codex").join("skills").join(skill_name),
            home.join(".claude").join("skills").join(skill_name),
            home.join(".cursor").join("skills").join(skill_name),
            home.join(".grok").join("skills").join(skill_name),
            home.join(".gemini")
                .join("config")
                .join("skills")
                .join(skill_name),
            home.join(".config")
                .join("opencode")
                .join("skills")
                .join(skill_name),
        ] {
            let stale_references = skill_destination.join("references");
            if stale_references.exists() {
                fs::remove_dir_all(&stale_references)
                    .map_err(|error| format!("이전 스킬 참조를 제거하지 못했습니다: {error}"))?;
            }
            copy_directory(&skill_source, &skill_destination)?;
            skill_destinations.push(skill_destination);
        }
    }

    let cli_source = bundled_path(resource_directory, "cli/briar.js", "dist-cli/briar.js");
    let launcher_source = bundled_path(
        resource_directory,
        "cli/briar",
        "../../scripts/briar-launcher",
    );
    let codex_runner_source = bundled_path(
        resource_directory,
        "agent/codex-runner.js",
        "dist-agent/codex-runner.js",
    );
    let claude_runner_source = bundled_path(
        resource_directory,
        "agent/claude-runner.js",
        "dist-agent/claude-runner.js",
    );
    let grok_runner_source = bundled_path(
        resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let cursor_runner_source = bundled_path(
        resource_directory,
        "agent/cursor-runner.js",
        "dist-agent/cursor-runner.js",
    );
    let agy_runner_source = bundled_path(
        resource_directory,
        "agent/agy-runner.js",
        "dist-agent/agy-runner.js",
    );
    let opencode_runner_source = bundled_path(
        resource_directory,
        "agent/opencode-runner.js",
        "dist-agent/opencode-runner.js",
    );
    if !cli_source.is_file() || !launcher_source.is_file() {
        return Err("Briar CLI 번들을 찾지 못했습니다.".to_string());
    }
    if !codex_runner_source.is_file()
        || !claude_runner_source.is_file()
        || !cursor_runner_source.is_file()
        || !grok_runner_source.is_file()
        || !agy_runner_source.is_file()
        || !opencode_runner_source.is_file()
    {
        return Err("Briar Agent runner 번들을 찾지 못했습니다.".to_string());
    }
    let library_directory = home.join(".local").join("share").join("briar");
    let binary_directory = home.join(".local").join("bin");
    fs::create_dir_all(&library_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&binary_directory).map_err(|error| error.to_string())?;
    fs::copy(cli_source, library_directory.join("briar.js"))
        .map_err(|error| format!("Briar CLI를 설치하지 못했습니다: {error}"))?;
    let agent_directory = library_directory.join("agent");
    fs::create_dir_all(&agent_directory).map_err(|error| error.to_string())?;
    fs::copy(codex_runner_source, agent_directory.join("codex-runner.js"))
        .map_err(|error| format!("Codex runner를 설치하지 못했습니다: {error}"))?;
    fs::copy(
        claude_runner_source,
        agent_directory.join("claude-runner.js"),
    )
    .map_err(|error| format!("Claude runner를 설치하지 못했습니다: {error}"))?;
    fs::copy(
        cursor_runner_source,
        agent_directory.join("cursor-runner.js"),
    )
    .map_err(|error| format!("Cursor runner를 설치하지 못했습니다: {error}"))?;
    fs::copy(grok_runner_source, agent_directory.join("grok-runner.js"))
        .map_err(|error| format!("Grok runner를 설치하지 못했습니다: {error}"))?;
    fs::copy(agy_runner_source, agent_directory.join("agy-runner.js"))
        .map_err(|error| format!("Antigravity runner를 설치하지 못했습니다: {error}"))?;
    fs::copy(
        opencode_runner_source,
        agent_directory.join("opencode-runner.js"),
    )
    .map_err(|error| format!("OpenCode runner를 설치하지 못했습니다: {error}"))?;
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

pub(super) fn read_trimmed_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn auto_hunt_assets_are_current(resource_directory: &Path, home: &Path) -> bool {
    let cli_directory = home.join(".local").join("share").join("briar");
    let cli_current = home.join(".local").join("bin").join("briar").is_file()
        && cli_directory.join("briar.js").is_file()
        && cli_directory.join("agent/codex-runner.js").is_file()
        && cli_directory.join("agent/claude-runner.js").is_file()
        && cli_directory.join("agent/cursor-runner.js").is_file()
        && cli_directory.join("agent/grok-runner.js").is_file()
        && cli_directory.join("agent/agy-runner.js").is_file()
        && cli_directory.join("agent/opencode-runner.js").is_file()
        && read_trimmed_file(&cli_directory.join("VERSION")).as_deref()
            == Some(env!("CARGO_PKG_VERSION"));
    if !cli_current {
        return false;
    }

    ["briar-workflow", "browser"].iter().all(|skill_name| {
        let relative_path = format!("skills/{skill_name}");
        let development_path = format!("../../{relative_path}");
        let skill_source = bundled_path(resource_directory, &relative_path, &development_path);
        let expected_version = read_trimmed_file(&skill_source.join("VERSION"))
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
        [
            home.join(".codex").join("skills").join(skill_name),
            home.join(".claude").join("skills").join(skill_name),
            home.join(".cursor").join("skills").join(skill_name),
            home.join(".grok").join("skills").join(skill_name),
            home.join(".gemini")
                .join("config")
                .join("skills")
                .join(skill_name),
            home.join(".config")
                .join("opencode")
                .join("skills")
                .join(skill_name),
        ]
        .iter()
        .all(|skill| {
            skill.join("SKILL.md").is_file()
                && read_trimmed_file(&skill.join("VERSION")).as_deref()
                    == Some(expected_version.as_str())
        })
    })
}

#[cfg(test)]
mod tests;
