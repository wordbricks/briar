//! macOS menu-bar (status) tray for Briar.
//!
//! Shows a template tray icon and a menu of currently running Auto Hunt
//! issues with their workflow stage / status. The frontend pushes the
//! localized snapshot; this module only renders native menu chrome.

use super::native_ui::{StatusTrayRunItem, StatusTraySnapshot};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager,
};
use tauri_specta::Event as _;

pub const TRAY_ID: &str = "briar-status";
pub const OPEN_BRIAR_MENU_ID: &str = "status-tray:open-briar";
pub const QUIT_BRIAR_MENU_ID: &str = "status-tray:quit-briar";
pub const RUN_MENU_ID_PREFIX: &str = "status-tray:run:";
const MAX_TITLE_CHARS: usize = 42;
const TRAY_ICON_SCALE: f64 = 1.8;
// Keep the canonical line-art mark as the template source. The macOS tray-icon
// backend normalizes the complete image canvas to 18pt, so the visible mark can
// only grow by occupying more of that slot. Zoom about the center by the
// requested 1.8x, capped so the full silhouette still fits instead of cropping
// into a square of inner lines.
const TRAY_TEMPLATE_PNG: &[u8] = include_bytes!("../../src/assets/brand/briar-mark-dark.png");

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

#[derive(Debug)]
struct ProjectGroup<'a> {
    project_id: &'a str,
    project_name: &'a str,
    items: Vec<&'a StatusTrayRunItem>,
}

#[derive(Debug, PartialEq, Eq)]
enum ProjectMenuEntry<'a> {
    Header {
        project_id: &'a str,
        project_name: &'a str,
    },
    Run(&'a StatusTrayRunItem),
    Separator,
}

fn project_groups(snapshot: &StatusTraySnapshot) -> Vec<ProjectGroup<'_>> {
    let mut groups: Vec<ProjectGroup<'_>> = Vec::new();
    for item in &snapshot.items {
        if let Some(group) = groups
            .iter_mut()
            .find(|group| group.project_id == item.project_id)
        {
            group.items.push(item);
        } else {
            groups.push(ProjectGroup {
                project_id: &item.project_id,
                project_name: &item.project_name,
                items: vec![item],
            });
        }
    }
    groups
}

fn project_menu_entries(snapshot: &StatusTraySnapshot) -> Vec<ProjectMenuEntry<'_>> {
    project_groups(snapshot)
        .into_iter()
        .flat_map(|group| {
            let project_name = if group.project_name.trim().is_empty() {
                group.project_id
            } else {
                group.project_name.trim()
            };
            std::iter::once(ProjectMenuEntry::Header {
                project_id: group.project_id,
                project_name,
            })
            .chain(group.items.into_iter().map(ProjectMenuEntry::Run))
            .chain(std::iter::once(ProjectMenuEntry::Separator))
        })
        .collect()
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
        .map(|image| {
            let scale = applied_tray_icon_scale(&image);
            scale_image_about_center(&image, scale)
        })
        .map_err(|error| format!("Status tray icon decode failed: {error}"))
}

