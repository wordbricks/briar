use super::*;

pub(super) const WORKFLOW_CHECKPOINT_KEY_MAX_LENGTH: usize = 64;

fn checkpoint_key_for_boundary(owner: &str, checkpoint: &WorkflowCheckpointConfig) -> String {
    let position = match checkpoint.position {
        WorkflowCheckpointPosition::Before => "before",
        WorkflowCheckpointPosition::After => "after",
    };
    let key = format!("{owner}-{position}-{}", checkpoint.stage);
    if key.len() <= WORKFLOW_CHECKPOINT_KEY_MAX_LENGTH {
        return key;
    }

    let hash = key
        .as_bytes()
        .iter()
        .fold(14_695_981_039_346_656_037_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(1_099_511_628_211)
        });
    let suffix = format!("-{hash:016x}");
    let prefix_budget = WORKFLOW_CHECKPOINT_KEY_MAX_LENGTH - suffix.len();
    let prefix_end = key
        .char_indices()
        .map(|(index, character)| index + character.len_utf8())
        .take_while(|end| *end <= prefix_budget)
        .last()
        .unwrap_or(0);
    format!("{}{suffix}", &key[..prefix_end])
}

pub(super) fn canonicalize_workflow(mut workflow: WorkflowConfig) -> WorkflowConfig {
    for requirement in &mut workflow.requirements {
        let canonical_tool = match requirement.kind {
            WorkflowRequirementKind::Executable => None,
            WorkflowRequirementKind::Xcode => Some("xcodebuild"),
            WorkflowRequirementKind::IosSimulator => Some("xcrun"),
            WorkflowRequirementKind::AndroidSdk => Some("adb"),
            WorkflowRequirementKind::AndroidEmulator => Some("emulator"),
        };
        if let Some(tool) = canonical_tool {
            requirement.tool = tool.to_string();
        }
    }
    for checkpoint in &mut workflow.execution.checkpoints {
        checkpoint.key = checkpoint_key_for_boundary("project", checkpoint);
    }
    workflow.execution.checkpoints.sort_by_key(|checkpoint| {
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
    });
    workflow
}

pub(super) fn workflow_requires_github(workflow: &WorkflowConfig) -> bool {
    workflow.stages.iter().any(|stage| {
        stage.id == "pr_open"
            || stage
                .evidence
                .iter()
                .any(|evidence| evidence == "pull_request")
    })
}

