use super::*;
use tauri_specta::{collect_commands, collect_events, Builder, ErrorHandlingMode};

/// JSON's recursive value shape for generated TypeScript contracts.
///
/// `Null(())` exports as the `null` literal, while Specta's default `f64`
/// representation also includes `null`; the explicit number override keeps
/// the generated union faithful to JSON.
#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(untagged)]
pub(crate) enum JsonValue {
    Bool(bool),
    Number(#[specta(type = specta_typescript::Number)] f64),
    Null(()),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "project-agent-schedule-poll")]
pub(crate) struct ProjectAgentSchedulePollEvent;

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "inbox-notification-open-available")]
pub(crate) struct InboxNotificationOpenAvailableEvent;

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "app-menu-settings")]
pub(crate) struct AppMenuSettingsEvent;

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "app-menu-update")]
pub(crate) struct AppMenuUpdateEvent;

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "status-tray-open-run")]
pub(crate) struct StatusTrayOpenRunPayload {
    pub(crate) project_id: String,
    pub(crate) run_id: String,
}

pub(super) fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        .error_handling(ErrorHandlingMode::Throw)
        // Reachable 64-bit values are bounded counters and millisecond
        // timestamps that remain within JavaScript's safe integer range.
        .dangerously_cast_bigints_to_number()
        .events(collect_events![
            agent::AppServerEventRecord,
            auto_hunt_dispatch::AutoHuntDispatchEvent,
            ProjectLlmProgressPayload,
            ProjectAgentSchedulePollEvent,
            InboxNotificationTarget,
            InboxNotificationOpenAvailableEvent,
            AppMenuSettingsEvent,
            AppMenuUpdateEvent,
            StatusTrayOpenRunPayload,
        ])
        .commands(collect_commands![
            prepare_launch_intro,
            show_main_window,
            reveal_main_window,
            finish_launch_intro,
            set_main_window_onboarding_mode,
            inspect_onboarding_prerequisites,
            load_agent_provider_models,
            inspect_open_code_terminal_path,
            configure_open_code_terminal_path,
            inspect_agent_browser,
            inspect_aside_browser,
            inspect_ego_browser,
            open_agent_provider_login,
            install_onboarding_prerequisite,
            install_agent_browser,
            setup_aside_browser,
            read_session_token,
            write_session_token,
            clear_session_token,
            set_app_badge_count,
            validate_repository_path,
            clone_github_ssh_repository,
            create_project_workspace,
            inspect_lovable_repository_compatibility,
            inspect_repository_readiness,
            discover_repository_icon,
            connected_project_ids,
            project_llm_chat,
            run_project_agent,
            stop_project_agent_session,
            prepare_for_app_update,
            take_planned_update_agent_recoveries,
            start_project_auto_hunt,
            load_auto_hunt_app_server_events,
            load_auto_hunt_dispatch,
            load_app_provider_settings,
            load_openrouter_credential_status,
            load_app_runtime_settings,
            load_browser_automation_settings,
            load_agent_usage,
            update_app_provider_settings,
            update_openrouter_api_key,
            update_app_runtime_settings,
            update_browser_automation_settings,
            load_project_llm_settings,
            update_project_llm_settings,
            load_project_sandbox_settings,
            update_project_sandbox_settings,
            update_local_project_workflow,
            update_local_project_velen_org,
            preflight_local_project_connection,
            project_repository_readiness,
            prepare_project_repository,
            disconnect_local_project,
            connect_local_project,
            inspect_velen,
            auto_hunt_health,
            repair_auto_hunt,
            configure_execution_worker,
            refresh_execution_worker_runtime,
            sync_execution_worker_labels,
            inspect_execution_workers,
            current_execution_worker_device_id,
            show_inbox_notification,
            request_inbox_notification_permission,
            inbox_notification_permission_status,
            open_inbox_notification_settings,
            drain_pending_inbox_notification_opens,
            arm_macos_password_editor,
            sync_status_tray,
            sync_app_update_menu,
        ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use specta_typescript::Typescript;

    fn export_typescript(path: impl AsRef<std::path::Path>) {
        let path = path.as_ref();
        builder()
            .export(Typescript::default(), path)
            .expect("failed to export Tauri TypeScript bindings");
        let bindings = std::fs::read_to_string(path)
            .expect("failed to read generated Tauri TypeScript bindings");
        let bindings = bindings
            .trim_end()
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(path, format!("{bindings}\n"))
            .expect("failed to normalize generated Tauri TypeScript bindings");
    }

    fn exported_typescript() -> String {
        let directory = tempfile::tempdir().expect("failed to create temporary bindings directory");
        let output = directory.path().join("tauri.ts");
        export_typescript(&output);
        std::fs::read_to_string(output).expect("failed to read temporary Tauri bindings")
    }

    fn generated_typescript_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated/tauri.ts")
    }

    #[test]
    fn json_value_exports_as_json_union() {
        assert!(exported_typescript().contains(
            "export type JsonValue = boolean | number | null | string | JsonValue[] | { [key in string]: JsonValue };"
        ));
    }

    #[test]
    fn typescript_bindings_are_current() {
        let expected = std::fs::read_to_string(generated_typescript_path())
            .expect("generated Tauri TypeScript bindings are missing");
        let actual = exported_typescript();

        assert!(
            actual == expected,
            "Tauri TypeScript bindings are stale; run `bun run --cwd apps/briar tauri:bindings`"
        );
    }

    #[test]
    #[ignore = "writes the generated TypeScript bindings"]
    fn export_typescript_bindings() {
        export_typescript(generated_typescript_path());
    }
}
