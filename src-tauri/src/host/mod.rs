//! Host-aware command execution.
//!
//! Briar runs `git`, `gh`, `velen`, its own CLI, and the coding agents as child
//! processes. Every one of those invocations goes through a [`CommandRunner`]
//! so the same code path serves the local machine and a remote SSH host. The
//! agents themselves speak line-delimited JSON over stdio, which an SSH exec
//! channel provides unchanged — no port forwarding and no relay daemon.

mod local;
mod shell;
mod ssh;

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Child,
    sync::Arc,
};

pub(crate) use local::LocalRunner;
pub(crate) use shell::shell_quote;
pub(crate) use ssh::{parse_ssh_resolve_output, SshAuth, SshHost, SshResolvedTarget, SshRunner};

pub(crate) const LOCAL_EXECUTION_HOST_ID: &str = "local";
const SSH_EXECUTION_HOST_PREFIX: &str = "ssh:";

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExecutionHostKind {
    Local,
    Ssh,
}

/// Which machine a project executes on. `local` is always available and is the
/// value every pre-existing project resolves to.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ExecutionHostId {
    Local,
    Ssh { host_id: String },
}

impl ExecutionHostId {
    /// Parse a stored identifier. Unknown or empty values resolve to `local`
    /// so a config written by a newer build can still be opened.
    pub(crate) fn parse(value: Option<&str>) -> Self {
        let Some(trimmed) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return Self::Local;
        };
        if trimmed == LOCAL_EXECUTION_HOST_ID {
            return Self::Local;
        }
        match trimmed.strip_prefix(SSH_EXECUTION_HOST_PREFIX) {
            Some(host_id) if !host_id.trim().is_empty() => Self::Ssh {
                host_id: host_id.trim().to_string(),
            },
            _ => Self::Local,
        }
    }

    pub(crate) fn as_stored(&self) -> String {
        match self {
            Self::Local => LOCAL_EXECUTION_HOST_ID.to_string(),
            Self::Ssh { host_id } => format!("{SSH_EXECUTION_HOST_PREFIX}{host_id}"),
        }
    }

    pub(crate) fn is_local(&self) -> bool {
        matches!(self, Self::Local)
    }

    pub(crate) fn ssh_host_id(&self) -> Option<&str> {
        match self {
            Self::Local => None,
            Self::Ssh { host_id } => Some(host_id),
        }
    }
}

pub(crate) fn ssh_execution_host_id(host_id: &str) -> String {
    format!("{SSH_EXECUTION_HOST_PREFIX}{host_id}")
}

/// One command to run on a host.
#[derive(Clone, Debug, Default)]
pub(crate) struct CommandSpec {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) working_directory: Option<PathBuf>,
    pub(crate) environment: Vec<(String, String)>,
}

