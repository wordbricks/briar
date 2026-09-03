use super::*;
#[cfg(all(desktop, not(target_os = "macos")))]
use tauri_specta::Event as _;

/// Marker file written to the app data directory once the first-run intro has
/// played through.
///
/// The intro window is opened from `setup`, long before any webview can read
/// `localStorage`, so the "already seen" answer has to live on disk. The
/// frontend keeps its own `localStorage` flag for the in-app preview flows.
#[cfg(any(target_os = "macos", test))]
pub(super) const LAUNCH_INTRO_SEEN_FILE: &str = "launch-intro-seen.v2";

/// Longest [`reveal_main_window`] waits for the first real screen to commit.
///
/// The intro holds for five seconds regardless; this only bounds the extra
/// wait when boot is slower than the animation.
#[cfg(desktop)]
pub(super) const MAIN_WINDOW_READY_WAIT: std::time::Duration = std::time::Duration::from_secs(12);

/// Backstop for an intro whose script never finishes.
///
/// Covers the five second hold plus [`MAIN_WINDOW_READY_WAIT`] plus the fade
/// and IPC round trips.
#[cfg(target_os = "macos")]
pub(super) const LAUNCH_INTRO_WATCHDOG: std::time::Duration = std::time::Duration::from_secs(20);

/// Backstop for a launch that never reports readiness and never opens an intro.
///
/// The main window is created hidden, so a frontend that fails before the
/// reveal effect runs (a broken bundle showing the `startup-error` overlay)
/// would otherwise stay invisible forever.
#[cfg(desktop)]
pub(super) const MAIN_WINDOW_VISIBILITY_WATCHDOG: std::time::Duration =
    std::time::Duration::from_secs(10);

/// Whether [`display_main_window`] should recenter before showing.
///
/// Centering an already visible window makes it jump, so it only applies to
/// the first show of a window that launched hidden.
#[cfg(desktop)]
pub(super) fn should_center_main_window(is_visible: bool) -> bool {
    !is_visible
}

#[cfg(desktop)]
#[derive(Debug, Default)]
struct LaunchIntroStatus {
    main_ready: bool,
    reveal_requested: bool,
}

/// Handshake between the launch intro window and the main window's first
/// screen.
///
/// The intro asks to reveal the main window after its five second hold;
/// [`LaunchIntroShared::wait_for_main_ready`] keeps that request parked until
/// the frontend reports that it committed a real screen, so the user never
/// sees the session loading spinner behind the intro.
#[cfg(desktop)]
#[derive(Debug, Default)]
pub(super) struct LaunchIntroShared {
    status: Mutex<LaunchIntroStatus>,
    ready: std::sync::Condvar,
}

#[cfg(desktop)]
impl LaunchIntroShared {
    fn status(&self) -> std::sync::MutexGuard<'_, LaunchIntroStatus> {
        // A poisoned lock must not keep the main window hidden forever.
        self.status
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    pub(super) fn mark_main_ready(&self) {
        {
            let mut status = self.status();
            if status.main_ready {
                return;
            }
            status.main_ready = true;
        }
        self.ready.notify_all();
    }

    pub(super) fn is_main_ready(&self) -> bool {
        self.status().main_ready
    }

    /// Records that the intro asked for the reveal. Returns whether this is the
    /// first request.
    pub(super) fn request_reveal(&self) -> bool {
        let mut status = self.status();
        let first = !status.reveal_requested;
        status.reveal_requested = true;
        first
    }

    pub(super) fn reveal_requested(&self) -> bool {
        self.status().reveal_requested
    }

    /// Blocks until the main window reports readiness or `cap` elapses.
    ///
    /// Returns whether readiness arrived within the cap.
    pub(super) fn wait_for_main_ready(&self, cap: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + cap;
        let mut status = self.status();
        while !status.main_ready {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let (next, timeout) = self
                .ready
                .wait_timeout(status, remaining)
                .unwrap_or_else(|error| error.into_inner());
            status = next;
            if timeout.timed_out() && !status.main_ready {
                return false;
            }
        }
        true
    }
}

/// Managed handle to [`LaunchIntroShared`].
#[cfg(desktop)]
#[derive(Debug, Default)]
pub(super) struct LaunchIntroState(Arc<LaunchIntroShared>);

