use super::*;

pub(super) fn git_repository_root(
    runner: &dyn host::CommandRunner,
    path: &Path,
) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("선택한 폴더를 찾을 수 없습니다.".to_string());
    }
    let git = runner.resolve_binary("git")?;
    let output = runner.run(
        &host::CommandSpec::new(git)
            .args(["rev-parse", "--show-toplevel"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .working_directory(path),
    )?;
    if !output.success() {
        return Err("Git 저장소 폴더를 선택하세요.".to_string());
    }
    let root = PathBuf::from(output.stdout_trimmed());
    if !root.is_dir() {
        return Err("Git 저장소의 최상위 폴더를 찾을 수 없습니다.".to_string());
    }
    runner
        .canonicalize(&root)
        .map_err(|error| format!("Git 저장소의 최상위 폴더를 열지 못했습니다: {error}"))
}

pub(super) fn repository_remote(runner: &dyn host::CommandRunner, path: &Path) -> Option<String> {
    let git = runner.resolve_binary("git").ok()?;
    let output = runner
        .run(
            &host::CommandSpec::new(git)
                .args(["remote", "get-url", "origin"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .working_directory(path),
        )
        .ok()?;
    if !output.success() {
        return None;
    }
    let remote = output.stdout.trim();
    (!remote.is_empty()).then(|| remote.to_string())
}

pub(super) fn git_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("git", Some(cli_execution_path(home)?), home)
        .map_err(|_| "Git이 필요합니다. Git을 설치한 뒤 다시 확인하세요.".to_string())
}

pub(super) fn gh_binary(home: &Path) -> Result<PathBuf, String> {
    which::which_in("gh", Some(cli_execution_path(home)?), home)
        .map_err(|_| "GitHub CLI가 설치되지 않았습니다.".to_string())
}

pub(super) fn parse_cli_version(stdout: &[u8]) -> Option<String> {
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

pub(super) fn inspect_cli(
    binary: Result<PathBuf, String>,
    execution_path: &OsStr,
) -> OnboardingPrerequisiteStatus {
    let Ok(binary) = binary else {
        return OnboardingPrerequisiteStatus {
            installed: false,
            version: None,
            authenticated: false,
        };
    };
    let version = Command::new(&binary)
        .env("PATH", execution_path)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            parse_cli_version(&output.stdout).or_else(|| parse_cli_version(&output.stderr))
        });
    let installed = version.is_some();
    OnboardingPrerequisiteStatus {
        installed,
        version,
        authenticated: installed,
    }
}

pub(super) fn agent_browser_output(
    home: &Path,
    binary: &Path,
    arguments: &[&str],
) -> Result<std::process::Output, String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let bun = bundled_bun_binary().ok_or_else(|| {
            "앱에 포함된 agent-browser용 Bun 런타임을 찾지 못했습니다. Briar를 다시 설치하세요."
                .to_string()
        })?;
        let mut command = Command::new(bun);
        command.arg(binary);
        command
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = Command::new(binary);

    command
        .args(arguments)
        .env("PATH", cli_execution_path(home)?)
        .env("HOME", home)
        .output()
        .map_err(|error| format!("agent-browser를 실행하지 못했습니다: {error}"))
}

pub(super) fn inspect_agent_browser_cli(
    home: &Path,
    binary: Result<PathBuf, String>,
) -> OnboardingPrerequisiteStatus {
    let Ok(binary) = binary else {
        return OnboardingPrerequisiteStatus {
            installed: false,
            version: None,
            authenticated: false,
        };
    };
    let version = agent_browser_output(home, &binary, &["--version"])
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            parse_cli_version(&output.stdout).or_else(|| parse_cli_version(&output.stderr))
        });
    let installed = version.is_some();
    OnboardingPrerequisiteStatus {
        installed,
        version,
        authenticated: installed,
    }
}

pub(super) fn inspect_onboarding_prerequisites_sync(
    home: &Path,
    openrouter_configured: bool,
) -> OnboardingPrerequisites {
    let execution_path = cli_execution_path(home).unwrap_or_default();
    let mut codex = inspect_cli(agent::codex_binary(home, &execution_path), &execution_path);
    let claude_binary = agent::claude_binary(home, &execution_path);
    let mut claude = inspect_cli(claude_binary.clone(), &execution_path);
    let cursor_binary = agent::cursor_binary(home, &execution_path);
    let mut cursor = inspect_cli(cursor_binary.clone(), &execution_path);
    let mut grok = inspect_cli(agent::grok_binary(home, &execution_path), &execution_path);
    let agy_binary = agent::agy_binary(home, &execution_path);
    let mut agy = inspect_cli(agy_binary.clone(), &execution_path);
    let mut opencode = inspect_cli(
        agent::opencode_binary(home, &execution_path),
        &execution_path,
    );
    codex.authenticated = codex.installed && agent_usage::codex_locally_authenticated(home);
    claude.authenticated = claude.installed
        && claude_binary.as_deref().is_ok_and(|binary| {
            agent_usage::claude_locally_authenticated(home, binary, &execution_path)
        });
    cursor.authenticated = cursor.installed
        && cursor_binary
            .as_deref()
            .is_ok_and(|binary| agent_usage::cursor_locally_authenticated(home, binary));
    grok.authenticated = grok.installed && agent_usage::grok_locally_authenticated(home);
    agy.authenticated = agy.installed
        && agy_binary.as_deref().is_ok_and(|binary| {
            agent_usage::agy_locally_authenticated(home, binary, &execution_path)
        });
    // OpenCode delegates authentication to its configured model providers. A
    // healthy installed CLI is enough to launch; the server reports any
    // provider-specific authentication error during the request.
    opencode.authenticated = opencode.installed;
    let openrouter = OnboardingPrerequisiteStatus {
        installed: opencode.installed,
        version: opencode.version.clone(),
        authenticated: opencode.installed && openrouter_configured,
    };
    OnboardingPrerequisites {
        git: inspect_cli(git_binary(home), &execution_path),
        codex,
        claude,
        cursor,
        grok,
        agy,
        opencode,
        openrouter,
    }
}

