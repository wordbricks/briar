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
