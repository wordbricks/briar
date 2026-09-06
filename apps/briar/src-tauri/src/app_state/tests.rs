use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(desktop)]
#[test]
fn exit_confirmation_allows_only_one_prompt_at_a_time() {
    let state = ExitConfirmationState::default();

    assert!(state.try_open_prompt());
    assert!(!state.try_open_prompt());

    state.close_prompt();
    assert!(state.try_open_prompt());
}

#[test]
fn stops_only_the_registered_agent_session_and_cleans_it_up() {
    let state = AgentSessionCancellationState::default();
    let registration = state.register("session-1").expect("registration");
    assert!(!registration.cancelled.load(Ordering::SeqCst));
    assert!(state.stop("session-1").expect("stop"));
    assert!(registration.cancelled.load(Ordering::SeqCst));
    assert!(!state.stop("missing-session").expect("missing"));

    assert!(state.register("session-1").is_err());
    assert!(registration.cancelled.load(Ordering::SeqCst));
    drop(registration);
    assert!(!state.stop("session-1").expect("cleaned up"));
}

#[test]
fn persists_and_clears_session_without_a_keychain() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-session-test-{unique}"));
    let session_path = directory.join(SESSION_FILE_NAME);

    assert_eq!(
        read_session_token_from(&session_path).expect("missing session should be valid"),
        None
    );
    write_session_token_to(&session_path, "persistent-session-token".to_string())
        .expect("session should be saved");
    assert_eq!(
        read_session_token_from(&session_path).expect("session should be readable"),
        Some("persistent-session-token".to_string())
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&session_path)
                .expect("session metadata should be readable")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    clear_session_token_at(&session_path).expect("session should be cleared");
    assert_eq!(
        read_session_token_from(&session_path).expect("cleared session should be valid"),
        None
    );
    fs::remove_dir_all(directory).expect("test session directory should be removed");
}

#[cfg(desktop)]
#[test]
fn desktop_login_switches_cli_account_and_api_without_changing_worker_settings() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let session_path = directory.path().join("session.json");
    let config_path = directory.path().join("cli/config.json");
    let mut config = default_local_config("https://old.briar.example.com");
    config.user_token = Some("old-cli-session".to_string());
    config.worker_device_identity = Some(format!("briar_device_{}", "a".repeat(64)));
    config.teams.push(LocalTeamConfig {
        id: "11111111-1111-4111-8111-111111111111".to_string(),
        repository_path: "/repo".to_string(),
        api_url: "https://old.briar.example.com".to_string(),
        agent_token: Some("briar_agent_existing".to_string()),
        execution_worker: LocalExecutionWorkerConfig {
            worker_id: "22222222-2222-4222-8222-222222222222".to_string(),
            device_id: "33333333-3333-4333-8333-333333333333".to_string(),
            organization_id: "44444444-4444-4444-8444-444444444444".to_string(),
            label: "Existing Worker".to_string(),
            max_concurrent_sessions: 2,
            token: Some("briar_worker_existing".to_string()),
            ..Default::default()
        }
        .into(),
        ..Default::default()
    });
    write_cli_config(&config_path, &config).expect("old CLI config");
    write_session_token_to(&session_path, "old-app-session".to_string()).expect("old app session");

    write_desktop_session_at(
        &session_path,
        &config_path,
        "https://briar.example.com",
        "new-session".to_string(),
    )
    .expect("login");

    let saved = read_cli_config(&config_path).expect("updated CLI config");
    assert_eq!(saved.user_token.as_deref(), Some("new-session"));
    assert_eq!(saved.api_url, "https://briar.example.com");
    assert_eq!(saved.teams, config.teams);
    assert_eq!(saved.worker_device_identity, config.worker_device_identity);
    assert_eq!(saved.agent_providers, config.agent_providers);
    assert_eq!(
        read_session_token_from(&session_path).expect("app session"),
        saved.user_token
    );

    clear_desktop_session_at(&session_path, &config_path).expect("logout");
    let cleared = read_cli_config(&config_path).expect("CLI config after logout");
    assert!(cleared.user_token.is_none());
    assert_eq!(cleared.teams, config.teams);
    assert!(read_session_token_from(&session_path)
        .expect("app logout")
        .is_none());
}

#[cfg(desktop)]
#[test]
fn desktop_login_initializes_cli_without_a_local_worker() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let session_path = directory.path().join("session.json");
    let config_path = directory.path().join("cli/config.json");
    write_desktop_session_at(
        &session_path,
        &config_path,
        "https://briar.example.com",
        "new-session".to_string(),
    )
    .expect("login");
    let saved = read_cli_config(&config_path).expect("CLI config");
    assert_eq!(saved.user_token.as_deref(), Some("new-session"));
    assert_eq!(saved.api_url, "https://briar.example.com");
    assert!(saved.teams.is_empty());
}

#[cfg(desktop)]
#[test]
fn desktop_logout_preserves_an_independent_cli_login() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let session_path = directory.path().join("session.json");
    let config_path = directory.path().join("config.json");
    write_session_token_to(&session_path, "app-session".to_string()).expect("app session");
    let mut config = default_local_config("https://briar.example.com");
    config.user_token = Some("separate-cli-session".to_string());
    write_cli_config(&config_path, &config).expect("CLI config");
    clear_desktop_session_at(&session_path, &config_path).expect("logout");
    assert_eq!(
        read_cli_config(&config_path)
            .expect("CLI config")
            .user_token,
        config.user_token
    );
    assert!(read_session_token_from(&session_path)
        .expect("app session")
        .is_none());
}

#[cfg(desktop)]
#[test]
fn desktop_login_restores_the_previous_session_if_cli_sync_fails() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let session_path = directory.path().join("session.json");
    let config_path = directory.path().join("config.json");
    for previous in [None, Some("previous-session")] {
        if let Some(token) = previous {
            write_session_token_to(&session_path, token.to_string()).expect("previous session");
        }
        assert!(write_desktop_session_at(
            &session_path,
            &config_path,
            "invalid API URL",
            "new-session".to_string()
        )
        .is_err());
        assert_eq!(
            read_session_token_from(&session_path)
                .expect("session after failure")
                .as_deref(),
            previous
        );
        assert!(!config_path.exists());
    }
}
