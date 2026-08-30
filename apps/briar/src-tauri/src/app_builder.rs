use super::*;

pub(super) fn run() {
    let builder = tauri::Builder::default()
        .manage(SleepPreventionState::default())
        .manage(AgentSessionCancellationState::default())
        .manage(PendingInboxNotificationOpens::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_auth_session::init());
    #[cfg(desktop)]
    let builder = builder
        .manage(ExitConfirmationState::default())
        .on_menu_event(|app, event| {
            if event.id() == APP_QUIT_MENU_ID {
                request_exit_confirmation(app);
            }
            #[cfg(target_os = "macos")]
            if event.id() == APP_SETTINGS_MENU_ID {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                let _ = app.emit(APP_SETTINGS_MENU_EVENT, ());
            }
            #[cfg(target_os = "macos")]
            if event.id() == APP_UPDATE_MENU_ID {
                let _ = app.emit(APP_UPDATE_MENU_EVENT, ());
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                #[cfg(target_os = "macos")]
                if let tauri::WindowEvent::Focused(focused) = event {
                    macos_secure_input::handle_focus_changed(window, *focused);
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    request_exit_confirmation(window.app_handle());
                }
            }
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(main_window_state_flags())
                .with_denylist(&["launch-intro"])
                .build(),
        );
    #[cfg(target_os = "macos")]
    let builder = builder.manage(status_tray::StatusTrayState::default());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(macos_secure_input::SecureInputState::default());
    let app = builder
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            if let Err(error) = macos_inbox_notifications::install(_app.handle()) {
                eprintln!("Inbox notification install skipped: {error}");
            }
            #[cfg(target_os = "macos")]
            if let Err(error) = status_tray::install(_app.handle()) {
                eprintln!("Status tray install failed: {error}");
            }
            #[cfg(desktop)]
            {
                if let Err(error) = install_app_menu(_app.handle()) {
                    eprintln!("App menu install failed: {error}");
                }
                if let Ok(config_path) = cli_config_path(_app.handle()) {
                    match app_runtime_settings_from(&config_path) {
                        Ok(settings) => {
                            if let Err(error) = _app
                                .state::<SleepPreventionState>()
                                .set_enabled(settings.prevent_sleep_while_running)
                            {
                                eprintln!("Sleep prevention startup failed: {error}");
                            }
                        }
                        Err(error) => {
                            eprintln!("App runtime settings startup failed: {error}");
                        }
                    }
                }
                let schedule_poll_app = _app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let _ = schedule_poll_app.emit(PROJECT_AGENT_SCHEDULE_POLL_EVENT, ());
                });
                let resource_directory = _app.path().resource_dir()?;
                let home = _app.path().home_dir()?;
                let app_data_directory = _app.path().app_data_dir()?;
                if let Err(error) =
                    planned_update_recovery::PlannedUpdateRecoveryStore::new(&app_data_directory)
                        .and_then(|store| store.cleanup_unprepared())
                {
                    eprintln!("Planned update recovery cleanup failed: {error}");
                }
                if let Err(error) =
                    auto_hunt_dispatch::AutoHuntDispatchStore::new(&app_data_directory)
                        .and_then(|store| store.interrupt_orphaned_groups())
                {
                    eprintln!("Auto Hunt dispatch recovery failed: {error}");
                }
                if let Err(error) = sync_auto_hunt_assets_and_restart_workers(
                    &resource_directory,
                    &home,
                    ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
                ) {
                    eprintln!(
                        "Briar CLI and Auto Hunt skill automatic synchronization failed: {error}"
                    );
                }
                #[cfg(not(dev))]
                {
                    let worktree_sweep_config = cli_config_path(_app.handle())?;
                    let worktree_sweep_home = home.clone();
                    std::thread::spawn(move || loop {
                        if let Err(error) = maintain_expired_auto_hunt_worktrees(
                            &worktree_sweep_config,
                            &worktree_sweep_home,
                        ) {
                            eprintln!("Completed worktree cleanup failed: {error}");
                        }
                        std::thread::sleep(std::time::Duration::from_secs(
                            WORKTREE_SWEEP_INTERVAL_SECS,
                        ));
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            prepare_project_repository,
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
            sync_app_update_menu
        ])
        .build(tauri::generate_context!())
        .expect("error while building Briar");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = &event
        {
            if !has_visible_windows {
                let _ = display_main_window(app, true);
            }
        }
        #[cfg(desktop)]
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
            request_exit_confirmation(app);
        }
    });
}