pub(super) fn provider_model_entry(
    result: Result<Vec<AgentProviderModel>, String>,
    default_efforts: Vec<AgentProviderEffort>,
    allow_custom_models: bool,
) -> AgentProviderModelCatalogEntry {
    match result {
        Ok(models) if !models.is_empty() || allow_custom_models => AgentProviderModelCatalogEntry {
            models,
            default_efforts,
            allow_custom_models,
            error: None,
        },
        Ok(_) => AgentProviderModelCatalogEntry {
            models: Vec::new(),
            default_efforts,
            allow_custom_models,
            error: Some("CLI가 지원 모델을 반환하지 않았습니다.".to_string()),
        },
        Err(error) => AgentProviderModelCatalogEntry {
            models: Vec::new(),
            default_efforts,
            allow_custom_models,
            error: Some(error),
        },
    }
}

pub(super) fn provider_model_entry_with_fallback(
    result: Result<Vec<AgentProviderModel>, String>,
    fallback: Result<Vec<AgentProviderModel>, String>,
    default_efforts: Vec<AgentProviderEffort>,
    allow_custom_models: bool,
) -> AgentProviderModelCatalogEntry {
    match result {
        Err(error) => AgentProviderModelCatalogEntry {
            models: fallback.unwrap_or_default(),
            default_efforts,
            allow_custom_models,
            error: Some(error),
        },
        result => provider_model_entry(result, default_efforts, allow_custom_models),
    }
}

pub(super) fn parse_grok_models(output: &str) -> Vec<AgentProviderModel> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let value = line
                .strip_prefix("* ")
                .or_else(|| line.strip_prefix("- "))?
                .trim();
            let id = value.strip_suffix(" (default)").unwrap_or(value).trim();
            (!id.is_empty()).then(|| AgentProviderModel {
                id: id.to_string(),
                label: id.to_string(),
                is_default: value.ends_with(" (default)"),
                default_effort_id: None,
                efforts: Vec::new(),
            })
        })
        .take(500)
        .collect()
}

pub(super) fn parse_opencode_models_verbose(output: &str) -> Vec<AgentProviderModel> {
    let mut models = Vec::new();
    let mut lines = output.lines().peekable();
    while let Some(line) = lines.next() {
        let id = line.trim();
        if id.is_empty() || id.chars().any(char::is_whitespace) {
            continue;
        }
        if lines.peek().is_none_or(|line| line.trim() != "{") {
            continue;
        }
        let mut json = String::new();
        for line in lines.by_ref() {
            json.push_str(line);
            json.push('\n');
            if line == "}" {
                break;
            }
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else {
            continue;
        };
        let label = value
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(id);
        let efforts = value
            .get("variants")
            .and_then(serde_json::Value::as_object)
            .into_iter()
            .flat_map(|variants| variants.keys())
            .take(20)
            .map(|effort| AgentProviderEffort {
                id: effort.clone(),
                label: effort.clone(),
                description: None,
                is_default: false,
            })
            .collect();
        models.push(AgentProviderModel {
            id: id.to_string(),
            label: label.to_string(),
            is_default: false,
            default_effort_id: None,
            efforts,
        });
        if models.len() >= 500 {
            break;
        }
    }
    models
}

pub(super) fn parse_opencode_cached_models(
    contents: &str,
) -> Result<Vec<AgentProviderModel>, String> {
    let catalog: serde_json::Value = serde_json::from_str(contents)
        .map_err(|error| format!("OpenCode 모델 캐시가 올바르지 않습니다: {error}"))?;
    let models = catalog
        .get("opencode")
        .and_then(|provider| provider.get("models"))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "OpenCode 모델 캐시에 opencode.models가 없습니다.".to_string())?;
    let mut output = models
        .iter()
        .filter_map(|(key, value)| {
            if value
                .get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status != "active")
            {
                return None;
            }
            let cost = value.get("cost")?;
            if cost.get("input").and_then(serde_json::Value::as_f64) != Some(0.0)
                || cost.get("output").and_then(serde_json::Value::as_f64) != Some(0.0)
            {
                return None;
            }
            let id = value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(key)
                .trim();
            if id.is_empty() || id.len() > 200 || id.chars().any(char::is_whitespace) {
                return None;
            }
            let label = value
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(id);
            let mut efforts = Vec::new();
            for option in value
                .get("reasoning_options")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                if efforts.len() >= 20 {
                    break;
                }
                if option.get("type").and_then(serde_json::Value::as_str) != Some("effort") {
                    continue;
                }
                for effort in option
                    .get("values")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .filter(|effort| !effort.is_empty() && effort.len() <= 50)
                {
                    if efforts.len() >= 20 {
                        break;
                    }
                    if efforts
                        .iter()
                        .any(|candidate: &AgentProviderEffort| candidate.id == effort)
                    {
                        continue;
                    }
                    efforts.push(AgentProviderEffort {
                        id: effort.to_string(),
                        label: effort.to_string(),
                        description: None,
                        is_default: false,
                    });
                }
            }
            Some(AgentProviderModel {
                id: format!("opencode/{id}"),
                label: label.to_string(),
                is_default: false,
                default_effort_id: None,
                efforts,
            })
        })
        .take(500)
        .collect::<Vec<_>>();
    output.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
    Ok(output)
}

pub(super) fn opencode_cached_models(home: &Path) -> Result<Vec<AgentProviderModel>, String> {
    let cache_root = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cache"));
    let path = cache_root.join("opencode/models.json");
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("OpenCode 모델 캐시를 읽지 못했습니다: {error}"))?;
    parse_opencode_cached_models(&contents)
}

