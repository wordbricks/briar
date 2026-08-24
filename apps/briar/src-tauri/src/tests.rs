use super::*;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
#[test]
fn app_update_menu_label_reflects_availability() {
    assert_eq!(app_update_menu_label(false), "Check for Updates…");
    assert_eq!(app_update_menu_label(true), "Update Briar…");
}

#[test]
fn inbox_channel_notification_target_preserves_message_context() {
    let target: InboxNotificationTarget = serde_json::from_value(json!({
        "messageId": "channel:reply-1",
        "projectId": "project-1",
        "targetId": "channel-1",
        "kind": "channel",
        "channelMessageId": "reply-1",
        "rootMessageId": "root-1"
    }))
    .expect("channel notification target");

    assert_eq!(target.channel_message_id.as_deref(), Some("reply-1"));
    assert_eq!(target.root_message_id.as_deref(), Some("root-1"));
    assert_eq!(
        serde_json::to_value(target).expect("serialized channel notification target"),
        json!({
            "messageId": "channel:reply-1",
            "projectId": "project-1",
            "targetId": "channel-1",
            "kind": "channel",
            "channelMessageId": "reply-1",
            "rootMessageId": "root-1"
        })
    );
}

#[test]
fn parses_grok_model_catalog_and_default() {
    let models = parse_grok_models(
        "You are logged in.\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n",
    );
    assert_eq!(
        models,
        vec![
            AgentProviderModel {
                id: "grok-4.6".to_string(),
                label: "grok-4.6".to_string(),
                is_default: true,
                default_effort_id: None,
                efforts: Vec::new(),
            },
            AgentProviderModel {
                id: "grok-4.5".to_string(),
                label: "grok-4.5".to_string(),
                is_default: false,
                default_effort_id: None,
                efforts: Vec::new(),
            },
        ]
    );
}

#[test]
fn parses_opencode_model_catalog_one_slug_per_line() {
    let models = parse_opencode_models_verbose(
            "openai/gpt-5.6-sol\n{\n  \"name\": \"GPT 5.6 Sol\",\n  \"variants\": {\"high\": {}}\n}\nanthropic/claude-sonnet-4-6\n{\n  \"name\": \"Claude Sonnet 4.6\",\n  \"variants\": {}\n}\n",
        );
    assert_eq!(
        models.into_iter().map(|model| model.id).collect::<Vec<_>>(),
        vec!["openai/gpt-5.6-sol", "anthropic/claude-sonnet-4-6"]
    );
}

#[test]
fn falls_back_to_active_free_opencode_models_from_the_local_cache() {
    let fallback = parse_opencode_cached_models(
        r#"{
                "opencode": {
                    "models": {
                        "free-model": {
                            "id": "free-model",
                            "name": "Free model",
                            "cost": {"input": 0, "output": 0},
                            "reasoning_options": [
                                {"type": "effort", "values": ["low", "high"]}
                            ]
                        },
                        "paid-model": {
                            "name": "Paid model",
                            "cost": {"input": 1, "output": 2}
                        },
                        "retired-model": {
                            "name": "Retired model",
                            "status": "deprecated",
                            "cost": {"input": 0, "output": 0}
                        }
                    }
                }
            }"#,
    )
    .expect("the OpenCode cache should parse");
    let entry = provider_model_entry_with_fallback(
        Err("live catalog unavailable".to_string()),
        Ok(fallback),
        Vec::new(),
        true,
    );

    assert_eq!(entry.error.as_deref(), Some("live catalog unavailable"));
    assert_eq!(entry.models.len(), 1);
    assert_eq!(entry.models[0].id, "opencode/free-model");
    assert_eq!(entry.models[0].label, "Free model");
    assert_eq!(
        entry.models[0]
            .efforts
            .iter()
            .map(|effort| effort.id.as_str())
            .collect::<Vec<_>>(),
        vec!["low", "high"]
    );
}

#[test]
fn parses_measured_antigravity_model_catalog() {
    let models = parse_agy_models(
        r#"{"conversation_id":"","status":"SUCCESS","command":{"name":"models","data":{"models":[{"id":"gemini-3.7-flash-high","label":"Gemini 3.7 Flash (High)"},{"id":"gemini-3.7-flash-low","label":"Gemini 3.7 Flash (Low)"}]}}}"#,
    );
    assert_eq!(
        models,
        vec![
            AgentProviderModel {
                id: "gemini-3.7-flash-high".to_string(),
                label: "Gemini 3.7 Flash (High)".to_string(),
                is_default: false,
                default_effort_id: None,
                efforts: Vec::new(),
            },
            AgentProviderModel {
                id: "gemini-3.7-flash-low".to_string(),
                label: "Gemini 3.7 Flash (Low)".to_string(),
                is_default: false,
                default_effort_id: None,
                efforts: Vec::new(),
            },
        ]
    );
    assert_eq!(
        parse_agy_efforts("  --effort  Reasoning effort (low|medium|high)"),
        vec![
            AgentProviderEffort {
                id: "low".to_string(),
                label: "low".to_string(),
                description: None,
                is_default: false,
            },
            AgentProviderEffort {
                id: "medium".to_string(),
                label: "medium".to_string(),
                description: None,
                is_default: false,
            },
            AgentProviderEffort {
                id: "high".to_string(),
                label: "high".to_string(),
                description: None,
                is_default: false,
            },
        ]
    );
}

#[test]
fn parses_claude_models_and_efforts_from_help() {
    let help = "  --effort <level>  Effort (low, medium, high, xhigh, max)\n  --model <model>  Alias (e.g. 'fable', 'opus', or 'sonnet') or 'claude-fable-5'.\n  --name <name>  Session name\n";
    assert_eq!(
        parse_claude_models(help)
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>(),
        vec!["fable", "opus", "sonnet", "claude-fable-5"]
    );
    assert_eq!(
        parse_claude_efforts(help)
            .into_iter()
            .map(|effort| effort.id)
            .collect::<Vec<_>>(),
        vec!["low", "medium", "high", "xhigh", "max"]
    );
}

fn provider_prerequisite(installed: bool, authenticated: bool) -> OnboardingPrerequisiteStatus {
    OnboardingPrerequisiteStatus {
        installed,
        version: installed.then(|| "test-version".to_string()),
        authenticated,
    }
}

fn provider_prerequisites(
    codex: (bool, bool),
    claude: (bool, bool),
    grok: (bool, bool),
    opencode: (bool, bool),
) -> OnboardingPrerequisites {
    OnboardingPrerequisites {
        git: provider_prerequisite(true, true),
        codex: provider_prerequisite(codex.0, codex.1),
        claude: provider_prerequisite(claude.0, claude.1),
        cursor: provider_prerequisite(false, false),
        grok: provider_prerequisite(grok.0, grok.1),
        agy: provider_prerequisite(false, false),
        opencode: provider_prerequisite(opencode.0, opencode.1),
        openrouter: provider_prerequisite(false, false),
    }
}

#[test]
fn selects_an_authenticated_llm_provider_for_repository_analysis() {
    let prerequisites =
        provider_prerequisites((true, false), (true, true), (false, false), (false, false));

    assert_eq!(
        connected_agent_provider(&prerequisites, AppProviderSettings::default())
            .expect("Claude should be selected"),
        agent::AgentProviderKind::Claude
    );
}

#[test]
fn skips_authenticated_llm_providers_disabled_in_app_settings() {
    let prerequisites =
        provider_prerequisites((true, true), (true, false), (true, true), (true, true));

    assert_eq!(
        connected_agent_provider(
            &prerequisites,
            AppProviderSettings {
                codex: false,
                claude: true,
                cursor: true,
                grok: true,
                agy: true,
                opencode: true,
                openrouter: true,
            },
        )
        .expect("Grok should be selected"),
        agent::AgentProviderKind::Grok
    );
}

#[test]
fn selects_connected_opencode_for_repository_analysis() {
    let prerequisites =
        provider_prerequisites((false, false), (false, false), (false, false), (true, true));

    assert_eq!(
        connected_agent_provider(&prerequisites, AppProviderSettings::default())
            .expect("OpenCode should be selected"),
        agent::AgentProviderKind::Opencode
    );
}

#[test]
fn rejects_repository_analysis_without_a_connected_llm_provider() {
    let prerequisites =
        provider_prerequisites((true, false), (false, false), (true, false), (false, false));

    assert!(
        connected_agent_provider(&prerequisites, AppProviderSettings::default())
            .expect_err("a connected provider should be required")
            .contains("연결된 LLM 프로바이더가 없습니다")
    );
}

#[test]
fn discovers_repository_icons_using_t3code_candidate_priority() {
    let directory = tempfile::tempdir().expect("temporary repository");
    fs::create_dir_all(directory.path().join("brand")).expect("brand directory");
    fs::write(
        directory.path().join("t3.json"),
        r#"{"iconPath":"brand/mark.svg"}"#,
    )
    .expect("project metadata");
    fs::write(directory.path().join("brand/mark.svg"), "<svg>mark</svg>").expect("configured icon");
    fs::write(directory.path().join("favicon.png"), b"fallback").expect("fallback icon");

    let icon = repository_icon_path(directory.path()).expect("repository icon");
    assert!(icon.ends_with("brand/mark.svg"));
    assert!(repository_icon_data_url(directory.path())
        .expect("icon data URL")
        .expect("icon")
        .starts_with("data:image/svg+xml;base64,"));
}

#[test]
fn discovers_repository_icon_declared_in_html() {
    let directory = tempfile::tempdir().expect("temporary repository");
    fs::create_dir_all(directory.path().join("public/brand")).expect("icon directory");
    fs::write(
        directory.path().join("index.html"),
        r#"<link href="/brand/logo.svg" rel="icon">"#,
    )
    .expect("html");
    fs::write(
        directory.path().join("public/brand/logo.svg"),
        "<svg>brand</svg>",
    )
    .expect("icon");

    let icon = repository_icon_path(directory.path()).expect("repository icon");
    assert!(icon.ends_with("public/brand/logo.svg"));
}