fn opaque_bounds(image: &Image<'_>) -> Option<(u32, u32, u32, u32)> {
    let width = image.width();
    let height = image.height();
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;
    let mut found = false;
    for (index, pixel) in image.rgba().as_chunks::<4>().0.iter().enumerate() {
        if pixel[3] == 0 {
            continue;
        }
        found = true;
        let x = index as u32 % width;
        let y = index as u32 / width;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    found.then_some((min_x, min_y, max_x, max_y))
}

fn scale_to_edge(center: f64, inner: f64, outer: f64) -> f64 {
    let span = inner - center;
    if span.abs() <= 0.0 {
        f64::INFINITY
    } else {
        (outer - center) / span
    }
}

fn max_unclipped_scale(image: &Image<'_>) -> f64 {
    let Some((min_x, min_y, max_x, max_y)) = opaque_bounds(image) else {
        return 1.0;
    };
    let width = image.width() as f64;
    let height = image.height() as f64;
    let center_x = (width - 1.0) / 2.0;
    let center_y = (height - 1.0) / 2.0;
    // Half-pixel inset keeps nearest-neighbor rounding from dropping the ring.
    [
        scale_to_edge(center_x, min_x as f64 - 0.5, 0.0),
        scale_to_edge(center_x, max_x as f64 + 0.5, width - 1.0),
        scale_to_edge(center_y, min_y as f64 - 0.5, 0.0),
        scale_to_edge(center_y, max_y as f64 + 0.5, height - 1.0),
    ]
    .into_iter()
    .fold(f64::INFINITY, f64::min)
    .max(1.0)
}

fn applied_tray_icon_scale(image: &Image<'_>) -> f64 {
    TRAY_ICON_SCALE.min(max_unclipped_scale(image))
}

fn scale_image_about_center(image: &Image<'_>, scale: f64) -> Image<'static> {
    let width = image.width();
    let height = image.height();
    let source = image.rgba();
    let mut scaled = vec![0; source.len()];
    let center_x = (width as f64 - 1.0) / 2.0;
    let center_y = (height as f64 - 1.0) / 2.0;
    let max_x = width.saturating_sub(1) as f64;
    let max_y = height.saturating_sub(1) as f64;

    for y in 0..height {
        for x in 0..width {
            let source_x = ((x as f64 - center_x) / scale + center_x)
                .round()
                .clamp(0.0, max_x) as u32;
            let source_y = ((y as f64 - center_y) / scale + center_y)
                .round()
                .clamp(0.0, max_y) as u32;
            let source_offset = ((source_y * width + source_x) * 4) as usize;
            let target_offset = ((y * width + x) * 4) as usize;
            scaled[target_offset..target_offset + 4]
                .copy_from_slice(&source[source_offset..source_offset + 4]);
        }
    }

    Image::new_owned(scaled, width, height)
}

fn build_menu(app: &AppHandle, snapshot: &StatusTraySnapshot) -> Result<Menu<tauri::Wry>, String> {
    let entries = project_menu_entries(snapshot);
    let has_project_sections = !entries.is_empty();
    let mut menu = MenuBuilder::new(app);

    for entry in entries {
        match entry {
            ProjectMenuEntry::Header {
                project_id,
                project_name,
            } => {
                let header = MenuItemBuilder::with_id(
                    format!("status-tray:project-header:{project_id}"),
                    project_name,
                )
                .enabled(false)
                .build(app)
                .map_err(|error| format!("Status tray project header failed: {error}"))?;
                menu = menu.item(&header);
            }
            ProjectMenuEntry::Run(item) => {
                menu = menu.text(
                    run_menu_id(&item.project_id, &item.run_id),
                    format_run_menu_text(&item.title, &item.status_label),
                );
            }
            ProjectMenuEntry::Separator => {
                menu = menu.separator();
            }
        }
    }

    if !has_project_sections {
        let empty = MenuItemBuilder::with_id("status-tray:empty", &snapshot.empty_label)
            .enabled(false)
            .build(app)
            .map_err(|error| format!("Status tray empty item failed: {error}"))?;
        menu = menu.item(&empty).separator();
    }

    let open = MenuItemBuilder::with_id(OPEN_BRIAR_MENU_ID, &snapshot.open_label)
        .enabled(true)
        .build(app)
        .map_err(|error| format!("Status tray open item failed: {error}"))?;
    let quit = MenuItemBuilder::with_id(QUIT_BRIAR_MENU_ID, &snapshot.quit_label)
        .enabled(true)
        .build(app)
        .map_err(|error| format!("Status tray quit item failed: {error}"))?;
    menu.item(&open)
        .item(&quit)
        .build()
        .map_err(|error| format!("Status tray menu failed: {error}"))
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
                let _ = crate::ipc::StatusTrayOpenRunPayload { project_id, run_id }.emit(app);
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

    #[test]
    fn groups_every_running_issue_by_project() {
        let items = (0..9)
            .map(|index| StatusTrayRunItem {
                project_id: if index % 2 == 0 { "p1" } else { "p2" }.to_string(),
                project_name: if index % 2 == 0 { "Briar" } else { "Crane" }.to_string(),
                run_id: format!("r{index}"),
                title: format!("Issue {index}"),
                status_label: "Running".to_string(),
            })
            .collect();
        let snapshot = StatusTraySnapshot {
            items,
            ..StatusTraySnapshot::default()
        };

        let groups = project_groups(&snapshot);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].project_name, "Briar");
        assert_eq!(groups[1].project_name, "Crane");
        assert_eq!(
            groups.iter().map(|group| group.items.len()).sum::<usize>(),
            9
        );
    }

    #[test]
    fn lays_out_project_sections_as_flat_headers_runs_and_dividers() {
        let snapshot = StatusTraySnapshot {
            items: vec![
                StatusTrayRunItem {
                    project_id: "p1".to_string(),
                    project_name: "  Briar  ".to_string(),
                    run_id: "r1".to_string(),
                    title: "First".to_string(),
                    status_label: "Running".to_string(),
                },
                StatusTrayRunItem {
                    project_id: "p2".to_string(),
                    project_name: String::new(),
                    run_id: "r2".to_string(),
                    title: "Second".to_string(),
                    status_label: "Running".to_string(),
                },
                StatusTrayRunItem {
                    project_id: "p1".to_string(),
                    project_name: "Briar".to_string(),
                    run_id: "r3".to_string(),
                    title: "Third".to_string(),
                    status_label: "Running".to_string(),
                },
            ],
            ..StatusTraySnapshot::default()
        };

        let entries = project_menu_entries(&snapshot);
        let layout = entries
            .iter()
            .map(|entry| match entry {
                ProjectMenuEntry::Header { project_name, .. } => {
                    format!("header:{project_name}")
                }
                ProjectMenuEntry::Run(item) => format!("run:{}", item.run_id),
                ProjectMenuEntry::Separator => "separator".to_string(),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            layout,
            vec![
                "header:Briar",
                "run:r1",
                "run:r3",
                "separator",
                "header:p2",
                "run:r2",
                "separator",
            ]
        );
    }

    #[test]
    fn tray_icon_uses_the_transparent_line_art_mark() {
        let image = tray_icon_image().expect("tray icon should decode");
        assert_eq!((image.width(), image.height()), (1000, 1000));

        let alpha = image
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|pixel| pixel[3])
            .collect::<Vec<_>>();
        let center_alpha = alpha[500 * image.width() as usize + 500];

        assert_eq!(
            center_alpha, 0,
            "line-art mark center should stay transparent"
        );
    }

    fn opaque_count(image: &Image<'_>) -> usize {
        image
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|pixel| pixel[3] > 0)
            .count()
    }

    #[test]
    fn tray_icon_artwork_is_scaled_up_by_one_point_eight() {
        assert_eq!(TRAY_ICON_SCALE, 1.8);

        let source = Image::from_bytes(TRAY_TEMPLATE_PNG).expect("source icon should decode");
        let applied = applied_tray_icon_scale(&source);
        assert_eq!(applied, TRAY_ICON_SCALE.min(max_unclipped_scale(&source)));
        assert!(applied > 1.0, "artwork should grow inside the 18pt canvas");
        assert!(
            applied <= TRAY_ICON_SCALE,
            "applied scale must not exceed the requested 1.8x"
        );

        let scaled = tray_icon_image().expect("tray icon should decode");
        assert_eq!(
            (scaled.width(), scaled.height()),
            (source.width(), source.height()),
            "the menu-bar canvas should retain its dimensions"
        );
        assert!(
            opaque_count(&scaled) > opaque_count(&source),
            "scaled artwork should occupy more of the fixed tray canvas"
        );
    }

    #[test]
    fn tray_icon_scale_keeps_the_complete_mark() {
        let source = Image::from_bytes(TRAY_TEMPLATE_PNG).expect("source icon should decode");
        let (min_x, min_y, max_x, max_y) =
            opaque_bounds(&source).expect("mark should have opaque pixels");
        let scale = applied_tray_icon_scale(&source);
        let width = source.width() as f64;
        let height = source.height() as f64;
        let center_x = (width - 1.0) / 2.0;
        let center_y = (height - 1.0) / 2.0;
        let sampled_left = (0.0 - center_x) / scale + center_x;
        let sampled_top = (0.0 - center_y) / scale + center_y;
        let sampled_right = (width - 1.0 - center_x) / scale + center_x;
        let sampled_bottom = (height - 1.0 - center_y) / scale + center_y;

        assert!(sampled_left <= min_x as f64);
        assert!(sampled_top <= min_y as f64);
        assert!(sampled_right >= max_x as f64);
        assert!(sampled_bottom >= max_y as f64);

        let scaled = tray_icon_image().expect("tray icon should decode");
        let (scaled_min_x, scaled_min_y, scaled_max_x, scaled_max_y) =
            opaque_bounds(&scaled).expect("scaled mark should have opaque pixels");
        assert!(scaled_min_x < min_x);
        assert!(scaled_min_y < min_y);
        assert!(scaled_max_x > max_x);
        assert!(scaled_max_y > max_y);
    }
}
