//! Deterministic local process environment for GUI-launched desktop commands.

use std::{
    collections::HashSet,
    env,
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
};

#[cfg(test)]
use super::CommandRunner;
use super::LocalRunner;

#[derive(Clone, Debug)]
pub(crate) struct LocalExecutionEnvironment {
    home: PathBuf,
    execution_path: OsString,
}

impl LocalExecutionEnvironment {
    pub(crate) fn discover(home: &Path) -> Result<Self, String> {
        let runtime_directories = env::current_exe()
            .map(|executable| bundled_runtime_directories(&executable))
            .unwrap_or_default();
        Self::with_runtime_and_inherited_path(home, runtime_directories, env::var_os("PATH"))
    }

    fn with_runtime_and_inherited_path(
        home: &Path,
        runtime_directories: impl IntoIterator<Item = PathBuf>,
        inherited_path: Option<OsString>,
    ) -> Result<Self, String> {
        let execution_path = env::join_paths(execution_path_candidates(
            home,
            runtime_directories,
            inherited_path.as_deref(),
        ))
        .map_err(|error| format!("CLI 실행 경로를 구성하지 못했습니다: {error}"))?;
        Ok(Self {
            home: home.to_path_buf(),
            execution_path,
        })
    }

    pub(crate) fn runner(&self) -> LocalRunner {
        LocalRunner::new(self.execution_path.clone(), self.home.clone())
    }
}

