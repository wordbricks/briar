use super::*;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn inbox_channel_notification_target_preserves_message_context() {
    let target: InboxNotificationTarget = serde_json::from_value(json!({
        "messageId": "channel:reply-1",
        "projectId": "project-1",
        "targetId": "channel-1",
        "kind": "channel",
        "channelMessageId": "reply-1",
        "rootMessageId": "root-1"
    }))
    .expect("channel notification target");

    assert_eq!(target.channel_message_id.as_deref(), Some("reply-1"));
    assert_eq!(target.root_message_id.as_deref(), Some("root-1"));
    assert_eq!(
        serde_json::to_value(target).expect("serialized channel notification target"),
        json!({
            "messageId": "channel:reply-1",
            "projectId": "project-1",
            "targetId": "channel-1",
            "kind": "channel",
            "channelMessageId": "reply-1",
            "rootMessageId": "root-1"
        })
    );
}

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
