use super::*;

#[tauri::command]
pub(super) async fn load_app_provider_settings(
    app: tauri::AppHandle,
) -> Result<AppProviderSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || app_provider_settings_from(&config_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
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
pub(super) async fn load_browser_automation_settings(
    app: tauri::AppHandle,
) -> Result<BrowserAutomationSettings, String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || browser_automation_settings_from(&config_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn load_agent_usage(
    app: tauri::AppHandle,
) -> Result<agent_usage::AgentUsageSnapshot, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_path = cli_config_path(&app)?;
    let openrouter_configured = tauri::async_runtime::spawn_blocking(move || {
        openrouter_api_key_from(&config_path).map(|api_key| api_key.is_some())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(agent_usage::load(home, openrouter_configured).await)
}

#[tauri::command]
pub(super) async fn update_app_provider_settings(
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
pub(super) async fn disconnect_local_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let config_path = cli_config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove_cli_connection(&config_path, &project_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn connect_local_project(
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
        let runner = LocalExecutionEnvironment::discover(&home)?.runner();
        let root = git_repository_root(&runner, Path::new(&repository_path))?;
        let remote = repository_remote(&runner, &root);
        auto_hunt.workflow = canonicalize_workflow(auto_hunt.workflow);
        validate_generated_workflow(&auto_hunt.workflow)?;
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
            .map(|org| inspect_velen_on(&runner, Some(org.clone())))
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
        install_auto_hunt_assets(&resource_directory, &home)?;
        let provider = connected_agent_provider(
            &inspect_onboarding_prerequisites_sync(
                &home,
                openrouter_api_key_from(&config_path)?.is_some(),
            ),
            app_provider_settings_from(&config_path)?,
        )?;
        write_cli_connection(
            &config_path,
            CliConnectionInput {
                api_url,
                project_id,
                agent_token,
                repository_path: root_string.clone(),
                repository_remote: remote,
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
