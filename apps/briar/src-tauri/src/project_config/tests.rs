use super::*;
use crate::test_support::{
    config_with_cli_owned_settings, config_with_worktree_settings, test_config_path,
    TEST_PROJECT_ID,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn selects_an_issue_worktree_by_recorded_branch() {
    let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111
";

    assert_eq!(
        select_issue_worktree(
            output,
            "11111111-2222-3333-4444-555555555555",
            Some("briar/fix-login-11111111"),
        )
        .expect("recorded branch should resolve"),
        PathBuf::from("/worktrees/fix-login-11111111")
    );
}

#[test]
fn recovers_an_issue_worktree_from_the_run_token_without_a_recorded_branch() {
    let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111-2
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111-2
";

    assert_eq!(
        select_issue_worktree(output, "11111111-2222-3333-4444-555555555555", None,)
            .expect("run token should resolve"),
        PathBuf::from("/worktrees/fix-login-11111111-2")
    );
}

#[test]
fn refuses_to_fall_back_when_the_issue_worktree_is_missing_or_ambiguous() {
    let missing = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main
";
    assert!(select_issue_worktree(missing, "11111111-2222-3333-4444-555555555555", None,).is_err());

    let ambiguous = "\
worktree /worktrees/first-11111111
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/briar/first-11111111

worktree /worktrees/second-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/second-11111111
";
    assert!(
        select_issue_worktree(ambiguous, "11111111-2222-3333-4444-555555555555", None,).is_err()
    );
}

#[test]
fn deserializes_the_issue_context_workspace_mode() {
    assert!(matches!(
        serde_json::from_str::<ProjectWorkspaceMode>("\"issueContext\"")
            .expect("issue context mode should deserialize"),
        ProjectWorkspaceMode::IssueContext
    ));
}

#[test]
fn parses_the_remote_default_branch_from_ls_remote() {
    assert_eq!(
        remote_head_branch(
            "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n"
        ),
        Some("main")
    );
    assert_eq!(
        remote_head_branch("0123456789abcdef0123456789abcdef01234567\tHEAD\n"),
        None
    );
}

#[test]
fn project_agent_uses_and_removes_the_latest_remote_checkout() {
    let Ok(git) = which::which("git") else {
        return;
    };
    let root = tempfile::tempdir().expect("temporary repository root");
    let remote = root.path().join("remote.git");
    let publisher = root.path().join("publisher");
    let connected = root.path().join("connected");

    let run = |cwd: &Path, args: &[&str]| {
        let output = Command::new(&git)
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    fs::create_dir_all(&publisher).expect("publisher directory");
    run(&publisher, &["init", "-b", "main"]);
    run(&publisher, &["config", "user.name", "Briar Test"]);
    run(
        &publisher,
        &["config", "user.email", "briar-test@example.com"],
    );
    fs::write(publisher.join("version.txt"), "old\n").expect("old version");
    run(&publisher, &["add", "version.txt"]);
    run(&publisher, &["commit", "-m", "old version"]);

    let init_remote = Command::new(&git)
        .args(["init", "--bare", "-b", "main"])
        .arg(&remote)
        .output()
        .expect("bare remote");
    assert!(
        init_remote.status.success(),
        "{}",
        String::from_utf8_lossy(&init_remote.stderr)
    );
    run(
        &publisher,
        &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
    );
    run(&publisher, &["push", "-u", "origin", "main"]);

    let clone = Command::new(&git)
        .arg("clone")
        .arg(&remote)
        .arg(&connected)
        .output()
        .expect("connected clone");
    assert!(
        clone.status.success(),
        "{}",
        String::from_utf8_lossy(&clone.stderr)
    );
    fs::write(publisher.join("version.txt"), "latest\n").expect("latest version");
    run(&publisher, &["add", "version.txt"]);
    run(&publisher, &["commit", "-m", "latest version"]);
    let latest_sha = run(&publisher, &["rev-parse", "HEAD"]);
    run(&publisher, &["push", "origin", "main"]);

    assert_eq!(
        fs::read_to_string(connected.join("version.txt")).expect("connected version"),
        "old\n"
    );
    fs::write(
        connected.join(WORKTREE_INCLUDE_FILE),
        "# local release inputs\n.env.keys\nlocal-config\n../unsafe\n*.glob\n",
    )
    .expect("worktree includes");
    fs::write(connected.join(".env.keys"), "release-key\n").expect("release key");
    fs::create_dir_all(connected.join("local-config")).expect("local config directory");
    fs::write(connected.join("local-config/settings.json"), "{}\n").expect("local config");
    let runner = host::LocalRunner::new(
        env::var_os("PATH").unwrap_or_default(),
        root.path().to_path_buf(),
    );
    let latest = prepare_latest_project_agent_workspace(&runner, &connected)
        .expect("latest project Agent workspace");
    assert_eq!(
        fs::read_to_string(latest.checkout.join("version.txt")).expect("analysis version"),
        "latest\n"
    );
    assert_eq!(run(&latest.checkout, &["rev-parse", "HEAD"]), latest_sha);
    assert_eq!(
        fs::read_to_string(latest.checkout.join(".env.keys")).expect("copied release key"),
        "release-key\n"
    );
    assert_eq!(
        fs::read_to_string(latest.checkout.join("local-config/settings.json"))
            .expect("copied local config"),
        "{}\n"
    );
    assert!(!latest.checkout.join("unsafe").exists());

    remove_latest_remote_workspace(&runner, &connected, &latest).expect("cleanup");
    assert!(!latest.root.exists());
}

#[test]
fn workflow_analysis_uses_the_connected_checkout_without_an_origin() {
    let Ok(git) = which::which("git") else {
        return;
    };
    let repository = tempfile::tempdir().expect("temporary repository");
    let init = Command::new(&git)
        .arg("-C")
        .arg(repository.path())
        .args(["init", "-b", "main"])
        .output()
        .expect("git init");
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );
    let runner = host::LocalRunner::new(
        env::var_os("PATH").unwrap_or_default(),
        repository.path().to_path_buf(),
    );

    assert!(prepare_latest_remote_workspace(&runner, repository.path())
        .expect("connected fallback")
        .is_none());
    let error = match prepare_latest_project_agent_workspace(&runner, repository.path()) {
        Ok(_) => panic!("project Agent execution requires origin"),
        Err(error) => error,
    };
    assert!(error.contains("origin"));
}

#[test]
fn writes_cli_connection_without_losing_non_auth_config() {
    let config_path = test_config_path("connect");
    let existing_project_id = "22222222-2222-4222-8222-222222222222";
    let new_project_id = "33333333-3333-4333-8333-333333333333";
    let config = LocalConfig {
        user_token: Some("existing-user-token".to_string()),
        projects: vec![LocalProjectConfig {
            id: existing_project_id.to_string(),
            repository_path: "/existing/repository".to_string(),
            api_url: "https://old.example.com".to_string(),
            agent_token: Some("briar_agent_existing".to_string()),
            auto_hunt: LocalAutoHuntConfig {
                velen_org: Some("existing".to_string()),
                data_source: Some("postgres://existing".to_string()),
                linear: LocalLinearConfig {
                    enabled: true,
                    source: Some("linear://existing".to_string()),
                    team_key: Some("OLD".to_string()),
                    ..Default::default()
                }
                .into(),
                github_repository: Some("example/existing".to_string()),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        }],
        ..default_local_config("https://old.example.com")
    };
    write_cli_config(&config_path, &config).expect("test config should be written");

    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "https://briar.example.com".to_string(),
            project_id: new_project_id.to_string(),
            agent_token: "briar_agent_new".to_string(),
            repository_path: "/new/repository".to_string(),
            repository_remote: Some("git@github.com:example/repository.git".to_string()),
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("example".to_string()),
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
    .expect("connection should be saved");

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be valid json");
    assert_eq!(saved["apiUrl"], "https://briar.example.com");
    assert!(saved["userToken"].is_null());
    assert_eq!(saved["projects"].as_array().map(Vec::len), Some(2));
    assert_eq!(saved["projects"][0]["autoHunt"]["linear"]["enabled"], true);
    assert_eq!(saved["projects"][1]["apiUrl"], "https://briar.example.com");
    assert_eq!(saved["projects"][1]["id"], new_project_id);
    assert_eq!(saved["projects"][1]["repositoryPath"], "/new/repository");
    assert_eq!(
        saved["projects"][1]["llm"]["approvalPolicy"],
        "LOCAL_APPROVAL_POLICY_NEVER"
    );
    assert!(saved["projects"][1]["autoHunt"]["linear"]["enabled"].is_null());
    assert_eq!(
        saved["projects"][1]["autoHunt"]["sandbox"]["fullAccess"],
        true
    );
    assert_eq!(
        saved["projects"][1]["autoHunt"]["workflow"]["stages"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert!(saved["projects"][1]["autoHunt"]["linearEnabled"].is_null());

    fs::remove_dir_all(config_path.parent().expect("config should have a parent"))
        .expect("test config directory should be removed");
}

#[test]
fn removes_only_the_selected_cli_connection() {
    let config_path = test_config_path("disconnect");
    let keep = "22222222-2222-4222-8222-222222222222";
    let delete = "33333333-3333-4333-8333-333333333333";
    let project = |id: &str, path: &str, token: &str| LocalProjectConfig {
        id: id.to_string(),
        repository_path: path.to_string(),
        api_url: "https://briar.example.com".to_string(),
        agent_token: Some(token.to_string()),
        ..Default::default()
    };
    let config = LocalConfig {
        projects: vec![
            project(keep, "/keep", "briar_agent_keep"),
            project(delete, "/delete", "briar_agent_delete"),
        ],
        ..default_local_config("https://briar.example.com")
    };
    write_cli_config(&config_path, &config).expect("test config should be written");

    remove_cli_connection(&config_path, delete).expect("connection should be removed");
    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be valid json");
    assert_eq!(saved["projects"].as_array().map(Vec::len), Some(1));
    assert_eq!(saved["projects"][0]["id"], keep);

    fs::remove_dir_all(config_path.parent().expect("config should have a parent"))
        .expect("test config directory should be removed");
}

#[test]
fn stores_project_settings_as_canonical_protojson() {
    let config_path = test_config_path("canonical-project-settings");
    config_with_cli_owned_settings(&config_path, None, None);

    update_app_provider_settings_at(
        &config_path,
        LocalAgentProviderSettings {
            codex: false,
            claude: true,
            cursor: true,
            grok: true,
            agy: true,
            opencode: true,
            openrouter: true,
            ..Default::default()
        },
    )
    .expect("provider settings should save");
    update_browser_automation_settings_at(
        &config_path,
        BrowserAutomationSettings {
            provider: BrowserAutomationProvider::Aside,
        },
    )
    .expect("browser automation settings should save");
    update_app_runtime_settings_at(
        &config_path,
        AppRuntimeSettingsUpdate {
            prevent_sleep_while_running: true,
        },
    )
    .expect("runtime settings should preserve browser automation settings");
    update_project_llm_settings_at(
        &config_path,
        TEST_PROJECT_ID,
        agent::ProjectLlmSettings {
            provider: agent::AgentProviderKind::Claude,
            model: Some("sonnet".to_string()),
            effort: Some(agent::ModelEffort::new("high")),
            approval_policy: agent::ApprovalPolicy::OnRequest,
        },
    )
    .expect("approval policy should save");

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert!(saved["agentProviders"]["codex"].is_null());
    assert_eq!(saved["agentProviders"]["claude"], true);
    assert_eq!(saved["appSettings"]["preventSleepWhileRunning"], true);
    assert_eq!(
        saved["appSettings"]["browserAutomationProvider"],
        "LOCAL_BROWSER_AUTOMATION_PROVIDER_ASIDE"
    );
    assert_eq!(
        saved["projects"][0]["llm"]["provider"],
        "AGENT_PROVIDER_CLAUDE"
    );
    assert_eq!(saved["projects"][0]["llm"]["model"], "sonnet");
    assert_eq!(saved["projects"][0]["llm"]["effort"], "high");
    assert_eq!(
        saved["projects"][0]["llm"]["approvalPolicy"],
        "LOCAL_APPROVAL_POLICY_ON_REQUEST"
    );

    fs::remove_dir_all(config_path.parent().expect("config should have a parent"))
        .expect("test config directory should be removed");
}

#[test]
fn initializes_provider_settings_when_local_config_is_missing() {
    let config_path = test_config_path("missing-provider-settings");

    let defaults = app_provider_settings_from(&config_path)
        .expect("missing provider settings should use defaults");
    assert!(defaults.codex);
    assert!(defaults.claude);
    assert!(defaults.cursor);
    assert!(defaults.grok);
    assert!(defaults.agy);
    assert!(defaults.opencode);
    assert!(defaults.openrouter);

    update_app_provider_settings_at(
        &config_path,
        LocalAgentProviderSettings {
            codex: true,
            claude: false,
            cursor: false,
            grok: false,
            agy: false,
            opencode: false,
            openrouter: false,
            ..Default::default()
        },
    )
    .expect("provider settings should initialize the local config");

    let saved = read_cli_config(&config_path).expect("saved config should be readable");
    let saved = saved
        .agent_providers
        .as_option()
        .expect("provider settings should exist");
    assert!(saved.codex);
    assert!(!saved.claude);
    assert!(!saved.cursor);
    assert!(!saved.grok);
    assert!(!saved.agy);
    assert!(!saved.opencode);
    assert!(!saved.openrouter);

    fs::remove_dir_all(
        config_path
            .parent()
            .expect("test config should have a parent directory"),
    )
    .expect("test config directory should be removed");
}

#[test]
fn updates_the_connected_project_workflow_locally() {
    let config_path = test_config_path("workflow-update");
    config_with_cli_owned_settings(&config_path, None, None);

    let mut workflow = repository_workflow_bootstrap();
    workflow.stages = vec![WorkflowStageConfig {
        id: "repository_qa".to_string(),
        label: "Repository QA".to_string(),
        required: true,
        evidence: vec!["diff".to_string()],
        checks: vec!["cargo test".to_string()],
    }];
    workflow.completion.required_stages = vec!["repository_qa".to_string()];
    workflow.requirements = vec![WorkflowRequirementConfig {
        id: "xcode".to_string(),
        label: "Xcode".to_string(),
        kind: WorkflowRequirementKind::Xcode,
        tool: "wrong".to_string(),
        reason: "Builds the iOS app.".to_string(),
    }];
    workflow.execution.checkpoints = vec![WorkflowCheckpointConfig {
        key: "human_review".to_string(),
        stage: "repository_qa".to_string(),
        position: WorkflowCheckpointPosition::After,
    }];

    let canonical = update_project_workflow_at(&config_path, TEST_PROJECT_ID, workflow)
        .expect("workflow should save");
    assert_eq!(canonical.requirements[0].tool, "xcodebuild");
    assert_eq!(
        canonical.execution.checkpoints[0].key,
        "project-after-repository_qa"
    );

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert_eq!(
        saved["projects"][0]["autoHunt"]["workflow"]["stages"][0]["checks"][0],
        "cargo test"
    );
    assert_eq!(
        saved["projects"][0]["autoHunt"]["workflow"]["requirements"][0]["tool"],
        "xcodebuild"
    );
    let runtime_workflow = project_auto_hunt_workflow_json(&config_path, TEST_PROJECT_ID)
        .expect("runtime workflow should load");
    assert!(runtime_workflow.contains("repository_qa"));
    assert!(runtime_workflow.contains("cargo test"));
    assert!(runtime_workflow.contains("\"checkpoints\""));
    fs::remove_dir_all(config_path.parent().expect("config should have a parent"))
        .expect("test config directory should be removed");
}

#[test]
fn canonicalizes_long_checkpoint_keys_identically_to_the_web_contract() {
    let stage_id = format!("a{}c", "b".repeat(62));
    let mut workflow = repository_workflow_bootstrap();
    workflow.stages = vec![WorkflowStageConfig {
        id: stage_id.clone(),
        label: "Long custom stage".to_string(),
        required: true,
        evidence: vec![],
        checks: vec![],
    }];
    workflow.completion.required_stages = vec![stage_id.clone()];
    workflow.execution.checkpoints = vec![WorkflowCheckpointConfig {
        key: "human-review".to_string(),
        stage: stage_id,
        position: WorkflowCheckpointPosition::After,
    }];

    let canonical = canonicalize_workflow(workflow);

    assert_eq!(
        canonical.execution.checkpoints[0].key,
        "project-after-abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-5210d1375021b160"
    );
    validate_generated_workflow(&canonical).expect("canonical key should remain valid");
}

#[test]
fn disconnecting_velen_clears_linear_settings() {
    let config_path = test_config_path("velen-disconnect");
    config_with_cli_owned_settings(&config_path, None, None);
    let mut config = read_cli_config(&config_path).expect("config should load");
    let auto_hunt = config.projects[0].auto_hunt.get_or_insert_default();
    auto_hunt.data_source = Some("postgres://wordbricks".to_string());
    auto_hunt.linear = LocalLinearConfig {
        enabled: true,
        source: Some("linear://wordbricks".to_string()),
        team_key: Some("BRIAR".to_string()),
        ..Default::default()
    }
    .into();
    write_cli_config(&config_path, &config).expect("test config should be written");

    let inspect = |_org: Option<String>| -> Result<VelenInspection, String> {
        panic!("disconnecting Velen should not inspect a source")
    };
    assert_eq!(
        update_project_velen_org_at(&config_path, TEST_PROJECT_ID, None, &inspect)
            .expect("Velen should disconnect"),
        None
    );

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert!(saved["projects"][0]["autoHunt"]["velenOrg"].is_null());
    assert!(saved["projects"][0]["autoHunt"]["dataSource"].is_null());
    assert_eq!(
        saved["projects"][0]["autoHunt"]["linear"],
        serde_json::json!({})
    );

    fs::remove_dir_all(config_path.parent().expect("config should have a parent"))
        .expect("test config directory should be removed");
}

#[test]
fn installs_cli_and_skill_assets() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-assets-test-{unique}"));
    let resources = home.join("missing-resources");
    let stale_references = home.join(".codex/skills/briar-workflow/references");
    fs::create_dir_all(&stale_references).expect("stale references should be created");
    fs::write(stale_references.join("lifecycle.md"), "stale")
        .expect("stale reference should be written");

    install_auto_hunt_assets(&resources, &home).expect("assets should install");

    assert!(home.join(".local/bin/briar").is_file());
    assert!(home.join(".local/share/briar/briar.js").is_file());
    for runner in [
        "codex-runner.js",
        "claude-runner.js",
        "cursor-runner.js",
        "grok-runner.js",
        "opencode-runner.js",
    ] {
        assert!(home.join(".local/share/briar/agent").join(runner).is_file());
    }
    assert_eq!(
        read_trimmed_file(&home.join(".local/share/briar/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert!(home.join(".codex/skills/briar-workflow/SKILL.md").is_file());
    assert!(home
        .join(".claude/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home
        .join(".cursor/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home.join(".grok/skills/briar-workflow/SKILL.md").is_file());
    assert!(home
        .join(".config/opencode/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home.join(".codex/skills/browser/SKILL.md").is_file());
    assert!(home.join(".claude/skills/browser/SKILL.md").is_file());
    assert!(home.join(".cursor/skills/browser/SKILL.md").is_file());
    assert!(home.join(".grok/skills/browser/SKILL.md").is_file());
    assert!(home
        .join(".config/opencode/skills/browser/SKILL.md")
        .is_file());
    assert!(!stale_references.exists());
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/browser/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert!(!sync_auto_hunt_assets(&resources, &home).expect("current assets should be checked"));

    fs::write(home.join(".local/share/briar/VERSION"), "0.0.0\n")
        .expect("CLI version should be made stale");
    assert!(sync_auto_hunt_assets(&resources, &home).expect("stale assets should be synchronized"));
    assert_eq!(
        read_trimmed_file(&home.join(".local/share/briar/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );

    fs::write(home.join(".codex/skills/briar-workflow/VERSION"), "0.0.0\n")
        .expect("skill version should be made stale");
    assert!(sync_auto_hunt_assets(&resources, &home).expect("stale skill should be synchronized"));
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    fs::remove_dir_all(home).expect("test home should be removed");
}

#[test]
fn stores_openrouter_credentials_locally_and_only_exposes_configuration_status() {
    let config_path = test_config_path("openrouter-credential");
    config_with_cli_owned_settings(&config_path, None, None);

    let status = update_openrouter_api_key_at(
        &config_path,
        Some("  sk-or-v1-local-test-key  ".to_string()),
    )
    .expect("credential should save");
    assert!(status.configured);

    let contents = fs::read_to_string(&config_path).expect("config should remain readable");
    assert!(contents.contains("sk-or-v1-local-test-key"));
    let environment = provider_environment_from(&config_path, agent::AgentProviderKind::Openrouter)
        .expect("OpenRouter environment should resolve");
    assert_eq!(
        environment[0],
        (
            "OPENROUTER_API_KEY".to_string(),
            "sk-or-v1-local-test-key".to_string(),
        )
    );
    assert_eq!(environment[1].0, "OPENCODE_CONFIG_CONTENT");
    assert!(!environment[1].1.contains("sk-or-v1-local-test-key"));

    let cleared =
        update_openrouter_api_key_at(&config_path, None).expect("credential should clear");
    assert!(!cleared.configured);
    assert!(
        provider_environment_from(&config_path, agent::AgentProviderKind::Openrouter,).is_err()
    );
}

#[test]
fn rejects_malformed_openrouter_credentials() {
    let config_path = test_config_path("openrouter-invalid-credential");
    config_with_cli_owned_settings(&config_path, None, None);
    assert!(
        update_openrouter_api_key_at(&config_path, Some("sk-or invalid".to_string()),).is_err()
    );
}

#[test]
fn saving_project_settings_keeps_cli_owned_worktree_settings() {
    let config_path = test_config_path("worktree-preserve");
    config_with_worktree_settings(
        &config_path,
        LocalWorktreeConfig {
            enabled: None,
            root: Some("/custom/worktrees".to_string()),
            branch_prefix: Some("hunt".to_string()),
            ..Default::default()
        },
    );
    let mut config = read_cli_config(&config_path).expect("config should load");
    config.projects[0].execution_worker = LocalExecutionWorkerConfig {
        worker_id: "worker-1".to_string(),
        device_id: "22222222-2222-4222-8222-222222222222".to_string(),
        organization_id: "33333333-3333-4333-8333-333333333333".to_string(),
        token: Some("briar_worker_test".to_string()),
        label: "Worker".to_string(),
        max_concurrent_sessions: 1,
        ..Default::default()
    }
    .into();
    write_cli_config(&config_path, &config).expect("worker binding should save");

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

    let saved_project = read_cli_config(&config_path)
        .expect("config should reload")
        .projects
        .into_iter()
        .find(|project| project.id == TEST_PROJECT_ID)
        .expect("project should survive the app-side save");
    assert_eq!(
        saved_project
            .execution_worker
            .as_option()
            .expect("worker should survive")
            .worker_id,
        "worker-1"
    );
    let worktrees = saved_project
        .auto_hunt
        .into_option()
        .and_then(|auto_hunt| auto_hunt.worktrees.into_option())
        .expect("worktree settings should survive an app-side save");
    assert_eq!(worktrees.root.as_deref(), Some("/custom/worktrees"));
    assert_eq!(worktrees.branch_prefix.as_deref(), Some("hunt"));
}

#[test]
fn resolves_a_workspace_root_through_a_runner() {
    let runner = host::LocalRunner::new(
        std::env::var_os("PATH").unwrap_or_default(),
        std::env::temp_dir(),
    );
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repository root should exist");
    let resolved = resolve_workspace_with(&runner, repository).expect("git root should resolve");
    assert_eq!(
        resolved,
        fs::canonicalize(repository).expect("repository should canonicalize")
    );

    let not_a_repository = std::env::temp_dir();
    assert!(resolve_workspace_with(&runner, &not_a_repository).is_err());
}
