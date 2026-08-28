use super::*;
use specta::{datatype::DataType, Type, Types};
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(untagged)]
pub(crate) enum JsonValueShape {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValueShape>),
    Object(BTreeMap<String, JsonValueShape>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(transparent)]
pub(crate) struct JsonValue(serde_json::Value);

impl Type for JsonValue {
    fn definition(types: &mut Types) -> DataType {
        JsonValueShape::definition(types)
    }
}

impl From<serde_json::Value> for JsonValue {
    fn from(value: serde_json::Value) -> Self {
        Self(value)
    }
}

pub(super) fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        .error_handling(ErrorHandlingMode::Throw)
        .dangerously_cast_bigints_to_number()
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
    fn export_typescript_bindings() {
        let output =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated/tauri.ts");

        builder()
            .export(Typescript::default(), output)
            .expect("failed to export Tauri TypeScript bindings");
    }
}