impl CommandSpec {
    pub(crate) fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            ..Self::default()
        }
    }

    pub(crate) fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args
            .extend(args.into_iter().map(|argument| argument.into()));
        self
    }

    pub(crate) fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.environment.push((key.into(), value.into()));
        self
    }

    pub(crate) fn working_directory(mut self, directory: impl Into<PathBuf>) -> Self {
        self.working_directory = Some(directory.into());
        self
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CommandOutput {
    pub(crate) status: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

impl CommandOutput {
    pub(crate) fn success(&self) -> bool {
        self.status == Some(0)
    }

    pub(crate) fn stdout_trimmed(&self) -> String {
        self.stdout.trim().to_string()
    }

    /// Best diagnostic line available, preferring stderr the way the shell does.
    pub(crate) fn failure_message(&self) -> String {
        let stderr = self.stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }
        let stdout = self.stdout.trim();
        if !stdout.is_empty() {
            return stdout.to_string();
        }
        match self.status {
            Some(code) => format!("종료 코드 {code}"),
            None => "신호로 종료되었습니다.".to_string(),
        }
    }
}

pub(crate) trait CommandRunner: Send + Sync {
    fn kind(&self) -> ExecutionHostKind;
    /// Human-readable host name for error messages.
    fn label(&self) -> String;
    /// Absolute path of a tool on this host, or a Korean error naming it.
    fn resolve_binary(&self, tool: &str) -> Result<String, String>;
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String>;
    /// Spawn with piped stdio. The agents' stdio JSON protocol rides this.
    fn spawn_piped(&self, spec: &CommandSpec) -> Result<Child, String>;
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String>;

    fn is_remote(&self) -> bool {
        self.kind() != ExecutionHostKind::Local
    }
}

/// Build the runner for a resolved host.
pub(crate) fn runner_for(
    host: &ExecutionHostId,
    hosts: &[SshHost],
    execution_path: OsString,
    home: &Path,
    auth: SshAuth,
) -> Result<Arc<dyn CommandRunner>, String> {
    match host {
        ExecutionHostId::Local => Ok(Arc::new(LocalRunner::new(execution_path, home.to_path_buf()))),
        ExecutionHostId::Ssh { host_id } => {
            let host = hosts
                .iter()
                .find(|candidate| candidate.id == *host_id)
                .ok_or_else(|| {
                    "연결된 SSH 호스트를 찾지 못했습니다. 설정에서 호스트를 다시 추가해 주세요."
                        .to_string()
                })?;
            Ok(Arc::new(SshRunner::new(
                host.clone(),
                auth,
                home.to_path_buf(),
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_missing_and_empty_identifiers_as_local() {
        assert_eq!(ExecutionHostId::parse(None), ExecutionHostId::Local);
        assert_eq!(ExecutionHostId::parse(Some("")), ExecutionHostId::Local);
        assert_eq!(ExecutionHostId::parse(Some("   ")), ExecutionHostId::Local);
        assert_eq!(ExecutionHostId::parse(Some("local")), ExecutionHostId::Local);
    }

    #[test]
    fn parses_ssh_identifiers() {
        assert_eq!(
            ExecutionHostId::parse(Some("ssh:ssh-1753000000-abc123")),
            ExecutionHostId::Ssh {
                host_id: "ssh-1753000000-abc123".to_string()
            }
        );
        assert_eq!(
            ExecutionHostId::parse(Some(" ssh:ssh-1 ")),
            ExecutionHostId::Ssh {
                host_id: "ssh-1".to_string()
            }
        );
    }

    #[test]
    fn falls_back_to_local_for_unusable_identifiers() {
        assert_eq!(ExecutionHostId::parse(Some("ssh:")), ExecutionHostId::Local);
        assert_eq!(
            ExecutionHostId::parse(Some("worker:abc")),
            ExecutionHostId::Local,
            "a detached worker never executes on behalf of the desktop"
        );
    }

    #[test]
    fn round_trips_stored_identifiers() {
        for stored in ["local", "ssh:ssh-1"] {
            assert_eq!(
                ExecutionHostId::parse(Some(stored)).as_stored(),
                stored.to_string()
            );
        }
    }

    #[test]
    fn exposes_the_ssh_host_id_only_for_ssh_hosts() {
        assert_eq!(ExecutionHostId::Local.ssh_host_id(), None);
        assert!(ExecutionHostId::Local.is_local());
        let ssh = ExecutionHostId::parse(Some("ssh:ssh-9"));
        assert_eq!(ssh.ssh_host_id(), Some("ssh-9"));
        assert!(!ssh.is_local());
    }

    #[test]
    fn selects_a_local_runner_for_the_local_host() {
        let runner = runner_for(
            &ExecutionHostId::Local,
            &[],
            OsString::from("/usr/bin"),
            &std::env::temp_dir(),
            SshAuth::default(),
        )
        .unwrap();
        assert_eq!(runner.kind(), ExecutionHostKind::Local);
        assert!(!runner.is_remote());
    }

    #[test]
    fn selects_an_ssh_runner_for_a_known_host() {
        let hosts = vec![SshHost {
            id: "ssh-1".to_string(),
            label: "build-box".to_string(),
            alias: "build-box".to_string(),
            ..SshHost::default()
        }];
        let runner = runner_for(
            &ExecutionHostId::parse(Some("ssh:ssh-1")),
            &hosts,
            OsString::from("/usr/bin"),
            &std::env::temp_dir(),
            SshAuth::default(),
        )
        .unwrap();
        assert_eq!(runner.kind(), ExecutionHostKind::Ssh);
        assert!(runner.is_remote());
        assert_eq!(runner.label(), "build-box");
    }

    #[test]
    fn rejects_an_unknown_ssh_host() {
        let error = runner_for(
            &ExecutionHostId::parse(Some("ssh:missing")),
            &[],
            OsString::from("/usr/bin"),
            &std::env::temp_dir(),
            SshAuth::default(),
        )
        .err()
        .expect("unknown host must not resolve to a runner");
        assert!(error.contains("SSH 호스트를 찾지 못했습니다"));
    }

    #[test]
    fn summarizes_failures_preferring_stderr() {
        let output = CommandOutput {
            status: Some(1),
            stdout: "out".to_string(),
            stderr: " boom \n".to_string(),
        };
        assert_eq!(output.failure_message(), "boom");
        let stdout_only = CommandOutput {
            status: Some(1),
            stdout: "out".to_string(),
            stderr: String::new(),
        };
        assert_eq!(stdout_only.failure_message(), "out");
        let silent = CommandOutput {
            status: Some(9),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_eq!(silent.failure_message(), "종료 코드 9");
        let signalled = CommandOutput {
            status: None,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(signalled.failure_message().contains("신호"));
    }

    #[test]
    fn builds_command_specs_fluently() {
        let spec = CommandSpec::new("git")
            .args(["status", "--porcelain"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .working_directory("/repo");
        assert_eq!(spec.program, "git");
        assert_eq!(spec.args, vec!["status", "--porcelain"]);
        assert_eq!(
            spec.environment,
            vec![("GIT_TERMINAL_PROMPT".to_string(), "0".to_string())]
        );
        assert_eq!(spec.working_directory, Some(PathBuf::from("/repo")));
    }
}
