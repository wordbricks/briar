use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

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
    assert_eq!(compatibility.stack, Some(LovableStack::TanstackStart));
    assert_eq!(
        compatibility.package_manager,
        Some(LovablePackageManager::Npm)
    );
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
    assert_eq!(compatibility.stack, Some(LovableStack::ViteReact));
    assert_eq!(
        compatibility.package_manager,
        Some(LovablePackageManager::Bun)
    );
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
fn non_pr_workflows_skip_optional_remote_probes() {
    struct RecordingRunner {
        inner: host::LocalRunner,
        commands: std::sync::Mutex<Vec<Vec<String>>>,
    }

    impl host::CommandRunner for RecordingRunner {
        fn resolve_binary(&self, tool: &str) -> Result<String, String> {
            host::CommandRunner::resolve_binary(&self.inner, tool)
        }

        fn run(&self, spec: &host::CommandSpec) -> Result<host::CommandOutput, String> {
            self.commands
                .lock()
                .expect("commands")
                .push(spec.args.clone());
            if spec
                .args
                .iter()
                .any(|argument| matches!(argument.as_str(), "ls-remote" | "push"))
            {
                return Ok(host::CommandOutput {
                    status: Some(1),
                    stdout: String::new(),
                    stderr: "remote probe should not run".to_string(),
                });
            }
            host::CommandRunner::run(&self.inner, spec)
        }

        fn spawn_piped(&self, spec: &host::CommandSpec) -> Result<std::process::Child, String> {
            host::CommandRunner::spawn_piped(&self.inner, spec)
        }

        fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
            host::CommandRunner::canonicalize(&self.inner, path)
        }
    }

    let Ok(git) = which::which("git") else {
        return;
    };
    let repository = tempfile::tempdir().expect("temporary repository");
    let initialized = std::process::Command::new(&git)
        .args(["init", "--quiet"])
        .current_dir(repository.path())
        .status()
        .expect("git init should start");
    assert!(initialized.success());
    let remote_added = std::process::Command::new(&git)
        .args([
            "remote",
            "add",
            "origin",
            "ssh://example.invalid/repository.git",
        ])
        .current_dir(repository.path())
        .status()
        .expect("git remote should start");
    assert!(remote_added.success());
    let runner = RecordingRunner {
        inner: host::LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            repository.path().to_path_buf(),
        ),
        commands: std::sync::Mutex::new(Vec::new()),
    };

    let readiness = inspect_repository_readiness_on(
        &runner,
        repository.path(),
        &repository_workflow_bootstrap(),
    );

    assert!(!readiness.requires_github);
    assert!(readiness.git_ready);
    assert!(readiness.issues.is_empty(), "{:?}", readiness.issues);
    assert!(runner
        .commands
        .lock()
        .expect("commands")
        .iter()
        .all(|arguments| {
            !arguments
                .iter()
                .any(|argument| matches!(argument.as_str(), "ls-remote" | "push"))
        }));
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