fn execution_path_candidates(
    home: &Path,
    runtime_directories: impl IntoIterator<Item = PathBuf>,
    inherited_path: Option<&OsStr>,
) -> Vec<PathBuf> {
    let mut paths = vec![home.join(".local/bin")];
    paths.extend(runtime_directories);
    paths.extend([
        home.join(".grok/bin"),
        home.join(".cursor/bin"),
        home.join(".opencode/bin"),
        home.join("bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        home.join(".volta/bin"),
        home.join(".asdf/shims"),
        home.join(".asdf/bin"),
        home.join(".local/share/mise/shims"),
        home.join(".mise/shims"),
        home.join(".nodenv/shims"),
        home.join(".nodenv/bin"),
        home.join("Library/Android/sdk/platform-tools"),
        home.join("Library/Android/sdk/emulator"),
        home.join("Android/Sdk/platform-tools"),
        home.join("Android/Sdk/emulator"),
    ]);

    #[cfg(unix)]
    {
        paths.push(home.join(".nix-profile/bin"));
        if let Some(username) = home.file_name().filter(|name| !name.is_empty()) {
            paths.push(
                PathBuf::from("/etc/profiles/per-user")
                    .join(username)
                    .join("bin"),
            );
            paths.push(
                PathBuf::from("/nix/var/nix/profiles/per-user")
                    .join(username)
                    .join("profile/bin"),
            );
        }
        paths.extend([
            PathBuf::from("/run/current-system/sw/bin"),
            PathBuf::from("/nix/var/nix/profiles/default/bin"),
        ]);
    }

    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    for variable in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(sdk_root) = env::var_os(variable) {
            let sdk_root = PathBuf::from(sdk_root);
            paths.push(sdk_root.join("platform-tools"));
            paths.push(sdk_root.join("emulator"));
        }
    }
    if let Some(existing) = inherited_path {
        paths.extend(env::split_paths(existing));
    }

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

/// A version manager shim directory (`mise`, `asdf`, `nodenv`, `pyenv`, …).
///
/// Their contents are dispatch stubs, not the tool: `~/.local/share/mise/shims/claude`
/// re-executes `mise`, which refuses to run when the directory it is invoked
/// from holds an untrusted `mise.toml` — exactly the case for the temporary
/// worktree a workflow analysis runs in. The shim directories stay on PATH so
/// a tool installed only through a version manager still resolves.
pub(crate) fn is_version_manager_shim_directory(directory: &Path) -> bool {
    directory.file_name() == Some(OsStr::new("shims"))
}

/// Resolve `tool` on `execution_path`, preferring a real binary over a version
/// manager shim. A shim only wins when nothing else on PATH provides the tool.
pub(crate) fn resolve_without_shim_shadowing(
    tool: &str,
    execution_path: &OsStr,
    cwd: &Path,
) -> Option<PathBuf> {
    let matches = which::which_in_all(tool, Some(execution_path), cwd)
        .map(|paths| paths.collect::<Vec<_>>())
        .unwrap_or_default();
    matches
        .iter()
        .find(|path| {
            path.parent()
                .is_none_or(|parent| !is_version_manager_shim_directory(parent))
        })
        .or_else(|| matches.first())
        .cloned()
}

pub(crate) fn bundled_runtime_directories(executable: &Path) -> Vec<PathBuf> {
    let Some(directory) = executable.parent() else {
        return Vec::new();
    };
    let mut directories = vec![directory.to_path_buf()];
    if directory.file_name() == Some(OsStr::new("deps")) {
        if let Some(target_profile) = directory.parent() {
            directories.push(target_profile.to_path_buf());
        }
    }
    directories
}

pub(crate) fn bundled_bun_binary() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .into_iter()
        .flat_map(|executable| bundled_runtime_directories(&executable))
        .map(|directory| directory.join("bun"))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
pub(crate) fn cli_execution_path_with_runtime(
    home: &Path,
    runtime_directories: impl IntoIterator<Item = PathBuf>,
) -> Result<OsString, String> {
    LocalExecutionEnvironment::with_runtime_and_inherited_path(
        home,
        runtime_directories,
        env::var_os("PATH"),
    )
    .map(|environment| environment.execution_path)
}

pub(crate) fn cli_execution_path(home: &Path) -> Result<OsString, String> {
    LocalExecutionEnvironment::discover(home).map(|environment| environment.execution_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn includes_nix_profiles_before_system_paths_and_deduplicates() {
        let home = Path::new("/Users/tester");
        let inherited = OsStr::new("/usr/bin:/custom/bin:/usr/bin");
        let paths = execution_path_candidates(
            home,
            [PathBuf::from("/Applications/Briar.app/Contents/MacOS")],
            Some(inherited),
        );

        let expected_nix_paths = [
            home.join(".nix-profile/bin"),
            PathBuf::from("/etc/profiles/per-user/tester/bin"),
            PathBuf::from("/nix/var/nix/profiles/per-user/tester/profile/bin"),
            PathBuf::from("/run/current-system/sw/bin"),
            PathBuf::from("/nix/var/nix/profiles/default/bin"),
        ];
        for expected in expected_nix_paths {
            assert!(paths.contains(&expected), "missing {}", expected.display());
        }
        let nix_profile = paths
            .iter()
            .position(|path| path == &home.join(".nix-profile/bin"))
            .unwrap();
        let homebrew = paths
            .iter()
            .position(|path| path == Path::new("/opt/homebrew/bin"))
            .unwrap();
        assert!(nix_profile < homebrew);
        assert_eq!(
            paths
                .iter()
                .filter(|path| path.as_path() == Path::new("/usr/bin"))
                .count(),
            1
        );
    }

    #[test]
    #[cfg(unix)]
    fn prefers_a_real_binary_over_a_version_manager_shim_earlier_on_path() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let home = tempfile::tempdir().expect("fixture home should exist");
        let shims = home.path().join(".local/share/mise/shims");
        let homebrew = home.path().join("opt/homebrew/bin");
        fs::create_dir_all(&shims).expect("shim directory should exist");
        fs::create_dir_all(&homebrew).expect("homebrew directory should exist");
        for directory in [&shims, &homebrew] {
            let binary = directory.join("fixture-claude");
            fs::write(&binary, "#!/bin/sh\nexit 0\n").expect("fixture should be written");
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
                .expect("fixture should be executable");
        }
        // The shim directory comes first, exactly as it does in the real
        // execution PATH.
        let execution_path =
            env::join_paths([shims.clone(), homebrew.clone()]).expect("fixture PATH should join");

        assert_eq!(
            resolve_without_shim_shadowing("fixture-claude", &execution_path, home.path()),
            Some(homebrew.join("fixture-claude")),
        );

        // A tool that only a version manager provides still resolves.
        fs::remove_file(homebrew.join("fixture-claude")).expect("homebrew copy should be removed");
        assert_eq!(
            resolve_without_shim_shadowing("fixture-claude", &execution_path, home.path()),
            Some(shims.join("fixture-claude")),
        );
        assert_eq!(
            resolve_without_shim_shadowing("briar-does-not-exist", &execution_path, home.path()),
            None,
        );
    }

    #[test]
    #[cfg(unix)]
    fn local_runner_prefers_a_real_binary_over_a_shim() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let home = tempfile::tempdir().expect("fixture home should exist");
        let shims = home.path().join(".local/share/mise/shims");
        let real = home.path().join(".local/bin");
        fs::create_dir_all(&shims).expect("shim directory should exist");
        fs::create_dir_all(&real).expect("binary directory should exist");
        for directory in [&shims, &real] {
            let binary = directory.join("fixture-tool");
            fs::write(&binary, "#!/bin/sh\nexit 0\n").expect("fixture should be written");
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
                .expect("fixture should be executable");
        }
        let environment = LocalExecutionEnvironment::with_runtime_and_inherited_path(
            home.path(),
            Vec::new(),
            Some(OsString::from("/usr/bin:/bin")),
        )
        .expect("environment should resolve");

        assert_eq!(
            environment
                .runner()
                .resolve_binary("fixture-tool")
                .expect("tool should resolve"),
            real.join("fixture-tool").to_string_lossy(),
        );
    }

    #[test]
    #[cfg(unix)]
    fn local_runner_resolves_a_tool_from_the_user_nix_profile() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let home = tempfile::tempdir().expect("fixture home should exist");
        let profile = home.path().join(".nix-profile/bin");
        fs::create_dir_all(&profile).expect("profile directory should exist");
        let tool = profile.join("fixture-tool");
        fs::write(&tool, "#!/bin/sh\nprintf 'fixture-tool 1.0\\n'\n")
            .expect("fixture tool should be written");
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o700))
            .expect("fixture tool should be executable");
        let environment = LocalExecutionEnvironment::with_runtime_and_inherited_path(
            home.path(),
            Vec::new(),
            Some(OsString::from("/usr/bin:/bin")),
        )
        .expect("environment should resolve");

        assert_eq!(
            environment
                .runner()
                .resolve_binary("fixture-tool")
                .expect("tool should resolve"),
            tool.to_string_lossy()
        );
    }
}