#[cfg(desktop)]
impl LaunchIntroState {
    pub(super) fn shared(&self) -> Arc<LaunchIntroShared> {
        Arc::clone(&self.0)
    }
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn launch_intro_marker_path(app_data_directory: &Path) -> PathBuf {
    app_data_directory.join(LAUNCH_INTRO_SEEN_FILE)
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn has_seen_launch_intro(app_data_directory: &Path) -> bool {
    launch_intro_marker_path(app_data_directory).exists()
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn record_launch_intro_seen(app_data_directory: &Path) -> Result<(), String> {
    let path = launch_intro_marker_path(app_data_directory);
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(app_data_directory)
        .and_then(|_| fs::write(&path, b"1"))
        .map_err(|error| format!("첫 실행 인트로 기록을 저장하지 못했습니다: {error}"))
}

/// What a launch should do about the first-run intro.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LaunchIntroDecision {
    /// Play the intro and write the marker when it finishes.
    Show,
    /// The marker is already on disk.
    AlreadySeen,
    /// A profile that predates the marker: adopt it without replaying the
    /// intro, so an update never shows the first-run animation twice.
    AdoptExistingProfile,
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn launch_intro_decision(
    intro_seen: bool,
    has_existing_session: bool,
) -> LaunchIntroDecision {
    if intro_seen {
        LaunchIntroDecision::AlreadySeen
    } else if has_existing_session {
        LaunchIntroDecision::AdoptExistingProfile
    } else {
        LaunchIntroDecision::Show
    }
}

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
pub(super) async fn inbox_notification_permission_status(
) -> Result<InboxNotificationPermissionStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos_inbox_notifications::permission_status().await
    }
    #[cfg(not(target_os = "macos"))]
    Ok(InboxNotificationPermissionStatus::Unsupported)
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

#[cfg(desktop)]
pub(super) fn display_main_window(app: &AppHandle, focus: bool) -> Result<(), String> {
    let main = main_window(app)?;
    // `visible: false` in the window config means the first show is also the
    // first placement; a window that is already on screen keeps its position.
    if should_center_main_window(main.is_visible().unwrap_or(false)) {
        main.center().map_err(|error| error.to_string())?;
    }
    main.show().map_err(|error| error.to_string())?;
    if focus {
        main.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        // While the intro is on screen the reveal path owns the main window,
        // so a frontend that believes it already played the intro (a cleared
        // localStorage, say) cannot pop the window out from behind it.
        if app.get_webview_window("launch-intro").is_some() {
            return Ok(());
        }
        display_main_window(&app, true)
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}

/// Reports that the main window committed its first real screen.
///
/// Called once the session restore settles, which is the moment the app shows
/// either the dashboard or the login/onboarding screen instead of the session
/// loading spinner.
#[tauri::command]
#[specta::specta]
pub(super) fn mark_main_window_ready(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if webview.window().label() != "main" {
            return Ok(());
        }
        webview
            .app_handle()
            .state::<LaunchIntroState>()
            .shared()
            .mark_main_ready();
    }
    #[cfg(not(desktop))]
    let _ = webview;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn sync_status_tray(
    app: tauri::AppHandle,
    snapshot: StatusTraySnapshot,
) -> Result<(), String> {
    #[cfg(all(desktop, target_os = "macos"))]
    {
        status_tray::sync_snapshot(&app, snapshot)
    }
    #[cfg(not(all(desktop, target_os = "macos")))]
    {
        let _ = (app, snapshot);
        Ok(())
    }
}

/// Canonical status tray snapshot shared by the frontend command and the
/// macOS renderer.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatusTraySnapshot {
    pub(super) running_label: String,
    pub(super) empty_label: String,
    pub(super) open_label: String,
    pub(super) quit_label: String,
    pub(super) more_label: String,
    pub(super) items: Vec<StatusTrayRunItem>,
}

fn default_status_tray_more_label() -> String {
    "+{count} more in Briar".to_string()
}

impl Default for StatusTraySnapshot {
    fn default() -> Self {
        Self {
            running_label: "Running".to_string(),
            empty_label: "No running issues".to_string(),
            open_label: "Open Briar".to_string(),
            quit_label: "Quit Briar".to_string(),
            more_label: default_status_tray_more_label(),
            items: Vec::new(),
        }
    }
}

#[derive(
    Clone, Debug, Default, serde::Deserialize, serde::Serialize, specta::Type, PartialEq, Eq,
)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatusTrayRunItem {
    pub(super) project_id: String,
    pub(super) run_id: String,
    pub(super) title: String,
    pub(super) status_label: String,
    pub(super) project_name: String,
}

/// Shows the main window behind the intro once it is worth looking at.
///
/// Resolves no earlier than the frontend's readiness signal (capped by
/// [`MAIN_WINDOW_READY_WAIT`]) so the intro can start its fade knowing the
/// first real screen is already painted underneath it.
#[tauri::command]
#[specta::specta]
pub(super) async fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let shared = {
            let state = app.state::<LaunchIntroState>();
            state.shared()
        };
        shared.request_reveal();
        if !shared.is_main_ready() {
            let waiter = Arc::clone(&shared);
            tauri::async_runtime::spawn_blocking(move || {
                waiter.wait_for_main_ready(MAIN_WINDOW_READY_WAIT)
            })
            .await
            .map_err(|error| format!("Briar 메인 창 준비를 기다리지 못했습니다: {error}"))?;
        }
        display_main_window(&app, false)
    }
    #[cfg(not(desktop))]
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
        persist_launch_intro_seen(&app);
        display_main_window(&app, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Writes the "intro seen" marker, logging instead of failing the caller.
#[cfg(target_os = "macos")]
pub(super) fn persist_launch_intro_seen(app: &AppHandle) {
    match app.path().app_data_dir() {
        Ok(directory) => {
            if let Err(error) = record_launch_intro_seen(&directory) {
                eprintln!("Launch intro marker write failed: {error}");
            }
        }
        Err(error) => eprintln!("Launch intro marker path failed: {error}"),
    }
}

/// Opens the first-run intro from `setup` when this profile has never seen it.
///
/// Running before the frontend boots is the whole point: the intro covers the
/// bundle download, the React mount, and the session restore instead of
/// starting after them.
#[cfg(target_os = "macos")]
pub(super) fn start_launch_intro_if_needed(app: &AppHandle) {
    let app_data_directory = match app.path().app_data_dir() {
        Ok(directory) => directory,
        Err(error) => {
            eprintln!("Launch intro marker path failed: {error}");
            return;
        }
    };
    let has_existing_session = session_file_path(app)
        .map(|path| path.exists())
        .unwrap_or(false);
    match launch_intro_decision(
        has_seen_launch_intro(&app_data_directory),
        has_existing_session,
    ) {
        LaunchIntroDecision::AlreadySeen => {}
        LaunchIntroDecision::AdoptExistingProfile => {
            if let Err(error) = record_launch_intro_seen(&app_data_directory) {
                eprintln!("Launch intro marker write failed: {error}");
            }
        }
        LaunchIntroDecision::Show => {
            if let Err(error) = open_launch_intro_window(app) {
                eprintln!("Launch intro startup failed: {error}");
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn prepare_launch_intro(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_launch_intro_window(&app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("The native launch intro is only available on macOS".to_string())
    }
}

/// Builds the always-on-top intro window over the current display.
///
/// Idempotent: a launch that already opened the intro from `setup` keeps the
/// window the frontend's effect would otherwise duplicate.
#[cfg(target_os = "macos")]
pub(super) fn open_launch_intro_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("launch-intro").is_some() {
        return Ok(());
    }

    let main = main_window(app)?;
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

    // A dedicated entry, not `index.html`: the intro must not download and
    // evaluate the whole app bundle a second time just to draw a splash.
    let build_result = WebviewWindowBuilder::new(
        app,
        "launch-intro",
        WebviewUrl::App("intro.html?launchIntro=native".into()),
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
        let _ = display_main_window(app, true);
        return Err(error.to_string());
    }

    // The intro window is driven by frontend timers. If its script fails to
    // load after an update, do not leave the production app running with
    // every window hidden forever.
    let fallback_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LAUNCH_INTRO_WATCHDOG);
        if let Some(intro) = fallback_app.get_webview_window("launch-intro") {
            let _ = intro.destroy();
            persist_launch_intro_seen(&fallback_app);
            let _ = display_main_window(&fallback_app, true);
        }
    });

    Ok(())
}

/// Shows the main window if a launch never revealed it.
///
/// The window is created hidden, so a frontend that crashes before its reveal
/// effect runs would otherwise leave the app with nothing on screen — including
/// the `startup-error` overlay it just rendered into that hidden webview.
#[cfg(desktop)]
pub(super) fn start_main_window_visibility_watchdog(app: &AppHandle) {
    let watchdog_app = app.clone();
    let shared = {
        let state = app.state::<LaunchIntroState>();
        state.shared()
    };
    std::thread::spawn(move || {
        std::thread::sleep(MAIN_WINDOW_VISIBILITY_WATCHDOG);
        // An intro on screen owns the reveal and has its own watchdog, and a
        // reveal already parked on the readiness gate will show the window
        // itself once boot settles.
        if watchdog_app.get_webview_window("launch-intro").is_some() || shared.reveal_requested() {
            return;
        }
        let Some(main) = watchdog_app.get_webview_window("main") else {
            return;
        };
        if main.is_visible().unwrap_or(true) {
            return;
        }
        if let Err(error) = display_main_window(&watchdog_app, true) {
            eprintln!("Main window visibility watchdog failed: {error}");
        }
    });
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
    // Parenting to a window that has never been shown would hide the sheet
    // along with it, so only attach once the main window is on screen.
    let dialog = match app
        .get_webview_window("main")
        .filter(|main| main.is_visible().unwrap_or(false))
    {
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
