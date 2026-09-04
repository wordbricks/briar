use super::*;

fn provider_prerequisite(installed: bool, authenticated: bool) -> OnboardingPrerequisiteStatus {
    OnboardingPrerequisiteStatus {
        installed,
        version: installed.then(|| "test-version".to_string()),
        authenticated,
    }
}

/// The provider a connection picks with no explicit choice, the way the
/// connection commands compose availability and selection.
fn connected_agent_provider(
    prerequisites: &OnboardingPrerequisites,
    enabled: LocalAgentProviderSettings,
    quotas: &agent_usage::ProviderQuotas,
) -> Result<agent::AgentProviderKind, String> {
    select_connected_agent_provider(&agent_provider_availability(prerequisites, enabled, quotas))
}

fn open_quotas() -> agent_usage::ProviderQuotas {
    agent_usage::ProviderQuotas::default()
}

fn exhausted_quota(resets_at: Option<u64>) -> agent_usage::ProviderQuota {
    agent_usage::ProviderQuota {
        known: true,
        exhausted: true,
        max_used_percent: Some(100.0),
        resets_at,
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
        connected_agent_provider(
            &prerequisites,
            default_agent_provider_settings(),
            &open_quotas(),
        )
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
            LocalAgentProviderSettings {
                codex: false,
                claude: true,
                cursor: true,
                grok: true,
                agy: true,
                opencode: true,
                openrouter: true,
                ..Default::default()
            },
            &open_quotas(),
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
        connected_agent_provider(
            &prerequisites,
            default_agent_provider_settings(),
            &open_quotas(),
        )
        .expect("OpenCode should be selected"),
        agent::AgentProviderKind::Opencode
    );
}

#[test]
fn rejects_repository_analysis_without_a_connected_llm_provider() {
    let prerequisites =
        provider_prerequisites((true, false), (false, false), (true, false), (false, false));

    assert!(connected_agent_provider(
        &prerequisites,
        default_agent_provider_settings(),
        &open_quotas(),
    )
    .expect_err("a connected provider should be required")
    .contains("연결된 LLM 프로바이더가 없습니다"));
}

#[test]
fn skips_a_connected_provider_whose_usage_window_is_spent() {
    let prerequisites =
        provider_prerequisites((true, true), (true, true), (false, false), (false, false));

    assert_eq!(
        connected_agent_provider(
            &prerequisites,
            default_agent_provider_settings(),
            &open_quotas().with(agent::AgentProviderKind::Codex, exhausted_quota(None)),
        )
        .expect("Claude should be selected"),
        agent::AgentProviderKind::Claude
    );
}

#[test]
fn falls_back_to_an_exhausted_provider_when_it_is_the_only_connected_one() {
    let prerequisites =
        provider_prerequisites((true, true), (false, false), (false, false), (false, false));

    assert_eq!(
        connected_agent_provider(
            &prerequisites,
            default_agent_provider_settings(),
            &open_quotas().with(agent::AgentProviderKind::Codex, exhausted_quota(None)),
        )
        .expect("the only connected provider should still be offered"),
        agent::AgentProviderKind::Codex
    );
}

#[test]
fn reports_why_each_provider_can_or_cannot_analyse_a_repository() {
    let prerequisites =
        provider_prerequisites((true, true), (true, false), (false, false), (true, true));
    let availability = agent_provider_availability(
        &prerequisites,
        LocalAgentProviderSettings {
            codex: true,
            claude: true,
            cursor: true,
            grok: true,
            agy: true,
            opencode: false,
            openrouter: true,
            ..Default::default()
        },
        &open_quotas().with(
            agent::AgentProviderKind::Codex,
            exhausted_quota(Some(1_800_052_800_000)),
        ),
    );
    let entry = |provider: agent::AgentProviderKind| {
        availability
            .iter()
            .find(|entry| entry.provider == provider)
            .expect("every provider should be reported")
    };

    let codex = entry(agent::AgentProviderKind::Codex);
    assert!(codex.selectable && codex.usage_exhausted);
    assert_eq!(
        codex.reason,
        Some(AgentProviderUnavailableReason::UsageExhausted)
    );
    assert_eq!(codex.usage_resets_at, Some(1_800_052_800_000));
    assert_eq!(
        entry(agent::AgentProviderKind::Claude).reason,
        Some(AgentProviderUnavailableReason::NotAuthenticated)
    );
    assert_eq!(
        entry(agent::AgentProviderKind::Grok).reason,
        Some(AgentProviderUnavailableReason::NotInstalled)
    );
    assert_eq!(
        entry(agent::AgentProviderKind::Opencode).reason,
        Some(AgentProviderUnavailableReason::Disabled)
    );
    assert!(!entry(agent::AgentProviderKind::Opencode).selectable);
}

