use super::*;
use tauri_specta::Event as _;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CliClaimResponse {
    pub(super) work: Option<CliClaimedRun>,
    #[serde(default)]
    pub(super) workspace_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CliClaimedRun {
    pub(super) run_id: String,
    pub(super) run_number: u64,
    pub(super) source_key: String,
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) priority: Option<u8>,
    #[serde(default)]
    pub(super) context: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) attachments: Vec<agent::ProjectAutoHuntIssueAttachment>,
    #[serde(default)]
    pub(super) messages: Vec<agent::ProjectAutoHuntIssueMessage>,
    pub(super) workflow: serde_json::Value,
    #[serde(default)]
    pub(super) workspace: Option<CliClaimedWorkspace>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CliClaimedWorkspace {
    #[serde(rename = "type")]
    pub(super) workspace_type: String,
    pub(super) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CliRunEvidenceResponse {
    pub(super) evidence: Vec<serde_json::Value>,
}

pub(super) fn claim_auto_hunt_run(
    runner: &dyn host::CommandRunner,
    cli_environment: &agent::AutoHuntCliEnvironment,
    connected_workspace: &Path,
    run_id: &str,
) -> Result<CliClaimResponse, String> {
    let arguments = auto_hunt_claim_arguments(run_id);
    let output = cli_environment.run_briar(runner, connected_workspace, arguments)?;
    if !output.success() {
        return Err(format!(
            "로컬 런타임이 이슈 처리 작업을 claim하지 못했습니다: {}",
            output.failure_message()
        ));
    }
    serde_json::from_str(output.stdout.trim())
        .map_err(|error| format!("로컬 claim 결과를 읽지 못했습니다: {error}"))
}

#[tauri::command]
#[specta::specta]
pub(super) async fn retry_project_auto_hunt_run(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    request_id: String,
    reason: String,
) -> Result<ipc::JsonValue, String> {
    if project_id.trim().is_empty()
        || project_id.len() > 128
        || run_id.trim().is_empty()
        || run_id.len() > 128
        || request_id.trim().is_empty()
        || request_id.len() > 128
        || reason.trim().is_empty()
        || reason.len() > 2_000
    {
        return Err("이슈 처리 재시도 요청이 올바르지 않습니다.".to_string());
    }
    let config_path = cli_config_path(&app)?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = read_cli_config(&config_path)?;
        let project = config
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
        let api_url = project
            .api_url
            .as_deref()
            .unwrap_or(config.api_url.as_str())
            .to_string();
        let (runner, workspace) = connected_project_runtime(&config_path, &project_id, &home)?;
        let execution_path = cli_execution_path(&home)?;
        let include_velen = project_auto_hunt_uses_velen(&config_path, &project_id)?;
        let cli_environment = agent::AutoHuntCliEnvironment::prepare_local(
            runner.clone(),
            &home,
            &execution_path,
            &workspace,
            &project_id,
            &api_url,
            include_velen,
        )?;
        let output = cli_environment.run_briar(
            runner.as_ref(),
            &workspace,
            auto_hunt_retry_arguments(&run_id, &request_id, &reason),
        )?;
        if !output.success() {
            return Err(format!(
                "Briar CLI가 이슈 처리 재시도를 시작하지 못했습니다: {}",
                output.failure_message()
            ));
        }
        serde_json::from_str(output.stdout.trim())
            .map_err(|error| format!("Briar CLI 재시도 결과를 읽지 못했습니다: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn auto_hunt_retry_arguments(
    run_id: &str,
    request_id: &str,
    reason: &str,
) -> Vec<String> {
    vec![
        "run".to_string(),
        "retry".to_string(),
        "--run".to_string(),
        run_id.to_string(),
        "--request-id".to_string(),
        request_id.to_string(),
        "--reason".to_string(),
        reason.to_string(),
        "--actor".to_string(),
        "briar-agent-host-tool".to_string(),
    ]
}

pub(super) fn auto_hunt_claim_arguments(run_id: &str) -> Vec<String> {
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

pub(super) fn auto_hunt_worktree_maintenance_arguments(
    path: &Path,
    run_id: Option<&str>,
    completed_at: Option<&str>,
) -> Vec<String> {
    let mut arguments = vec![
        "worktree".to_string(),
        "maintain".to_string(),
        "--path".to_string(),
        path.to_string_lossy().into_owned(),
    ];
    if let (Some(run_id), Some(completed_at)) = (run_id, completed_at) {
        arguments.extend([
            "--run".to_string(),
            run_id.to_string(),
            "--completed-at".to_string(),
            completed_at.to_string(),
        ]);
    }
    arguments
}

pub(super) fn maintain_auto_hunt_worktree(
    runner: &dyn host::CommandRunner,
    cli_environment: &agent::AutoHuntCliEnvironment,
    connected_workspace: &Path,
    worktree_path: &Path,
    run_id: Option<&str>,
    completed_at: Option<&str>,
) -> Result<(), String> {
    let output = cli_environment.run_briar(
        runner,
        connected_workspace,
        auto_hunt_worktree_maintenance_arguments(worktree_path, run_id, completed_at),
    )?;
    if output.success() {
        Ok(())
    } else {
        Err(format!(
            "이슈 처리 워크트리 유지보수에 실패했습니다: {}",
            output.failure_message()
        ))
    }
}

#[cfg(all(desktop, not(dev)))]
pub(super) fn maintain_expired_auto_hunt_worktrees(
    config_path: &Path,
    home: &Path,
) -> Result<(), String> {
    let config = read_cli_config(config_path)?;
    let execution_path = cli_execution_path(home)?;
    let mut errors = Vec::new();
    for project in &config.projects {
        let project_id = project.id.clone();
        let api_url = project
            .api_url
            .as_deref()
            .unwrap_or(config.api_url.as_str())
            .to_string();
        let runtime = connected_project_runtime(config_path, &project_id, home).and_then(
            |(runner, workspace)| {
                let include_velen = project_auto_hunt_uses_velen(config_path, &project_id)?;
                let cli_environment = agent::AutoHuntCliEnvironment::prepare_local(
                    runner.clone(),
                    home,
                    &execution_path,
                    &workspace,
                    &project_id,
                    &api_url,
                    include_velen,
                )?;
                Ok((runner, workspace, cli_environment))
            },
        );
        let (runner, workspace, cli_environment) = match runtime {
            Ok(runtime) => runtime,
            Err(error) => {
                errors.push(format!("{project_id}: {error}"));
                continue;
            }
        };
        match cli_environment.run_briar(
            runner.as_ref(),
            &workspace,
            vec![
                "worktree".to_string(),
                "maintain".to_string(),
                "--all".to_string(),
            ],
        ) {
            Ok(output) if output.success() => {}
            Ok(output) => errors.push(format!("{project_id}: {}", output.failure_message())),
            Err(error) => errors.push(format!("{project_id}: {error}")),
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

pub(super) fn auto_hunt_terminal_event_arguments(
    run_id: &str,
    source_key: &str,
    status: &str,
    cause: &str,
    detail: &str,
) -> Vec<String> {
    let event_key = format!("{source_key}:{status}:{cause}");
    let (status_detail, structured_result) = if status == "blocked" {
        let reason = match cause {
            "workspace-allocation" => "Briar가 이 이슈를 처리할 별도 작업 공간을 준비하지 못해 작업을 시작할 수 없습니다. 아직 코드 변경은 시작되지 않았습니다.".to_string(),
            _ => detail.to_string(),
        };
        let technical_detail = match cause {
            "workspace-allocation" => {
                format!("이슈 전용 작업 공간 생성 단계가 실패했습니다. 원본 오류: {detail}")
            }
            _ => detail.to_string(),
        };
        let next_action = match cause {
            "workspace-allocation" => "프로젝트 저장소에 접근할 수 있는 담당자가 Worker 컴퓨터의 Briar에서 저장소 연결을 다시 확인한 뒤 이 이슈를 재시도해 주세요. 이슈가 ‘진행 중’ 상태로 바뀌면 문제가 해결된 것입니다.",
            _ => "이 문제를 담당할 수 있는 사람이 안내된 원인을 해결한 뒤 이 이슈를 재시도해 주세요. 이슈가 ‘진행 중’ 상태로 바뀌면 문제가 해결된 것입니다.",
        };
        (
            technical_detail,
            Some(
                serde_json::json!({
                    "summary": reason,
                    "outcome": "blocked",
                    "importance": "important",
                    "urgency": "normal",
                    "impact": "issue",
                    "humanActionRequired": true,
                    "nextAction": next_action,
                    "dueAt": null
                })
                .to_string(),
            ),
        )
    } else {
        (detail.to_string(), None)
    };
    let mut arguments = vec![
        "run".to_string(),
        "event".to_string(),
        "add".to_string(),
        "--run".to_string(),
        run_id.to_string(),
        "--status".to_string(),
        status.to_string(),
        "--event-key".to_string(),
        event_key,
        "--status-detail".to_string(),
        status_detail,
        "--actor".to_string(),
        "briar-auto-hunt-runtime".to_string(),
    ];
    if let Some(structured_result) = structured_result {
        arguments.extend(["--structured-result".to_string(), structured_result]);
    }
    arguments
}

pub(super) fn record_auto_hunt_terminal_event(
    runner: &dyn host::CommandRunner,
    cli_environment: &agent::AutoHuntCliEnvironment,
    workspace: &Path,
    run: &CliClaimedRun,
    status: &str,
    cause: &str,
    detail: &str,
) -> Result<(), String> {
    let arguments =
        auto_hunt_terminal_event_arguments(&run.run_id, &run.source_key, status, cause, detail);
    let output = cli_environment.run_briar(runner, workspace, arguments)?;
    if output.success() {
        Ok(())
    } else {
        Err(format!(
            "run {status} 상태를 기록하지 못했습니다: {}",
            output.failure_message()
        ))
    }
}

pub(super) struct AutoHuntEvidenceCapture<'a> {
    pub(super) runner: &'a dyn host::CommandRunner,
    pub(super) cli_environment: &'a agent::AutoHuntCliEnvironment,
    pub(super) store: &'a auto_hunt_dispatch::AutoHuntDispatchStore,
    pub(super) app: &'a tauri::AppHandle,
    pub(super) dispatch_group_id: &'a str,
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
                serde_json::from_str::<CliRunEvidenceResponse>(output.stdout.trim())
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

pub(super) fn emit_latest_auto_hunt_dispatch_event(
    app: &tauri::AppHandle,
    group: &auto_hunt_dispatch::AutoHuntDispatchGroup,
) {
    if let Some(event) = group.events.last() {
        let _ = event.emit(app);
    }
}

pub(super) fn validate_project_auto_hunt_request(
    project_id: &str,
    request: &agent::ProjectAutoHuntRequest,
) -> Result<(), String> {
    validate_auto_hunt_session_id(&request.session_id)?;
    if request.issues.is_empty() {
        return Err("대기 상태인 이슈가 없습니다.".to_string());
    }
    if request.issues.len() > agent::MAX_AUTO_HUNT_ISSUES {
        return Err(format!(
            "한 번의 이슈 처리 세션에서는 최대 {}개의 이슈만 처리할 수 있습니다.",
            agent::MAX_AUTO_HUNT_ISSUES
        ));
    }
    if request
        .issues
        .iter()
        .any(|issue| auto_hunt_run_token(&issue.run_id).is_err())
    {
        return Err("이슈 처리 대상 이슈 ID가 올바르지 않습니다.".to_string());
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
        || request.responsibility.chars().count() > MAX_AGENT_RESPONSIBILITY_CHARS
        || request.skill.trim().is_empty()
        || request.skill.chars().count() > MAX_RENDERED_AGENT_SKILL_ROSTER_CHARS
    {
        return Err("이슈 처리 에이전트 설정이 올바르지 않습니다.".to_string());
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

pub(super) fn create_auto_hunt_worker_event_sink(
    base: agent::AgentEventSink,
    store: auto_hunt_dispatch::AutoHuntDispatchStore,
    app: tauri::AppHandle,
    dispatch_group_id: String,
    worker_session_id: String,
) -> agent::AgentEventSink {
    Arc::new(move |provider_event| {
        let conversation_id = match provider_event.event.as_ref() {
            Some(agent::AgentEvent::ConversationStarted { conversation_id }) => {
                Some(conversation_id.clone())
            }
            _ => None,
        };
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
        if let Some(conversation_id) = conversation_id {
            let group = store.transition_worker(
                &dispatch_group_id,
                &worker_session_id,
                auto_hunt_dispatch::AutoHuntWorkerStatus::Running,
                None,
                Some(conversation_id),
                Some("프로바이더 대화가 시작되어 복구 지점을 저장했습니다.".to_string()),
            )?;
            emit_latest_auto_hunt_dispatch_event(&app, &group);
        }
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
#[specta::specta]
pub(super) async fn start_project_auto_hunt(
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
        return Err("이슈 처리 API URL이 올바르지 않습니다.".to_string());
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
            connected_project_runtime(&config_path, &project_id, &home)?;
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
        let effort = (provider == settings.provider)
            .then_some(settings.effort.clone())
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
            let cli_environment = agent::AutoHuntCliEnvironment::prepare_local(
                runner.clone(),
                &home,
                &execution_path,
                &workspace,
                &project_id,
                &request.api_url,
                include_velen,
            )?;
            let requested_issue = &request.issues[index];
            let claim = claim_auto_hunt_run(
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
                    "로컬 런타임이 요청한 run {} 대신 {}을 claim했습니다.",
                    requested_issue.run_id, claimed.run_id
                ));
            }
            let worker_session_id = format!("{}-w{}", request.session_id, index + 1);
            let issue = agent::ProjectAutoHuntIssue {
                run_id: claimed.run_id.clone(),
                run_number: claimed.run_number,
                source_key: claimed.source_key.clone(),
                title: claimed.title.clone(),
                issue_description: claimed.description.clone(),
                priority: claimed.priority,
                context: claimed.context.clone(),
                attachments: claimed.attachments.clone(),
                conversation: claimed.messages.clone(),
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
                    .unwrap_or("claim한 run의 전용 worktree를 반환하지 않았습니다.");
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
                return Err(
                    "로컬 런타임이 전용 worktree가 아닌 workspace를 할당했습니다.".to_string(),
                );
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
                    .title(format!("{provider_name} 이슈 처리 승인"))
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

            let mut worker_environment = cli_environment.environment().to_vec();
            worker_environment.extend(provider_environment_from(&config_path, provider)?);
            match agent::start_auto_hunt_worker(
                &backend,
                &project_id,
                &worker_workspace,
                agent::AutoHuntExecution {
                    approval_policy: settings.approval_policy,
                    model: model.clone(),
                    effort: effort.clone(),
                    event_sink: worker_event_sink,
                    environment: worker_environment,
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
                        if let Err(error) = maintain_auto_hunt_worktree(
                            runner.as_ref(),
                            &cli_environment,
                            &workspace,
                            &worker_workspace,
                            None,
                            None,
                        ) {
                            eprintln!("{error}");
                        }
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

            let completed_at = dispatch_store
                .load(&request.session_id)
                .ok()
                .flatten()
                .and_then(|group| {
                    group
                        .workers
                        .into_iter()
                        .find(|worker| worker.session_id == worker_session_id)
                })
                .filter(|worker| {
                    worker.status == auto_hunt_dispatch::AutoHuntWorkerStatus::Completed
                })
                .and_then(|worker| worker.completed_at);
            if let Err(error) = maintain_auto_hunt_worktree(
                runner.as_ref(),
                &cli_environment,
                &workspace,
                &worker_workspace,
                completed_at.as_ref().map(|_| claimed.run_id.as_str()),
                completed_at.as_deref(),
            ) {
                eprintln!("{error}");
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
                environment: provider_environment_from(&config_path, provider)?,
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
            let error = format!("이슈 처리 런타임 작업이 비정상 종료되었습니다: {join_error}");
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

pub(super) fn validate_auto_hunt_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
    {
        return Err("이슈 처리 세션 ID가 올바르지 않습니다.".to_string());
    }
    Ok(())
}

pub(super) fn auto_hunt_event_path(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<PathBuf, String> {
    validate_auto_hunt_session_id(session_id)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(AUTO_HUNT_EVENT_DIRECTORY)
        .join(format!("{session_id}.jsonl")))
}

pub(super) fn create_auto_hunt_event_sink(
    app: &tauri::AppHandle,
    session_id: &str,
    cancelled: Arc<AtomicBool>,
) -> Result<agent::AgentEventSink, String> {
    let path = auto_hunt_event_path(app, session_id)?;
    let directory = path
        .parent()
        .ok_or_else(|| "이슈 처리 이벤트 저장 경로가 올바르지 않습니다.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("이슈 처리 이벤트 저장 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("이슈 처리 이벤트 저장 폴더 권한을 지정하지 못했습니다: {error}")
        })?;
    }
    let (file, last_sequence) = open_auto_hunt_event_log(&path)?;
    let file = Arc::new(Mutex::new(file));
    let sequence = Arc::new(AtomicU64::new(last_sequence));
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
            .map_err(|error| format!("이슈 처리 이벤트를 직렬화하지 못했습니다: {error}"))?;
        {
            let mut file = file
                .lock()
                .map_err(|_| "이슈 처리 이벤트 로그 잠금이 손상되었습니다.".to_string())?;
            file.write_all(&serialized)
                .and_then(|_| file.write_all(b"\n"))
                .and_then(|_| file.flush())
                .map_err(|error| format!("이슈 처리 이벤트를 저장하지 못했습니다: {error}"))?;
        }
        let _ = record.emit(&event_app);
        Ok(())
    }))
}

pub(super) fn open_auto_hunt_event_log(path: &Path) -> Result<(fs::File, u64), String> {
    let mut options = OpenOptions::new();
    options.create(true).read(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("이슈 처리 이벤트 로그를 열지 못했습니다: {error}"))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|error| format!("이슈 처리 이벤트 로그를 읽지 못했습니다: {error}"))?;
    let last_sequence = parse_auto_hunt_event_records(&contents)?
        .into_iter()
        .map(|record| record.sequence)
        .max()
        .unwrap_or(0);
    Ok((file, last_sequence))
}

pub(super) fn parse_auto_hunt_event_records(
    contents: &str,
) -> Result<Vec<agent::AppServerEventRecord>, String> {
    contents
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str(line).map_err(|error| {
                format!(
                    "이슈 처리 이벤트 로그의 {}번째 줄이 손상되었습니다: {error}",
                    index + 1
                )
            })
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_auto_hunt_app_server_events(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Vec<agent::AppServerEventRecord>, String> {
    let path = auto_hunt_event_path(&app, &session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!("이슈 처리 이벤트 로그를 읽지 못했습니다: {error}"));
            }
        };
        parse_auto_hunt_event_records(&contents)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub(super) async fn load_auto_hunt_dispatch(
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

#[cfg(test)]
mod tests;