pub(super) fn github_repository_from_remote(remote: &str) -> Option<String> {
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

pub(super) fn command_failure(output: &std::process::Output) -> String {
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

pub(super) fn quoted_attribute(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(found) = lower[offset..].find(attribute) {
        let start = offset + found;
        let before = lower[..start].chars().next_back();
        let after = lower[start + attribute.len()..].chars().next();
        if before.is_some_and(|character| character.is_ascii_alphanumeric() || character == '_')
            || after.is_some_and(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            offset = start + attribute.len();
            continue;
        }
        let remainder = &tag[start + attribute.len()..];
        let delimiter = remainder.find(['=', ':'])?;
        let value = remainder[delimiter + 1..].trim_start();
        let quote = value.chars().next()?;
        if quote != '\'' && quote != '"' {
            offset = start + attribute.len();
            continue;
        }
        let quoted = &value[quote.len_utf8()..];
        return quoted.find(quote).map(|end| quoted[..end].to_string());
    }
    None
}

pub(super) fn repository_icon_href(source: &str) -> Option<String> {
    let lower = source.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(found) = lower[offset..].find("<link") {
        let start = offset + found;
        let end = source[start..].find('>').map(|end| start + end + 1)?;
        let tag = &source[start..end];
        let rel = quoted_attribute(tag, "rel");
        if rel.as_deref().is_some_and(|rel| {
            matches!(rel.to_ascii_lowercase().as_str(), "icon" | "shortcut icon")
        }) {
            if let Some(href) = quoted_attribute(tag, "href") {
                return Some(href);
            }
        }
        offset = end;
    }

    // React router metadata commonly declares icons as object literals.
    for object in source.split(['{', '}']) {
        let rel = quoted_attribute(object, "rel");
        if rel.as_deref().is_some_and(|rel| {
            matches!(rel.to_ascii_lowercase().as_str(), "icon" | "shortcut icon")
        }) {
            if let Some(href) = quoted_attribute(object, "href") {
                return Some(href);
            }
        }
    }
    None
}

pub(super) fn safe_repository_file(root: &Path, relative_path: &str) -> Option<PathBuf> {
    let root = fs::canonicalize(root).ok()?;
    let candidate = fs::canonicalize(root.join(relative_path)).ok()?;
    let metadata = fs::metadata(&candidate).ok()?;
    (candidate.starts_with(&root)
        && metadata.is_file()
        && metadata.len() <= MAX_REPOSITORY_ICON_BYTES)
        .then_some(candidate)
}

pub(super) fn repository_icon_path(root: &Path) -> Option<PathBuf> {
    let configured_icon = fs::read_to_string(root.join("t3.json"))
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|project| project.get("iconPath")?.as_str().map(str::to_string));
    if let Some(path) = configured_icon
        .as_deref()
        .and_then(|path| safe_repository_file(root, path))
    {
        return Some(path);
    }

    for candidate in REPOSITORY_ICON_CANDIDATES {
        if let Some(path) = safe_repository_file(root, candidate) {
            return Some(path);
        }
    }

    for source_file in REPOSITORY_ICON_SOURCE_FILES {
        let Some(source_path) = safe_repository_file(root, source_file) else {
            continue;
        };
        let Ok(source) = fs::read_to_string(source_path) else {
            continue;
        };
        let Some(href) = repository_icon_href(&source) else {
            continue;
        };
        if href.starts_with("//") || href.contains("://") || href.starts_with("data:") {
            continue;
        }
        let clean = href
            .split(['?', '#'])
            .next()
            .unwrap_or("")
            .trim_start_matches('/');
        if clean.is_empty() {
            continue;
        }
        for candidate in [format!("public/{clean}"), clean.to_string()] {
            if let Some(path) = safe_repository_file(root, &candidate) {
                return Some(path);
            }
        }
    }
    None
}

pub(super) fn repository_icon_data_url(root: &Path) -> Result<Option<String>, String> {
    let Some(path) = repository_icon_path(root) else {
        return Ok(None);
    };
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return Ok(None),
    };
    let bytes =
        fs::read(&path).map_err(|error| format!("저장소 아이콘을 읽지 못했습니다: {error}"))?;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        BASE64_STANDARD.encode(bytes)
    )))
}

#[tauri::command]
pub(super) async fn discover_repository_icon(
    app: tauri::AppHandle,
    repository_path: String,
) -> Result<Option<String>, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let root = git_repository_root(&runner, Path::new(&repository_path))?;
        repository_icon_data_url(&root)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) const MAX_LOVABLE_PACKAGE_JSON_BYTES: u64 = 1024 * 1024;

pub(super) fn package_script_is_preset_compatible(name: &str, command: &str) -> bool {
    let command = command.trim();
    if command.is_empty()
        || command.contains([';', '|', '`', '\n', '\r', '>', '<'])
        || command.contains("$(")
        || command.replace("&&", "").contains('&')
    {
        return false;
    }
    let allowed_prefixes: &[&str] = match name {
        "build" => &["vite build", "vinxi build", "react-router build", "tsc"],
        "lint" => &["eslint", "biome check", "oxlint"],
        "typecheck" => &["tsc"],
        "test" => &["vitest", "jest"],
        _ => return false,
    };
    command.split("&&").all(|segment| {
        let segment = segment.trim();
        allowed_prefixes.iter().any(|prefix| {
            segment == *prefix
                || segment
                    .strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.starts_with(char::is_whitespace))
        })
    })
}

