use super::*;

#[tauri::command]
#[specta::specta]
pub(super) async fn load_app_provider_settings(
    app: tauri::AppHandle,
) -> Result<AppProviderSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        app_provider_settings_from(&config_path).map(AppProviderSettings::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_openrouter_credential_status(
    app: tauri::AppHandle,
) -> Result<OpenRouterCredentialStatus, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(OpenRouterCredentialStatus {
            configured: openrouter_api_key_from(&config_path)?.is_some(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn update_openrouter_api_key(
    app: tauri::AppHandle,
    api_key: Option<String>,
) -> Result<OpenRouterCredentialStatus, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_openrouter_api_key_at(&config_path, api_key)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_vertex_ai_credential_status(
    app: tauri::AppHandle,
) -> Result<VertexAiCredentialStatus, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let saved = vertex_ai_settings_from(&config_path)?;
        Ok(VertexAiCredentialStatus {
            configured: saved.is_some(),
            project_id: saved
                .as_ref()
                .map(|saved| saved.project_id.trim().to_string()),
            location: saved
                .as_ref()
                .map(|saved| saved.location.trim().to_string()),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Vertex AI stores no secret: authentication is the machine's Google
/// Application Default Credentials, and only the project and region are saved.
#[tauri::command]
#[specta::specta]
pub(super) async fn update_vertex_ai_settings(
    app: tauri::AppHandle,
    project_id: Option<String>,
    location: Option<String>,
) -> Result<VertexAiCredentialStatus, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_vertex_ai_settings_at(&config_path, project_id, location)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_app_runtime_settings(
    app: tauri::AppHandle,
) -> Result<AppRuntimeSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        app_runtime_settings_from(&config_path).map(AppRuntimeSettings::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_browser_automation_settings(
    app: tauri::AppHandle,
) -> Result<BrowserAutomationSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || browser_automation_settings_from(&config_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_agent_usage(
    app: tauri::AppHandle,
) -> Result<agent_usage::AgentUsageSnapshot, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_path = cli_config_path(&app)?;
    let configured_upstreams =
        tauri::async_runtime::spawn_blocking(move || configured_upstreams_from(&config_path))
            .await
            .map_err(|error| error.to_string())??;
    Ok(agent_usage::load(home, configured_upstreams).await)
}

#[tauri::command]
#[specta::specta]
pub(super) async fn update_app_provider_settings(
    app: tauri::AppHandle,
    settings: AppProviderSettings,
) -> Result<AppProviderSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_app_provider_settings_at(&config_path, settings.into())
            .map(AppProviderSettings::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn update_app_runtime_settings(
    app: tauri::AppHandle,
    sleep_prevention: tauri::State<'_, SleepPreventionState>,
    settings: AppRuntimeSettingsUpdate,
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
#[specta::specta]
pub(super) async fn update_browser_automation_settings(
    app: tauri::AppHandle,
    settings: BrowserAutomationSettings,
) -> Result<BrowserAutomationSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_browser_automation_settings_at(&config_path, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_project_llm_settings(
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
#[specta::specta]
pub(super) async fn update_project_llm_settings(
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
#[specta::specta]
pub(super) async fn load_project_sandbox_settings(
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
#[specta::specta]
pub(super) async fn update_project_sandbox_settings(
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
#[specta::specta]
pub(super) async fn update_local_project_workflow(
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
#[specta::specta]
pub(super) async fn update_local_project_velen_org(
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
#[specta::specta]
pub(super) async fn disconnect_local_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove_cli_connection(&config_path, &project_id))
        .await
        .map_err(|error| error.to_string())?
}

struct PreparedLocalProjectConnection {
    repository_path: String,
    repository_remote: Option<String>,
    provider: agent::AgentProviderKind,
    workflow: WorkflowConfig,
    auto_hunt: AutoHuntConfig,
}

/// Which providers this machine could run the repository analysis on, with the
/// quota probe folded in. The probe is one Briar CLI call and never fails the
/// connection: a provider whose usage cannot be read stays selectable.
fn local_project_provider_availability(
    config_path: &Path,
    home: &Path,
) -> Result<Vec<AgentProviderAvailability>, String> {
    let configured_upstreams = configured_upstreams_from(config_path)?;
    Ok(agent_provider_availability(
        &inspect_onboarding_prerequisites_sync(home, &configured_upstreams),
        app_provider_settings_from(config_path)?,
        &agent_usage::local_quotas(home, &configured_upstreams),
    ))
}

/// The provider a connection commits to: the requested one when the screen sent
/// a choice, and otherwise the first connected provider with quota left.
fn resolved_local_project_provider(
    availability: &[AgentProviderAvailability],
    requested: Option<agent::AgentProviderKind>,
) -> Result<agent::AgentProviderKind, String> {
    match requested {
        Some(requested) => requested_agent_provider(availability, requested),
        None => select_connected_agent_provider(availability),
    }
}

fn prepare_local_project_connection_on(
    runner: &dyn host::CommandRunner,
    repository_path: &Path,
    mut auto_hunt: AutoHuntConfig,
    provider: Result<agent::AgentProviderKind, String>,
) -> Result<PreparedLocalProjectConnection, String> {
    let root = git_repository_root(runner, repository_path)?;
    let repository_remote = repository_remote(runner, &root);
    auto_hunt.workflow = canonicalize_workflow(auto_hunt.workflow);
    validate_generated_workflow(&auto_hunt.workflow)?;
    let workflow = auto_hunt.workflow.clone();
    let repository_path = root
        .into_os_string()
        .into_string()
        .map_err(|_| "Git 저장소 경로를 표시할 수 없습니다.".to_string())?;
    let provider = provider?;
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
        .map(|org| inspect_velen_on(runner, Some(org.clone())))
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

    Ok(PreparedLocalProjectConnection {
        repository_path,
        repository_remote,
        provider,
        workflow,
        auto_hunt,
    })
}

#[tauri::command]
#[specta::specta]
pub(super) async fn preflight_local_project_connection(
    app: tauri::AppHandle,
    repository_path: String,
    auto_hunt: AutoHuntConfig,
) -> Result<LocalProjectConnectionPreflight, String> {
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let availability = local_project_provider_availability(&config_path, &home)?;
        let provider = resolved_local_project_provider(&availability, None);
        let prepared = prepare_local_project_connection_on(
            &runner,
            Path::new(&repository_path),
            auto_hunt,
            provider,
        )?;
        Ok(LocalProjectConnectionPreflight {
            repository_path: prepared.repository_path,
            repository_remote: prepared.repository_remote,
            provider: prepared.provider,
            providers: availability,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn connect_local_project(
    app: tauri::AppHandle,
    api_url: String,
    project_id: String,
    agent_token: String,
    repository_path: String,
    auto_hunt: AutoHuntConfig,
    provider: Option<agent::AgentProviderKind>,
) -> Result<ConnectedLocalProject, String> {
    let config_path = cli_config_path(&app)?;
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let availability = local_project_provider_availability(&config_path, &home)?;
        let resolved = resolved_local_project_provider(&availability, provider);
        let prepared = prepare_local_project_connection_on(
            &runner,
            Path::new(&repository_path),
            auto_hunt,
            resolved,
        )?;
        install_auto_hunt_assets(&resource_directory, &home)?;
        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url,
                project_id,
                agent_token,
                repository_path: prepared.repository_path.clone(),
                repository_remote: prepared.repository_remote,
            },
            LocalProjectAgentConfig {
                llm: agent::ProjectLlmSettings {
                    provider: prepared.provider,
                    ..agent::ProjectLlmSettings::default()
                },
                auto_hunt: prepared.auto_hunt,
            },
        )?;
        Ok(ConnectedLocalProject {
            repository_path: prepared.repository_path,
            workflow: prepared.workflow,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn connection_preflight_and_connect_share_authoritative_preparation() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().expect("fixture home should exist");
        let repository = home.path().join("repository");
        fs::create_dir_all(&repository).expect("fixture repository should exist");
        let profile = home.path().join(".nix-profile/bin");
        fs::create_dir_all(&profile).expect("Nix profile should exist");
        let git = profile.join("git");
        fs::write(
            &git,
            "#!/bin/sh\ncase \"$1\" in\n  rev-parse) pwd ;;\n  remote) printf 'git@github.com:example/repository.git\\n' ;;\n  *) exit 2 ;;\nesac\n",
        )
        .expect("fixture Git should be written");
        fs::set_permissions(&git, fs::Permissions::from_mode(0o700))
            .expect("fixture Git should be executable");
        let runner = LocalExecutionEnvironment::discover(home.path())
            .expect("local environment should resolve")
            .runner();
        let auto_hunt = AutoHuntConfig {
            velen_org: None,
            data_source: None,
            linear_enabled: false,
            linear_source: None,
            linear_team: None,
            github_repository: Some("example/repository".to_string()),
            github_repository_id: Some(701),
            workflow: repository_workflow_bootstrap(),
        };

        let prepared = prepare_local_project_connection_on(
            &runner,
            &repository,
            auto_hunt.clone(),
            Ok(agent::AgentProviderKind::Codex),
        )
        .expect("preparation should succeed");
        assert_eq!(prepared.provider, agent::AgentProviderKind::Codex);
        assert_eq!(
            prepared.repository_path,
            repository
                .canonicalize()
                .expect("repository should canonicalize")
                .to_string_lossy()
        );
        assert_eq!(
            prepared.repository_remote.as_deref(),
            Some("git@github.com:example/repository.git")
        );

        assert_eq!(
            prepare_local_project_connection_on(
                &runner,
                &repository,
                auto_hunt,
                Err("provider unavailable".to_string()),
            )
            .err()
            .expect("missing provider should block preparation"),
            "provider unavailable"
        );
    }

    fn availability(
        provider: agent::AgentProviderKind,
        selectable: bool,
        usage_exhausted: bool,
    ) -> AgentProviderAvailability {
        AgentProviderAvailability {
            provider,
            enabled: true,
            installed: selectable,
            authenticated: selectable,
            selectable,
            usage_exhausted,
            max_used_percent: None,
            usage_resets_at: None,
            reason: None,
        }
    }

    #[test]
    fn connects_on_the_requested_provider_and_otherwise_on_the_one_with_quota_left() {
        let entries = vec![
            availability(agent::AgentProviderKind::Codex, true, true),
            availability(agent::AgentProviderKind::Claude, true, false),
            availability(agent::AgentProviderKind::Grok, false, false),
        ];

        assert_eq!(
            resolved_local_project_provider(&entries, None)
                .expect("a provider with quota left should be chosen"),
            agent::AgentProviderKind::Claude
        );
        assert_eq!(
            resolved_local_project_provider(&entries, Some(agent::AgentProviderKind::Codex))
                .expect("the requested provider should be committed"),
            agent::AgentProviderKind::Codex
        );
        assert!(
            resolved_local_project_provider(&entries, Some(agent::AgentProviderKind::Grok))
                .is_err()
        );
    }
}