#[test]
fn extracts_repository_icon_from_router_metadata() {
    assert_eq!(
        repository_icon_href(
            r#"export const links = () => [{ href: "/favicon.svg", rel: "icon" }];"#,
        ),
        Some("/favicon.svg".to_string())
    );
}

#[test]
fn repository_icon_never_escapes_repository_root() {
    let parent = tempfile::tempdir().expect("temporary parent");
    let repository = parent.path().join("repository");
    fs::create_dir_all(&repository).expect("repository");
    fs::write(parent.path().join("secret.svg"), "<svg>secret</svg>").expect("outside icon");
    fs::write(
        repository.join("t3.json"),
        r#"{"iconPath":"../secret.svg"}"#,
    )
    .expect("project metadata");

    assert_eq!(repository_icon_path(&repository), None);
}

#[test]
fn recognizes_standard_tanstack_start_lovable_repositories() {
    let repository = tempfile::tempdir().expect("temporary repository");
    fs::write(
        repository.path().join("package.json"),
        r#"{
              "packageManager": "npm@11.0.0",
              "scripts": {
                "dev": "vite dev",
                "lint": "eslint .",
                "test": "vitest run",
                "build": "vite build"
              },
              "dependencies": {
                "@tanstack/react-start": "^1.0.0",
                "react": "^19.0.0"
              },
              "devDependencies": { "vite": "^7.0.0" }
            }"#,
    )
    .expect("package manifest");
    fs::write(repository.path().join("package-lock.json"), "{}\n").expect("package lock");
    fs::write(
        repository.path().join("vite.config.ts"),
        "export default {};\n",
    )
    .expect("Vite configuration");

    let compatibility = inspect_lovable_repository_compatibility_in(repository.path());

    assert!(compatibility.compatible, "{:?}", compatibility.issues);
    assert_eq!(compatibility.stack.as_deref(), Some("tanstack-start"));
    assert_eq!(compatibility.package_manager.as_deref(), Some("npm"));
    assert_eq!(compatibility.scripts, vec!["build", "dev", "lint", "test"]);
}

#[test]
fn recognizes_legacy_vite_lovable_repositories() {
    let repository = tempfile::tempdir().expect("temporary repository");
    fs::write(
        repository.path().join("package.json"),
        r#"{
              "scripts": { "dev": "vite", "build": "vite build" },
              "dependencies": { "react": "^18.0.0" },
              "devDependencies": { "vite": "^5.0.0" }
            }"#,
    )
    .expect("package manifest");
    fs::write(repository.path().join("bun.lock"), "").expect("bun lockfile");
    fs::write(
        repository.path().join("vite.config.ts"),
        "export default {};\n",
    )
    .expect("Vite configuration");

    let compatibility = inspect_lovable_repository_compatibility_in(repository.path());

    assert!(compatibility.compatible, "{:?}", compatibility.issues);
    assert_eq!(compatibility.stack.as_deref(), Some("vite-react"));
    assert_eq!(compatibility.package_manager.as_deref(), Some("bun"));
}

#[test]
fn sends_custom_lovable_delivery_workflows_to_repository_analysis() {
    let repository = tempfile::tempdir().expect("temporary repository");
    fs::write(
        repository.path().join("package.json"),
        r#"{
              "scripts": {
                "build": "vite build",
                "deploy": "wrangler deploy"
              },
              "dependencies": { "react": "^18.0.0" },
              "devDependencies": { "vite": "^5.0.0" }
            }"#,
    )
    .expect("package manifest");
    fs::create_dir_all(repository.path().join(".github/workflows")).expect("workflow directory");
    fs::create_dir_all(repository.path().join("supabase/functions"))
        .expect("Supabase functions directory");
    fs::write(
        repository.path().join("supabase/config.toml"),
        "project_id = 'app'\n",
    )
    .expect("Supabase configuration");
    fs::write(
        repository.path().join("vite.config.ts"),
        "export default {};\n",
    )
    .expect("Vite configuration");

    let compatibility = inspect_lovable_repository_compatibility_in(repository.path());

    assert!(!compatibility.compatible);
    assert!(compatibility
        .issues
        .iter()
        .any(|issue| issue.contains("Custom deployment scripts")));
    assert!(compatibility
        .issues
        .iter()
        .any(|issue| issue.contains("Custom CI or deployment")));
    assert!(compatibility
        .issues
        .iter()
        .any(|issue| issue.contains("Supabase Edge Functions")));
}

#[test]
fn rejects_shell_composition_in_preset_validation_scripts() {
    assert!(package_script_is_preset_compatible(
        "build",
        "tsc -b && vite build"
    ));
    assert!(!package_script_is_preset_compatible(
        "build",
        "vite build && curl https://example.com"
    ));
    assert!(!package_script_is_preset_compatible(
        "build",
        "vite build & curl https://example.com"
    ));
}

#[cfg(desktop)]
#[test]
fn exit_confirmation_allows_only_one_prompt_at_a_time() {
    let state = ExitConfirmationState::default();

    assert!(state.try_open_prompt());
    assert!(!state.try_open_prompt());

    state.close_prompt();
    assert!(state.try_open_prompt());
}

#[test]
fn stops_only_the_registered_agent_session_and_cleans_it_up() {
    let state = AgentSessionCancellationState::default();
    let registration = state.register("session-1").expect("registration");
    assert!(!registration.cancelled.load(Ordering::SeqCst));
    assert!(state.stop("session-1").expect("stop"));
    assert!(registration.cancelled.load(Ordering::SeqCst));
    assert!(!state.stop("missing-session").expect("missing"));

    assert!(state.register("session-1").is_err());
    assert!(registration.cancelled.load(Ordering::SeqCst));
    drop(registration);
    assert!(!state.stop("session-1").expect("cleaned up"));
}

#[test]
fn resumes_an_existing_auto_hunt_event_log_without_overwriting_records() {
    let directory = tempfile::tempdir().expect("event log directory should exist");
    let path = directory.path().join("session-1.jsonl");
    let (mut file, last_sequence) =
        open_auto_hunt_event_log(&path).expect("new event log should open");
    assert_eq!(last_sequence, 0);

    let first = agent::AppServerEventRecord::new(
        "session-1".to_string(),
        1,
        agent::AgentProviderEvent {
            provider: agent::AgentProviderKind::Codex,
            direction: agent::AgentEventDirection::Server,
            raw: serde_json::json!({"message": "first attempt"}),
            event: None,
        },
    );
    serde_json::to_writer(&mut file, &first).expect("first event should serialize");
    file.write_all(b"\n").expect("first event should finish");
    file.flush().expect("first event should persist");
    drop(file);

    let (mut file, last_sequence) =
        open_auto_hunt_event_log(&path).expect("existing event log should reopen");
    assert_eq!(last_sequence, 1);

    let second = agent::AppServerEventRecord::new(
        "session-1".to_string(),
        last_sequence + 1,
        agent::AgentProviderEvent {
            provider: agent::AgentProviderKind::Codex,
            direction: agent::AgentEventDirection::Server,
            raw: serde_json::json!({"message": "resumed attempt"}),
            event: None,
        },
    );
    serde_json::to_writer(&mut file, &second).expect("resumed event should serialize");
    file.write_all(b"\n").expect("resumed event should finish");
    file.flush().expect("resumed event should persist");
    drop(file);

    let contents = fs::read_to_string(path).expect("event log should be readable");
    let records = parse_auto_hunt_event_records(&contents).expect("event log should remain valid");
    assert_eq!(
        records
            .iter()
            .map(|record| record.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(records[0].message["message"], "first attempt");
    assert_eq!(records[1].message["message"], "resumed attempt");
}

#[cfg(unix)]
#[test]
fn resolves_cli_tools_installed_through_mise_shims_as_a_fallback() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let shims = home.path().join(".local/share/mise/shims");
    fs::create_dir_all(&shims).expect("mise shims directory should exist");
    for binary in ["bun", "codex"] {
        let path = shims.join(binary);
        fs::write(&path, format!("#!/bin/sh\nprintf '{binary} 1.2.3\\n'\n"))
            .expect("fixture CLI should be written");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .expect("fixture CLI should be executable");
    }
    let execution_path =
        cli_execution_path_with_runtime(home.path(), Vec::new()).expect("CLI PATH should resolve");

    let resolved = which::which_in("bun", Some(&execution_path), home.path())
        .expect("Bun should resolve through the mise shim directory");

    assert_eq!(resolved, shims.join("bun"));
    assert_eq!(
        agent::codex_binary(home.path(), &execution_path)
            .expect("Codex should resolve through the mise shim directory"),
        shims.join("codex")
    );
}

#[cfg(unix)]
#[test]
fn uses_the_cursor_agent_companion_binary_for_login() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let binary_directory = home.path().join(".local/bin");
    fs::create_dir_all(&binary_directory).expect("Cursor CLI directory should exist");
    for name in ["cursor-agent", "agent"] {
        let binary = binary_directory.join(name);
        fs::write(&binary, "#!/bin/sh\nexit 0\n").expect("Cursor CLI fixture should be written");
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
            .expect("Cursor CLI fixture should be executable");
    }

    let (binary, arguments) = provider_login_binary_and_args(home.path(), "cursor")
        .expect("Cursor login command should resolve");

    assert_eq!(binary, binary_directory.join("agent"));
    assert_eq!(arguments, vec!["login"]);
}

#[cfg(unix)]
#[test]
fn skips_a_broken_codex_before_a_working_path_candidate() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let broken_directory = home.path().join(".bun/bin");
    let working_directory = home.path().join("homebrew/bin");
    fs::create_dir_all(&broken_directory).expect("broken fixture directory should exist");
    fs::create_dir_all(&working_directory).expect("working fixture directory should exist");

    let broken = broken_directory.join("codex");
    fs::write(&broken, "#!/usr/bin/env missing-codex-runtime\n")
        .expect("broken Codex fixture should be written");
    let working = working_directory.join("codex");
    fs::write(&working, "#!/bin/sh\nprintf 'codex-cli 1.2.3\\n'\n")
        .expect("working Codex fixture should be written");
    for binary in [&broken, &working] {
        fs::set_permissions(binary, fs::Permissions::from_mode(0o700))
            .expect("fixture CLI should be executable");
    }

    let execution_path = env::join_paths([&broken_directory, &working_directory])
        .expect("fixture PATH should resolve");

    assert_eq!(
        agent::codex_binary(home.path(), &execution_path)
            .expect("the working Codex should be selected"),
        working
    );
}

