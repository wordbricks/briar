use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const TEST_PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";

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
pub(super) fn config_with_worktree_settings(config_path: &Path, worktrees: LocalWorktreeConfig) {
    config_with_cli_owned_settings(config_path, Some(worktrees), None)
}

pub(super) fn config_with_cli_owned_settings(
    config_path: &Path,
    worktrees: Option<LocalWorktreeConfig>,
    sandbox: Option<LocalSandboxConfig>,
) {
    let config = LocalConfig {
        projects: vec![LocalProjectConfig {
            id: TEST_PROJECT_ID.to_string(),
            repository_path: "/repo".to_string(),
            api_url: "http://127.0.0.1:8787".to_string(),
            repository_remote: None,
            agent_token: Some("briar_agent_x".to_string()),
            auto_hunt: LocalAutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                worktrees: worktrees.into(),
                sandbox: sandbox.into(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        }],
        ..default_local_config("http://127.0.0.1:8787")
    };
    write_cli_config(config_path, &config).expect("config should be written");
}
