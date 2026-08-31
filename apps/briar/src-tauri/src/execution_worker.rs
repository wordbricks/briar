use super::*;

const WORKER_CLEANUP_INCOMPLETE_PREFIX: &str = "BRIAR_WORKER_CLEANUP_INCOMPLETE: ";

fn cleanup_enabled_worker(
    run: &impl Fn(&[&str]) -> Result<String, String>,
    project_id: &str,
) -> Result<(), String> {
    run(&["worker", "uninstall-service", "--project", project_id])?;
    run(&[
        "worker",
        "unregister",
        "--project",
        project_id,
        "--lifecycle-reason",
        "managed-deprovision",
    ])?;
    Ok(())
}

fn rollback_enabled_worker_failure(
    run: &impl Fn(&[&str]) -> Result<String, String>,
    project_id: &str,
    cause: String,
) -> String {
    match cleanup_enabled_worker(run, project_id) {
        Ok(()) => cause,
        Err(cleanup) => {
            format!("{WORKER_CLEANUP_INCOMPLETE_PREFIX}{cause} (Worker 정리 실패: {cleanup})")
        }
    }
}

fn enable_execution_worker(
    run: &impl Fn(&[&str]) -> Result<String, String>,
    project_id: &str,
    bun_path: &str,
    cli_path: &str,
) -> Result<(), String> {
    // A failed registration has not produced a local binding that can be
    // unregistered reliably. Cleanup begins only after the CLI confirms that
    // registration completed.
    run(&["worker", "register", "--project", project_id])?;
    run(&[
        "worker",
        "install-service",
        "--project",
        project_id,
        "--runtime-binary",
        bun_path,
        "--cli-script",
        cli_path,
    ])
    .map_err(|cause| rollback_enabled_worker_failure(run, project_id, cause))?;
    run(&["worker", "status", "--project", project_id])
        .map_err(|cause| rollback_enabled_worker_failure(run, project_id, cause))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn configure_execution_worker(
    app: AppHandle,
    project_id: String,
    user_token: String,
    enabled: bool,
) -> Result<(), String> {
    if project_id.trim().is_empty() || user_token.trim().is_empty() {
        return Err("프로젝트와 로그인 정보가 필요합니다.".to_string());
    }
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    sync_auto_hunt_assets_and_restart_workers(
        &resource_directory,
        &home,
        ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
    )?;
    let bun = bundled_bun_binary()
        .ok_or_else(|| "Briar에 포함된 Bun runtime을 찾지 못했습니다.".to_string())?;
    let cli = home.join(".local/share/briar/briar.js");
    let bun_path = bun
        .to_str()
        .ok_or_else(|| "Briar Bun runtime 경로가 올바르지 않습니다.".to_string())?;
    let cli_path = cli
        .to_str()
        .ok_or_else(|| "Briar CLI 경로가 올바르지 않습니다.".to_string())?;

    let run = |arguments: &[&str]| -> Result<String, String> {
        let output = Command::new(&bun)
            .arg(&cli)
            .args(arguments)
            .env("BRIAR_USER_TOKEN", &user_token)
            .env("PATH", cli_execution_path(&home)?)
            .output()
            .map_err(|error| format!("Worker 설정 명령을 시작하지 못했습니다: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                detail
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    };

    if enabled {
        return enable_execution_worker(&run, &project_id, bun_path, cli_path);
    }

    run(&["worker", "uninstall-service", "--project", &project_id])?;
    run(&["worker", "unregister", "--project", &project_id])?;

    run(&["worker", "status", "--project", &project_id])?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn inspect_execution_workers(
    app: AppHandle,
    project_ids: Vec<String>,
) -> Result<Vec<LocalExecutionWorkerStatus>, String> {
    inspect_execution_workers_at(&cli_config_path(&app)?, project_ids)
}

#[tauri::command]
#[specta::specta]
pub(super) fn current_execution_worker_device_id(
    app: AppHandle,
    organization_id: String,
) -> Result<Option<String>, String> {
    current_execution_worker_device_id_at(&cli_config_path(&app)?, &organization_id)
}

#[tauri::command]
#[specta::specta]
pub(super) fn sync_execution_worker_labels(app: AppHandle) -> Result<(), String> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    sync_auto_hunt_assets_and_restart_workers(
        &resource_directory,
        &home,
        ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
    )?;
    let bun = bundled_bun_binary()
        .ok_or_else(|| "Briar에 포함된 Bun runtime을 찾지 못했습니다.".to_string())?;
    let cli = home.join(".local/share/briar/briar.js");
    let output = Command::new(&bun)
        .arg(&cli)
        .args(["worker", "sync-label"])
        .env("PATH", cli_execution_path(&home)?)
        .output()
        .map_err(|error| format!("Worker 이름 동기화를 시작하지 못했습니다: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn refresh_execution_worker_runtime(app: AppHandle) -> Result<bool, String> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    sync_auto_hunt_assets_and_restart_workers(
        &resource_directory,
        &home,
        ExecutionWorkerRestartPolicy::Always,
    )
}

pub(super) fn inspect_execution_workers_at(
    config_path: &Path,
    project_ids: Vec<String>,
) -> Result<Vec<LocalExecutionWorkerStatus>, String> {
    // Settings-page inspection must stay read-only: synchronizing CLI assets
    // here can disturb a running background Worker and change its readiness.
    let config = read_cli_config(config_path)?;
    let projects = config
        .projects
        .into_iter()
        .map(|project| (project.id.clone(), project))
        .collect::<BTreeMap<_, _>>();
    project_ids
        .into_iter()
        .filter(|project_id| !project_id.trim().is_empty())
        .filter_map(|project_id| {
            projects
                .get(&project_id)
                .map(|project| (project_id, project))
        })
        .map(|(project_id, project)| {
            let worker = project.execution_worker.as_option();
            Ok(LocalExecutionWorkerStatus {
                project_id,
                registered: worker.is_some(),
                worker_id: worker.map(|worker| worker.worker_id.clone()),
                device_id: worker.map(|worker| worker.device_id.clone()),
                label: worker.map(|worker| worker.label.clone()),
                max_concurrent_sessions: worker.map(|worker| worker.max_concurrent_sessions),
            })
        })
        .collect()
}

pub(super) fn current_execution_worker_device_id_at(
    config_path: &Path,
    organization_id: &str,
) -> Result<Option<String>, String> {
    let config = read_cli_config(config_path)?;
    let mut device_ids = config
        .projects
        .iter()
        .filter_map(|project| project.execution_worker.as_option())
        .filter(|worker| worker.organization_id == organization_id)
        .map(|worker| worker.device_id.clone())
        .collect::<BTreeSet<_>>();
    if device_ids.len() > 1 {
        return Err("같은 조직의 로컬 Worker device ID가 서로 다릅니다.".to_string());
    }
    Ok(device_ids.pop_first())
}

pub(super) fn sync_auto_hunt_assets(
    resource_directory: &Path,
    home: &Path,
) -> Result<bool, String> {
    if auto_hunt_assets_are_current(resource_directory, home) {
        return Ok(false);
    }
    install_auto_hunt_assets(resource_directory, home)?;
    Ok(true)
}

pub(super) fn should_manage_installed_auto_hunt_assets() -> bool {
    !cfg!(debug_assertions) && !cfg!(dev)
}

#[derive(Clone, Copy)]
pub(super) enum ExecutionWorkerRestartPolicy {
    WhenRuntimeIsStale,
    Always,
}

impl ExecutionWorkerRestartPolicy {
    pub(super) fn should_restart(
        self,
        assets_updated: bool,
        runtime_restart_is_current: bool,
    ) -> bool {
        assets_updated || !runtime_restart_is_current || matches!(self, Self::Always)
    }
}

pub(super) fn execution_worker_restart_version_path(home: &Path) -> PathBuf {
    home.join(".local/share/briar/WORKER_RUNTIME_RESTART_VERSION")
}

pub(super) fn execution_worker_restart_is_current(home: &Path) -> bool {
    read_trimmed_file(&execution_worker_restart_version_path(home)).as_deref()
        == Some(env!("CARGO_PKG_VERSION"))
}

pub(super) fn record_execution_worker_restart_version(home: &Path) -> Result<(), String> {
    fs::write(
        execution_worker_restart_version_path(home),
        format!("{}\n", env!("CARGO_PKG_VERSION")),
    )
    .map_err(|error| format!("Worker 재시작 버전을 기록하지 못했습니다: {error}"))
}

pub(super) fn sync_auto_hunt_assets_and_restart_workers(
    resource_directory: &Path,
    home: &Path,
    restart_policy: ExecutionWorkerRestartPolicy,
) -> Result<bool, String> {
    // Development apps share the production bundle identifier and home
    // directory. Letting one synchronize these global assets can restart the
    // installed Worker that is currently running the development app itself.
    if !should_manage_installed_auto_hunt_assets() {
        return Ok(false);
    }
    let updated = sync_auto_hunt_assets(resource_directory, home)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let runtime_restart_is_current = execution_worker_restart_is_current(home);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let runtime_restart_is_current = true;
    if !restart_policy.should_restart(updated, runtime_restart_is_current) {
        return Ok(false);
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if let Err(error) = restart_execution_worker_services(home) {
            // Assets and running processes have independent versions. Keep the
            // valid assets, but leave the restart marker stale so the next app
            // start retries the safe Worker service handoff.
            let _ = fs::remove_file(execution_worker_restart_version_path(home));
            return Err(error);
        }
        if let Err(error) = record_execution_worker_restart_version(home) {
            let _ = fs::remove_file(execution_worker_restart_version_path(home));
            return Err(error);
        }
    }
    Ok(updated)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn restart_execution_worker_services(home: &Path) -> Result<(), String> {
    let bun = bundled_bun_binary()
        .ok_or_else(|| "Briar에 포함된 Bun runtime을 찾지 못했습니다.".to_string())?;
    let cli = home.join(".local/share/briar/briar.js");
    let output = Command::new(&bun)
        .arg(&cli)
        .args(["worker", "restart-services"])
        .env("PATH", cli_execution_path(home)?)
        .output()
        .map_err(|error| format!("업데이트된 Worker 재시작을 시작하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

pub(super) fn read_trimmed_file_on(
    runner: &dyn host::CommandRunner,
    path: &Path,
) -> Option<String> {
    let shell = runner.resolve_binary("sh").ok()?;
    let output = runner
        .run(&host::CommandSpec::new(shell).args([
            "-c".to_string(),
            "test -f \"$1\" && cat -- \"$1\"".to_string(),
            "briar-read-file".to_string(),
            path.to_string_lossy().into_owned(),
        ]))
        .ok()?;
    output
        .success()
        .then(|| output.stdout_trimmed())
        .filter(|value| !value.is_empty())
}

pub(super) fn first_output_line(output: &host::CommandOutput) -> String {
    output
        .stdout
        .lines()
        .chain(output.stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("준비됨")
        .to_string()
}

pub(super) fn inspect_workflow_requirements(
    runner: &dyn host::CommandRunner,
    configured: &[WorkflowRequirementConfig],
) -> Vec<WorkflowRequirementHealth> {
    configured
        .iter()
        .map(|requirement| {
            let result = match requirement.kind {
                WorkflowRequirementKind::Executable => runner
                    .resolve_binary(&requirement.tool)
                    .map(|path| (true, path)),
                WorkflowRequirementKind::Xcode => runner
                    .resolve_binary("xcodebuild")
                    .and_then(|binary| {
                        runner
                            .run(&host::CommandSpec::new(binary).args(["-version"]))
                            .map_err(|error| error.to_string())
                    })
                    .map(|output| {
                        let healthy = output.success();
                        let detail = if healthy {
                            first_output_line(&output)
                        } else {
                            output.failure_message()
                        };
                        (healthy, detail)
                    }),
                WorkflowRequirementKind::IosSimulator => runner
                    .resolve_binary("xcrun")
                    .and_then(|binary| {
                        runner
                            .run(&host::CommandSpec::new(binary).args([
                                "simctl",
                                "list",
                                "devices",
                                "available",
                                "--json",
                            ]))
                            .map_err(|error| error.to_string())
                    })
                    .map(|output| {
                        if !output.success() {
                            return (false, output.failure_message());
                        }
                        let count = serde_json::from_str::<serde_json::Value>(&output.stdout)
                            .ok()
                            .and_then(|value| value.get("devices").cloned())
                            .and_then(|devices| devices.as_object().cloned())
                            .map(|devices| {
                                devices
                                    .values()
                                    .filter_map(|devices| devices.as_array())
                                    .map(Vec::len)
                                    .sum::<usize>()
                            })
                            .unwrap_or_default();
                        (
                            count > 0,
                            if count > 0 {
                                format!("사용 가능한 시뮬레이터 {count}개")
                            } else {
                                "사용 가능한 iOS 시뮬레이터가 없습니다.".to_string()
                            },
                        )
                    }),
                WorkflowRequirementKind::AndroidSdk => runner
                    .resolve_binary("adb")
                    .and_then(|binary| {
                        runner
                            .run(&host::CommandSpec::new(binary).args(["version"]))
                            .map_err(|error| error.to_string())
                    })
                    .map(|output| {
                        let healthy = output.success();
                        let detail = if healthy {
                            first_output_line(&output)
                        } else {
                            output.failure_message()
                        };
                        (healthy, detail)
                    }),
                WorkflowRequirementKind::AndroidEmulator => runner
                    .resolve_binary("emulator")
                    .and_then(|binary| {
                        runner
                            .run(&host::CommandSpec::new(binary).args(["-list-avds"]))
                            .map_err(|error| error.to_string())
                    })
                    .map(|output| {
                        if !output.success() {
                            return (false, output.failure_message());
                        }
                        let count = output
                            .stdout
                            .lines()
                            .filter(|line| !line.trim().is_empty())
                            .count();
                        (
                            count > 0,
                            if count > 0 {
                                format!("설치된 Android 가상 기기 {count}개")
                            } else {
                                "설치된 Android 가상 기기(AVD)가 없습니다.".to_string()
                            },
                        )
                    }),
            };
            let (healthy, detail) = result.unwrap_or_else(|error| (false, error));
            WorkflowRequirementHealth {
                id: requirement.id.clone(),
                label: requirement.label.clone(),
                kind: requirement.kind.clone(),
                tool: requirement.tool.clone(),
                reason: requirement.reason.clone(),
                healthy,
                detail,
            }
        })
        .collect()
}

pub(super) fn auto_hunt_health_sync(
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

pub(super) fn auto_hunt_health_sync_with(
    config_path: &Path,
    resource_directory: &Path,
    home: &Path,
    project_id: &str,
    inspect_velen: &dyn Fn(Option<String>) -> Result<VelenInspection, String>,
) -> Result<AutoHuntHealth, String> {
    let config = read_cli_config(config_path)?;
    let project = config
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "이 컴퓨터에 연결된 프로젝트가 아닙니다.".to_string())?;
    let runner = project_runner(&config, project_id, home)?;
    let execution_home = home.to_path_buf();
    let mut issues = Vec::new();

    let repository_path = Path::new(&project.repository_path);
    let repository_healthy = resolve_workspace_with(runner.as_ref(), repository_path).is_ok();
    if !repository_healthy {
        issues.push("연결된 Git 저장소 경로를 사용할 수 없습니다.".to_string());
    }

    let expected_version = env!("CARGO_PKG_VERSION").to_string();
    let cli_path = execution_home.join(".local").join("bin").join("briar");
    let cli_installed = runner.resolve_binary("briar").is_ok();
    let cli_version = read_trimmed_file(
        &execution_home
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
        "skills/briar-workflow",
        "../../skills/briar-workflow",
    );
    let skill_expected_version = read_trimmed_file(&skill_source.join("VERSION"))
        .unwrap_or_else(|| expected_version.clone());
    let llm = project
        .llm
        .as_option()
        .map(project_llm_settings_from_proto)
        .transpose()?
        .unwrap_or_default();
    let skill_directory = match llm.provider {
        agent::AgentProviderKind::Codex => ".codex",
        agent::AgentProviderKind::Claude => ".claude",
        agent::AgentProviderKind::Cursor => ".cursor",
        agent::AgentProviderKind::Grok => ".grok",
        agent::AgentProviderKind::Agy => ".gemini/config",
        agent::AgentProviderKind::Opencode | agent::AgentProviderKind::Openrouter => {
            ".config/opencode"
        }
    };
    let skill_path = execution_home
        .join(skill_directory)
        .join("skills")
        .join("briar-workflow");
    let skill_installed =
        read_trimmed_file_on(runner.as_ref(), &skill_path.join("SKILL.md")).is_some();
    let skill_version = read_trimmed_file_on(runner.as_ref(), &skill_path.join("VERSION"));
    let skill_current = skill_version.as_deref() == Some(skill_expected_version.as_str());
    if !skill_installed {
        issues.push("Briar Workflow 스킬이 설치되지 않았습니다.".to_string());
    } else if !skill_current {
        issues.push("Workflow 스킬 버전이 앱 번들과 다릅니다.".to_string());
    }

    let velen_org = project
        .auto_hunt
        .as_option()
        .and_then(|auto_hunt| auto_hunt.velen_org.clone());
    let (velen_authenticated, velen_email, velen_healthy) = if let Some(org) = velen_org.as_deref()
    {
        let inspection = inspect_velen(Some(org.to_string()));
        match inspection {
            Ok(inspection) => (inspection.authenticated, inspection.email, true),
            Err(error) => {
                issues.push(format!("Velen 연결 확인 실패: {error}"));
                (false, None, false)
            }
        }
    } else {
        (false, None, true)
    };
    let workflow = project
        .auto_hunt
        .as_option()
        .and_then(|auto_hunt| auto_hunt.workflow.as_option())
        .map(workflow_from_proto)
        .transpose()?;
    let requirements = workflow
        .as_ref()
        .map(|workflow| inspect_workflow_requirements(runner.as_ref(), &workflow.requirements))
        .unwrap_or_default();
    for requirement in requirements
        .iter()
        .filter(|requirement| !requirement.healthy)
    {
        issues.push(format!(
            "{} 준비 필요: {}",
            requirement.label, requirement.detail
        ));
    }

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
        requirements,
        issues,
    })
}

#[tauri::command]
#[specta::specta]
pub(super) async fn auto_hunt_health(
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
#[specta::specta]
pub(super) async fn repair_auto_hunt(
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

#[cfg(test)]
mod tests;