#[cfg(unix)]
#[test]
fn only_marks_a_cli_installed_when_its_version_probe_succeeds() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().expect("fixture directory should exist");
    let working = directory.path().join("working-cli");
    let broken = directory.path().join("broken-cli");
    fs::write(&working, "#!/bin/sh\nprintf 'codex-cli 1.2.3\\n' >&2\n")
        .expect("working fixture should be written");
    fs::write(&broken, "#!/bin/sh\nexit 1\n").expect("broken fixture should be written");
    for binary in [&working, &broken] {
        fs::set_permissions(binary, fs::Permissions::from_mode(0o700))
            .expect("fixture CLI should be executable");
    }

    let working_status = inspect_cli(Ok(working));
    assert!(working_status.installed);
    assert!(working_status.authenticated);
    assert_eq!(working_status.version.as_deref(), Some("codex-cli 1.2.3"));

    let broken_status = inspect_cli(Ok(broken));
    assert!(!broken_status.installed);
    assert!(!broken_status.authenticated);
    assert_eq!(broken_status.version, None);
}

#[cfg(unix)]
#[test]
fn prefers_the_bundled_bun_over_user_installed_runtimes() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let bundled = tempfile::tempdir().expect("bundled runtime directory should exist");
    let user_shims = home.path().join(".local/share/mise/shims");
    fs::create_dir_all(&user_shims).expect("mise shims directory should exist");
    for bun in [bundled.path().join("bun"), user_shims.join("bun")] {
        fs::write(&bun, "#!/bin/sh\nexit 0\n").expect("fixture Bun should be written");
        fs::set_permissions(&bun, fs::Permissions::from_mode(0o700))
            .expect("fixture Bun should be executable");
    }

    let resolved = which::which_in(
        "bun",
        Some(
            cli_execution_path_with_runtime(home.path(), [bundled.path().to_path_buf()])
                .expect("CLI PATH should resolve"),
        ),
        home.path(),
    )
    .expect("Bun should resolve through the bundled runtime directory");

    assert_eq!(resolved, bundled.path().join("bun"));
}

#[test]
fn configures_the_opencode_terminal_path_idempotently_for_zsh() {
    let home = tempfile::tempdir().expect("fixture home should exist");
    let binary_directory = home.path().join(".bun/bin");
    fs::create_dir_all(&binary_directory).expect("Bun bin directory should exist");
    fs::write(binary_directory.join("opencode"), "fixture")
        .expect("OpenCode fixture should be written");
    fs::write(home.path().join(".zshrc"), "export EDITOR=vim\n")
        .expect("zsh config should be written");

    for _ in 0..2 {
        let status = configure_open_code_terminal_path_for_binary(
            home.path(),
            Some(OsStr::new("/bin/zsh")),
            binary_directory.join("opencode"),
        )
        .expect("terminal PATH should be configured");
        assert!(status.supported);
        assert!(status.configured);
    }

    let contents =
        fs::read_to_string(home.path().join(".zshrc")).expect("zsh config should be readable");
    assert!(contents.starts_with("export EDITOR=vim\n"));
    assert!(contents.contains("export PATH=\"$HOME/.bun/bin:$PATH\""));
    assert_eq!(contents.matches(BRIAR_CLI_PATH_BLOCK_START).count(), 1);
    assert_eq!(contents.matches(BRIAR_CLI_PATH_BLOCK_END).count(), 1);
}

#[test]
fn recognizes_an_existing_fish_opencode_path() {
    let home = tempfile::tempdir().expect("fixture home should exist");
    let binary_directory = home.path().join(".bun/bin");
    let config = home.path().join(".config/fish/config.fish");
    fs::create_dir_all(&binary_directory).expect("Bun bin directory should exist");
    fs::create_dir_all(config.parent().expect("fish config should have a parent"))
        .expect("fish config directory should exist");
    fs::write(binary_directory.join("opencode"), "fixture")
        .expect("OpenCode fixture should be written");
    fs::write(&config, "fish_add_path \"$HOME/.bun/bin\"\n")
        .expect("fish config should be written");

    let status = open_code_terminal_path_status_for_binary(
        home.path(),
        Some(OsStr::new("/opt/homebrew/bin/fish")),
        Some(binary_directory.join("opencode")),
    );

    assert!(status.supported);
    assert!(status.configured);
    assert_eq!(status.config_path.as_deref(), config.to_str());
}

#[cfg(unix)]
#[test]
fn prefers_the_user_cli_over_the_desktop_app_binary() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let bundled = tempfile::tempdir().expect("bundled runtime directory should exist");
    let user_bin = home.path().join(".local/bin");
    fs::create_dir_all(&user_bin).expect("user CLI directory should exist");
    for briar in [user_bin.join("briar"), bundled.path().join("briar")] {
        fs::write(&briar, "#!/bin/sh\nexit 0\n").expect("fixture CLI should be written");
        fs::set_permissions(&briar, fs::Permissions::from_mode(0o700))
            .expect("fixture CLI should be executable");
    }

    let resolved = which::which_in(
        "briar",
        Some(
            cli_execution_path_with_runtime(home.path(), [bundled.path().to_path_buf()])
                .expect("CLI PATH should resolve"),
        ),
        home.path(),
    )
    .expect("Briar should resolve through the user CLI directory");

    assert_eq!(resolved, user_bin.join("briar"));
}

#[test]
fn resolves_the_sidecar_next_to_apps_and_test_binaries() {
    assert_eq!(
        bundled_runtime_directories(Path::new("/Applications/Briar.app/Contents/MacOS/briar")),
        vec![PathBuf::from("/Applications/Briar.app/Contents/MacOS")]
    );
    assert_eq!(
        bundled_runtime_directories(Path::new(
            "/repo/src-tauri/target/debug/deps/briar_lib-test"
        )),
        vec![
            PathBuf::from("/repo/src-tauri/target/debug/deps"),
            PathBuf::from("/repo/src-tauri/target/debug")
        ]
    );
}

#[cfg(target_os = "macos")]
#[test]
fn resolves_the_prepared_bun_sidecar_from_the_test_target() {
    let bundled = bundled_bun_binary().expect("prepared Bun sidecar should resolve");
    assert_eq!(bundled.file_name(), Some(OsStr::new("bun")));
    let output = Command::new(bundled)
        .arg("--version")
        .output()
        .expect("bundled Bun should execute");
    assert!(output.status.success());
    let package: serde_json::Value = serde_json::from_str(include_str!("../../../../package.json"))
        .expect("package should parse");
    let expected = package["packageManager"]
        .as_str()
        .and_then(|value| value.strip_prefix("bun@"))
        .expect("packageManager should pin Bun");
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), expected);
}

#[cfg(target_os = "macos")]
#[test]
fn runs_agent_browser_with_bundled_bun_instead_of_mise_node() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let shims = home.path().join(".local/share/mise/shims");
    fs::create_dir_all(&shims).expect("mise shim directory should exist");
    let node = shims.join("node");
    fs::write(&node, "#!/bin/sh\nexit 99\n").expect("broken Node shim should be written");
    fs::set_permissions(&node, fs::Permissions::from_mode(0o700))
        .expect("broken Node shim should be executable");
    let agent_browser = home.path().join("agent-browser.js");
    fs::write(
        &agent_browser,
        "#!/usr/bin/env node\nconsole.log('agent-browser fixture');\n",
    )
    .expect("agent-browser fixture should be written");

    let output = agent_browser_output(home.path(), &agent_browser, &["--version"])
        .expect("bundled Bun should run agent-browser");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "agent-browser fixture"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn detects_aside_cli_mcp_and_browser_skill_readiness() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    fs::create_dir_all(home.path().join("Applications/Aside.app"))
        .expect("Aside app fixture should exist");
    let binary = home.path().join(".local/bin/aside");
    fs::create_dir_all(binary.parent().expect("binary should have a parent"))
        .expect("local binary directory should exist");
    fs::write(
            &binary,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.26.810.1915; exit 0; fi\nif [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"--help\" ]; then exit 0; fi\nexit 1\n",
        )
        .expect("Aside CLI fixture should be written");
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
        .expect("Aside CLI fixture should be executable");
    for skill in [
        ".codex/skills/browser/SKILL.md",
        ".claude/skills/browser/SKILL.md",
        ".cursor/skills/browser/SKILL.md",
        ".grok/skills/browser/SKILL.md",
        ".gemini/config/skills/browser/SKILL.md",
        ".config/opencode/skills/browser/SKILL.md",
    ] {
        let skill = home.path().join(skill);
        fs::create_dir_all(skill.parent().expect("skill should have a parent"))
            .expect("skill directory should exist");
        fs::write(skill, "# Browser\n").expect("skill fixture should be written");
    }

    let status = inspect_aside_browser_sync(home.path());

    assert!(status.supported);
    assert!(status.installed);
    assert!(status.cli_ready);
    assert!(status.mcp_ready);
    assert!(status.skill_ready);
    assert!(status.browser_ready);
    assert_eq!(status.version.as_deref(), Some("1.26.810.1915"));
}

#[test]
fn selects_an_issue_worktree_by_recorded_branch() {
    let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111
";

    assert_eq!(
        select_issue_worktree(
            output,
            "11111111-2222-3333-4444-555555555555",
            Some("briar/fix-login-11111111"),
        )
        .expect("recorded branch should resolve"),
        PathBuf::from("/worktrees/fix-login-11111111")
    );
}

#[test]
fn recovers_an_issue_worktree_from_the_run_token_without_a_recorded_branch() {
    let output = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /worktrees/fix-login-11111111-2
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/fix-login-11111111-2
";

    assert_eq!(
        select_issue_worktree(output, "11111111-2222-3333-4444-555555555555", None,)
            .expect("run token should resolve"),
        PathBuf::from("/worktrees/fix-login-11111111-2")
    );
}