pub(super) fn inspect_lovable_repository_compatibility_in(
    repository_root: &Path,
) -> LovableRepositoryCompatibility {
    let mut issues = Vec::new();
    let Ok(repository_root) = fs::canonicalize(repository_root) else {
        return LovableRepositoryCompatibility {
            compatible: false,
            stack: None,
            package_manager: None,
            scripts: Vec::new(),
            issues: vec!["The repository root could not be resolved.".to_string()],
        };
    };
    let package_path = repository_root.join("package.json");
    let Ok(resolved_package_path) = fs::canonicalize(&package_path) else {
        return LovableRepositoryCompatibility {
            compatible: false,
            stack: None,
            package_manager: None,
            scripts: Vec::new(),
            issues: vec!["package.json is missing.".to_string()],
        };
    };
    if !resolved_package_path.starts_with(&repository_root) {
        return LovableRepositoryCompatibility {
            compatible: false,
            stack: None,
            package_manager: None,
            scripts: Vec::new(),
            issues: vec!["package.json resolves outside the repository.".to_string()],
        };
    }
    let package_size = fs::metadata(&resolved_package_path)
        .map(|metadata| metadata.len())
        .unwrap_or(MAX_LOVABLE_PACKAGE_JSON_BYTES + 1);
    if package_size > MAX_LOVABLE_PACKAGE_JSON_BYTES {
        return LovableRepositoryCompatibility {
            compatible: false,
            stack: None,
            package_manager: None,
            scripts: Vec::new(),
            issues: vec!["package.json is too large to inspect safely.".to_string()],
        };
    }
    let package = fs::read_to_string(&resolved_package_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok());
    let Some(package) = package.and_then(|value| value.as_object().cloned()) else {
        return LovableRepositoryCompatibility {
            compatible: false,
            stack: None,
            package_manager: None,
            scripts: Vec::new(),
            issues: vec!["package.json is not valid JSON.".to_string()],
        };
    };

    let dependencies = ["dependencies", "devDependencies", "peerDependencies"]
        .into_iter()
        .filter_map(|key| package.get(key).and_then(serde_json::Value::as_object))
        .flat_map(|dependencies| dependencies.keys().cloned())
        .collect::<BTreeSet<_>>();
    let has_react = dependencies.contains("react");
    if !has_react {
        issues.push("The React dependency was not found.".to_string());
    }
    let stack = if dependencies.contains("@tanstack/react-start") {
        Some("tanstack-start".to_string())
    } else if dependencies.contains("vite") && has_react {
        Some("vite-react".to_string())
    } else {
        issues.push("Neither TanStack Start nor React + Vite was detected.".to_string());
        None
    };
    if ![
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
    ]
    .iter()
    .any(|config| repository_root.join(config).is_file())
    {
        issues.push("A Vite configuration file was not found.".to_string());
    }
    let supabase_directory = repository_root.join("supabase");
    if supabase_directory.is_dir() {
        if !supabase_directory.join("config.toml").is_file() {
            issues.push("The Supabase directory has no config.toml file.".to_string());
        }
        if supabase_directory.join("functions").is_dir() {
            issues.push(
                "Supabase Edge Functions require repository-specific workflow analysis."
                    .to_string(),
            );
        }
    }

    let script_entries = package
        .get("scripts")
        .and_then(serde_json::Value::as_object);
    let scripts = script_entries
        .into_iter()
        .flat_map(|scripts| scripts.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    if !scripts.contains("build") {
        issues.push("A package build script is required.".to_string());
    }
    for script_name in ["lint", "typecheck", "test", "build"] {
        let Some(command) = script_entries
            .and_then(|scripts| scripts.get(script_name))
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        if !package_script_is_preset_compatible(script_name, command) {
            issues.push(format!(
                "The '{script_name}' script requires repository-specific analysis."
            ));
        }
    }
    let custom_lifecycle_scripts = scripts
        .iter()
        .filter(|script| {
            let script = script.to_ascii_lowercase();
            ["deploy", "release", "publish"]
                .iter()
                .any(|prefix| script == *prefix || script.starts_with(&format!("{prefix}:")))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !custom_lifecycle_scripts.is_empty() {
        issues.push(format!(
            "Custom deployment scripts were detected: {}.",
            custom_lifecycle_scripts.join(", ")
        ));
    }
    if package.get("workspaces").is_some() {
        issues.push("A workspace or monorepo configuration was detected.".to_string());
    }

    let custom_configuration = [
        ".github/workflows",
        ".gitlab-ci.yml",
        ".circleci",
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",
        "wrangler.toml",
        "wrangler.json",
        "wrangler.jsonc",
        "vercel.json",
        "netlify.toml",
        "firebase.json",
        "fly.toml",
        "render.yaml",
        "render.yml",
        "railway.json",
        "serverless.yml",
        "serverless.yaml",
    ]
    .into_iter()
    .filter(|relative| repository_root.join(relative).exists())
    .collect::<Vec<_>>();
    if !custom_configuration.is_empty() {
        issues.push(format!(
            "Custom CI or deployment configuration was detected: {}.",
            custom_configuration.join(", ")
        ));
    }

    let mut package_manager_signals = BTreeSet::new();
    let declared_package_manager = package
        .get("packageManager")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| value.split('@').next())
        .filter(|manager| matches!(*manager, "bun" | "npm" | "pnpm" | "yarn"))
        .map(str::to_string);
    if package.get("packageManager").is_some() && declared_package_manager.is_none() {
        issues.push("The declared package manager is not supported by the preset.".to_string());
    }
    if let Some(manager) = declared_package_manager.as_ref() {
        package_manager_signals.insert(manager.clone());
    }
    for (lockfile, manager) in [
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("package-lock.json", "npm"),
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
    ] {
        if repository_root.join(lockfile).is_file() {
            package_manager_signals.insert(manager.to_string());
        }
    }
    if package_manager_signals.len() > 1 {
        issues.push(format!(
            "Conflicting package manager signals were detected: {}.",
            package_manager_signals
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let package_manager = declared_package_manager
        .or_else(|| package_manager_signals.iter().next().cloned())
        .or_else(|| Some("npm".to_string()));

    LovableRepositoryCompatibility {
        compatible: issues.is_empty(),
        stack,
        package_manager,
        scripts: scripts.into_iter().collect(),
        issues,
    }
}

#[tauri::command]
pub(super) async fn inspect_lovable_repository_compatibility(
    app: tauri::AppHandle,
    repository_path: String,
) -> Result<LovableRepositoryCompatibility, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let root = git_repository_root(&runner, Path::new(&repository_path))?;
        Ok(inspect_lovable_repository_compatibility_in(&root))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn inspect_repository_readiness_on(
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
        .then(|| repository_remote(runner, resolved_path))
        .flatten();
    if requires_github && remote.is_none() {
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
        .filter(|_| requires_github && repository_healthy && safe_remote)
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
    if requires_github && remote.is_some() && !remote_reachable {
        issues.push("origin에 인증된 상태로 접근할 수 없습니다.".to_string());
    }

    // `--dry-run` validates the receive-pack transport without updating a
    // remote ref. Hooks are disabled because connected repositories are
    // untrusted input during onboarding.
    let push_access = git
        .as_ref()
        .ok()
        .filter(|_| requires_github && repository_healthy && remote_reachable)
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
    if requires_github && remote_reachable && !push_access {
        issues.push("origin에 브랜치를 push할 권한을 확인하지 못했습니다.".to_string());
    }

    let github_repository = remote.as_deref().and_then(github_repository_from_remote);
    if requires_github && github_repository.is_none() {
        issues.push("PR 단계에는 GitHub origin 저장소가 필요합니다.".to_string());
    }
    let git_ready = git_installed && repository_healthy;
    let pr_ready = git_ready && remote_reachable && push_access && github_repository.is_some();

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
        gh_installed: false,
        gh_version: None,
        gh_authenticated: false,
        gh_account: None,
        github_write_access: push_access,
        git_ready,
        pr_ready,
        issues,
    }
}

pub(super) fn project_repository_readiness_at(
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
pub(super) async fn inspect_repository_readiness(
    app: tauri::AppHandle,
    repository_path: String,
    workflow: WorkflowConfig,
) -> Result<RepositoryReadiness, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        Ok(inspect_repository_readiness_on(
            &runner,
            Path::new(&repository_path),
            &workflow,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn project_repository_readiness(
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

#[cfg(test)]
pub(super) fn run_velen_json_with(
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

pub(super) fn run_velen_json_on(
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

pub(super) fn inspect_velen_sync(org: Option<String>) -> Result<VelenInspection, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾을 수 없습니다.".to_string())?;
    let runner = LocalExecutionEnvironment::discover(&home)?.runner();
    inspect_velen_on(&runner, org)
}

pub(super) fn inspect_velen_on(
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
pub(super) async fn inspect_velen(
    app: tauri::AppHandle,
    org: Option<String>,
) -> Result<VelenInspection, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        inspect_velen_on(&runner, org)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn validate_repository_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let root = git_repository_root(&runner, Path::new(&path))?;
        root.into_os_string()
            .into_string()
            .map_err(|_| "Git 저장소 경로를 표시할 수 없습니다.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Folder that holds the repositories Briar creates for brand-new projects.
pub(super) fn briar_workspace_root(home: &Path) -> PathBuf {
    home.join("Briar")
}

fn managed_project_repository_root(
    home: &Path,
    organization_id: &str,
    project_id: &str,
) -> PathBuf {
    home.join("Briar")
        .join("projects")
        .join(organization_id)
        .join(project_id)
}

fn safe_server_identifier(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn github_repository_parts(value: &str) -> Result<(&str, &str), String> {
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default();
    let valid = |segment: &str| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    };
    if !valid(owner) || !valid(repository) || parts.next().is_some() {
        return Err("프로젝트의 GitHub 저장소 정보가 올바르지 않습니다.".to_string());
    }
    Ok((owner, repository))
}

fn ensure_repository_disk_space(path: &Path) -> Result<(), String> {
    let output = Command::new("df")
        .arg("-Pk")
        .arg(path)
        .output()
        .map_err(|error| format!("디스크 여유 공간을 확인하지 못했습니다: {error}"))?;
    if !output.status.success() {
        return Err("디스크 여유 공간을 확인하지 못했습니다.".to_string());
    }
    let available_kib = String::from_utf8_lossy(&output.stdout)
        .lines()
        .last()
        .and_then(|line| line.split_whitespace().nth(3))
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "디스크 여유 공간 결과를 읽지 못했습니다.".to_string())?;
    if available_kib < 1_048_576 {
        return Err(
            "저장소를 준비하려면 디스크 여유 공간이 1GB 이상 필요합니다. 공간을 확보한 뒤 다시 시도해 주세요."
                .to_string(),
        );
    }
    Ok(())
}

fn project_git_credential_helper() -> &'static str {
    "!\"${BRIAR_CLI:-briar}\" github credential"
}

fn configure_project_git_credentials(
    git: &Path,
    repository_path: &Path,
    repository_id: u64,
) -> Result<(), String> {
    let repository_id = repository_id.to_string();
    let settings = [
        ("briar.githubRepositoryId", repository_id.as_str()),
        ("credential.useHttpPath", "true"),
        (
            "credential.https://github.com.helper",
            project_git_credential_helper(),
        ),
    ];
    for (key, value) in settings {
        let output = Command::new(git)
            .args(["config", "--local", key, value])
            .current_dir(repository_path)
            .output()
            .map_err(|error| format!("Git 인증 설정을 저장하지 못했습니다: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Git 인증 설정을 저장하지 못했습니다: {}",
                command_failure(&output)
            ));
        }
    }
    Ok(())
}

fn with_temporary_git_credential(
    command: &mut Command,
    credential: &ProjectGithubCredential,
    temporary_directory: &Path,
) -> Result<(), String> {
    let askpass = temporary_directory.join("briar-git-askpass.sh");
    fs::write(
        &askpass,
        "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' \"$BRIAR_GIT_USERNAME\" ;;\n  *) printf '%s\\n' \"$BRIAR_GIT_PASSWORD\" ;;\nesac\n",
    )
    .map_err(|error| format!("임시 Git 인증 도우미를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&askpass, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("임시 Git 인증 도우미를 보호하지 못했습니다: {error}"))?;
    }
    command
        .env("GIT_ASKPASS", askpass)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("BRIAR_GIT_USERNAME", &credential.username)
        .env("BRIAR_GIT_PASSWORD", &credential.password);
    Ok(())
}

pub(super) fn prepare_project_repository_in(
    git: &Path,
    home: &Path,
    credential: &ProjectGithubCredential,
) -> Result<PreparedProjectRepository, String> {
    if !safe_server_identifier(&credential.project.id)
        || !safe_server_identifier(&credential.project.organization_id)
    {
        return Err("서버가 반환한 프로젝트 식별자가 올바르지 않습니다.".to_string());
    }
    let (_, repository_name) = github_repository_parts(&credential.repository.full_name)?;
    let expected_clone_url = format!("https://github.com/{}.git", credential.repository.full_name);
    if credential.repository.clone_url != expected_clone_url || credential.repository.id == 0 {
        return Err("서버가 반환한 GitHub 저장소 식별자가 일치하지 않습니다.".to_string());
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(&credential.expires_at)
        .map_err(|_| "GitHub 자격 증명의 만료 시간을 확인하지 못했습니다.".to_string())?;
    if expires_at <= chrono::Utc::now() + chrono::Duration::seconds(30) {
        return Err(
            "GitHub 자격 증명이 만료되었습니다. 다시 시도해 새 자격 증명을 받아 주세요."
                .to_string(),
        );
    }

    let project_root = managed_project_repository_root(
        home,
        &credential.project.organization_id,
        &credential.project.id,
    );
    fs::create_dir_all(&project_root)
        .map_err(|error| format!("Briar 관리 폴더를 만들지 못했습니다: {error}"))?;
    ensure_repository_disk_space(&project_root)?;
    let repository_path = project_root.join(repository_name);
    let credential_directory = tempfile::tempdir()
        .map_err(|error| format!("임시 Git 인증 공간을 만들지 못했습니다: {error}"))?;
    let mut reused = false;

    if repository_path.exists() {
        let root = Command::new(git)
            .args(["rev-parse", "--show-toplevel"])
            .current_dir(&repository_path)
            .output()
            .map_err(|error| format!("기존 저장소를 확인하지 못했습니다: {error}"))?;
        let remote = Command::new(git)
            .args(["remote", "get-url", "origin"])
            .current_dir(&repository_path)
            .output()
            .map_err(|error| format!("기존 저장소 origin을 확인하지 못했습니다: {error}"))?;
        let root_matches = root.status.success()
            && canonical_directory(Path::new(String::from_utf8_lossy(&root.stdout).trim()))?
                == canonical_directory(&repository_path)?;
        let remote_repository = remote
            .status
            .success()
            .then(|| github_repository_from_remote(String::from_utf8_lossy(&remote.stdout).trim()))
            .flatten();
        if !root_matches
            || remote_repository.as_deref().is_none_or(|repository| {
                !repository.eq_ignore_ascii_case(&credential.repository.full_name)
            })
        {
            return Err(format!(
                "{} 폴더에 다른 저장소가 있어 덮어쓰지 않았습니다. 폴더를 옮기거나 프로젝트 연결을 확인한 뒤 다시 시도해 주세요.",
                repository_path.display()
            ));
        }
        let marker = Command::new(git)
            .args(["config", "--local", "--get", "briar.githubRepositoryId"])
            .current_dir(&repository_path)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|value| value.trim().parse::<u64>().ok());
        if marker.is_some_and(|value| value != credential.repository.id) {
            return Err("기존 clone의 GitHub 저장소 ID가 프로젝트와 다릅니다.".to_string());
        }
        let mut verify = Command::new(git);
        verify
            .args([
                "-c",
                "credential.helper=",
                "ls-remote",
                "--exit-code",
                &expected_clone_url,
                "HEAD",
            ])
            .current_dir(&repository_path);
        with_temporary_git_credential(&mut verify, credential, credential_directory.path())?;
        let verified = verify
            .output()
            .map_err(|error| format!("기존 clone 접근 권한을 확인하지 못했습니다: {error}"))?;
        if !verified.status.success() {
            return Err("기존 clone에 대한 GitHub App 접근 권한을 확인하지 못했습니다. 권한을 갱신한 뒤 다시 시도해 주세요.".to_string());
        }
        reused = true;
    } else {
        let staging = tempfile::Builder::new()
            .prefix(".briar-clone-")
            .tempdir_in(&project_root)
            .map_err(|error| format!("임시 clone 폴더를 만들지 못했습니다: {error}"))?;
        let checkout = staging.path().join("repository");
        let mut clone = Command::new(git);
        clone
            .args([
                "-c",
                "credential.helper=",
                "-c",
                "core.hooksPath=/dev/null",
                "clone",
                "--origin",
                "origin",
                "--",
                &expected_clone_url,
            ])
            .arg(&checkout);
        with_temporary_git_credential(&mut clone, credential, credential_directory.path())?;
        let cloned = clone
            .output()
            .map_err(|error| format!("Git 저장소 clone을 시작하지 못했습니다: {error}"))?;
        if !cloned.status.success() {
            return Err("GitHub 저장소를 가져오지 못했습니다. 저장소 권한이나 토큰 만료를 확인한 뒤 다시 시도해 주세요.".to_string());
        }
        fs::rename(&checkout, &repository_path)
            .map_err(|error| format!("준비한 저장소를 관리 폴더로 옮기지 못했습니다: {error}"))?;
    }

    let set_remote = Command::new(git)
        .args(["remote", "set-url", "origin", &expected_clone_url])
        .current_dir(&repository_path)
        .output()
        .map_err(|error| format!("origin 주소를 보호된 HTTPS 주소로 바꾸지 못했습니다: {error}"))?;
    if !set_remote.status.success() {
        return Err(format!(
            "origin 주소를 보호된 HTTPS 주소로 바꾸지 못했습니다: {}",
            command_failure(&set_remote)
        ));
    }
    configure_project_git_credentials(git, &repository_path, credential.repository.id)?;
    Ok(PreparedProjectRepository {
        repository_path: path_display_string(canonical_directory(&repository_path)?)?,
        repository_id: credential.repository.id,
        repository: credential.repository.full_name.clone(),
        reused,
        completed_steps: vec![
            "git".to_string(),
            "disk".to_string(),
            "clone".to_string(),
            "verify".to_string(),
            "credential-helper".to_string(),
        ],
    })
}

#[tauri::command]
pub(super) async fn prepare_project_repository(
    app: tauri::AppHandle,
    project_id: String,
    credential: ProjectGithubCredential,
) -> Result<PreparedProjectRepository, String> {
    if project_id != credential.project.id {
        return Err("요청한 프로젝트와 GitHub 자격 증명의 프로젝트가 다릅니다.".to_string());
    }
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let git = git_binary(&home)?;
        prepare_project_repository_in(&git, &home, &credential)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Turns a project name into a folder name that is safe on every platform.
pub(super) fn project_folder_name(name: &str) -> Result<String, String> {
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
pub(super) fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("프로젝트 폴더를 열지 못했습니다: {error}"))
}

pub(super) fn path_display_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "경로를 표시할 수 없습니다.".to_string())
}

pub(super) fn init_git_repository(git: &Path, path: &Path, name: &str) -> Result<(), String> {
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

pub(super) fn create_project_workspace_in(
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
pub(super) struct CreatedProjectWorkspace {
    pub(super) repository_path: String,
    /// False when an earlier attempt already created the repository.
    pub(super) created: bool,
}

#[tauri::command]
pub(super) async fn create_project_workspace(
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

#[cfg(test)]
mod tests;