pub(super) fn parse_claude_efforts(output: &str) -> Vec<AgentProviderEffort> {
    let Some(line) = output.lines().find(|line| line.contains("--effort")) else {
        return Vec::new();
    };
    let Some(values) = line
        .rsplit_once('(')
        .and_then(|(_, rest)| rest.split_once(')').map(|(values, _)| values))
    else {
        return Vec::new();
    };
    values
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 50)
        .take(20)
        .map(|value| AgentProviderEffort {
            id: value.to_string(),
            label: value.to_string(),
            description: None,
            is_default: false,
        })
        .collect()
}

pub(super) fn parse_claude_models(output: &str) -> Vec<AgentProviderModel> {
    let mut in_model_help = false;
    let mut block = String::new();
    for line in output.lines() {
        if line.contains("--model <model>") {
            in_model_help = true;
        } else if in_model_help && line.trim_start().starts_with('-') {
            break;
        }
        if in_model_help {
            block.push_str(line);
            block.push(' ');
        }
    }
    let mut models = Vec::new();
    for (index, value) in block.split('\'').enumerate() {
        if index % 2 == 0 {
            continue;
        }
        let id = value.trim();
        if id.is_empty()
            || id.len() > 100
            || !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._-/".contains(character))
            || models
                .iter()
                .any(|model: &AgentProviderModel| model.id == id)
        {
            continue;
        }
        models.push(AgentProviderModel {
            id: id.to_string(),
            label: id.to_string(),
            is_default: false,
            default_effort_id: None,
            efforts: Vec::new(),
        });
        if models.len() >= 500 {
            break;
        }
    }
    models
}

pub(super) fn grok_cached_models(home: &Path) -> Result<Vec<AgentProviderModel>, String> {
    let path = home.join(".grok/models_cache.json");
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Grok 모델 캐시를 읽지 못했습니다: {error}"))?;
    let value: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Grok 모델 캐시가 올바르지 않습니다: {error}"))?;
    let models = value
        .get("models")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Grok 모델 캐시에 models가 없습니다.".to_string())?;
    Ok(models
        .iter()
        .filter_map(|(key, value)| {
            let info = value.get("info").unwrap_or(value);
            if info.get("hidden").and_then(serde_json::Value::as_bool) == Some(true)
                || info
                    .get("supported_in_api")
                    .and_then(serde_json::Value::as_bool)
                    == Some(false)
            {
                return None;
            }
            let id = info
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(key);
            if id.is_empty() || id.len() > 100 {
                return None;
            }
            let label = info
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(id);
            let mut efforts = info
                .get("reasoning_efforts")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|effort| {
                    let id = effort.get("id").or_else(|| effort.get("value"))?.as_str()?;
                    Some(AgentProviderEffort {
                        id: id.to_string(),
                        label: effort
                            .get("label")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or(id)
                            .to_string(),
                        description: effort
                            .get("description")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                        is_default: effort
                            .get("default")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                    })
                })
                .take(20)
                .collect::<Vec<_>>();
            let default_effort_id = info
                .get("reasoning_effort")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    efforts
                        .iter()
                        .find(|effort| effort.is_default)
                        .map(|effort| effort.id.clone())
                });
            for effort in &mut efforts {
                effort.is_default = default_effort_id.as_deref() == Some(effort.id.as_str());
            }
            Some(AgentProviderModel {
                id: id.to_string(),
                label: label.to_string(),
                is_default: false,
                default_effort_id,
                efforts,
            })
        })
        .take(500)
        .collect())
}

pub(super) fn parse_agy_models(output: &str) -> Vec<AgentProviderModel> {
    fn collect(value: &serde_json::Value, output: &mut Vec<AgentProviderModel>) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    if let Some(id) = value.as_str().map(str::trim).filter(|id| !id.is_empty()) {
                        output.push(AgentProviderModel {
                            id: id.to_string(),
                            label: id.to_string(),
                            is_default: false,
                            default_effort_id: None,
                            efforts: Vec::new(),
                        });
                    } else {
                        collect(value, output);
                    }
                }
            }
            serde_json::Value::Object(object) => {
                let id = object
                    .get("id")
                    .or_else(|| object.get("model_id"))
                    .or_else(|| object.get("modelId"))
                    .and_then(serde_json::Value::as_str);
                if let Some(id) = id.map(str::trim).filter(|id| !id.is_empty()) {
                    let label = object
                        .get("display_name")
                        .or_else(|| object.get("displayName"))
                        .or_else(|| object.get("label"))
                        .or_else(|| object.get("name"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|label| !label.is_empty())
                        .unwrap_or(id);
                    output.push(AgentProviderModel {
                        id: id.to_string(),
                        label: label.to_string(),
                        is_default: object
                            .get("is_default")
                            .or_else(|| object.get("isDefault"))
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                        default_effort_id: None,
                        efforts: Vec::new(),
                    });
                    return;
                }
                for value in object.values() {
                    collect(value, output);
                }
            }
            _ => {}
        }
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(output) else {
        return Vec::new();
    };
    let mut models = Vec::new();
    collect(&value, &mut models);
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models.truncate(500);
    models
}

pub(super) fn parse_agy_efforts(output: &str) -> Vec<AgentProviderEffort> {
    let Some(line) = output.lines().find(|line| line.contains("--effort")) else {
        return Vec::new();
    };
    let Some(values) = line
        .rsplit_once('(')
        .and_then(|(_, rest)| rest.split_once(')').map(|(values, _)| values))
    else {
        return Vec::new();
    };
    values
        .split(['|', ','])
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 50)
        .take(20)
        .map(|value| AgentProviderEffort {
            id: value.to_string(),
            label: value.to_string(),
            description: None,
            is_default: false,
        })
        .collect()
}

