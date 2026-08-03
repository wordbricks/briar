//! macOS menu-bar (status) tray for Briar.
//!
//! Shows a template tray icon and a menu of currently running Auto Hunt
//! issues with their workflow stage / status. The frontend pushes the
//! localized snapshot; this module only renders native menu chrome.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};

pub const TRAY_ID: &str = "briar-status";
pub const OPEN_BRIAR_MENU_ID: &str = "status-tray:open-briar";
pub const QUIT_BRIAR_MENU_ID: &str = "status-tray:quit-briar";
pub const RUN_MENU_ID_PREFIX: &str = "status-tray:run:";
pub const STATUS_TRAY_OPEN_RUN_EVENT: &str = "status-tray-open-run";

const MAX_VISIBLE_RUNS: usize = 8;
const MAX_TITLE_CHARS: usize = 42;
const TRAY_TEMPLATE_PNG: &[u8] = include_bytes!("../icons/tray-template.png");

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusTrayRunItem {
    pub project_id: String,
    pub run_id: String,
    pub title: String,
    pub status_label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub project_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusTraySnapshot {
    pub running_label: String,
    pub empty_label: String,
    pub open_label: String,
    pub quit_label: String,
    /// Localized overflow label with `{count}` placeholder for hidden runs.
    #[serde(default = "default_more_label")]
    pub more_label: String,
    #[serde(default)]
    pub items: Vec<StatusTrayRunItem>,
}

fn default_more_label() -> String {
    "+{count} more in Briar".to_string()
}

impl Default for StatusTraySnapshot {
    fn default() -> Self {
        Self {
            running_label: "Running".to_string(),
            empty_label: "No running issues".to_string(),
            open_label: "Open Briar".to_string(),
            quit_label: "Quit Briar".to_string(),
            more_label: default_more_label(),
            items: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusTrayOpenRunPayload {
    pub project_id: String,
    pub run_id: String,
}

pub struct StatusTrayState {
    snapshot: Mutex<StatusTraySnapshot>,
}

impl Default for StatusTrayState {
    fn default() -> Self {
        Self {
            snapshot: Mutex::new(StatusTraySnapshot::default()),
        }
    }
}

impl StatusTrayState {
    fn replace(&self, snapshot: StatusTraySnapshot) -> StatusTraySnapshot {
        let mut guard = self.snapshot.lock().expect("status tray snapshot lock");
        *guard = snapshot;
        guard.clone()
    }

    fn current(&self) -> StatusTraySnapshot {
        self.snapshot
            .lock()
            .expect("status tray snapshot lock")
            .clone()
    }
}

pub fn truncate_title(title: &str, max_chars: usize) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return "Untitled issue".to_string();
    }
    let count = trimmed.chars().count();
    if count <= max_chars {
        return trimmed.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let mut out: String = trimmed.chars().take(keep).collect();
    out.push('…');
    out
}

pub fn format_run_menu_text(title: &str, status_label: &str) -> String {
    let title = truncate_title(title, MAX_TITLE_CHARS);
    let status = status_label.trim();
    if status.is_empty() {
        title
    } else {
        format!("{title}  ·  {status}")
    }
}

pub fn run_menu_id(project_id: &str, run_id: &str) -> String {
    format!("{RUN_MENU_ID_PREFIX}{project_id}:{run_id}")
}

pub fn parse_run_menu_id(id: &str) -> Option<(String, String)> {
    let rest = id.strip_prefix(RUN_MENU_ID_PREFIX)?;
    let (project_id, run_id) = rest.split_once(':')?;
    if project_id.is_empty() || run_id.is_empty() {
        return None;
    }
    Some((project_id.to_string(), run_id.to_string()))
}

fn tray_icon_image() -> Result<Image<'static>, String> {
    Image::from_bytes(TRAY_TEMPLATE_PNG)
        .map(|image| image.to_owned())
        .map_err(|error| format!("Status tray icon decode failed: {error}"))
}

fn build_menu(app: &AppHandle, snapshot: &StatusTraySnapshot) -> Result<Menu<tauri::Wry>, String> {
    let mut owned_items = Vec::new();

    let running_header = MenuItemBuilder::with_id("status-tray:running-header", &snapshot.running_label)
        .enabled(false)
        .build(app)
        .map_err(|error| format!("Status tray header failed: {error}"))?;
    owned_items.push(running_header);

    let visible = snapshot.items.iter().take(MAX_VISIBLE_RUNS);
    let mut has_runs = false;
    for item in visible {
        has_runs = true;
        let text = format_run_menu_text(&item.title, &item.status_label);
        let id = run_menu_id(&item.project_id, &item.run_id);
        let menu_item = MenuItemBuilder::with_id(id, text)
            .enabled(true)
            .build(app)
            .map_err(|error| format!("Status tray run item failed: {error}"))?;
        owned_items.push(menu_item);
    }

    let overflow = snapshot.items.len().saturating_sub(MAX_VISIBLE_RUNS);
    if overflow > 0 {
        let more_text = snapshot
            .more_label
            .replace("{count}", &overflow.to_string());
        let more = MenuItemBuilder::with_id("status-tray:more", more_text)
            .enabled(false)
            .build(app)
            .map_err(|error| format!("Status tray overflow item failed: {error}"))?;
        owned_items.push(more);
    }

    if !has_runs {
        let empty = MenuItemBuilder::with_id("status-tray:empty", &snapshot.empty_label)
            .enabled(false)
            .build(app)
            .map_err(|error| format!("Status tray empty item failed: {error}"))?;
        owned_items.push(empty);
    }

    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("Status tray separator failed: {error}"))?;
    let open = MenuItemBuilder::with_id(OPEN_BRIAR_MENU_ID, &snapshot.open_label)
        .enabled(true)
        .build(app)
        .map_err(|error| format!("Status tray open item failed: {error}"))?;
    let quit = MenuItemBuilder::with_id(QUIT_BRIAR_MENU_ID, &snapshot.quit_label)
        .enabled(true)
        .build(app)
        .map_err(|error| format!("Status tray quit item failed: {error}"))?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        Vec::with_capacity(owned_items.len() + 3);
    for item in &owned_items {
        refs.push(item);
    }
    refs.push(&separator);
    refs.push(&open);
    refs.push(&quit);

    Menu::with_items(app, &refs).map_err(|error| format!("Status tray menu failed: {error}"))
}

fn tooltip_for(snapshot: &StatusTraySnapshot) -> String {
    let count = snapshot.items.len();
    if count == 0 {
        "Briar".to_string()
    } else {
        format!("Briar · {count} running")
    }
}

fn apply_snapshot(app: &AppHandle, snapshot: &StatusTraySnapshot) -> Result<(), String> {
    let menu = build_menu(app, snapshot)?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Status tray icon is not installed.".to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("Status tray menu update failed: {error}"))?;
    tray.set_tooltip(Some(tooltip_for(snapshot)))
        .map_err(|error| format!("Status tray tooltip update failed: {error}"))?;
    Ok(())
}

fn show_main_window_from_tray(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        OPEN_BRIAR_MENU_ID => {
            show_main_window_from_tray(app);
        }
        QUIT_BRIAR_MENU_ID => {
            crate::request_exit_confirmation(app);
        }
        other => {
            if let Some((project_id, run_id)) = parse_run_menu_id(other) {
                show_main_window_from_tray(app);
                let _ = app.emit(
                    STATUS_TRAY_OPEN_RUN_EVENT,
                    StatusTrayOpenRunPayload { project_id, run_id },
                );
            }
        }
    }
}

