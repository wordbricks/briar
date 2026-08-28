use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn test_config_path(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after the epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-host-test-{name}-{unique}"));
    fs::create_dir_all(&directory).expect("test directory should be created");
    directory.join("config.json")
}

/// Write a project whose auto-hunt block carries CLI-owned worktree settings.
pub(super) fn config_with_worktree_settings(config_path: &Path, worktrees: StoredWorktreeConfig) {
    config_with_cli_owned_settings(config_path, Some(worktrees), None)
}

pub(super) fn config_with_cli_owned_settings(
    config_path: &Path,
    worktrees: Option<StoredWorktreeConfig>,
    sandbox: Option<StoredSandboxConfig>,
) {
    let config = CliConfig {
        api_url: "http://127.0.0.1:8787".to_string(),
        user_token: None,
        agent_providers: StoredAppProviderSettings::default(),
        openrouter_api_key: None,
        app_settings: StoredAppRuntimeSettings::default(),
        projects: vec![CliProject {
            id: "project-1".to_string(),
            repository_path: "/repo".to_string(),
            api_url: Some("http://127.0.0.1:8787".to_string()),
            repository_remote: None,
            agent_token: "briar_agent_x".to_string(),
            llm: None,
            auto_hunt: Some(StoredAutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear: None,
                github_repository: None,
                workflow: None,
                worktrees,
                sandbox,
                extra: BTreeMap::new(),
            }),
            extra: BTreeMap::new(),
        }],
        extra: BTreeMap::new(),
    };
    write_cli_config(config_path, &config).expect("config should be written");
}