#[test]
fn refuses_to_fall_back_when_the_issue_worktree_is_missing_or_ambiguous() {
    let missing = "\
worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main
";
    assert!(select_issue_worktree(missing, "11111111-2222-3333-4444-555555555555", None,).is_err());

    let ambiguous = "\
worktree /worktrees/first-11111111
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/briar/first-11111111

worktree /worktrees/second-11111111
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/briar/second-11111111
";
    assert!(
        select_issue_worktree(ambiguous, "11111111-2222-3333-4444-555555555555", None,).is_err()
    );
}

#[test]
fn deserializes_the_issue_context_workspace_mode() {
    assert!(matches!(
        serde_json::from_str::<ProjectWorkspaceMode>("\"issueContext\"")
            .expect("issue context mode should deserialize"),
        ProjectWorkspaceMode::IssueContext
    ));
}

#[test]
fn unrestricted_project_chat_bypasses_approvals_and_sandboxing() {
    let execution = project_chat_execution(
        true,
        agent::ApprovalPolicy::OnRequest,
        Some("model".to_string()),
        Some(agent::ModelEffort::new("high")),
        None,
    );

    assert_eq!(execution.approval_policy, agent::ApprovalPolicy::Never);
    assert_eq!(execution.sandbox_mode, agent::SandboxMode::DangerFullAccess);
    assert!(execution.network_access);
    assert_eq!(execution.model.as_deref(), Some("model"));
    assert_eq!(execution.effort, Some(agent::ModelEffort::new("high")));
}

#[test]
fn ordinary_project_chat_stays_read_only() {
    let execution =
        project_chat_execution(false, agent::ApprovalPolicy::OnRequest, None, None, None);

    assert_eq!(execution.approval_policy, agent::ApprovalPolicy::OnRequest);
    assert_eq!(execution.sandbox_mode, agent::SandboxMode::ReadOnly);
    assert!(!execution.network_access);
}

#[test]
fn parses_the_remote_default_branch_from_ls_remote() {
    assert_eq!(
        remote_head_branch(
            "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n"
        ),
        Some("main")
    );
    assert_eq!(
        remote_head_branch("0123456789abcdef0123456789abcdef01234567\tHEAD\n"),
        None
    );
}

#[test]
fn project_agent_uses_and_removes_the_latest_remote_checkout() {
    let Ok(git) = which::which("git") else {
        return;
    };
    let root = tempfile::tempdir().expect("temporary repository root");
    let remote = root.path().join("remote.git");
    let publisher = root.path().join("publisher");
    let connected = root.path().join("connected");

    let run = |cwd: &Path, args: &[&str]| {
        let output = Command::new(&git)
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    fs::create_dir_all(&publisher).expect("publisher directory");
    run(&publisher, &["init", "-b", "main"]);
    run(&publisher, &["config", "user.name", "Briar Test"]);
    run(
        &publisher,
        &["config", "user.email", "briar-test@example.com"],
    );
    fs::write(publisher.join("version.txt"), "old\n").expect("old version");
    run(&publisher, &["add", "version.txt"]);
    run(&publisher, &["commit", "-m", "old version"]);

    let init_remote = Command::new(&git)
        .args(["init", "--bare", "-b", "main"])
        .arg(&remote)
        .output()
        .expect("bare remote");
    assert!(
        init_remote.status.success(),
        "{}",
        String::from_utf8_lossy(&init_remote.stderr)
    );
    run(
        &publisher,
        &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
    );
    run(&publisher, &["push", "-u", "origin", "main"]);

    let clone = Command::new(&git)
        .arg("clone")
        .arg(&remote)
        .arg(&connected)
        .output()
        .expect("connected clone");
    assert!(
        clone.status.success(),
        "{}",
        String::from_utf8_lossy(&clone.stderr)
    );
    fs::write(publisher.join("version.txt"), "latest\n").expect("latest version");
    run(&publisher, &["add", "version.txt"]);
    run(&publisher, &["commit", "-m", "latest version"]);
    let latest_sha = run(&publisher, &["rev-parse", "HEAD"]);
    run(&publisher, &["push", "origin", "main"]);

    assert_eq!(
        fs::read_to_string(connected.join("version.txt")).expect("connected version"),
        "old\n"
    );
    fs::write(
        connected.join(WORKTREE_INCLUDE_FILE),
        "# local release inputs\n.env.keys\nlocal-config\n../unsafe\n*.glob\n",
    )
    .expect("worktree includes");
    fs::write(connected.join(".env.keys"), "release-key\n").expect("release key");
    fs::create_dir_all(connected.join("local-config")).expect("local config directory");
    fs::write(connected.join("local-config/settings.json"), "{}\n").expect("local config");
    let runner = host::LocalRunner::new(
        env::var_os("PATH").unwrap_or_default(),
        root.path().to_path_buf(),
    );
    let latest = prepare_latest_project_agent_workspace(&runner, &connected)
        .expect("latest project Agent workspace");
    assert_eq!(
        fs::read_to_string(latest.checkout.join("version.txt")).expect("analysis version"),
        "latest\n"
    );
    assert_eq!(run(&latest.checkout, &["rev-parse", "HEAD"]), latest_sha);
    assert_eq!(
        fs::read_to_string(latest.checkout.join(".env.keys")).expect("copied release key"),
        "release-key\n"
    );
    assert_eq!(
        fs::read_to_string(latest.checkout.join("local-config/settings.json"))
            .expect("copied local config"),
        "{}\n"
    );
    assert!(!latest.checkout.join("unsafe").exists());

    remove_latest_remote_workspace(&runner, &connected, &latest).expect("cleanup");
    assert!(!latest.root.exists());
}

#[test]
fn workflow_analysis_uses_the_connected_checkout_without_an_origin() {
    let Ok(git) = which::which("git") else {
        return;
    };
    let repository = tempfile::tempdir().expect("temporary repository");
    let init = Command::new(&git)
        .arg("-C")
        .arg(repository.path())
        .args(["init", "-b", "main"])
        .output()
        .expect("git init");
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );
    let runner = host::LocalRunner::new(
        env::var_os("PATH").unwrap_or_default(),
        repository.path().to_path_buf(),
    );

    assert!(prepare_latest_remote_workspace(&runner, repository.path())
        .expect("connected fallback")
        .is_none());
    let error = match prepare_latest_project_agent_workspace(&runner, repository.path()) {
        Ok(_) => panic!("project Agent execution requires origin"),
        Err(error) => error,
    };
    assert!(error.contains("origin"));
}

#[test]
fn project_folder_names_stay_filesystem_safe() {
    assert_eq!(project_folder_name("  briar  ").as_deref(), Ok("briar"));
    assert_eq!(
        project_folder_name("my new project").as_deref(),
        Ok("my-new-project")
    );
    assert_eq!(
        project_folder_name("../etc/passwd").as_deref(),
        Ok("etc-passwd")
    );
    assert!(project_folder_name("   ").is_err());
    assert!(project_folder_name("///").is_err());
}

#[test]
fn github_ssh_urls_produce_safe_repository_names() {
    assert_eq!(
        github_ssh_repository_name("git@github.com:wordbricks/briar.git").as_deref(),
        Ok("briar")
    );
    assert_eq!(
        github_ssh_repository_name("ssh://git@github.com/wordbricks/my-app.git").as_deref(),
        Ok("my-app")
    );
    assert!(github_ssh_repository_name("https://github.com/wordbricks/briar.git").is_err());
    assert!(github_ssh_repository_name("git@github.com:wordbricks/../briar.git").is_err());
}

#[test]
fn git_clone_errors_explain_common_ssh_problems() {
    assert!(
        friendly_git_clone_error("git@github.com: Permission denied (publickey).")
            .contains("SSH 키")
    );
    assert!(friendly_git_clone_error("ERROR: Repository not found.").contains("권한"));
}