/// Install the macOS status-bar tray icon. Safe to call once during setup.
pub fn install(app: &AppHandle) -> Result<TrayIcon<tauri::Wry>, String> {
    let icon = tray_icon_image()?;
    let snapshot = app.state::<StatusTrayState>().current();
    let menu = build_menu(app, &snapshot)?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip(tooltip_for(&snapshot))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .build(app)
        .map_err(|error| format!("Status tray install failed: {error}"))?;

    Ok(tray)
}

pub fn sync_snapshot(app: &AppHandle, snapshot: StatusTraySnapshot) -> Result<(), String> {
    let stored = app.state::<StatusTrayState>().replace(snapshot);
    if app.tray_by_id(TRAY_ID).is_none() {
        // Tray is macOS-only at install time; no-op elsewhere.
        return Ok(());
    }
    apply_snapshot(app, &stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_long_titles_with_ellipsis() {
        let long = "가".repeat(50);
        let truncated = truncate_title(&long, 10);
        assert_eq!(truncated.chars().count(), 10);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn formats_run_menu_text_with_status() {
        assert_eq!(
            format_run_menu_text("Issue title", "구현"),
            "Issue title  ·  구현"
        );
        assert_eq!(format_run_menu_text("  Alone  ", ""), "Alone");
    }

    #[test]
    fn round_trips_run_menu_ids() {
        let id = run_menu_id("proj-1", "run-2");
        assert_eq!(
            parse_run_menu_id(&id),
            Some(("proj-1".to_string(), "run-2".to_string()))
        );
        assert_eq!(parse_run_menu_id("status-tray:open-briar"), None);
    }
}