#[test]
fn commits_a_requested_provider_only_while_it_stays_usable() {
    let prerequisites =
        provider_prerequisites((true, true), (true, true), (false, false), (false, false));
    let availability = agent_provider_availability(
        &prerequisites,
        default_agent_provider_settings(),
        &open_quotas().with(agent::AgentProviderKind::Claude, exhausted_quota(None)),
    );

    assert_eq!(
        requested_agent_provider(&availability, agent::AgentProviderKind::Claude)
            .expect("an exhausted provider stays the user's choice"),
        agent::AgentProviderKind::Claude
    );
    assert!(
        requested_agent_provider(&availability, agent::AgentProviderKind::Grok)
            .expect_err("a provider that is not connected cannot be committed")
            .contains("Grok")
    );
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

    let (binary, arguments) =
        provider_login_binary_and_args(home.path(), AgentLoginProvider::Cursor)
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
    let execution_path = env::join_paths([directory.path()]).expect("fixture PATH should resolve");

    let working_status = inspect_cli(Ok(working), &execution_path);
    assert!(working_status.installed);
    assert!(working_status.authenticated);
    assert_eq!(working_status.version.as_deref(), Some("codex-cli 1.2.3"));

    let broken_status = inspect_cli(Ok(broken), &execution_path);
    assert!(!broken_status.installed);
    assert!(!broken_status.authenticated);
    assert_eq!(broken_status.version, None);
}

#[cfg(unix)]
#[test]
fn inspects_a_cli_with_a_runtime_from_the_execution_path() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().expect("fixture directory should exist");
    let launcher = directory.path().join("script-cli");
    let runtime = directory.path().join("script-runtime");
    fs::write(&launcher, "#!/usr/bin/env script-runtime\n")
        .expect("CLI launcher fixture should be written");
    fs::write(&runtime, "#!/bin/sh\nprintf 'script-cli 1.2.3\\n'\n")
        .expect("runtime fixture should be written");
    for binary in [&launcher, &runtime] {
        fs::set_permissions(binary, fs::Permissions::from_mode(0o700))
            .expect("fixture binary should be executable");
    }
    let execution_path = env::join_paths([directory.path()]).expect("fixture PATH should resolve");

    let status = inspect_cli(Ok(launcher), &execution_path);

    assert!(status.installed);
    assert!(status.authenticated);
    assert_eq!(status.version.as_deref(), Some("script-cli 1.2.3"));
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
    let package: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../package.json"))
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
fn resolves_the_workspace_git_root() {
    let home = dirs::home_dir().expect("home should resolve");
    let runner = LocalExecutionEnvironment::discover(&home)
        .expect("local environment should resolve")
        .runner();
    let root = git_repository_root(&runner, Path::new(env!("CARGO_MANIFEST_DIR")))
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
#[cfg(unix)]
fn resolves_repository_metadata_through_the_shared_nix_environment() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("fixture home should exist");
    let repository = home.path().join("repository");
    fs::create_dir_all(&repository).expect("fixture repository should exist");
    let profile = home.path().join(".nix-profile/bin");
    fs::create_dir_all(&profile).expect("Nix profile should exist");
    let git = profile.join("git");
    fs::write(
        &git,
        "#!/bin/sh\ncase \"$1\" in\n  rev-parse) pwd ;;\n  remote) printf 'git@github.com:example/repository.git\\n' ;;\n  *) exit 2 ;;\nesac\n",
    )
    .expect("fixture Git should be written");
    fs::set_permissions(&git, fs::Permissions::from_mode(0o700))
        .expect("fixture Git should be executable");
    let runner = LocalExecutionEnvironment::discover(home.path())
        .expect("local environment should resolve")
        .runner();

    assert_eq!(
        git_repository_root(&runner, &repository).expect("root should resolve"),
        repository
            .canonicalize()
            .expect("fixture should canonicalize")
    );
    assert_eq!(
        repository_remote(&runner, &repository).as_deref(),
        Some("git@github.com:example/repository.git")
    );
}