#[test]
fn new_projects_get_an_initialized_git_repository() {
    let Ok(git) = which::which("git") else {
        return;
    };
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = env::temp_dir().join(format!("briar-workspace-{unique}"));

    let created = create_project_workspace_in(&git, &root, "Sample Project").expect("created");
    assert!(created.created);
    assert!(created.repository_path.ends_with("Sample-Project"));
    assert!(Path::new(&created.repository_path).join(".git").is_dir());
    assert!(Path::new(&created.repository_path)
        .join("README.md")
        .is_file());

    let reused = create_project_workspace_in(&git, &root, "Sample Project").expect("reused");
    assert!(!reused.created);
    assert_eq!(reused.repository_path, created.repository_path);

    let occupied = root.join("Taken");
    fs::create_dir_all(&occupied).expect("directory");
    fs::write(occupied.join("notes.md"), "hello").expect("file");
    assert!(create_project_workspace_in(&git, &root, "Taken").is_err());

    let _ = fs::remove_dir_all(&root);
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

#[test]
fn parses_plain_and_json_cli_versions() {
    assert_eq!(
        parse_cli_version(b"codex-cli 0.144.1\n"),
        Some("codex-cli 0.144.1".to_string())
    );
    assert_eq!(
        parse_cli_version(
            br#"{"command":"version","data":{"display":"velen 0.2.43\n"},"ok":true}"#
        ),
        Some("velen 0.2.43".to_string())
    );
    assert_eq!(parse_cli_version(b""), None);
}

#[test]
fn validates_auto_hunt_session_ids_before_building_log_paths() {
    assert!(validate_auto_hunt_session_id("019f8a9c-2c95-7591-a096-fcbf930cf122").is_ok());
    assert!(validate_auto_hunt_session_id("../session").is_err());
    assert!(validate_auto_hunt_session_id("session.jsonl").is_err());
    assert!(validate_auto_hunt_session_id("").is_err());
}

#[test]
fn retries_the_requested_run_through_the_briar_cli() {
    let arguments = auto_hunt_retry_arguments(
        "515b7a2c-8918-5a8f-a292-f0b95090281c",
        "616b7a2c-8918-5a8f-a292-f0b95090281d",
        "GitHub authentication was restored.",
    );

    assert_eq!(
        arguments,
        vec![
            "run",
            "retry",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--request-id",
            "616b7a2c-8918-5a8f-a292-f0b95090281d",
            "--reason",
            "GitHub authentication was restored.",
            "--actor",
            "briar-agent-host-tool",
        ],
    );
}

#[test]
fn targets_the_requested_run_when_claiming_auto_hunt_work() {
    let arguments = auto_hunt_claim_arguments("515b7a2c-8918-5a8f-a292-f0b95090281c");

    assert_eq!(
        arguments,
        vec![
            "queue",
            "claim",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--workspace",
            "worktree",
            "--actor",
            "briar-auto-hunt-runtime",
            "--runtime-dispatch",
        ],
    );
}

#[test]
fn maintains_the_finished_workers_exact_worktree() {
    let arguments = auto_hunt_worktree_maintenance_arguments(
        Path::new("/tmp/briar/workspaces/project/issue-515b7a2c"),
        Some("515b7a2c-8918-5a8f-a292-f0b95090281c"),
        Some("2026-08-06T00:00:00Z"),
    );

    assert_eq!(
        arguments,
        vec![
            "worktree",
            "maintain",
            "--path",
            "/tmp/briar/workspaces/project/issue-515b7a2c",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--completed-at",
            "2026-08-06T00:00:00Z",
        ],
    );
}

#[test]
fn records_an_actionable_handoff_for_runtime_blockers() {
    let arguments = auto_hunt_terminal_event_arguments(
        "515b7a2c-8918-5a8f-a292-f0b95090281c",
        "BRIAR-13",
        "blocked",
        "workspace-allocation",
        "worktree creation failed",
    );

    let detail_index = arguments
        .iter()
        .position(|argument| argument == "--status-detail")
        .expect("blocked event should include a reason");
    assert!(arguments[detail_index + 1].contains("작업 공간 생성 단계가 실패했습니다"));
    assert!(arguments[detail_index + 1].contains("원본 오류: worktree creation failed"));

    let result_index = arguments
        .iter()
        .position(|argument| argument == "--structured-result")
        .expect("blocked event should include a structured result");
    let result: serde_json::Value = serde_json::from_str(&arguments[result_index + 1])
        .expect("structured result should be valid JSON");
    assert_eq!(result["outcome"], "blocked");
    assert_eq!(result["humanActionRequired"], true);
    assert!(result["summary"]
        .as_str()
        .expect("summary should be text")
        .contains("작업을 시작할 수 없습니다"));
    assert!(result["nextAction"]
        .as_str()
        .expect("next action should be text")
        .contains("저장소 연결을 다시 확인"));
}

#[test]
fn parses_the_claimed_runs_durable_issue_snapshot() {
    let response = serde_json::from_value::<CliClaimResponse>(serde_json::json!({
        "work": {
            "runId": "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "runNumber": 13,
            "sourceKey": "BRIAR-13",
            "title": "Render the attached layout",
            "description": "Match the mobile reference.",
            "priority": 1,
            "context": { "customer": "enterprise" },
            "workflow": { "version": 2 },
            "attachments": [{
                "id": "attachment-1",
                "filename": "layout.png",
                "contentType": "image/png",
                "byteSize": 2048,
                "url": "/projects/project-1/runs/run-1/attachments/attachment-1",
                "localPath": "/tmp/attachments/layout.png",
                "downloadError": null
            }],
            "messages": [{
                "id": "message-1",
                "parentMessageId": null,
                "body": "The compact breakpoint is required.",
                "author": {
                    "id": "user-1",
                    "name": "Jay",
                    "provider": null
                },
                "createdAt": "2026-07-30T00:00:00Z",
                "updatedAt": "2026-07-30T00:00:00Z"
            }]
        }
    }))
    .expect("claim response should parse");
    let work = response.work.expect("claim should contain work");

    assert_eq!(
        work.description.as_deref(),
        Some("Match the mobile reference.")
    );
    assert_eq!(
        work.attachments[0].local_path.as_deref(),
        Some("/tmp/attachments/layout.png")
    );
    assert_eq!(work.messages[0].body, "The compact breakpoint is required.");
}

#[test]
fn persists_and_clears_session_without_a_keychain() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-session-test-{unique}"));
    let session_path = directory.join(SESSION_FILE_NAME);

    assert_eq!(
        read_session_token_from(&session_path).expect("missing session should be valid"),
        None
    );
    write_session_token_to(&session_path, "persistent-session-token".to_string())
        .expect("session should be saved");
    assert_eq!(
        read_session_token_from(&session_path).expect("session should be readable"),
        Some("persistent-session-token".to_string())
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&session_path)
                .expect("session metadata should be readable")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    clear_session_token_at(&session_path).expect("session should be cleared");
    assert_eq!(
        read_session_token_from(&session_path).expect("cleared session should be valid"),
        None
    );
    fs::remove_dir_all(directory).expect("test session directory should be removed");
}

#[test]
fn writes_cli_connection_without_losing_non_auth_config() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-connect-test-{unique}"));
    let config_path = directory.join("config.json");
    fs::create_dir_all(&directory).expect("test config directory should be created");
    fs::write(
        &config_path,
        r#"{
  "apiUrl": "https://old.example.com",
  "userToken": "existing-user-token",
  "customSetting": true,
  "projects": [
    {
      "id": "existing-project",
      "repositoryPath": "/existing/repository",
      "agentToken": "briar_agent_existing",
      "autoHunt": {
        "velenOrg": "existing",
        "dataSource": "postgres://existing",
        "linear": {
          "enabled": true,
          "source": "linear://existing",
          "teamKey": "OLD",
          "customLinearSetting": true
        },
        "githubRepository": "example/existing",
        "customAutoHuntSetting": true
      },
      "label": "keep me"
    }
  ]
}"#,
    )
    .expect("test config should be written");

    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "https://briar.example.com".to_string(),
            project_id: "new-project".to_string(),
            agent_token: "briar_agent_new".to_string(),
            repository_path: "/new/repository".to_string(),
            repository_remote: Some("git@github.com:example/repository.git".to_string()),
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("example".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: None,
                workflow: repository_workflow_bootstrap(),
            },
        },
    )
    .expect("connection should be saved");

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be valid json");
    assert_eq!(saved["apiUrl"], "https://briar.example.com");
    assert!(saved["userToken"].is_null());
    assert_eq!(saved["customSetting"], true);
    assert_eq!(saved["projects"].as_array().map(Vec::len), Some(2));
    assert_eq!(saved["projects"][0]["label"], "keep me");
    assert_eq!(saved["projects"][0]["autoHunt"]["linear"]["enabled"], true);
    assert_eq!(
        saved["projects"][0]["autoHunt"]["linear"]["customLinearSetting"],
        true
    );
    assert_eq!(saved["projects"][1]["apiUrl"], "https://briar.example.com");
    assert_eq!(
        saved["projects"][0]["autoHunt"]["customAutoHuntSetting"],
        true
    );
    assert_eq!(saved["projects"][1]["id"], "new-project");
    assert_eq!(saved["projects"][1]["repositoryPath"], "/new/repository");
    assert_eq!(saved["projects"][1]["llm"]["approvalPolicy"], "never");
    assert_eq!(saved["projects"][1]["autoHunt"]["linear"]["enabled"], false);
    assert_eq!(
        saved["projects"][1]["autoHunt"]["sandbox"]["fullAccess"],
        true
    );
    assert_eq!(
        saved["projects"][1]["autoHunt"]["workflow"]["stages"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert!(saved["projects"][1]["autoHunt"]["linearEnabled"].is_null());

    fs::remove_dir_all(directory).expect("test config directory should be removed");
}

#[test]
fn removes_only_the_selected_cli_connection() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-disconnect-test-{unique}"));
    let config_path = directory.join("config.json");
    fs::create_dir_all(&directory).expect("test config directory should be created");
    fs::write(
        &config_path,
        r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [
    {"id":"keep","repositoryPath":"/keep","agentToken":"briar_agent_keep"},
    {"id":"delete","repositoryPath":"/delete","agentToken":"briar_agent_delete"}
  ]
}"#,
    )
    .expect("test config should be written");

    remove_cli_connection(&config_path, "delete").expect("connection should be removed");
    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be valid json");
    assert_eq!(saved["projects"].as_array().map(Vec::len), Some(1));
    assert_eq!(saved["projects"][0]["id"], "keep");

    fs::remove_dir_all(directory).expect("test config directory should be removed");
}

#[test]
fn stores_project_approval_policy_locally() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-llm-settings-test-{unique}"));
    let config_path = directory.join("config.json");
    fs::create_dir_all(&directory).expect("test config directory should be created");
    fs::write(
        &config_path,
        r#"{
  "apiUrl": "https://briar.example.com",
  "customSetting": true,
  "projects": [
    {"id":"project-1","repositoryPath":"/repo","agentToken":"briar_agent_test"}
  ]
}"#,
    )
    .expect("test config should be written");

    assert_eq!(
        project_llm_settings_from(&config_path, "project-1")
            .expect("legacy project settings should load")
            .approval_policy,
        agent::ApprovalPolicy::Never
    );
    assert_eq!(
        project_llm_settings_from(&config_path, "project-1")
            .expect("legacy project settings should load")
            .effort,
        None
    );
    assert!(
        app_provider_settings_from(&config_path)
            .expect("legacy provider settings should load")
            .codex
    );
    let legacy_runtime_settings =
        app_runtime_settings_from(&config_path).expect("legacy runtime settings should load");
    assert!(!legacy_runtime_settings.prevent_sleep_while_running);
    assert_eq!(
        legacy_runtime_settings.browser_automation_provider,
        BrowserAutomationProvider::EgoBrowser
    );
    update_app_provider_settings_at(
        &config_path,
        AppProviderSettings {
            codex: false,
            claude: true,
            cursor: true,
            grok: true,
            agy: true,
            opencode: true,
            openrouter: true,
        },
    )
    .expect("provider settings should save");
    update_browser_automation_settings_at(
        &config_path,
        BrowserAutomationSettings {
            provider: BrowserAutomationProvider::Aside,
        },
    )
    .expect("browser automation settings should save");
    update_app_runtime_settings_at(
        &config_path,
        AppRuntimeSettingsUpdate {
            prevent_sleep_while_running: true,
        },
    )
    .expect("runtime settings should preserve browser automation settings");
    update_project_llm_settings_at(
        &config_path,
        "project-1",
        agent::ProjectLlmSettings {
            provider: agent::AgentProviderKind::Claude,
            model: Some("sonnet".to_string()),
            effort: Some(agent::ModelEffort::new("high")),
            approval_policy: agent::ApprovalPolicy::OnRequest,
        },
    )
    .expect("approval policy should save");

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert_eq!(saved["customSetting"], true);
    assert_eq!(saved["agentProviders"]["codex"], false);
    assert_eq!(saved["agentProviders"]["claude"], true);
    assert_eq!(saved["appSettings"]["preventSleepWhileRunning"], true);
    assert_eq!(saved["appSettings"]["browserAutomationProvider"], "aside");
    assert_eq!(saved["projects"][0]["llm"]["provider"], "claude");
    assert_eq!(saved["projects"][0]["llm"]["model"], "sonnet");
    assert_eq!(saved["projects"][0]["llm"]["effort"], "high");
    assert_eq!(saved["projects"][0]["llm"]["approvalPolicy"], "on-request");

    fs::remove_dir_all(directory).expect("test config directory should be removed");
}

