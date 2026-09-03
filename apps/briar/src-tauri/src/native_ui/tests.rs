use super::*;

#[cfg(target_os = "macos")]
#[test]
fn app_update_menu_label_reflects_availability() {
    assert_eq!(app_update_menu_label(false), "Check for Updates…");
    assert_eq!(app_update_menu_label(true), "Update Briar…");
}

#[test]
fn launch_intro_covers_the_desktop_below_the_menu_bar() {
    assert_eq!(
        launch_intro_bounds(0, 0, 3024, 1964, 48),
        (0, 48, 3024, 1916)
    );
    assert_eq!(
        launch_intro_bounds(-2560, -120, 2560, 1440, -120),
        (-2560, -120, 2560, 1440)
    );
}

#[test]
fn uses_compact_window_presentation_only_during_onboarding() {
    assert_eq!(main_window_size(true), ONBOARDING_MAIN_WINDOW_SIZE);
    assert_eq!(main_window_size(false), DEFAULT_MAIN_WINDOW_SIZE);
    assert_eq!(main_window_min_size(true), ONBOARDING_MAIN_WINDOW_SIZE);
    assert_eq!(main_window_min_size(false), DEFAULT_MAIN_WINDOW_MIN_SIZE);
    assert!(!main_window_decorated(true));
    assert!(main_window_decorated(false));
    assert_eq!(restored_main_window_title_bar_style(true), None);
    assert_eq!(
        restored_main_window_title_bar_style(false),
        Some(tauri::TitleBarStyle::Overlay)
    );
}

#[cfg(desktop)]
#[test]
fn centers_the_main_window_only_on_its_first_show() {
    assert!(should_center_main_window(false));
    assert!(!should_center_main_window(true));
}

#[cfg(desktop)]
#[test]
fn plays_the_intro_once_per_profile_and_adopts_pre_marker_profiles() {
    assert_eq!(
        launch_intro_decision(false, false),
        LaunchIntroDecision::Show
    );
    assert_eq!(
        launch_intro_decision(false, true),
        LaunchIntroDecision::AdoptExistingProfile
    );
    assert_eq!(
        launch_intro_decision(true, false),
        LaunchIntroDecision::AlreadySeen
    );
    assert_eq!(
        launch_intro_decision(true, true),
        LaunchIntroDecision::AlreadySeen
    );
}

#[cfg(desktop)]
#[test]
fn records_the_launch_intro_marker_in_the_app_data_directory() {
    let directory = tempfile::tempdir().expect("temporary app data directory");
    let app_data_directory = directory.path().join("missing-until-now");

    assert!(!has_seen_launch_intro(&app_data_directory));
    record_launch_intro_seen(&app_data_directory).expect("marker write");
    assert!(has_seen_launch_intro(&app_data_directory));
    assert_eq!(
        launch_intro_marker_path(&app_data_directory),
        app_data_directory.join(LAUNCH_INTRO_SEEN_FILE)
    );

    // Rewriting an existing marker must stay a no-op.
    record_launch_intro_seen(&app_data_directory).expect("idempotent marker write");
    assert!(has_seen_launch_intro(&app_data_directory));
}

#[cfg(desktop)]
#[test]
fn resolves_the_reveal_wait_as_soon_as_the_main_window_reports_ready() {
    let shared = Arc::new(LaunchIntroShared::default());
    assert!(!shared.is_main_ready());
    assert!(!shared.reveal_requested());
    assert!(shared.request_reveal());
    assert!(!shared.request_reveal());
    assert!(shared.reveal_requested());

    let signaller = Arc::clone(&shared);
    let handle = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(20));
        signaller.mark_main_ready();
    });

    assert!(shared.wait_for_main_ready(std::time::Duration::from_secs(5)));
    assert!(shared.is_main_ready());
    handle.join().expect("signal thread");

    // A window that is already ready must not park the reveal at all.
    assert!(shared.wait_for_main_ready(std::time::Duration::from_millis(0)));
}

#[cfg(desktop)]
#[test]
fn gives_up_on_the_reveal_wait_once_the_cap_elapses() {
    let shared = LaunchIntroShared::default();
    let started = std::time::Instant::now();
    assert!(!shared.wait_for_main_ready(std::time::Duration::from_millis(30)));
    assert!(started.elapsed() >= std::time::Duration::from_millis(25));
    assert!(!shared.is_main_ready());
}

#[cfg(target_os = "macos")]
#[test]
fn holds_the_intro_watchdog_past_the_slowest_reveal() {
    // Five second hold + the readiness wait cap + the 600ms fade.
    assert!(
        LAUNCH_INTRO_WATCHDOG > MAIN_WINDOW_READY_WAIT + std::time::Duration::from_millis(5_600)
    );
    assert!(MAIN_WINDOW_VISIBILITY_WATCHDOG < LAUNCH_INTRO_WATCHDOG);
}

#[cfg(desktop)]
#[test]
fn restores_only_the_main_window_size_and_maximized_state() {
    use tauri_plugin_window_state::StateFlags;

    let flags = main_window_state_flags();
    assert!(flags.contains(StateFlags::SIZE));
    assert!(flags.contains(StateFlags::MAXIMIZED));
    assert!(!flags.contains(StateFlags::POSITION));
    assert!(!flags.contains(StateFlags::VISIBLE));
    assert!(!flags.contains(StateFlags::DECORATIONS));
    assert!(!flags.contains(StateFlags::FULLSCREEN));
}
