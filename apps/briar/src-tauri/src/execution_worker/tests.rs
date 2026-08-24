use super::*;
use crate::test_support::test_config_path;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(debug_assertions)]
#[test]
fn development_builds_do_not_manage_installed_auto_hunt_assets() {
    assert!(!should_manage_installed_auto_hunt_assets());

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-dev-assets-test-{unique}"));
    let resources = home.join("missing-resources");

    assert!(!sync_auto_hunt_assets_and_restart_workers(
        &resources,
        &home,
        ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
    )
    .expect("development asset synchronization should be skipped"));
    assert!(!home.join(".local/share/briar").exists());
}

#[test]
fn worker_runtime_restart_policy_repairs_stale_processes() {
    assert!(ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(true, true));
    assert!(!ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(false, true));
    assert!(ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(false, false));
    assert!(ExecutionWorkerRestartPolicy::Always.should_restart(true, true));
    assert!(ExecutionWorkerRestartPolicy::Always.should_restart(false, true));
}

#[test]
fn worker_restart_version_marker_tracks_the_current_app() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-worker-restart-test-{unique}"));
    fs::create_dir_all(home.join(".local/share/briar"))
        .expect("runtime directory should be created");

    assert!(!execution_worker_restart_is_current(&home));
    record_execution_worker_restart_version(&home)
        .expect("current restart version should be recorded");
    assert!(execution_worker_restart_is_current(&home));

    fs::write(execution_worker_restart_version_path(&home), "0.0.0\n")
        .expect("restart marker should become stale");
    assert!(!execution_worker_restart_is_current(&home));

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
    let repository = git_repository_root(Path::new(env!("CARGO_MANIFEST_DIR")))
        .expect("workspace should be a git repository")
        .to_string_lossy()
        .into_owned();
    install_auto_hunt_assets(&resources, &home).expect("assets should install");
    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "https://briar.example.com".to_string(),
            project_id: "11111111-1111-4111-8111-111111111111".to_string(),
            agent_token: "briar_agent_test".to_string(),
            repository_path: repository,
            repository_remote: Some("https://github.com/wordbricks/briar.git".to_string()),
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: Some("wordbricks/briar".to_string()),
                workflow: repository_workflow_bootstrap(),
            },
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

    let mut config = read_cli_config(&config_path).expect("config should be readable");
    config.projects[0]
        .auto_hunt
        .as_mut()
        .expect("Auto Hunt settings should exist")
        .velen_org = None;
    write_cli_config(&config_path, &config).expect("optional Velen config should save");
    let no_inspect = |_: Option<String>| -> Result<VelenInspection, String> {
        panic!("unconfigured Velen should not be inspected")
    };
    let without_velen = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &no_inspect,
    )
    .expect("health without Velen should be readable");
    assert!(without_velen.healthy);
    assert!(without_velen.velen_healthy);
    assert!(without_velen.velen_org.is_none());

    let mut config = read_cli_config(&config_path).expect("config should be readable");
    config.projects[0]
        .auto_hunt
        .as_mut()
        .and_then(|auto_hunt| auto_hunt.workflow.as_mut())
        .expect("workflow should exist")
        .requirements = vec![WorkflowRequirementConfig {
        id: "custom_tool".to_string(),
        label: "Custom Tool".to_string(),
        kind: WorkflowRequirementKind::Executable,
        tool: "briar-tool-that-does-not-exist".to_string(),
        reason: "Runs repository validation.".to_string(),
    }];
    write_cli_config(&config_path, &config).expect("workflow requirement should save");
    let missing_tool = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &no_inspect,
    )
    .expect("tool requirement health should be readable");
    assert!(!missing_tool.healthy);
    assert_eq!(missing_tool.requirements.len(), 1);
    assert!(!missing_tool.requirements[0].healthy);
    assert!(missing_tool
        .issues
        .iter()
        .any(|issue| issue.contains("Custom Tool")));

    fs::remove_dir_all(home).expect("test home should be removed");
}

#[test]
fn inspects_local_workers_without_mutating_their_configuration() {
    let config_path = test_config_path("inspect-workers");
    let contents = serde_json::json!({
        "apiUrl": "https://briar.example.com",
        "projects": [
            {
                "id": "project-1",
                "repositoryPath": "/repo/one",
                "agentToken": "briar_agent_one",
                "executionWorker": {
                    "workerId": "worker-1",
                    "deviceId": "device-1",
                    "label": "Dev Mac",
                    "maxConcurrentSessions": 3,
                    "token": "briar_worker_secret"
                }
            },
            {
                "id": "project-2",
                "repositoryPath": "/repo/two",
                "agentToken": "briar_agent_two"
            }
        ]
    })
    .to_string();
    fs::write(&config_path, &contents).expect("config should be written");

    let statuses = inspect_execution_workers_at(
        &config_path,
        vec![
            "project-2".to_string(),
            "missing-project".to_string(),
            "project-1".to_string(),
        ],
    )
    .expect("worker status should be readable");

    assert_eq!(
        statuses,
        vec![
            LocalExecutionWorkerStatus {
                project_id: "project-2".to_string(),
                registered: false,
                worker_id: None,
                device_id: None,
                label: None,
                max_concurrent_sessions: None,
            },
            LocalExecutionWorkerStatus {
                project_id: "project-1".to_string(),
                registered: true,
                worker_id: Some("worker-1".to_string()),
                device_id: Some("device-1".to_string()),
                label: Some("Dev Mac".to_string()),
                max_concurrent_sessions: Some(3),
            },
        ]
    );
    assert_eq!(
        fs::read_to_string(&config_path).expect("config should remain readable"),
        contents
    );
}

#[test]
fn resolves_the_registered_worker_device_for_the_requested_organization() {
    let config_path = test_config_path("current-worker-device");
    fs::write(
        &config_path,
        serde_json::json!({
            "apiUrl": "https://briar.example.com",
            "projects": [
                {
                    "id": "project-1",
                    "repositoryPath": "/repo/one",
                    "agentToken": "briar_agent_one",
                    "executionWorker": {
                        "workerId": "worker-1",
                        "deviceId": "device-local",
                        "organizationId": "organization-1",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_secret"
                    }
                },
                {
                    "id": "project-2",
                    "repositoryPath": "/repo/two",
                    "agentToken": "briar_agent_two",
                    "executionWorker": {
                        "workerId": "worker-2",
                        "deviceId": "device-local",
                        "organizationId": "organization-1",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_secret"
                    }
                },
                {
                    "id": "project-3",
                    "repositoryPath": "/repo/three",
                    "agentToken": "briar_agent_three",
                    "executionWorker": {
                        "workerId": "worker-3",
                        "deviceId": "device-other-org",
                        "organizationId": "organization-2",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_other"
                    }
                }
            ]
        })
        .to_string(),
    )
    .expect("config should be written");

    assert_eq!(
        current_execution_worker_device_id_at(&config_path, "organization-1")
            .expect("device should resolve"),
        Some("device-local".to_string())
    );
    assert_eq!(
        current_execution_worker_device_id_at(&config_path, "missing-organization")
            .expect("an unregistered organization is valid"),
        None
    );
}