#[test]
fn initializes_provider_settings_when_local_config_is_missing() {
    let config_path = test_config_path("missing-provider-settings");

    let defaults = app_provider_settings_from(&config_path)
        .expect("missing provider settings should use defaults");
    assert!(defaults.codex);
    assert!(defaults.claude);
    assert!(defaults.cursor);
    assert!(defaults.grok);
    assert!(defaults.agy);
    assert!(defaults.opencode);
    assert!(defaults.openrouter);

    update_app_provider_settings_at(
        &config_path,
        AppProviderSettings {
            codex: true,
            claude: false,
            cursor: false,
            grok: false,
            agy: false,
            opencode: false,
            openrouter: false,
        },
    )
    .expect("provider settings should initialize the local config");

    let saved = read_cli_config(&config_path).expect("saved config should be readable");
    assert!(saved.agent_providers.codex);
    assert!(!saved.agent_providers.claude);
    assert!(!saved.agent_providers.cursor);
    assert!(!saved.agent_providers.grok);
    assert!(!saved.agent_providers.agy);
    assert!(!saved.agent_providers.opencode);
    assert!(!saved.agent_providers.openrouter);

    fs::remove_dir_all(
        config_path
            .parent()
            .expect("test config should have a parent directory"),
    )
    .expect("test config directory should be removed");
}

#[test]
fn updates_the_connected_project_workflow_locally() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-workflow-update-test-{unique}"));
    let config_path = directory.join("config.json");
    fs::create_dir_all(&directory).expect("test config directory should be created");
    fs::write(
        &config_path,
        r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [{
    "id": "project-1",
    "repositoryPath": "/repo",
    "agentToken": "briar_agent_test",
    "autoHunt": {
      "velenOrg": "wordbricks",
      "workflow": {
        "version": 2,
        "stages": [{"id":"analyzing","label":"Analyze","required":true}],
        "execution": {"checkpoints":[]},
        "completion": {"requiredStages":["analyzing"]},
        "release": {"enabled":false}
      }
    }
  }]
}"#,
    )
    .expect("test config should be written");

    let mut workflow = repository_workflow_bootstrap();
    workflow.stages = vec![WorkflowStageConfig {
        id: "repository_qa".to_string(),
        label: "Repository QA".to_string(),
        required: true,
        evidence: vec!["diff".to_string()],
        checks: vec!["cargo test".to_string()],
    }];
    workflow.completion.required_stages = vec!["repository_qa".to_string()];
    workflow.execution.checkpoints = vec![WorkflowCheckpointConfig {
        key: "project-after-repository_qa".to_string(),
        stage: "repository_qa".to_string(),
        position: WorkflowCheckpointPosition::After,
    }];

    update_project_workflow_at(&config_path, "project-1", workflow).expect("workflow should save");

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert_eq!(
        saved["projects"][0]["autoHunt"]["workflow"]["stages"][0]["checks"][0],
        "cargo test"
    );
    let runtime_workflow = project_auto_hunt_workflow_json(&config_path, "project-1")
        .expect("runtime workflow should load");
    assert!(runtime_workflow.contains("repository_qa"));
    assert!(runtime_workflow.contains("cargo test"));
    assert!(runtime_workflow.contains("\"checkpoints\""));
    assert!(!runtime_workflow.contains("\"release\""));

    fs::remove_dir_all(directory).expect("test config directory should be removed");
}

#[test]
fn resolves_the_workspace_git_root() {
    let root = git_repository_root(Path::new(env!("CARGO_MANIFEST_DIR")))
        .expect("workspace should be a git repository");
    assert_eq!(
        root,
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("repository root should exist")
    );
}

#[test]
fn disconnecting_velen_clears_legacy_linear_settings() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-velen-disconnect-test-{unique}"));
    let config_path = directory.join("config.json");
    fs::create_dir_all(&directory).expect("test config directory should be created");
    fs::write(
        &config_path,
        r#"{
  "apiUrl": "https://briar.example.com",
  "projects": [{
    "id": "project-1",
    "repositoryPath": "/repo",
    "agentToken": "briar_agent_test",
    "autoHunt": {
      "velenOrg": "wordbricks",
      "dataSource": "postgres://wordbricks",
      "linear": {
        "enabled": true,
        "source": "linear://wordbricks",
        "teamKey": "BRIAR"
      }
    }
  }]
}"#,
    )
    .expect("test config should be written");

    let inspect = |_org: Option<String>| -> Result<VelenInspection, String> {
        panic!("disconnecting Velen should not inspect a source")
    };
    assert_eq!(
        update_project_velen_org_at(&config_path, "project-1", None, &inspect)
            .expect("Velen should disconnect"),
        None
    );

    let saved: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("saved config should be readable"),
    )
    .expect("saved config should be json");
    assert!(saved["projects"][0]["autoHunt"]["velenOrg"].is_null());
    assert!(saved["projects"][0]["autoHunt"]["dataSource"].is_null());
    assert_eq!(
        saved["projects"][0]["autoHunt"]["linear"],
        serde_json::json!({"enabled": false})
    );

    fs::remove_dir_all(directory).expect("test config directory should be removed");
}

#[test]
fn recognizes_pr_workflows_and_github_remotes() {
    let mut workflow = repository_workflow_bootstrap();
    assert!(!workflow_requires_github(&workflow));
    workflow.stages.push(WorkflowStageConfig {
        id: "pr_open".to_string(),
        label: "PR validation".to_string(),
        required: true,
        evidence: vec!["pull_request".to_string()],
        checks: Vec::new(),
    });
    assert!(workflow_requires_github(&workflow));
    assert_eq!(
        github_repository_from_remote("git@github.com:wordbricks/briar.git"),
        Some("wordbricks/briar".to_string())
    );
    assert_eq!(
        github_repository_from_remote("https://github.com/wordbricks/briar.git"),
        Some("wordbricks/briar".to_string())
    );
    assert_eq!(
        github_repository_from_remote("git@gitlab.com:wordbricks/briar.git"),
        None
    );
}

