use super::*;

#[tauri::command]
pub(super) async fn connected_project_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
pub(super) async fn project_llm_chat(
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
    let cursor_runner = bundled_path(
        &resource_directory,
        "agent/cursor-runner.js",
        "dist-agent/cursor-runner.js",
    );
    let grok_runner = bundled_path(
        &resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let agy_runner = bundled_path(
        &resource_directory,
        "agent/agy-runner.js",
        "dist-agent/agy-runner.js",
    );
    let opencode_runner = bundled_path(
        &resource_directory,
        "agent/opencode-runner.js",
        "dist-agent/opencode-runner.js",
    );
    let approval_app = app.clone();
    let progress_project_id = project_id.clone();
    let progress_event_sink = request
        .progress_id
        .clone()
        .filter(|request_id| !request_id.trim().is_empty())
        .map(|request_id| {
            let progress_app = app.clone();
            Arc::new(move |provider_event: agent::AgentProviderEvent| {
                if provider_event.direction != agent::AgentEventDirection::Server {
                    return Ok(());
                }
                let Some(event) = provider_event.event else {
                    return Ok(());
                };
                let _ = progress_app.emit(
                    PROJECT_LLM_PROGRESS_EVENT,
                    ProjectLlmProgressPayload {
                        request_id: request_id.clone(),
                        project_id: progress_project_id.clone(),
                        provider: provider_event.provider,
                        event,
                    },
                );
                Ok(())
            }) as agent::AgentEventSink
        });
    tauri::async_runtime::spawn_blocking(move || {
        let (runner, connected_workspace) =
            connected_project_runtime(&config_path, &project_id, &home)?;
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
                cursor: &cursor_runner,
                grok: &grok_runner,
                agy: &agy_runner,
                opencode: &opencode_runner,
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
        let mut execution = project_chat_execution(
            full_access.unwrap_or(false),
            settings.approval_policy,
            model,
            effort,
            progress_event_sink,
        );
        execution.environment = provider_environment_from(&config_path, provider)?;
        let result = agent::AgentBackend::run(
            &backend,
            &project_id,
            workspace,
            execution,
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
pub(super) async fn run_project_agent(
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
        || request.responsibility.chars().count() > MAX_AGENT_RESPONSIBILITY_CHARS
        || request.skill.trim().is_empty()
        || request.skill.chars().count() > MAX_RENDERED_AGENT_SKILL_ROSTER_CHARS
        || request.message.trim().is_empty()
        || request.message.len() > 20_000
        || request.runs.len() > 500
        || request.runs.iter().any(|run| {
            run.run_id.trim().is_empty()
                || run.run_id.len() > 128
                || run.source_key.trim().is_empty()
                || run.source_key.len() > 300
                || run.title.trim().is_empty()
                || run.title.len() > 500
                || !matches!(
                    run.status.as_str(),
                    "backlog"
                        | "queued"
                        | "running"
                        | "blocked"
                        | "failed"
                        | "completed"
                        | "cancelled"
                )
                || run.detail.as_ref().is_some_and(|value| value.len() > 4_000)
                || run
                    .result_summary
                    .as_ref()
                    .is_some_and(|value| value.len() > 4_000)
                || run.updated_at.len() > 100
        })
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
    let cursor_runner = bundled_path(
        &resource_directory,
        "agent/cursor-runner.js",
        "dist-agent/cursor-runner.js",
    );
    let grok_runner = bundled_path(
        &resource_directory,
        "agent/grok-runner.js",
        "dist-agent/grok-runner.js",
    );
    let agy_runner = bundled_path(
        &resource_directory,
        "agent/agy-runner.js",
        "dist-agent/agy-runner.js",
    );
    let opencode_runner = bundled_path(
        &resource_directory,
        "agent/opencode-runner.js",
        "dist-agent/opencode-runner.js",
    );
    let recovery_store = planned_update_recovery::PlannedUpdateRecoveryStore::new(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    )?;
    let resume_after_update = request.resume_after_update;
    if resume_after_update {
        recovery_store.begin(&project_id, &request)?;
    }
    let recovery_session_id = request.session_id.clone();
    let recovery_event_store = recovery_store.clone();
    let stored_event_sink =
        create_auto_hunt_event_sink(&app, &request.session_id, Arc::clone(&cancellation_signal))?;
    let event_sink: agent::AgentEventSink = Arc::new(move |provider_event| {
        if resume_after_update {
            if let Some(agent::AgentEvent::ConversationStarted { conversation_id }) =
                provider_event.event.as_ref()
            {
                recovery_event_store.record_conversation(&recovery_session_id, conversation_id)?;
            }
        }
        stored_event_sink(provider_event)
    });
    let approval_app = app.clone();
    let session_id = request.session_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _cancellation = cancellation;
        ensure_agent_session_running(&cancellation_signal)?;
        let (runner, connected_workspace) =
            connected_project_runtime(&config_path, &project_id, &home)?;
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
            runner.clone(),
            agent::AgentRunnerBundles {
                claude: &claude_runner,
                cursor: &cursor_runner,
                grok: &grok_runner,
                agy: &agy_runner,
                opencode: &opencode_runner,
            },
        )?;
        let model = request
            .agent_model
            .clone()
            .filter(|value| !value.trim().is_empty());
        let effort = request
            .agent_effort
            .clone()
            .or((provider == settings.provider)
                .then_some(settings.effort.clone())
                .flatten());
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
        let workspace =
            prepare_latest_project_agent_workspace(runner.as_ref(), &connected_workspace)?;
        let result = agent::run_project_agent(
            &backend,
            &project_id,
            &workspace.checkout,
            agent::ChatExecution {
                approval_policy: settings.approval_policy,
                sandbox_mode: project_agent_sandbox_mode(full_access),
                network_access: true,
                model,
                effort,
                event_sink: Some(event_sink),
                environment: provider_environment_from(&config_path, provider)?,
                workspace_write_roots: Vec::new(),
            },
            &workflow_json,
            request,
            &approve,
        );
        let cleanup =
            remove_latest_remote_workspace(runner.as_ref(), &connected_workspace, &workspace);
        match (result, cleanup) {
            (Ok(response), Ok(())) => Ok(response),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
            (Err(error), Err(cleanup_error)) => Err(format!(
                "{error} (최신 에이전트 작업공간 정리 실패: {cleanup_error})"
            )),
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    let cleanup = if resume_after_update {
        recovery_store.finish(&session_id)
    } else {
        Ok(())
    };
    match (outcome, cleanup) {
        (Ok(response), Ok(())) => Ok(response),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(error), Err(cleanup_error)) => Err(format!(
            "{error} (업데이트 복구 상태 정리 실패: {cleanup_error})"
        )),
    }
}

#[tauri::command]
pub(super) fn prepare_for_app_update(
    app: tauri::AppHandle,
    session_cancellations: tauri::State<'_, AgentSessionCancellationState>,
) -> Result<usize, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let active_session_ids = session_cancellations.active_session_ids()?;
    planned_update_recovery::PlannedUpdateRecoveryStore::new(&directory)?
        .prepare_for_update(&active_session_ids)
}

#[tauri::command]
pub(super) fn take_planned_update_agent_recoveries(
    app: tauri::AppHandle,
) -> Result<Vec<planned_update_recovery::PlannedUpdateAgentRecovery>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    planned_update_recovery::PlannedUpdateRecoveryStore::new(&directory)?.take_prepared()
}

#[tauri::command]
pub(super) fn stop_project_agent_session(
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
pub(super) fn project_worktree_root(
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
pub(super) fn project_auto_hunt_full_access(
    config_path: &Path,
    project_id: &str,
) -> Result<bool, String> {
    Ok(read_cli_config(config_path)?
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref())
        .and_then(|auto_hunt| auto_hunt.sandbox.as_ref())
        .and_then(|sandbox| sandbox.full_access)
        .unwrap_or(true))
}

pub(super) fn project_sandbox_settings_from(
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

pub(super) fn update_project_sandbox_settings_at(
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

pub(super) fn project_auto_hunt_uses_velen(
    config_path: &Path,
    project_id: &str,
) -> Result<bool, String> {
    Ok(read_cli_config(config_path)?
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.auto_hunt.as_ref())
        .and_then(|auto_hunt| auto_hunt.velen_org.as_deref())
        .is_some_and(|org| !org.trim().is_empty()))
}

pub(super) fn project_auto_hunt_workflow_json(
    config_path: &Path,
    project_id: &str,
) -> Result<String, String> {
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
    validate_generated_workflow(workflow)?;
    serde_json::to_string_pretty(&canonicalize_workflow(workflow.clone()))
        .map_err(|error| format!("프로젝트 워크플로우를 직렬화하지 못했습니다: {error}"))
}

pub(super) fn project_chat_execution(
    full_access: bool,
    approval_policy: agent::ApprovalPolicy,
    model: Option<String>,
    effort: Option<agent::ModelEffort>,
    event_sink: Option<agent::AgentEventSink>,
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
        event_sink,
        environment: Vec::new(),
        // Project chat runs in the checkout only; Auto Hunt widens this.
        workspace_write_roots: Vec::new(),
    }
}

pub(super) fn project_agent_sandbox_mode(full_access: bool) -> agent::SandboxMode {
    if full_access {
        agent::SandboxMode::DangerFullAccess
    } else {
        agent::SandboxMode::WorkspaceWrite
    }
}

#[cfg(test)]
mod tests;