pub(super) fn command_agy_models(
    home: &Path,
    binary: Result<PathBuf, String>,
) -> Result<Vec<AgentProviderModel>, String> {
    let binary = binary?;
    let output = Command::new(binary)
        .args(["--output-format", "json", "models"])
        .env("PATH", cli_execution_path(home)?)
        .env("HOME", home)
        .env_remove("AGY_ADC_AUTH")
        .env_remove("GEMINI_API_KEY")
        .env_remove("GOOGLE_API_KEY")
        .env_remove("GOOGLE_APPLICATION_CREDENTIALS")
        .output()
        .map_err(|error| format!("Antigravity 지원 모델 목록을 가져오지 못했습니다: {error}"))?;
    if !output.status.success() {
        let message = [output.stderr.as_slice(), output.stdout.as_slice()]
            .into_iter()
            .map(String::from_utf8_lossy)
            .map(|value| value.trim().to_string())
            .find(|value| !value.is_empty())
            .unwrap_or_else(|| "Antigravity 지원 모델 목록 명령이 실패했습니다.".to_string());
        return Err(message);
    }
    Ok(parse_agy_models(&String::from_utf8_lossy(&output.stdout)))
}

pub(super) fn command_provider_models(
    home: &Path,
    binary: Result<PathBuf, String>,
    args: &[&str],
    parser: fn(&str) -> Vec<AgentProviderModel>,
    environment: &[(String, String)],
) -> Result<Vec<AgentProviderModel>, String> {
    let binary = binary?;
    let mut command = Command::new(binary);
    command
        .args(args)
        .env("PATH", cli_execution_path(home)?)
        .env("HOME", home);
    for (key, value) in environment {
        command.env(key, value);
    }
    let output = command
        .output()
        .map_err(|error| format!("지원 모델 목록을 가져오지 못했습니다: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "지원 모델 목록 명령이 실패했습니다.".to_string()
        } else {
            stderr
        });
    }
    Ok(parser(&String::from_utf8_lossy(&output.stdout)))
}