#[test]
fn installs_cli_and_skill_assets() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-assets-test-{unique}"));
    let resources = home.join("missing-resources");
    let stale_references = home.join(".codex/skills/briar-workflow/references");
    fs::create_dir_all(&stale_references).expect("stale references should be created");
    fs::write(stale_references.join("lifecycle.md"), "stale")
        .expect("stale reference should be written");

    install_auto_hunt_assets(&resources, &home).expect("assets should install");

    assert!(home.join(".local/bin/briar").is_file());
    assert!(home.join(".local/share/briar/briar.js").is_file());
    for runner in [
        "codex-runner.js",
        "claude-runner.js",
        "cursor-runner.js",
        "grok-runner.js",
        "opencode-runner.js",
    ] {
        assert!(home.join(".local/share/briar/agent").join(runner).is_file());
    }
    assert_eq!(
        read_trimmed_file(&home.join(".local/share/briar/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert!(home.join(".codex/skills/briar-workflow/SKILL.md").is_file());
    assert!(home
        .join(".claude/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home
        .join(".cursor/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home.join(".grok/skills/briar-workflow/SKILL.md").is_file());
    assert!(home
        .join(".config/opencode/skills/briar-workflow/SKILL.md")
        .is_file());
    assert!(home.join(".codex/skills/browser/SKILL.md").is_file());
    assert!(home.join(".claude/skills/browser/SKILL.md").is_file());
    assert!(home.join(".cursor/skills/browser/SKILL.md").is_file());
    assert!(home.join(".grok/skills/browser/SKILL.md").is_file());
    assert!(home
        .join(".config/opencode/skills/browser/SKILL.md")
        .is_file());
    assert!(!stale_references.exists());
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/browser/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    assert!(!sync_auto_hunt_assets(&resources, &home).expect("current assets should be checked"));

    fs::write(home.join(".local/share/briar/VERSION"), "0.0.0\n")
        .expect("CLI version should be made stale");
    assert!(sync_auto_hunt_assets(&resources, &home).expect("stale assets should be synchronized"));
    assert_eq!(
        read_trimmed_file(&home.join(".local/share/briar/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );

    fs::write(home.join(".codex/skills/briar-workflow/VERSION"), "0.0.0\n")
        .expect("skill version should be made stale");
    assert!(sync_auto_hunt_assets(&resources, &home).expect("stale skill should be synchronized"));
    assert_eq!(
        read_trimmed_file(&home.join(".codex/skills/briar-workflow/VERSION")),
        Some(env!("CARGO_PKG_VERSION").to_string())
    );
    fs::remove_dir_all(home).expect("test home should be removed");
}

#[cfg(debug_assertions)]
#[test]
fn development_builds_do_not_manage_installed_auto_hunt_assets() {
    assert!(!should_manage_installed_auto_hunt_assets());

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-dev-assets-test-{unique}"));
    let resources = home.join("missing-resources");

    assert!(!sync_auto_hunt_assets_and_restart_workers(
        &resources,
        &home,
        ExecutionWorkerRestartPolicy::WhenRuntimeIsStale,
    )
    .expect("development asset synchronization should be skipped"));
    assert!(!home.join(".local/share/briar").exists());
}

#[test]
fn worker_runtime_restart_policy_repairs_stale_processes() {
    assert!(ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(true, true));
    assert!(!ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(false, true));
    assert!(ExecutionWorkerRestartPolicy::WhenRuntimeIsStale.should_restart(false, false));
    assert!(ExecutionWorkerRestartPolicy::Always.should_restart(true, true));
    assert!(ExecutionWorkerRestartPolicy::Always.should_restart(false, true));
}

#[test]
fn worker_restart_version_marker_tracks_the_current_app() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-worker-restart-test-{unique}"));
    fs::create_dir_all(home.join(".local/share/briar"))
        .expect("runtime directory should be created");

    assert!(!execution_worker_restart_is_current(&home));
    record_execution_worker_restart_version(&home)
        .expect("current restart version should be recorded");
    assert!(execution_worker_restart_is_current(&home));

    fs::write(execution_worker_restart_version_path(&home), "0.0.0\n")
        .expect("restart marker should become stale");
    assert!(!execution_worker_restart_is_current(&home));

    fs::remove_dir_all(home).expect("test home should be removed");
}

#[cfg(unix)]
#[test]
fn runs_node_based_velen_from_a_gui_style_path() {
    use std::os::unix::fs::PermissionsExt;

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-velen-path-test-{unique}"));
    let local_bin = home.join(".local/bin");
    fs::create_dir_all(&local_bin).expect("test bin should be created");
    let node = local_bin.join("node");
    let velen = home.join("velen");
    fs::write(
        &node,
        "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true,\"runtime\":\"node\"}'\n",
    )
    .expect("fake node should be written");
    fs::write(&velen, "#!/usr/bin/env node\n").expect("fake Velen should be written");
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755))
        .expect("fake node should be executable");
    fs::set_permissions(&velen, fs::Permissions::from_mode(0o755))
        .expect("fake Velen should be executable");

    let result = run_velen_json_with(&velen, &home, &["auth", "whoami"])
        .expect("Velen should find node through the augmented GUI path");
    assert_eq!(
        result.get("runtime").and_then(|value| value.as_str()),
        Some("node")
    );

    fs::remove_dir_all(home).expect("test home should be removed");
}

#[test]
fn reports_health_drift_and_repairs_bundled_assets() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("briar-health-test-{unique}"));
    let resources = home.join("missing-resources");
    let config_path = home.join(".config/briar/config.json");
    let repository = git_repository_root(Path::new(env!("CARGO_MANIFEST_DIR")))
        .expect("workspace should be a git repository")
        .to_string_lossy()
        .into_owned();
    install_auto_hunt_assets(&resources, &home).expect("assets should install");
    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "https://briar.example.com".to_string(),
            project_id: "11111111-1111-4111-8111-111111111111".to_string(),
            agent_token: "briar_agent_test".to_string(),
            repository_path: repository,
            repository_remote: Some("https://github.com/wordbricks/briar.git".to_string()),
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: Some("wordbricks/briar".to_string()),
                workflow: repository_workflow_bootstrap(),
            },
        },
    )
    .expect("connection should be saved");
    let inspect = |_: Option<String>| {
        Ok(VelenInspection {
            authenticated: true,
            email: Some("jay@example.com".to_string()),
            current_org: Some("wordbricks".to_string()),
            organizations: Vec::new(),
            sources: Vec::new(),
        })
    };

    let healthy = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &inspect,
    )
    .expect("health should be readable");
    assert!(healthy.healthy);
    assert!(healthy.repository_healthy);
    assert!(healthy.cli_current);
    assert!(healthy.skill_current);
    assert!(healthy.velen_healthy);

    fs::remove_file(home.join(".local/share/briar/VERSION"))
        .expect("version marker should be removable");
    let drifted = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &inspect,
    )
    .expect("drifted health should be readable");
    assert!(!drifted.healthy);
    assert!(!drifted.cli_current);

    install_auto_hunt_assets(&resources, &home).expect("repair should reinstall assets");
    let repaired = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &inspect,
    )
    .expect("repaired health should be readable");
    assert!(repaired.healthy);
    assert!(repaired.cli_current);

    let mut config = read_cli_config(&config_path).expect("config should be readable");
    config.projects[0]
        .auto_hunt
        .as_mut()
        .expect("Auto Hunt settings should exist")
        .velen_org = None;
    write_cli_config(&config_path, &config).expect("optional Velen config should save");
    let no_inspect = |_: Option<String>| -> Result<VelenInspection, String> {
        panic!("unconfigured Velen should not be inspected")
    };
    let without_velen = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &no_inspect,
    )
    .expect("health without Velen should be readable");
    assert!(without_velen.healthy);
    assert!(without_velen.velen_healthy);
    assert!(without_velen.velen_org.is_none());

    let mut config = read_cli_config(&config_path).expect("config should be readable");
    config.projects[0]
        .auto_hunt
        .as_mut()
        .and_then(|auto_hunt| auto_hunt.workflow.as_mut())
        .expect("workflow should exist")
        .requirements = vec![WorkflowRequirementConfig {
        id: "custom_tool".to_string(),
        label: "Custom Tool".to_string(),
        kind: WorkflowRequirementKind::Executable,
        tool: "briar-tool-that-does-not-exist".to_string(),
        reason: "Runs repository validation.".to_string(),
    }];
    write_cli_config(&config_path, &config).expect("workflow requirement should save");
    let missing_tool = auto_hunt_health_sync_with(
        &config_path,
        &resources,
        &home,
        "11111111-1111-4111-8111-111111111111",
        &no_inspect,
    )
    .expect("tool requirement health should be readable");
    assert!(!missing_tool.healthy);
    assert_eq!(missing_tool.requirements.len(), 1);
    assert!(!missing_tool.requirements[0].healthy);
    assert!(missing_tool
        .issues
        .iter()
        .any(|issue| issue.contains("Custom Tool")));

    fs::remove_dir_all(home).expect("test home should be removed");
}

fn test_config_path(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after the epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("briar-host-test-{name}-{unique}"));
    fs::create_dir_all(&directory).expect("test directory should be created");
    directory.join("config.json")
}

#[test]
fn inspects_local_workers_without_mutating_their_configuration() {
    let config_path = test_config_path("inspect-workers");
    let contents = serde_json::json!({
        "apiUrl": "https://briar.example.com",
        "projects": [
            {
                "id": "project-1",
                "repositoryPath": "/repo/one",
                "agentToken": "briar_agent_one",
                "executionWorker": {
                    "workerId": "worker-1",
                    "deviceId": "device-1",
                    "label": "Dev Mac",
                    "maxConcurrentSessions": 3,
                    "token": "briar_worker_secret"
                }
            },
            {
                "id": "project-2",
                "repositoryPath": "/repo/two",
                "agentToken": "briar_agent_two"
            }
        ]
    })
    .to_string();
    fs::write(&config_path, &contents).expect("config should be written");

    let statuses = inspect_execution_workers_at(
        &config_path,
        vec![
            "project-2".to_string(),
            "missing-project".to_string(),
            "project-1".to_string(),
        ],
    )
    .expect("worker status should be readable");

    assert_eq!(
        statuses,
        vec![
            LocalExecutionWorkerStatus {
                project_id: "project-2".to_string(),
                registered: false,
                worker_id: None,
                device_id: None,
                label: None,
                max_concurrent_sessions: None,
            },
            LocalExecutionWorkerStatus {
                project_id: "project-1".to_string(),
                registered: true,
                worker_id: Some("worker-1".to_string()),
                device_id: Some("device-1".to_string()),
                label: Some("Dev Mac".to_string()),
                max_concurrent_sessions: Some(3),
            },
        ]
    );
    assert_eq!(
        fs::read_to_string(&config_path).expect("config should remain readable"),
        contents
    );
}

#[test]
fn resolves_the_registered_worker_device_for_the_requested_organization() {
    let config_path = test_config_path("current-worker-device");
    fs::write(
        &config_path,
        serde_json::json!({
            "apiUrl": "https://briar.example.com",
            "projects": [
                {
                    "id": "project-1",
                    "repositoryPath": "/repo/one",
                    "agentToken": "briar_agent_one",
                    "executionWorker": {
                        "workerId": "worker-1",
                        "deviceId": "device-local",
                        "organizationId": "organization-1",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_secret"
                    }
                },
                {
                    "id": "project-2",
                    "repositoryPath": "/repo/two",
                    "agentToken": "briar_agent_two",
                    "executionWorker": {
                        "workerId": "worker-2",
                        "deviceId": "device-local",
                        "organizationId": "organization-1",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_secret"
                    }
                },
                {
                    "id": "project-3",
                    "repositoryPath": "/repo/three",
                    "agentToken": "briar_agent_three",
                    "executionWorker": {
                        "workerId": "worker-3",
                        "deviceId": "device-other-org",
                        "organizationId": "organization-2",
                        "label": "Dev Mac",
                        "maxConcurrentSessions": 3,
                        "token": "briar_worker_other"
                    }
                }
            ]
        })
        .to_string(),
    )
    .expect("config should be written");

    assert_eq!(
        current_execution_worker_device_id_at(&config_path, "organization-1")
            .expect("device should resolve"),
        Some("device-local".to_string())
    );
    assert_eq!(
        current_execution_worker_device_id_at(&config_path, "missing-organization")
            .expect("an unregistered organization is valid"),
        None
    );
}

/// Write a project whose auto-hunt block carries CLI-owned worktree settings.
fn config_with_worktree_settings(config_path: &Path, worktrees: StoredWorktreeConfig) {
    config_with_cli_owned_settings(config_path, Some(worktrees), None)
}

