use super::*;
#[cfg(all(desktop, not(target_os = "macos")))]
use tauri_specta::Event as _;

#[cfg(any(target_os = "macos", test))]
pub(super) fn launch_intro_bounds(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    work_area_y: i32,
) -> (i32, i32, u32, u32) {
    let top_inset = work_area_y.saturating_sub(monitor_y).max(0) as u32;
    (
        monitor_x,
        monitor_y.saturating_add(top_inset as i32),
        monitor_width,
        monitor_height.saturating_sub(top_inset).max(1),
    )
}

pub(super) fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Briar main window is unavailable".to_string())
}

pub(super) fn main_window_size(compact: bool) -> (f64, f64) {
    if compact {
        ONBOARDING_MAIN_WINDOW_SIZE
    } else {
        DEFAULT_MAIN_WINDOW_SIZE
    }
}

pub(super) fn main_window_min_size(compact: bool) -> (f64, f64) {
    if compact {
        ONBOARDING_MAIN_WINDOW_SIZE
    } else {
        DEFAULT_MAIN_WINDOW_MIN_SIZE
    }
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn main_window_decorated(compact: bool) -> bool {
    !compact
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn restored_main_window_title_bar_style(compact: bool) -> Option<tauri::TitleBarStyle> {
    (!compact).then_some(tauri::TitleBarStyle::Overlay)
}

#[cfg(desktop)]
pub(super) fn main_window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;

    StateFlags::SIZE | StateFlags::MAXIMIZED
}

#[tauri::command]
#[specta::specta]
pub(super) fn show_inbox_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    target: InboxNotificationTarget,
    play_sound: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos_inbox_notifications::show(title, body, target, play_sound)
    }

    #[cfg(all(desktop, not(target_os = "macos")))]
    {
        std::thread::spawn(move || {
            let mut notification = notify_rust::Notification::new();
            notification.summary(&title).body(&body).auto_icon();
            #[cfg(unix)]
            if play_sound {
                notification.sound_name("message-new-instant");
            } else {
                notification.hint(notify_rust::Hint::SuppressSound(true));
            }
            #[cfg(windows)]
            if play_sound {
                notification.sound_name("Default");
            }
            #[cfg(unix)]
            notification.action("default", "Open");
            #[cfg(windows)]
            if let Ok(executable) = tauri::utils::platform::current_exe() {
                if let Some(directory) = executable.parent() {
                    let separator = std::path::MAIN_SEPARATOR;
                    let directory = directory.display().to_string();
                    if !(directory.ends_with(format!("{separator}target{separator}debug").as_str())
                        || directory
                            .ends_with(format!("{separator}target{separator}release").as_str()))
                    {
                        notification.app_id(&app.config().identifier);
                    }
                }
            }

            let handle = match notification.show() {
                Ok(handle) => handle,
                Err(error) => {
                    eprintln!("Inbox notification failed: {error}");
                    return;
                }
            };
            if let Err(error) =
                handle.wait_for_response(move |response: &notify_rust::NotificationResponse| {
                    let opens_notification = match response {
                        notify_rust::NotificationResponse::Default => true,
                        notify_rust::NotificationResponse::Action(action) => action == "default",
                        _ => false,
                    };
                    if !opens_notification {
                        return;
                    }

                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.unminimize();
                        let _ = main.set_focus();
                    }
                    let _ = target.emit(&app);
                })
            {
                eprintln!("Inbox notification response failed: {error}");
            }
        });
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = (app, title, body, target, play_sound);
        Err("Desktop inbox notifications are unavailable on mobile".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub(super) async fn request_inbox_notification_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos_inbox_notifications::request_permission().await
    }
    #[cfg(not(target_os = "macos"))]
    Err("Native macOS notification permission is unavailable on this platform".to_string())
}

#[tauri::command]
#[specta::specta]
pub(super) async fn inbox_notification_permission_status() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        macos_inbox_notifications::permission_status().await
    }
    #[cfg(not(target_os = "macos"))]
    Ok("unsupported".to_string())
}

#[tauri::command]
#[specta::specta]
pub(super) fn open_inbox_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.opener()
            .open_url(
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
                None::<&str>,
            )
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native macOS notification settings are unavailable on this platform".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn drain_pending_inbox_notification_opens(
    state: tauri::State<'_, PendingInboxNotificationOpens>,
) -> Vec<InboxNotificationTarget> {
    state.drain()
}