pub(super) fn command_help(home: &Path, binary: Result<PathBuf, String>) -> Result<String, String> {
    let output = Command::new(binary?)
        .arg("--help")
        .env("PATH", cli_execution_path(home)?)
        .env("HOME", home)
        .output()
        .map_err(|error| format!("CLI capability를 가져오지 못했습니다: {error}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(text)
}

pub(super) fn load_agent_provider_models_sync(
    home: &Path,
    config_path: &Path,
) -> AgentProviderModelCatalog {
    let execution_path = cli_execution_path(home).unwrap_or_default();
    let runner: Arc<dyn host::CommandRunner> = Arc::new(host::LocalRunner::new(
        execution_path.clone(),
        home.to_path_buf(),
    ));
    let codex = agent::codex_binary(home, &execution_path).and_then(|binary| {
        let binary = binary
            .to_str()
            .ok_or_else(|| "Codex CLI 경로가 올바르지 않습니다.".to_string())?;
        agent::codex_models(runner, binary, home).map(|models| {
            models
                .into_iter()
                .map(
                    |(id, label, is_default, default_effort_id, efforts)| AgentProviderModel {
                        id,
                        label,
                        is_default,
                        default_effort_id,
                        efforts: efforts
                            .into_iter()
                            .map(|(id, label, description, is_default)| AgentProviderEffort {
                                id,
                                label,
                                description,
                                is_default,
                            })
                            .collect(),
                    },
                )
                .collect()
        })
    });
    let claude_help = command_help(home, agent::claude_binary(home, &execution_path));
    let claude_efforts = claude_help
        .as_ref()
        .map(|output| parse_claude_efforts(output))
        .unwrap_or_default();
    let claude = claude_help.map(|output| parse_claude_models(&output));
    let grok_cli = command_provider_models(
        home,
        agent::grok_binary(home, &execution_path),
        &["models"],
        parse_grok_models,
        &[],
    );
    let agy_help = command_help(home, agent::agy_binary(home, &execution_path));
    let agy_efforts = agy_help
        .as_ref()
        .map(|output| parse_agy_efforts(output))
        .unwrap_or_default();
    let agy = command_agy_models(home, agent::agy_binary(home, &execution_path));
    let grok = grok_cached_models(home)
        .map(|mut cached| {
            if let Ok(reported) = &grok_cli {
                for model in &mut cached {
                    model.is_default = reported
                        .iter()
                        .any(|candidate| candidate.id == model.id && candidate.is_default);
                }
                for model in reported {
                    if !cached.iter().any(|candidate| candidate.id == model.id) {
                        cached.push(model.clone());
                    }
                }
            }
            cached
        })
        .or(grok_cli);
    let opencode = command_provider_models(
        home,
        agent::opencode_binary(home, &execution_path),
        &["models", "--verbose"],
        parse_opencode_models_verbose,
        &[],
    );
    let openrouter = provider_environment_from(config_path, agent::AgentProviderKind::Openrouter)
        .and_then(|environment| {
            command_provider_models(
                home,
                agent::opencode_binary(home, &execution_path),
                &["models", "--verbose"],
                parse_opencode_models_verbose,
                &environment,
            )
        })
        .map(|models| {
            models
                .into_iter()
                .filter(|model| model.id.starts_with("openrouter/"))
                .collect()
        });
    AgentProviderModelCatalog {
        codex: provider_model_entry(codex, Vec::new(), false),
        claude: provider_model_entry(claude, claude_efforts, true),
        // Cursor model ids are provider-owned and accepted by the ACP runtime.
        // Keep the selector open so users can choose one or leave the runtime
        // on Cursor's provider default.
        cursor: provider_model_entry(Ok(Vec::new()), Vec::new(), true),
        grok: provider_model_entry(grok, Vec::new(), false),
        agy: provider_model_entry(agy, agy_efforts, false),
        opencode: provider_model_entry_with_fallback(
            opencode,
            opencode_cached_models(home),
            Vec::new(),
            true,
        ),
        openrouter: provider_model_entry(openrouter, Vec::new(), true),
    }
}

pub(super) fn connected_agent_provider(
    prerequisites: &OnboardingPrerequisites,
    enabled: AppProviderSettings,
) -> Result<agent::AgentProviderKind, String> {
    [
        (agent::AgentProviderKind::Codex, &prerequisites.codex),
        (agent::AgentProviderKind::Claude, &prerequisites.claude),
        (agent::AgentProviderKind::Cursor, &prerequisites.cursor),
        (agent::AgentProviderKind::Grok, &prerequisites.grok),
        (agent::AgentProviderKind::Agy, &prerequisites.agy),
        (agent::AgentProviderKind::Opencode, &prerequisites.opencode),
        (agent::AgentProviderKind::Openrouter, &prerequisites.openrouter),
    ]
    .into_iter()
    .find_map(|(provider, status)| {
        (enabled.is_enabled(provider) && status.installed && status.authenticated)
            .then_some(provider)
    })
    .ok_or_else(|| {
        "연결된 LLM 프로바이더가 없습니다. 앱 설정에서 Codex, Claude, Cursor, Grok, Antigravity, OpenCode 또는 OpenRouter를 연결한 뒤 다시 시도하세요."
            .to_string()
    })
}

pub(super) fn provider_login_binary_and_args(
    home: &Path,
    provider: &str,
) -> Result<(PathBuf, Vec<&'static str>), String> {
    let execution_path = cli_execution_path(home)?;
    match provider {
        "codex" => Ok((agent::codex_binary(home, &execution_path)?, vec!["login"])),
        "claude" => Ok((
            agent::claude_binary(home, &execution_path)?,
            vec!["auth", "login", "--claudeai"],
        )),
        "cursor" => {
            let cursor_binary = agent::cursor_binary(home, &execution_path)?;
            let sibling = cursor_binary.with_file_name(if cfg!(target_os = "windows") {
                "agent.exe"
            } else {
                "agent"
            });
            let login_binary = sibling.is_file().then_some(sibling).or_else(|| {
                which::which_in("agent", Some(&execution_path), home).ok()
            }).ok_or_else(|| {
                "Cursor 로그인 명령을 찾지 못했습니다. Cursor CLI를 다시 설치한 뒤 `agent login`을 실행하세요."
                    .to_string()
            })?;
            Ok((login_binary, vec!["login"]))
        }
        "grok" => Ok((agent::grok_binary(home, &execution_path)?, vec!["login"])),
        "agy" => Ok((agent::agy_binary(home, &execution_path)?, vec![])),
        "opencode" => Ok((
            agent::opencode_binary(home, &execution_path)?,
            vec!["auth", "login"],
        )),
        _ => Err("지원하지 않는 Agent 프로바이더입니다.".to_string()),
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "macos")]
pub(super) fn open_provider_login_terminal(binary: &Path, args: &[&str]) -> Result<(), String> {
    let command = std::iter::once(binary.to_string_lossy().to_string())
        .chain(args.iter().map(|value| value.to_string()))
        .map(|value| shell_quote(&value))
        .collect::<Vec<_>>()
        .join(" ");
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let script =
        format!("tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell");
    Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Terminal을 열지 못했습니다: {error}"))
}

#[cfg(target_os = "windows")]
pub(super) fn open_provider_login_terminal(binary: &Path, args: &[&str]) -> Result<(), String> {
    let command = format!(
        "\"{}\" {}",
        binary.display(),
        args.iter()
            .map(|value| format!("\"{}\"", value.replace('"', "\\\"")))
            .collect::<Vec<_>>()
            .join(" ")
    );
    Command::new("cmd")
        .args(["/C", "start", "", "cmd", "/K", &command])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("명령 프롬프트를 열지 못했습니다: {error}"))
}

#[cfg(target_os = "linux")]
pub(super) fn open_provider_login_terminal(binary: &Path, args: &[&str]) -> Result<(), String> {
    let command = std::iter::once(binary.to_string_lossy().to_string())
        .chain(args.iter().map(|value| value.to_string()))
        .map(|value| shell_quote(&value))
        .collect::<Vec<_>>()
        .join(" ");
    let interactive_command = format!("{command}; exec \"${{SHELL:-/bin/sh}}\"");
    for (terminal, terminal_args) in [
        (
            "x-terminal-emulator",
            vec!["-e", "sh", "-lc", interactive_command.as_str()],
        ),
        (
            "gnome-terminal",
            vec!["--", "sh", "-lc", interactive_command.as_str()],
        ),
        (
            "konsole",
            vec!["-e", "sh", "-lc", interactive_command.as_str()],
        ),
    ] {
        if Command::new(terminal).args(terminal_args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err("사용 가능한 터미널 앱을 찾지 못했습니다.".to_string())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(super) fn open_provider_login_terminal(_binary: &Path, _args: &[&str]) -> Result<(), String> {
    Err("모바일에서는 Agent CLI 로그인을 열 수 없습니다.".to_string())
}

#[tauri::command]
pub(super) async fn open_agent_provider_login(
    app: tauri::AppHandle,
    provider: String,
) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let (binary, args) = provider_login_binary_and_args(&home, &provider)?;
        open_provider_login_terminal(&binary, &args)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn inspect_onboarding_prerequisites(
    app: tauri::AppHandle,
) -> Result<OnboardingPrerequisites, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let configured = openrouter_api_key_from(&config_path)?.is_some();
        Ok(inspect_onboarding_prerequisites_sync(&home, configured))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn load_agent_provider_models(
    app: tauri::AppHandle,
) -> Result<AgentProviderModelCatalog, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        load_agent_provider_models_sync(&home, &config_path)
    })
    .await
    .map_err(|error| error.to_string())
}

pub(super) const BRIAR_CLI_PATH_BLOCK_START: &str = "# >>> Briar CLI path >>>";
pub(super) const BRIAR_CLI_PATH_BLOCK_END: &str = "# <<< Briar CLI path <<<";

#[derive(Clone, Copy)]
pub(super) enum ShellConfigKind {
    Posix,
    Fish,
}

pub(super) fn shell_config(
    home: &Path,
    shell: Option<&OsStr>,
) -> Option<(PathBuf, ShellConfigKind)> {
    let shell_name = shell
        .and_then(|value| Path::new(value).file_name())
        .and_then(OsStr::to_str)?;
    match shell_name {
        "zsh" => Some((home.join(".zshrc"), ShellConfigKind::Posix)),
        "bash" => Some((home.join(".bashrc"), ShellConfigKind::Posix)),
        "fish" => Some((home.join(".config/fish/config.fish"), ShellConfigKind::Fish)),
        _ => None,
    }
}

pub(super) fn home_relative_cli_directory(home: &Path, directory: &Path) -> Option<String> {
    let relative = directory.strip_prefix(home).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    Some(format!("$HOME/{}", relative.to_string_lossy()))
}

pub(super) fn shell_config_contains_cli_directory(
    contents: &str,
    home: &Path,
    directory: &Path,
) -> bool {
    let absolute = directory.to_string_lossy();
    let home_relative = home_relative_cli_directory(home, directory);
    contents.lines().any(|line| {
        let line = line.trim();
        !line.starts_with('#')
            && (line.contains(absolute.as_ref())
                || home_relative
                    .as_ref()
                    .is_some_and(|candidate| line.contains(candidate)))
    })
}

pub(super) fn cli_directory_in_process_path(directory: &Path) -> bool {
    env::var_os("PATH")
        .map(|path| env::split_paths(&path).any(|candidate| candidate == directory))
        .unwrap_or(false)
}

pub(super) fn open_code_terminal_path_status_sync(
    home: &Path,
    shell: Option<&OsStr>,
) -> Result<OpenCodeTerminalPathStatus, String> {
    let execution_path = cli_execution_path(home)?;
    let binary = agent::opencode_binary(home, &execution_path).ok();
    Ok(open_code_terminal_path_status_for_binary(
        home, shell, binary,
    ))
}

pub(super) fn open_code_terminal_path_status_for_binary(
    home: &Path,
    shell: Option<&OsStr>,
    binary: Option<PathBuf>,
) -> OpenCodeTerminalPathStatus {
    let binary_directory = binary.as_deref().and_then(Path::parent);
    let Some((config_path, _)) = shell_config(home, shell) else {
        return OpenCodeTerminalPathStatus {
            supported: false,
            configured: false,
            binary_path: binary.map(|path| path.to_string_lossy().into_owned()),
            config_path: None,
        };
    };
    let configured = binary_directory.is_some_and(|directory| {
        cli_directory_in_process_path(directory)
            || fs::read_to_string(&config_path)
                .ok()
                .is_some_and(|contents| {
                    shell_config_contains_cli_directory(&contents, home, directory)
                })
    });
    OpenCodeTerminalPathStatus {
        supported: binary_directory.is_some(),
        configured,
        binary_path: binary.map(|path| path.to_string_lossy().into_owned()),
        config_path: Some(config_path.to_string_lossy().into_owned()),
    }
}

pub(super) fn configure_open_code_terminal_path_sync(
    home: &Path,
    shell: Option<&OsStr>,
) -> Result<OpenCodeTerminalPathStatus, String> {
    let execution_path = cli_execution_path(home)?;
    let binary = agent::opencode_binary(home, &execution_path)?;
    configure_open_code_terminal_path_for_binary(home, shell, binary)
}

pub(super) fn configure_open_code_terminal_path_for_binary(
    home: &Path,
    shell: Option<&OsStr>,
    binary: PathBuf,
) -> Result<OpenCodeTerminalPathStatus, String> {
    let directory = binary
        .parent()
        .ok_or_else(|| "OpenCode 실행 경로를 확인하지 못했습니다.".to_string())?;
    let (config_path, kind) = shell_config(home, shell).ok_or_else(|| {
        "현재 로그인 shell은 자동 PATH 설정을 지원하지 않습니다. OpenCode 설치 경로를 PATH에 직접 추가하세요."
            .to_string()
    })?;
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    if !shell_config_contains_cli_directory(&existing, home, directory)
        && !existing.contains(BRIAR_CLI_PATH_BLOCK_START)
    {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("shell 설정 디렉터리를 만들지 못했습니다: {error}"))?;
        }
        let display_directory = home_relative_cli_directory(home, directory)
            .unwrap_or_else(|| directory.to_string_lossy().into_owned());
        let command = match kind {
            ShellConfigKind::Posix => format!("export PATH=\"{display_directory}:$PATH\""),
            ShellConfigKind::Fish => format!("fish_add_path \"{display_directory}\""),
        };
        let prefix = if existing.is_empty() || existing.ends_with('\n') {
            ""
        } else {
            "\n"
        };
        let block = format!(
            "{prefix}{BRIAR_CLI_PATH_BLOCK_START}\n{command}\n{BRIAR_CLI_PATH_BLOCK_END}\n"
        );
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&config_path)
            .and_then(|mut file| file.write_all(block.as_bytes()))
            .map_err(|error| format!("shell PATH 설정을 저장하지 못했습니다: {error}"))?;
    }
    Ok(OpenCodeTerminalPathStatus {
        supported: true,
        configured: true,
        binary_path: Some(binary.to_string_lossy().into_owned()),
        config_path: Some(config_path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub(super) async fn inspect_open_code_terminal_path(
    app: tauri::AppHandle,
) -> Result<OpenCodeTerminalPathStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let shell = env::var_os("SHELL");
    tauri::async_runtime::spawn_blocking(move || {
        open_code_terminal_path_status_sync(&home, shell.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn configure_open_code_terminal_path(
    app: tauri::AppHandle,
) -> Result<OpenCodeTerminalPathStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let shell = env::var_os("SHELL");
    tauri::async_runtime::spawn_blocking(move || {
        configure_open_code_terminal_path_sync(&home, shell.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn install_cli_package(home: &Path, package: &str) -> Result<(), String> {
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
            .env("HOME", home)
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

pub(super) fn install_brew_package(home: &Path, package: &str) -> Result<(), String> {
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

pub(super) fn install_grok_cli(home: &Path) -> Result<(), String> {
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

pub(super) fn install_cursor_cli(home: &Path) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let shell = which::which_in("bash", Some(&execution_path), home)
        .or_else(|_| which::which_in("sh", Some(&execution_path), home))
        .map_err(|_| "Cursor 설치에 필요한 shell을 찾지 못했습니다.".to_string())?;
    let output = Command::new(shell)
        .env("PATH", &execution_path)
        .env("HOME", home)
        .args(["-c", "curl https://cursor.com/install -fsS | bash"])
        .output()
        .map_err(|error| format!("Cursor CLI 설치 명령을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let message = [output.stderr.as_slice(), output.stdout.as_slice()]
        .into_iter()
        .map(String::from_utf8_lossy)
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(format!("Cursor CLI를 설치하지 못했습니다: {message}"))
}

pub(super) fn install_agy_cli(home: &Path) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let shell = which::which_in("bash", Some(&execution_path), home)
        .or_else(|_| which::which_in("sh", Some(&execution_path), home))
        .map_err(|_| "Antigravity 설치에 필요한 shell을 찾지 못했습니다.".to_string())?;
    let output = Command::new(shell)
        .env("PATH", &execution_path)
        .env("HOME", home)
        .args([
            "-c",
            "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        ])
        .output()
        .map_err(|error| format!("Antigravity CLI 설치 명령을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let message = [output.stderr.as_slice(), output.stdout.as_slice()]
        .into_iter()
        .map(String::from_utf8_lossy)
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(format!("Antigravity CLI를 설치하지 못했습니다: {message}"))
}

#[tauri::command]
pub(super) async fn install_onboarding_prerequisite(
    app: tauri::AppHandle,
    prerequisite: String,
) -> Result<OnboardingPrerequisites, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        match prerequisite.as_str() {
            "git" => install_brew_package(&home, "git")?,
            "codex" => install_cli_package(&home, "@openai/codex")?,
            "claude" => install_cli_package(&home, "@anthropic-ai/claude-code")?,
            "cursor" => install_cursor_cli(&home)?,
            "grok" => install_grok_cli(&home)?,
            "agy" => install_agy_cli(&home)?,
            "opencode" => install_cli_package(&home, "opencode-ai")?,
            "openrouter" => install_cli_package(&home, "opencode-ai")?,
            _ => return Err("지원하지 않는 필수 도구입니다.".to_string()),
        }
        let configured = openrouter_api_key_from(&config_path)?.is_some();
        let prerequisites = inspect_onboarding_prerequisites_sync(&home, configured);
        let installed = match prerequisite.as_str() {
            "git" => prerequisites.git.installed,
            "codex" => prerequisites.codex.installed,
            "claude" => prerequisites.claude.installed,
            "cursor" => prerequisites.cursor.installed,
            "grok" => prerequisites.grok.installed,
            "agy" => prerequisites.agy.installed,
            "opencode" => prerequisites.opencode.installed,
            "openrouter" => prerequisites.openrouter.installed,
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

pub(super) fn inspect_agent_browser_sync(home: &Path) -> AgentBrowserStatus {
    #[cfg(desktop)]
    {
        let binary = cli_execution_path(home).and_then(|execution_path| {
            which::which_in("agent-browser", Some(execution_path), home)
                .map_err(|_| "agent-browser가 설치되지 않았습니다.".to_string())
        });
        let status = inspect_agent_browser_cli(home, binary.clone());
        let browser_ready = binary
            .ok()
            .and_then(|binary| {
                agent_browser_output(home, &binary, &["doctor", "--offline", "--quick"]).ok()
            })
            .is_some_and(|output| output.status.success());
        AgentBrowserStatus {
            supported: true,
            installed: status.installed,
            browser_ready,
            version: status.version,
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = home;
        AgentBrowserStatus {
            supported: false,
            installed: false,
            browser_ready: false,
            version: None,
        }
    }
}

#[tauri::command]
pub(super) async fn inspect_agent_browser(
    app: tauri::AppHandle,
) -> Result<AgentBrowserStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || inspect_agent_browser_sync(&home))
        .await
        .map_err(|error| error.to_string())
}

pub(super) fn inspect_ego_browser_sync(home: &Path) -> EgoBrowserStatus {
    #[cfg(target_os = "macos")]
    {
        let installed = Path::new("/Applications/ego lite.app").is_dir()
            || home.join("Applications/ego lite.app").is_dir();
        let execution_path = cli_execution_path(home).unwrap_or_default();
        let cli = inspect_cli(
            which::which_in("ego-browser", Some(&execution_path), home)
                .map_err(|_| "ego-browser가 설치되지 않았습니다.".to_string()),
            &execution_path,
        );
        EgoBrowserStatus {
            supported: true,
            installed,
            browser_ready: installed && cli.installed,
            version: cli.version,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        EgoBrowserStatus {
            supported: false,
            installed: false,
            browser_ready: false,
            version: None,
        }
    }
}

#[tauri::command]
pub(super) async fn inspect_ego_browser(app: tauri::AppHandle) -> Result<EgoBrowserStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || inspect_ego_browser_sync(&home))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn aside_supported() -> bool {
    Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .split('.')
                .next()?
                .parse::<u32>()
                .ok()
        })
        .is_some_and(|major| major >= 15)
}

#[cfg(target_os = "macos")]
pub(super) fn aside_installed(home: &Path) -> bool {
    [
        PathBuf::from("/Applications/Aside.app"),
        PathBuf::from("/Applications/Aside Browser.app"),
        home.join("Applications/Aside.app"),
        home.join("Applications/Aside Browser.app"),
    ]
    .iter()
    .any(|path| path.is_dir())
}

#[cfg(target_os = "macos")]
pub(super) fn aside_browser_skill_ready(home: &Path) -> bool {
    [
        home.join(".codex/skills/browser/SKILL.md"),
        home.join(".claude/skills/browser/SKILL.md"),
        home.join(".cursor/skills/browser/SKILL.md"),
        home.join(".grok/skills/browser/SKILL.md"),
        home.join(".gemini/config/skills/browser/SKILL.md"),
        home.join(".config/opencode/skills/browser/SKILL.md"),
    ]
    .iter()
    .all(|path| path.is_file())
}

#[cfg(target_os = "macos")]
pub(super) fn aside_output(
    home: &Path,
    binary: &Path,
    arguments: &[&str],
) -> Option<std::process::Output> {
    Command::new(binary)
        .args(arguments)
        .env("PATH", cli_execution_path(home).ok()?)
        .env("HOME", home)
        .output()
        .ok()
}

pub(super) fn inspect_aside_browser_sync(home: &Path) -> AsideBrowserStatus {
    #[cfg(target_os = "macos")]
    {
        let supported = aside_supported();
        let installed = aside_installed(home);
        let binary = cli_execution_path(home)
            .ok()
            .and_then(|execution_path| which::which_in("aside", Some(execution_path), home).ok());
        let version = binary.as_deref().and_then(|binary| {
            aside_output(home, binary, &["--version"])
                .filter(|output| output.status.success())
                .and_then(|output| {
                    parse_cli_version(&output.stdout).or_else(|| parse_cli_version(&output.stderr))
                })
        });
        let cli_ready = version.is_some();
        let mcp_ready = binary.as_deref().is_some_and(|binary| {
            aside_output(home, binary, &["mcp", "--help"])
                .is_some_and(|output| output.status.success())
        });
        let skill_ready = aside_browser_skill_ready(home);
        AsideBrowserStatus {
            supported,
            installed,
            cli_ready,
            mcp_ready,
            skill_ready,
            browser_ready: supported && installed && cli_ready && mcp_ready && skill_ready,
            version,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        AsideBrowserStatus {
            supported: false,
            installed: false,
            cli_ready: false,
            mcp_ready: false,
            skill_ready: false,
            browser_ready: false,
            version: None,
        }
    }
}

#[tauri::command]
pub(super) async fn inspect_aside_browser(
    app: tauri::AppHandle,
) -> Result<AsideBrowserStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || inspect_aside_browser_sync(&home))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn install_aside_cli(home: &Path) -> Result<(), String> {
    let execution_path = cli_execution_path(home)?;
    let shell = which::which_in("bash", Some(&execution_path), home)
        .or_else(|_| which::which_in("sh", Some(&execution_path), home))
        .map_err(|_| "Aside CLI 설치에 필요한 shell을 찾지 못했습니다.".to_string())?;
    let output = Command::new(shell)
        .env("PATH", &execution_path)
        .env("HOME", home)
        .args([
            "-c",
            "curl -fsSL https://releases.aside.com/install.sh | bash",
        ])
        .output()
        .map_err(|error| format!("Aside CLI 설치 명령을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = [output.stderr.as_slice(), output.stdout.as_slice()]
        .into_iter()
        .map(String::from_utf8_lossy)
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(format!("Aside CLI를 설치하지 못했습니다: {detail}"))
}

#[tauri::command]
pub(super) async fn setup_aside_browser(
    app: tauri::AppHandle,
) -> Result<AsideBrowserStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            if !aside_supported() {
                return Err("Aside는 macOS 15 이상에서만 사용할 수 있습니다.".to_string());
            }
            if !aside_installed(&home) {
                return Err("Aside를 먼저 설치하고 로그인과 온보딩을 완료해 주세요.".to_string());
            }
            install_aside_cli(&home)?;
            sync_auto_hunt_assets(&resource_directory, &home)?;
            let status = inspect_aside_browser_sync(&home);
            if !status.browser_ready {
                return Err(format!(
                    "Aside 설정 후 재확인에 실패했습니다. CLI: {}, MCP: {}, Skill: {}",
                    status.cli_ready, status.mcp_ready, status.skill_ready
                ));
            }
            Ok(status)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (home, resource_directory);
            Err("Aside는 macOS 15 이상에서만 사용할 수 있습니다.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn install_agent_browser(
    app: tauri::AppHandle,
) -> Result<AgentBrowserStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(desktop)]
        {
            install_cli_package(&home, "agent-browser")?;
            let execution_path = cli_execution_path(&home)?;
            let binary = which::which_in("agent-browser", Some(&execution_path), &home)
                .map_err(|_| {
                    "설치는 완료됐지만 agent-browser를 찾지 못했습니다. Briar를 다시 열어 주세요."
                        .to_string()
                })?;
            let output = agent_browser_output(&home, &binary, &["install"]).map_err(|error| {
                format!("agent-browser용 Chrome 설치를 시작하지 못했습니다: {error}")
            })?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let detail = [stderr.trim(), stdout.trim()]
                    .into_iter()
                    .find(|part| !part.is_empty())
                    .unwrap_or("unknown error");
                return Err(format!(
                    "agent-browser용 Chrome을 설치하지 못했습니다: {detail}"
                ));
            }
            let status = inspect_agent_browser_sync(&home);
            if !status.installed || !status.browser_ready {
                return Err(
                    "설치는 완료됐지만 agent-browser 브라우저 런타임을 확인하지 못했습니다. Briar를 다시 열어 주세요."
                        .to_string(),
                );
            }
            Ok(status)
        }
        #[cfg(not(desktop))]
        {
            let _ = home;
            Err("agent-browser는 Briar 데스크톱 앱에서만 설치할 수 있습니다.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
