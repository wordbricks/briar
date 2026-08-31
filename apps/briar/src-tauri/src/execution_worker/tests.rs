use super::*;
use crate::test_support::test_config_path;
use std::cell::RefCell;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn worker_enable_does_not_deprovision_after_registration_fails() {
    let commands = RefCell::new(Vec::<String>::new());
    let run = |arguments: &[&str]| {
        commands.borrow_mut().push(arguments[1].to_string());
        Err("register failed".to_string())
    };

    let error = enable_execution_worker(&run, "project-1", "/bun", "/briar.js")
        .expect_err("registration should fail");

    assert_eq!(error, "register failed");
    assert_eq!(commands.into_inner(), ["register"]);
}

#[test]
fn worker_enable_rolls_back_after_status_command_fails() {
    let commands = RefCell::new(Vec::<String>::new());
    let run = |arguments: &[&str]| {
        commands.borrow_mut().push(arguments[1].to_string());
        if arguments[1] == "status" {
            Err("status failed".to_string())
        } else {
            Ok("{}".to_string())
        }
    };

    let error = enable_execution_worker(&run, "project-1", "/bun", "/briar.js")
        .expect_err("status failure should roll back the Worker");

    assert!(!error.starts_with(WORKER_CLEANUP_INCOMPLETE_PREFIX));
    assert_eq!(error, "status failed");
    assert_eq!(
        commands.into_inner(),
        [
            "register",
            "install-service",
            "status",
            "uninstall-service",
            "unregister",
        ]
    );
}

#[test]
fn worker_enable_reports_when_rollback_cannot_finish() {
    let commands = RefCell::new(Vec::<String>::new());
    let run = |arguments: &[&str]| {
        commands.borrow_mut().push(arguments[1].to_string());
        match arguments[1] {
            "install-service" => Err("install failed".to_string()),
            "uninstall-service" => Err("uninstall failed".to_string()),
            _ => Ok("{}".to_string()),
        }
    };

    let error = enable_execution_worker(&run, "project-1", "/bun", "/briar.js")
        .expect_err("incomplete cleanup should fail");

    assert!(error.starts_with(WORKER_CLEANUP_INCOMPLETE_PREFIX));
    assert!(error.contains("install failed"));
    assert!(error.contains("uninstall failed"));
    assert_eq!(
        commands.into_inner(),
        ["register", "install-service", "uninstall-service"]
    );
}

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
    let runner = LocalExecutionEnvironment::discover(&home)
        .expect("local environment should resolve")
        .runner();
    let repository = git_repository_root(&runner, Path::new(env!("CARGO_MANIFEST_DIR")))
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
                github_repository_id: Some(701),
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
        .as_option_mut()
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
        .as_option_mut()
        .and_then(|auto_hunt| auto_hunt.workflow.as_option_mut())
        .expect("workflow should exist")
        .requirements = vec![
        briar_contracts::proto::briar::types::v1::WorkflowRequirement {
            id: "custom_tool".to_string(),
            label: "Custom Tool".to_string(),
            kind: "executable".to_string(),
            tool: "briar-tool-that-does-not-exist".to_string(),
            reason: "Runs repository validation.".to_string(),
            ..Default::default()
        },
    ];
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
    let project_one = "11111111-1111-4111-8111-111111111111";
    let project_two = "22222222-2222-4222-8222-222222222222";
    let config = LocalConfig {
        projects: vec![
            LocalProjectConfig {
                id: project_one.to_string(),
                repository_path: "/repo/one".to_string(),
                api_url: "https://briar.example.com".to_string(),
                agent_token: Some("briar_agent_one".to_string()),
                execution_worker: LocalExecutionWorkerConfig {
                    worker_id: "worker-1".to_string(),
                    device_id: "33333333-3333-4333-8333-333333333333".to_string(),
                    organization_id: "44444444-4444-4444-8444-444444444444".to_string(),
                    label: "Dev Mac".to_string(),
                    max_concurrent_sessions: 3,
                    token: Some("briar_worker_secret".to_string()),
                    ..Default::default()
                }
                .into(),
                ..Default::default()
            },
            LocalProjectConfig {
                id: project_two.to_string(),
                repository_path: "/repo/two".to_string(),
                api_url: "https://briar.example.com".to_string(),
                agent_token: Some("briar_agent_two".to_string()),
                ..Default::default()
            },
        ],
        ..default_local_config("https://briar.example.com")
    };
    write_cli_config(&config_path, &config).expect("config should be written");
    let contents = fs::read_to_string(&config_path).expect("config should be readable");

    let statuses = inspect_execution_workers_at(
        &config_path,
        vec![
            project_two.to_string(),
            "missing-project".to_string(),
            project_one.to_string(),
        ],
    )
    .expect("worker status should be readable");

    assert_eq!(
        statuses,
        vec![
            LocalExecutionWorkerStatus {
                project_id: project_two.to_string(),
                registered: false,
                worker_id: None,
                device_id: None,
                label: None,
                max_concurrent_sessions: None,
            },
            LocalExecutionWorkerStatus {
                project_id: project_one.to_string(),
                registered: true,
                worker_id: Some("worker-1".to_string()),
                device_id: Some("33333333-3333-4333-8333-333333333333".to_string()),
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
    let local_device = "44444444-4444-4444-8444-444444444444";
    let local_organization = "55555555-5555-4555-8555-555555555555";
    let config = LocalConfig {
        projects: [
            (
                "11111111-1111-4111-8111-111111111111",
                "/repo/one",
                "worker-1",
                local_device,
                local_organization,
                "briar_worker_secret",
            ),
            (
                "22222222-2222-4222-8222-222222222222",
                "/repo/two",
                "worker-2",
                local_device,
                local_organization,
                "briar_worker_secret",
            ),
            (
                "33333333-3333-4333-8333-333333333333",
                "/repo/three",
                "worker-3",
                "66666666-6666-4666-8666-666666666666",
                "77777777-7777-4777-8777-777777777777",
                "briar_worker_other",
            ),
        ]
        .into_iter()
        .map(
            |(id, repository_path, worker_id, device_id, organization_id, token)| {
                LocalProjectConfig {
                    id: id.to_string(),
                    repository_path: repository_path.to_string(),
                    api_url: "https://briar.example.com".to_string(),
                    agent_token: Some(format!("briar_agent_{worker_id}")),
                    execution_worker: LocalExecutionWorkerConfig {
                        worker_id: worker_id.to_string(),
                        device_id: device_id.to_string(),
                        organization_id: organization_id.to_string(),
                        label: "Dev Mac".to_string(),
                        max_concurrent_sessions: 3,
                        token: Some(token.to_string()),
                        ..Default::default()
                    }
                    .into(),
                    ..Default::default()
                }
            },
        )
        .collect(),
        ..default_local_config("https://briar.example.com")
    };
    write_cli_config(&config_path, &config).expect("config should be written");

    assert_eq!(
        current_execution_worker_device_id_at(&config_path, local_organization)
            .expect("device should resolve"),
        Some(local_device.to_string())
    );
    assert_eq!(
        current_execution_worker_device_id_at(&config_path, "missing-organization")
            .expect("an unregistered organization is valid"),
        None
    );
}
