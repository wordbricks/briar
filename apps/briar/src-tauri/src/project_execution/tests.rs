use super::*;
use crate::test_support::{
    config_with_cli_owned_settings, config_with_worktree_settings, test_config_path,
    TEST_PROJECT_ID,
};

#[test]
fn unrestricted_project_chat_bypasses_approvals_and_sandboxing() {
    let execution = project_chat_execution(
        true,
        agent::ApprovalPolicy::OnRequest,
        Some("model".to_string()),
        Some(agent::ModelEffort::new("high")),
        None,
    );

    assert_eq!(execution.approval_policy, agent::ApprovalPolicy::Never);
    assert_eq!(execution.sandbox_mode, agent::SandboxMode::DangerFullAccess);
    assert!(execution.network_access);
    assert_eq!(execution.model.as_deref(), Some("model"));
    assert_eq!(execution.effort, Some(agent::ModelEffort::new("high")));
}

#[test]
fn ordinary_project_chat_stays_read_only() {
    let execution =
        project_chat_execution(false, agent::ApprovalPolicy::OnRequest, None, None, None);

    assert_eq!(execution.approval_policy, agent::ApprovalPolicy::OnRequest);
    assert_eq!(execution.sandbox_mode, agent::SandboxMode::ReadOnly);
    assert!(!execution.network_access);
}

#[test]
fn resolves_the_configured_auto_hunt_worktree_root_per_project() {
    let config_path = test_config_path("worktree-root");
    config_with_worktree_settings(
        &config_path,
        LocalWorktreeConfig {
            enabled: None,
            root: Some("/custom/worktrees".to_string()),
            branch_prefix: None,
            ..Default::default()
        },
    );
    assert_eq!(
        project_worktree_root(&config_path, TEST_PROJECT_ID, Path::new("/Users/dev"))
            .expect("root should resolve"),
        Some(PathBuf::from("/custom/worktrees").join(TEST_PROJECT_ID))
    );
}

#[test]
fn falls_back_to_the_default_worktree_root_and_honors_opt_out() {
    let config_path = test_config_path("worktree-default");
    config_with_worktree_settings(
        &config_path,
        LocalWorktreeConfig {
            enabled: None,
            root: None,
            branch_prefix: None,
            ..Default::default()
        },
    );
    assert_eq!(
        project_worktree_root(&config_path, TEST_PROJECT_ID, Path::new("/Users/dev"))
            .expect("root should resolve"),
        Some(PathBuf::from("/Users/dev/briar/workspaces").join(TEST_PROJECT_ID))
    );

    let disabled_path = test_config_path("worktree-disabled");
    config_with_worktree_settings(
        &disabled_path,
        LocalWorktreeConfig {
            enabled: Some(false),
            root: None,
            branch_prefix: None,
            ..Default::default()
        },
    );
    // Opted out: no extra writable root is granted to the agent.
    assert_eq!(
        project_worktree_root(&disabled_path, TEST_PROJECT_ID, Path::new("/Users/dev"))
            .expect("root should resolve"),
        None
    );
}

#[test]
fn project_filesystem_access_controls_saved_agent_sandbox() {
    let config_path = test_config_path("sandbox-default");
    config_with_cli_owned_settings(&config_path, None, None);
    let full_access = project_auto_hunt_full_access(&config_path, TEST_PROJECT_ID)
        .expect("sandbox setting should resolve");
    assert!(full_access);
    assert_eq!(
        project_agent_sandbox_mode(full_access),
        agent::SandboxMode::DangerFullAccess
    );

    let sandboxed = test_config_path("sandbox-workspace-only");
    config_with_cli_owned_settings(
        &sandboxed,
        None,
        Some(LocalSandboxConfig {
            full_access: Some(false),
            ..Default::default()
        }),
    );
    let full_access = project_auto_hunt_full_access(&sandboxed, TEST_PROJECT_ID)
        .expect("sandbox setting should resolve");
    assert!(!full_access);
    assert_eq!(
        project_agent_sandbox_mode(full_access),
        agent::SandboxMode::WorkspaceWrite
    );
}

#[test]
fn app_settings_can_change_and_preserve_the_workspace_sandbox() {
    let config_path = test_config_path("sandbox-preserve");
    config_with_cli_owned_settings(
        &config_path,
        None,
        Some(LocalSandboxConfig {
            full_access: Some(false),
            ..Default::default()
        }),
    );

    assert!(
        !project_sandbox_settings_from(&config_path, TEST_PROJECT_ID)
            .expect("sandbox setting should load")
            .full_access
    );
    update_project_sandbox_settings_at(
        &config_path,
        TEST_PROJECT_ID,
        ProjectSandboxSettings { full_access: true },
    )
    .expect("sandbox setting should update");
    assert!(project_auto_hunt_full_access(&config_path, TEST_PROJECT_ID)
        .expect("updated sandbox setting should resolve"));
    update_project_sandbox_settings_at(
        &config_path,
        TEST_PROJECT_ID,
        ProjectSandboxSettings { full_access: false },
    )
    .expect("sandbox setting should update");

    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "http://127.0.0.1:8787".to_string(),
            project_id: TEST_PROJECT_ID.to_string(),
            agent_token: "briar_agent_x".to_string(),
            repository_path: "/repo".to_string(),
            repository_remote: None,
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: None,
                github_repository_id: None,
                workflow: repository_workflow_bootstrap(),
            },
        },
    )
    .expect("settings should save");

    assert!(
        !project_auto_hunt_full_access(&config_path, TEST_PROJECT_ID)
            .expect("sandbox setting should survive an app-side save")
    );
}
