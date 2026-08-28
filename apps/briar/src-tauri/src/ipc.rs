use super::*;
use tauri_specta::{collect_commands, collect_events, Builder, ErrorHandlingMode};

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

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "project-agent-schedule-poll")]
pub(crate) struct ProjectAgentSchedulePollEvent;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "inbox-notification-open-available")]
pub(crate) struct InboxNotificationOpenAvailableEvent;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "app-menu-settings")]
pub(crate) struct AppMenuSettingsEvent;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "app-menu-update")]
pub(crate) struct AppMenuUpdateEvent;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "status-tray-open-run")]
pub(crate) struct StatusTrayOpenRunPayload {
    pub(crate) project_id: String,
    pub(crate) run_id: String,
}

pub(super) fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        .error_handling(ErrorHandlingMode::Throw)
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
            current_app_icon,
            set_app_icon,
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
            retry_project_auto_hunt_run,
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
            install_project_github_cli,
            login_project_github,
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

    #[test]
    fn json_value_exports_as_json_union() {
        let output =
            std::env::temp_dir().join(format!("briar-tauri-bindings-{}.ts", std::process::id()));
        builder()
            .export(Typescript::default(), &output)
            .expect("failed to export temporary Tauri TypeScript bindings");
        let bindings = std::fs::read_to_string(&output)
            .expect("failed to read temporary Tauri TypeScript bindings");
        let _ = std::fs::remove_file(output);

        assert!(bindings.contains(
            "export type JsonValue = boolean | number | null | string | JsonValue[] | { [key in string]: JsonValue };"
        ));
    }

    #[test]
    fn typed_events_preserve_existing_contract() {
        let names = [
            <agent::AppServerEventRecord as tauri_specta::Event>::NAME,
            <auto_hunt_dispatch::AutoHuntDispatchEvent as tauri_specta::Event>::NAME,
            <ProjectLlmProgressPayload as tauri_specta::Event>::NAME,
            <ProjectAgentSchedulePollEvent as tauri_specta::Event>::NAME,
            <InboxNotificationTarget as tauri_specta::Event>::NAME,
            <InboxNotificationOpenAvailableEvent as tauri_specta::Event>::NAME,
            <AppMenuSettingsEvent as tauri_specta::Event>::NAME,
            <AppMenuUpdateEvent as tauri_specta::Event>::NAME,
            <StatusTrayOpenRunPayload as tauri_specta::Event>::NAME,
        ];
        assert_eq!(
            names,
            [
                "auto-hunt-app-server-event",
                "auto-hunt-dispatch-event",
                "project-llm-progress",
                "project-agent-schedule-poll",
                "inbox-notification-open",
                "inbox-notification-open-available",
                "app-menu-settings",
                "app-menu-update",
                "status-tray-open-run",
            ]
        );

        for payload in [
            serde_json::to_value(ProjectAgentSchedulePollEvent),
            serde_json::to_value(InboxNotificationOpenAvailableEvent),
            serde_json::to_value(AppMenuSettingsEvent),
            serde_json::to_value(AppMenuUpdateEvent),
        ] {
            assert_eq!(
                payload.expect("failed to serialize unit event"),
                serde_json::Value::Null
            );
        }
        assert_eq!(
            serde_json::to_value(StatusTrayOpenRunPayload {
                project_id: "project-1".to_string(),
                run_id: "run-1".to_string(),
            })
            .expect("failed to serialize status tray event"),
            serde_json::json!({ "projectId": "project-1", "runId": "run-1" })
        );
    }

    #[test]
    fn export_typescript_bindings() {
        let output =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated/tauri.ts");

        builder()
            .export(Typescript::default(), output)
            .expect("failed to export Tauri TypeScript bindings");
    }
}
