mod agent;
mod agent_usage;
mod auto_hunt_dispatch;
mod host;
#[cfg(target_os = "macos")]
mod macos_inbox_notifications;
#[cfg(target_os = "macos")]
mod macos_secure_input;
mod planned_update_recovery;
#[cfg(desktop)]
mod status_tray;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    env,
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[cfg(target_os = "macos")]
use tauri::{webview::Color, WebviewUrl, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

const SESSION_FILE_NAME: &str = "session.json";
const AUTO_HUNT_EVENT_DIRECTORY: &str = "auto-hunt-sessions";
const WORKTREE_INCLUDE_FILE: &str = ".worktreeinclude";
const WORKTREE_INCLUDE_MAX_BYTES: u64 = 256 * 1024;
const WORKTREE_INCLUDE_MAX_ENTRIES: usize = 200;
const AUTO_HUNT_APP_SERVER_EVENT: &str = "auto-hunt-app-server-event";
const AUTO_HUNT_DISPATCH_EVENT: &str = "auto-hunt-dispatch-event";
const PROJECT_LLM_PROGRESS_EVENT: &str = "project-llm-progress";
const PROJECT_AGENT_SCHEDULE_POLL_EVENT: &str = "project-agent-schedule-poll";
#[cfg(all(desktop, not(dev)))]
const WORKTREE_SWEEP_INTERVAL_SECS: u64 = 60 * 60;
#[cfg(all(desktop, not(target_os = "macos")))]
const INBOX_NOTIFICATION_OPEN_EVENT: &str = "inbox-notification-open";
#[cfg(target_os = "macos")]
const INBOX_NOTIFICATION_OPEN_AVAILABLE_EVENT: &str = "inbox-notification-open-available";
const AGENT_SESSION_STOPPED_ERROR: &str = "사용자가 에이전트 세션을 중지했습니다.";
const GITHUB_DEVICE_LOGIN_URL: &str = "https://github.com/login/device";
#[cfg(not(target_os = "windows"))]
const GITHUB_CLI_NOOP_BROWSER: &str = "/usr/bin/true";
#[cfg(target_os = "windows")]
const GITHUB_CLI_NOOP_BROWSER: &str = "cmd.exe /D /C rem";
const DEFAULT_MAIN_WINDOW_SIZE: (f64, f64) = (1440.0, 900.0);
const DEFAULT_MAIN_WINDOW_MIN_SIZE: (f64, f64) = (980.0, 680.0);
const ONBOARDING_MAIN_WINDOW_SIZE: (f64, f64) = (780.0, 580.0);
const MAX_REPOSITORY_ICON_BYTES: u64 = 10 * 1024 * 1024;
const MAX_AGENT_RESPONSIBILITY_CHARS: usize = 20_000;
const MAX_RENDERED_AGENT_SKILL_ROSTER_CHARS: usize = 125_000;
const REPOSITORY_ICON_CANDIDATES: &[&str] = &[
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "app/favicon.ico",
    "app/favicon.png",
    "app/icon.svg",
    "app/icon.png",
    "app/icon.ico",
    "src/favicon.ico",
    "src/favicon.svg",
    "src/app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "assets/icon.svg",
    "assets/icon.png",
    "assets/logo.svg",
    "assets/logo.png",
    ".idea/icon.svg",
];
const REPOSITORY_ICON_SOURCE_FILES: &[&str] = &[
    "index.html",
    "public/index.html",
    "app/routes/__root.tsx",
    "src/routes/__root.tsx",
    "app/root.tsx",
    "src/root.tsx",
    "src/index.html",
];

// Backend module map:
// - app_state: shared state, persisted session data, and application-level settings types
// - agent_cli: provider CLI discovery, installation, login, and model catalogs
// - repository: repository creation, cloning, readiness, and compatibility checks
// - project_config: connected-project configuration, worktrees, workflows, and bundled assets
// - execution_worker: worker configuration, health, and installed-runtime synchronization
// - project_execution: project chat, agent sessions, cancellation, and sandbox selection
// - auto_hunt: run claiming, dispatch, retry/recovery, evidence, and event logs
// - settings: Tauri commands that expose persisted project/application settings
// - native_ui: windows, menus, tray, notifications, updates, and macOS integration
// - app_builder: Tauri state/plugin setup and the stable command registration contract
mod agent_cli;
mod app_builder;
mod app_state;
mod auto_hunt;
mod execution_worker;
mod native_ui;
mod project_config;
mod project_execution;
mod repository;
mod settings;

use agent_cli::*;
use app_state::*;
use auto_hunt::*;
use execution_worker::*;
use native_ui::*;
use project_config::*;
use project_execution::*;
use repository::*;
use settings::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_builder::run();
}

#[cfg(test)]
mod tests;
