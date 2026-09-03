use super::*;
#[cfg(desktop)]
use tauri_specta::Event as _;

pub(super) fn run() {
    let ipc_builder = ipc::builder();
    let invoke_handler = ipc_builder.invoke_handler();
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
                let _ = ipc::AppMenuSettingsEvent.emit(app);
            }
            #[cfg(target_os = "macos")]
            if event.id() == APP_UPDATE_MENU_ID {
                let _ = ipc::AppMenuUpdateEvent.emit(app);
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
        .plugin(tauri_plugin_clipboard_manager::init())
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
        .setup(move |_app| {
            ipc_builder.mount_events(_app);
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
                    let _ = ipc::ProjectAgentSchedulePollEvent.emit(&schedule_poll_app);
                });
                let resource_directory = _app.path().resource_dir()?;
                let home = _app.path().home_dir()?;
                let app_data_directory = _app.path().app_data_dir()?;
                // Kept synchronous: both are plain directory scans over a
                // handful of small local JSON files, so they finish long
                // before the webview can load and call any command — they
                // are not the source of the multi-second setup freeze.
                // `cleanup_unprepared` also has a real (if narrow) ordering
                // hazard if it were deferred: when no fresh marker is
                // present it deletes *every* file in the active-recovery
                // directory, including ones a resumed session's `begin()`
                // may have just written after the frontend called
                // `take_planned_update_agent_recoveries` (see
                // project_execution.rs). Running it here, before the event
                // loop starts and before any command can run, guarantees it
                // never races that write.
                if let Err(error) =
                    planned_update_recovery::PlannedUpdateRecoveryStore::new(&app_data_directory)
                        .and_then(|store| store.cleanup_unprepared())
                {
                    eprintln!("Planned update recovery cleanup failed: {error}");
                }
                // `interrupt_orphaned_groups` flips any dispatch group left
                // "running" by a previous process to "interrupted". The
                // frontend's one-shot recovery effect (`useAutoHuntSessions`,
                // empty dependency array) reads dispatch status once on
                // mount and never re-polls it afterwards, so a group this
                // hasn't reached yet would show "running" indefinitely
                // instead of self-correcting. Kept synchronous so that
                // one-shot read always sees the reconciled state.
                if let Err(error) =
                    auto_hunt_dispatch::AutoHuntDispatchStore::new(&app_data_directory)
                        .and_then(|store| store.interrupt_orphaned_groups())
                {
                    eprintln!("Auto Hunt dispatch recovery failed: {error}");
                }
                // This copies skill bundles into several destinations under
                // `home` and then blocks on a `bun ... worker
                // restart-services` subprocess. On the setup thread that
                // freezes the already-visible, still-blank window for
                // seconds on the first launch after every app update.
                // Running it on a background thread lets `setup` return and
                // the event loop (and window paint) start immediately.
                //
                // `auto_hunt_health` and `repair_auto_hunt` read the same
                // CLI/skill VERSION files this writes, and the frontend
                // calls `auto_hunt_health` once on mount, so there is a
                // narrow window where a health check can observe a
                // partially-synced install and report a stale/misleading
                // issue. That is judged acceptable here: the dashboard
                // polls and re-runs the health check periodically, so the
                // status self-corrects on the next pass once the
                // background sync finishes.
                let background_resource_directory = resource_directory.clone();
                let background_home = home.clone();
                std::thread::spawn(move || {
                    if let Err(error) = sync_auto_hunt_assets_and_restart_workers(
                        &background_resource_directory,
                        &background_home,
                        ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
                    ) {
                        eprintln!(
                            "Briar CLI and Auto Hunt skill automatic synchronization failed: {error}"
                        );
                    }
                });
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
        .invoke_handler(invoke_handler)
        .build(tauri::generate_context!())
        .expect("error while building Briar");
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = &_event
        {
            if !has_visible_windows {
                let _ = display_main_window(_app, true);
            }
        }
        #[cfg(desktop)]
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = _event
        {
            api.prevent_exit();
            request_exit_confirmation(_app);
        }
    });
}