#[tauri::command]
#[specta::specta]
pub(super) fn set_main_window_onboarding_mode(
    app: tauri::AppHandle,
    compact: bool,
) -> Result<(), String> {
    let main = main_window(&app)?;
    let (width, height) = main_window_size(compact);
    let (min_width, min_height) = main_window_min_size(compact);
    #[cfg(target_os = "macos")]
    {
        main.set_decorations(main_window_decorated(compact))
            .map_err(|error| error.to_string())?;
        // Switching back from the borderless onboarding window rebuilds the
        // native style mask without FullSizeContentView. Reapply the configured
        // overlay so macOS keeps the traffic lights inside Briar's header.
        if let Some(style) = restored_main_window_title_bar_style(compact) {
            main.set_title_bar_style(style)
                .map_err(|error| error.to_string())?;
        }
        main.set_shadow(true).map_err(|error| error.to_string())?;
    }
    main.set_min_size(Some(tauri::LogicalSize::new(min_width, min_height)))
        .map_err(|error| error.to_string())?;
    main.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    #[cfg(desktop)]
    main.center().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn display_main_window(app: &AppHandle, focus: bool) -> Result<(), String> {
    let main = main_window(app)?;
    main.center().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    if focus {
        main.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        display_main_window(&app, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn sync_status_tray(
    app: tauri::AppHandle,
    snapshot: StatusTraySnapshotCommand,
) -> Result<(), String> {
    #[cfg(all(desktop, target_os = "macos"))]
    {
        status_tray::sync_snapshot(&app, snapshot.into())
    }
    #[cfg(not(all(desktop, target_os = "macos")))]
    {
        let _ = (app, snapshot);
        Ok(())
    }
}

/// Command payload shared with the frontend; converted to the tray module type
/// only on macOS desktop where the tray is installed.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatusTraySnapshotCommand {
    pub(super) running_label: String,
    pub(super) empty_label: String,
    pub(super) open_label: String,
    pub(super) quit_label: String,
    #[serde(default = "default_status_tray_more_label")]
    pub(super) more_label: String,
    #[serde(default)]
    pub(super) items: Vec<StatusTrayRunItemCommand>,
}

pub(super) fn default_status_tray_more_label() -> String {
    "+{count} more in Briar".to_string()
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatusTrayRunItemCommand {
    pub(super) project_id: String,
    pub(super) run_id: String,
    pub(super) title: String,
    pub(super) status_label: String,
    #[serde(default)]
    pub(super) project_name: String,
}

#[cfg(all(desktop, target_os = "macos"))]
impl From<StatusTraySnapshotCommand> for status_tray::StatusTraySnapshot {
    fn from(value: StatusTraySnapshotCommand) -> Self {
        Self {
            running_label: value.running_label,
            empty_label: value.empty_label,
            open_label: value.open_label,
            quit_label: value.quit_label,
            more_label: value.more_label,
            items: value
                .items
                .into_iter()
                .map(|item| status_tray::StatusTrayRunItem {
                    project_id: item.project_id,
                    run_id: item.run_id,
                    title: item.title,
                    status_label: item.status_label,
                    project_name: item.project_name,
                })
                .collect(),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        display_main_window(&app, false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn finish_launch_intro(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(intro) = app.get_webview_window("launch-intro") {
            intro.destroy().map_err(|error| error.to_string())?;
        }
        display_main_window(&app, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn prepare_launch_intro(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if app.get_webview_window("launch-intro").is_some() {
            return Ok(());
        }

        let main = main_window(&app)?;
        main.center().map_err(|error| error.to_string())?;
        main.hide().map_err(|error| error.to_string())?;

        let monitor = match main.current_monitor().map_err(|error| error.to_string())? {
            Some(monitor) => monitor,
            None => main
                .primary_monitor()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "No macOS display is available".to_string())?,
        };
        let position = monitor.position();
        let size = monitor.size();
        let work_area = monitor.work_area();
        let (x, y, width, height) = launch_intro_bounds(
            position.x,
            position.y,
            size.width,
            size.height,
            work_area.position.y,
        );
        let scale_factor = monitor.scale_factor();

        let build_result = WebviewWindowBuilder::new(
            &app,
            "launch-intro",
            WebviewUrl::App("index.html?launchIntro=native".into()),
        )
        .title("")
        .position(x as f64 / scale_factor, y as f64 / scale_factor)
        .inner_size(width as f64 / scale_factor, height as f64 / scale_factor)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .closable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .shadow(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .initialization_script("document.documentElement.classList.add('launch-intro-document');")
        .focused(true)
        .visible(true)
        .build();

        if let Err(error) = build_result {
            let _ = display_main_window(&app, true);
            return Err(error.to_string());
        }

        // The intro window is driven by frontend timers. If its script fails to
        // load after an update, do not leave the production app running with
        // every window hidden forever.
        let fallback_app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(7));
            if let Some(intro) = fallback_app.get_webview_window("launch-intro") {
                let _ = intro.destroy();
                let _ = display_main_window(&fallback_app, true);
            }
        });

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("The native launch intro is only available on macOS".to_string())
    }
}

/// Menu id of the custom Quit item installed by [`install_app_menu`].
///
/// The default macOS menu's predefined Quit item terminates the app directly
/// (Cmd+Q goes through NSApplication `terminate:`), bypassing the exit
/// confirmation. Replacing it with a normal menu item whose accelerator routes
/// through this id keeps the confirmation dialog on every quit path.
#[cfg(desktop)]
pub(crate) const APP_QUIT_MENU_ID: &str = "app:quit";

#[cfg(target_os = "macos")]
pub(super) const APP_MENU_ID: &str = "app:menu";
#[cfg(target_os = "macos")]
pub(super) const APP_SETTINGS_MENU_ID: &str = "app:settings";
#[cfg(target_os = "macos")]
pub(super) const APP_UPDATE_MENU_ID: &str = "app:update";
#[cfg(target_os = "macos")]
pub(super) fn app_update_menu_label(update_available: bool) -> &'static str {
    if update_available {
        "Update Briar…"
    } else {
        "Check for Updates…"
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn sync_app_update_menu(
    app: tauri::AppHandle,
    update_available: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let menu = app
            .menu()
            .ok_or_else(|| "App menu is not installed".to_string())?;
        let app_menu_kind = menu
            .get(APP_MENU_ID)
            .ok_or_else(|| "App submenu is not installed".to_string())?;
        let app_menu = app_menu_kind
            .as_submenu()
            .ok_or_else(|| "App menu item is not a submenu".to_string())?;
        let update_item_kind = app_menu
            .get(APP_UPDATE_MENU_ID)
            .ok_or_else(|| "App update menu item is not installed".to_string())?;
        let update_item = update_item_kind
            .as_menuitem()
            .ok_or_else(|| "App update menu entry is not a regular item".to_string())?;
        update_item
            .set_text(app_update_menu_label(update_available))
            .map_err(|error| format!("App update menu label failed: {error}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, update_available);

    Ok(())
}

/// Install the app-wide menu with a custom Quit item that asks for
/// confirmation before exiting.
///
/// Mirrors Tauri's default macOS menu (About, Services, Hide, Hide Others,
/// Edit, View, Window, Help) but swaps the predefined Quit item for a regular
/// item bound to [`APP_QUIT_MENU_ID`] with the Cmd/Ctrl+Q accelerator. The
/// menu event handler registered in [`run`] shows the confirmation dialog.
#[cfg(desktop)]
pub(super) fn install_app_menu(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", windows))]
    use tauri::menu::MenuItem;
    use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};

    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    #[cfg(any(target_os = "macos", windows))]
    let quit = MenuItem::with_id(
        app,
        APP_QUIT_MENU_ID,
        format!("Quit {}", pkg_info.name),
        true,
        Some("CmdOrCtrl+Q"),
    )
    .map_err(|error| format!("App menu quit item failed: {error}"))?;

    #[cfg(target_os = "macos")]
    let settings = MenuItem::with_id(
        app,
        APP_SETTINGS_MENU_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+Comma"),
    )
    .map_err(|error| format!("App menu settings item failed: {error}"))?;

    #[cfg(target_os = "macos")]
    let update = MenuItem::with_id(
        app,
        APP_UPDATE_MENU_ID,
        app_update_menu_label(false),
        true,
        None::<&str>,
    )
    .map_err(|error| format!("App menu update item failed: {error}"))?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)
                .map_err(|error| format!("App menu minimize item failed: {error}"))?,
            &PredefinedMenuItem::maximize(app, None)
                .map_err(|error| format!("App menu maximize item failed: {error}"))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)
                .map_err(|error| format!("App menu separator failed: {error}"))?,
            &PredefinedMenuItem::close_window(app, None)
                .map_err(|error| format!("App menu close window item failed: {error}"))?,
        ],
    )
    .map_err(|error| format!("App menu Window submenu failed: {error}"))?;

    let help_menu = Submenu::with_id_and_items(
        app,
        "help",
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about_metadata))
                .map_err(|error| format!("App menu about item failed: {error}"))?,
        ],
    )
    .map_err(|error| format!("App menu Help submenu failed: {error}"))?;

    let menu = Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_id_and_items(
                app,
                APP_MENU_ID,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))
                        .map_err(|error| format!("App menu about item failed: {error}"))?,
                    &update,
                    &PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("App menu separator failed: {error}"))?,
                    &settings,
                    &PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("App menu separator failed: {error}"))?,
                    &PredefinedMenuItem::services(app, None)
                        .map_err(|error| format!("App menu services item failed: {error}"))?,
                    &PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("App menu separator failed: {error}"))?,
                    &PredefinedMenuItem::hide(app, None)
                        .map_err(|error| format!("App menu hide item failed: {error}"))?,
                    &PredefinedMenuItem::hide_others(app, None)
                        .map_err(|error| format!("App menu hide others item failed: {error}"))?,
                    &PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("App menu separator failed: {error}"))?,
                    &quit,
                ],
            )
            .map_err(|error| format!("App menu failed: {error}"))?,
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            )))]
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app, None)
                        .map_err(|error| format!("App menu close window item failed: {error}"))?,
                    #[cfg(not(target_os = "macos"))]
                    &quit,
                ],
            )
            .map_err(|error| format!("App menu File submenu failed: {error}"))?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)
                        .map_err(|error| format!("App menu undo item failed: {error}"))?,
                    &PredefinedMenuItem::redo(app, None)
                        .map_err(|error| format!("App menu redo item failed: {error}"))?,
                    &PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("App menu separator failed: {error}"))?,
                    &PredefinedMenuItem::cut(app, None)
                        .map_err(|error| format!("App menu cut item failed: {error}"))?,
                    &PredefinedMenuItem::copy(app, None)
                        .map_err(|error| format!("App menu copy item failed: {error}"))?,
                    &PredefinedMenuItem::paste(app, None)
                        .map_err(|error| format!("App menu paste item failed: {error}"))?,
                    &PredefinedMenuItem::select_all(app, None)
                        .map_err(|error| format!("App menu select all item failed: {error}"))?,
                ],
            )
            .map_err(|error| format!("App menu Edit submenu failed: {error}"))?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)
                    .map_err(|error| format!("App menu fullscreen item failed: {error}"))?],
            )
            .map_err(|error| format!("App menu View submenu failed: {error}"))?,
            &window_menu,
            &help_menu,
        ],
    )
    .map_err(|error| format!("App menu build failed: {error}"))?;

    app.set_menu(menu)
        .map_err(|error| format!("App menu install failed: {error}"))?;
    Ok(())
}

#[cfg(desktop)]
pub(crate) fn request_exit_confirmation(app: &AppHandle) {
    let state = app.state::<ExitConfirmationState>();
    if !state.try_open_prompt() {
        return;
    }

    let confirmation_app = app.clone();
    let dialog = app
        .dialog()
        .message("Briar를 종료하시겠습니까?")
        .title("Briar 종료")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "종료".to_string(),
            "취소".to_string(),
        ));
    let dialog = match app.get_webview_window("main") {
        Some(main) => dialog.parent(&main),
        None => dialog,
    };
    dialog.show(move |confirmed| {
        confirmation_app
            .state::<ExitConfirmationState>()
            .close_prompt();
        if confirmed {
            confirmation_app.exit(0);
        }
    });
}

#[tauri::command]
#[specta::specta]
pub(super) fn arm_macos_password_editor(webview: tauri::Webview) {
    #[cfg(target_os = "macos")]
    if webview.window().label() == "main" {
        macos_secure_input::arm_password_editor(&webview);
    }

    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}

#[cfg(test)]
mod tests;