fn config_with_cli_owned_settings(
    config_path: &Path,
    worktrees: Option<StoredWorktreeConfig>,
    sandbox: Option<StoredSandboxConfig>,
) {
    let config = CliConfig {
        api_url: "http://127.0.0.1:8787".to_string(),
        user_token: None,
        agent_providers: AppProviderSettings::default(),
        openrouter_api_key: None,
        app_settings: StoredAppRuntimeSettings::default(),
        projects: vec![CliProject {
            id: "project-1".to_string(),
            repository_path: "/repo".to_string(),
            api_url: Some("http://127.0.0.1:8787".to_string()),
            repository_remote: None,
            agent_token: "briar_agent_x".to_string(),
            llm: None,
            auto_hunt: Some(StoredAutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear: None,
                github_repository: None,
                workflow: None,
                worktrees,
                sandbox,
                extra: BTreeMap::new(),
            }),
            extra: BTreeMap::new(),
        }],
        extra: BTreeMap::new(),
    };
    write_cli_config(config_path, &config).expect("config should be written");
}

#[test]
fn stores_openrouter_credentials_locally_and_only_exposes_configuration_status() {
    let config_path = test_config_path("openrouter-credential");
    config_with_cli_owned_settings(&config_path, None, None);

    let status = update_openrouter_api_key_at(
        &config_path,
        Some("  sk-or-v1-local-test-key  ".to_string()),
    )
    .expect("credential should save");
    assert!(status.configured);

    let contents = fs::read_to_string(&config_path).expect("config should remain readable");
    assert!(contents.contains("sk-or-v1-local-test-key"));
    let environment = provider_environment_from(&config_path, agent::AgentProviderKind::Openrouter)
        .expect("OpenRouter environment should resolve");
    assert_eq!(
        environment[0],
        (
            "OPENROUTER_API_KEY".to_string(),
            "sk-or-v1-local-test-key".to_string(),
        )
    );
    assert_eq!(environment[1].0, "OPENCODE_CONFIG_CONTENT");
    assert!(!environment[1].1.contains("sk-or-v1-local-test-key"));

    let cleared =
        update_openrouter_api_key_at(&config_path, None).expect("credential should clear");
    assert!(!cleared.configured);
    assert!(
        provider_environment_from(&config_path, agent::AgentProviderKind::Openrouter,).is_err()
    );
}

#[cfg(unix)]
#[test]
fn passes_openrouter_environment_to_model_discovery() {
    use std::os::unix::fs::PermissionsExt;

    let config_path = test_config_path("openrouter-model-discovery");
    config_with_cli_owned_settings(&config_path, None, None);
    update_openrouter_api_key_at(
        &config_path,
        Some("sk-or-v1-discovery-test-key".to_string()),
    )
    .expect("OpenRouter credential should save");

    let home = tempfile::tempdir().expect("fixture home should exist");
    let binary = home.path().join("mock-opencode");
    fs::write(
        &binary,
        r#"#!/bin/sh
if [ "$OPENROUTER_API_KEY" != "sk-or-v1-discovery-test-key" ]; then
  exit 11
fi
case "$OPENCODE_CONFIG_CONTENT" in
  *openrouter*) ;;
  *) exit 12 ;;
esac
printf '%s\n' 'openrouter/test-model' '{' '  "name": "Test model"' '}'
"#,
    )
    .expect("mock OpenCode should be written");
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
        .expect("mock OpenCode should be executable");

    let environment = provider_environment_from(&config_path, agent::AgentProviderKind::Openrouter)
        .expect("OpenRouter environment should resolve");
    let models = command_provider_models(
        home.path(),
        Ok(binary),
        &["models", "--verbose"],
        parse_opencode_models_verbose,
        &environment,
    )
    .expect("model discovery should receive the OpenRouter environment");

    assert_eq!(models[0].id, "openrouter/test-model");
}

#[test]
fn rejects_malformed_openrouter_credentials() {
    let config_path = test_config_path("openrouter-invalid-credential");
    config_with_cli_owned_settings(&config_path, None, None);
    assert!(
        update_openrouter_api_key_at(&config_path, Some("sk-or invalid".to_string()),).is_err()
    );
}

#[test]
fn resolves_the_configured_auto_hunt_worktree_root_per_project() {
    let config_path = test_config_path("worktree-root");
    config_with_worktree_settings(
        &config_path,
        StoredWorktreeConfig {
            enabled: None,
            root: Some("/custom/worktrees".to_string()),
            branch_prefix: None,
            extra: BTreeMap::new(),
        },
    );
    assert_eq!(
        project_worktree_root(&config_path, "project-1", Path::new("/Users/dev"))
            .expect("root should resolve"),
        Some(PathBuf::from("/custom/worktrees/project-1"))
    );
}

#[test]
fn falls_back_to_the_default_worktree_root_and_honors_opt_out() {
    let config_path = test_config_path("worktree-default");
    config_with_worktree_settings(
        &config_path,
        StoredWorktreeConfig {
            enabled: None,
            root: None,
            branch_prefix: None,
            extra: BTreeMap::new(),
        },
    );
    assert_eq!(
        project_worktree_root(&config_path, "project-1", Path::new("/Users/dev"))
            .expect("root should resolve"),
        Some(PathBuf::from("/Users/dev/briar/workspaces/project-1"))
    );

    let disabled_path = test_config_path("worktree-disabled");
    config_with_worktree_settings(
        &disabled_path,
        StoredWorktreeConfig {
            enabled: Some(false),
            root: None,
            branch_prefix: None,
            extra: BTreeMap::new(),
        },
    );
    // Opted out: no extra writable root is granted to the agent.
    assert_eq!(
        project_worktree_root(&disabled_path, "project-1", Path::new("/Users/dev"))
            .expect("root should resolve"),
        None
    );
}

#[test]
fn saving_project_settings_keeps_cli_owned_worktree_settings() {
    let config_path = test_config_path("worktree-preserve");
    config_with_worktree_settings(
        &config_path,
        StoredWorktreeConfig {
            enabled: None,
            root: Some("/custom/worktrees".to_string()),
            branch_prefix: Some("hunt".to_string()),
            extra: BTreeMap::new(),
        },
    );

    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "http://127.0.0.1:8787".to_string(),
            project_id: "project-1".to_string(),
            agent_token: "briar_agent_x".to_string(),
            repository_path: "/repo".to_string(),
            repository_remote: None,
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: None,
                workflow: repository_workflow_bootstrap(),
            },
        },
    )
    .expect("settings should save");

    let worktrees = read_cli_config(&config_path)
        .expect("config should reload")
        .projects
        .into_iter()
        .find(|project| project.id == "project-1")
        .and_then(|project| project.auto_hunt)
        .and_then(|auto_hunt| auto_hunt.worktrees)
        .expect("worktree settings should survive an app-side save");
    assert_eq!(worktrees.root.as_deref(), Some("/custom/worktrees"));
    assert_eq!(worktrees.branch_prefix.as_deref(), Some("hunt"));
}

#[test]
fn project_filesystem_access_controls_saved_agent_sandbox() {
    let config_path = test_config_path("sandbox-default");
    config_with_cli_owned_settings(&config_path, None, None);
    let full_access = project_auto_hunt_full_access(&config_path, "project-1")
        .expect("sandbox setting should resolve");
    assert!(full_access);
    assert_eq!(
        project_agent_sandbox_mode(full_access),
        agent::SandboxMode::DangerFullAccess
    );

    let sandboxed = test_config_path("sandbox-workspace-only");
    config_with_cli_owned_settings(
        &sandboxed,
        None,
        Some(StoredSandboxConfig {
            full_access: Some(false),
            extra: BTreeMap::new(),
        }),
    );
    let full_access = project_auto_hunt_full_access(&sandboxed, "project-1")
        .expect("sandbox setting should resolve");
    assert!(!full_access);
    assert_eq!(
        project_agent_sandbox_mode(full_access),
        agent::SandboxMode::WorkspaceWrite
    );
}

#[test]
fn app_settings_can_change_and_preserve_the_workspace_sandbox() {
    let config_path = test_config_path("sandbox-preserve");
    config_with_cli_owned_settings(
        &config_path,
        None,
        Some(StoredSandboxConfig {
            full_access: Some(false),
            extra: BTreeMap::new(),
        }),
    );

    assert!(
        !project_sandbox_settings_from(&config_path, "project-1")
            .expect("sandbox setting should load")
            .full_access
    );
    update_project_sandbox_settings_at(
        &config_path,
        "project-1",
        ProjectSandboxSettings { full_access: true },
    )
    .expect("sandbox setting should update");
    assert!(project_auto_hunt_full_access(&config_path, "project-1")
        .expect("updated sandbox setting should resolve"));
    update_project_sandbox_settings_at(
        &config_path,
        "project-1",
        ProjectSandboxSettings { full_access: false },
    )
    .expect("sandbox setting should update");

    write_cli_connection(
        &config_path,
        CliConnectionInput {
            api_url: "http://127.0.0.1:8787".to_string(),
            project_id: "project-1".to_string(),
            agent_token: "briar_agent_x".to_string(),
            repository_path: "/repo".to_string(),
            repository_remote: None,
        },
        LocalProjectAgentConfig {
            llm: agent::ProjectLlmSettings::default(),
            auto_hunt: AutoHuntConfig {
                velen_org: Some("wordbricks".to_string()),
                data_source: None,
                linear_enabled: false,
                linear_source: None,
                linear_team: None,
                github_repository: None,
                workflow: repository_workflow_bootstrap(),
            },
        },
    )
    .expect("settings should save");

    assert!(!project_auto_hunt_full_access(&config_path, "project-1")
        .expect("sandbox setting should survive an app-side save"));
}

#[test]
fn resolves_a_workspace_root_through_a_runner() {
    let runner = host::LocalRunner::new(
        std::env::var_os("PATH").unwrap_or_default(),
        std::env::temp_dir(),
    );
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repository root should exist");
    let resolved = resolve_workspace_with(&runner, repository).expect("git root should resolve");
    assert_eq!(
        resolved,
        fs::canonicalize(repository).expect("repository should canonicalize")
    );

    let not_a_repository = std::env::temp_dir();
    assert!(resolve_workspace_with(&runner, &not_a_repository).is_err());
}
