//! Local command execution shared by Briar's desktop integrations.

mod local;

use std::{
    path::{Path, PathBuf},
    process::Child,
};

pub(crate) use local::LocalRunner;

/// One command to run on the local machine.
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
            Some(0) => "명령은 성공했지만 출력이 비어 있습니다.".to_string(),
            Some(code) => format!("종료 코드 {code}"),
            None => "신호로 종료되었습니다.".to_string(),
        }
    }
}

pub(crate) trait CommandRunner: Send + Sync {
    /// Absolute path of a local tool, or a Korean error naming it.
    fn resolve_binary(&self, tool: &str) -> Result<String, String>;
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String>;
    /// Spawn a local process with piped stdio for an agent protocol.
    fn spawn_piped(&self, spec: &CommandSpec) -> Result<Child, String>;
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let empty_success = CommandOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_eq!(
            empty_success.failure_message(),
            "명령은 성공했지만 출력이 비어 있습니다."
        );
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
