//! Local execution host. Behaviour must stay identical to Briar's original
//! direct `Command::new` calls, because every existing project keeps using it.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

use super::{CommandOutput, CommandRunner, CommandSpec, ExecutionHostKind};

pub(crate) struct LocalRunner {
    execution_path: OsString,
    home: PathBuf,
}

impl LocalRunner {
    pub(crate) fn new(execution_path: OsString, home: PathBuf) -> Self {
        Self {
            execution_path,
            home,
        }
    }

    fn command_for(&self, spec: &CommandSpec) -> Command {
        let mut command = Command::new(&spec.program);
        command.args(&spec.args);
        command.env("PATH", &self.execution_path);
        for (key, value) in &spec.environment {
            command.env(key, value);
        }
        if let Some(directory) = spec.working_directory.as_deref() {
            command.current_dir(directory);
        }
        command
    }
}

impl CommandRunner for LocalRunner {
    fn kind(&self) -> ExecutionHostKind {
        ExecutionHostKind::Local
    }

    fn label(&self) -> String {
        "이 컴퓨터".to_string()
    }

    fn resolve_binary(&self, tool: &str) -> Result<String, String> {
        which::which_in(tool, Some(&self.execution_path), &self.home)
            .map(|path| path.to_string_lossy().to_string())
            .map_err(|_| format!("{tool}을(를) 찾지 못했습니다. 설치되어 있는지 확인해 주세요."))
    }

    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        let output = self
            .command_for(spec)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("{} 명령을 실행하지 못했습니다: {error}", spec.program))?;
        Ok(CommandOutput {
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    fn spawn_piped(&self, spec: &CommandSpec) -> Result<Child, String> {
        self.command_for(spec)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("{}을(를) 시작하지 못했습니다: {error}", spec.program))
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        std::fs::canonicalize(path)
            .map_err(|error| format!("경로를 열지 못했습니다: {} ({error})", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runner() -> LocalRunner {
        LocalRunner::new(
            std::env::var_os("PATH").unwrap_or_default(),
            std::env::temp_dir(),
        )
    }

    #[test]
    fn runs_a_local_command_and_captures_output() {
        let output = runner()
            .run(&CommandSpec::new("sh").args(["-c", "printf briar"]))
            .unwrap();
        assert!(output.success());
        assert_eq!(output.stdout_trimmed(), "briar");
    }

    #[test]
    fn reports_a_failing_exit_status_without_erroring() {
        let output = runner()
            .run(&CommandSpec::new("sh").args(["-c", "printf oops >&2; exit 3"]))
            .unwrap();
        assert!(!output.success());
        assert_eq!(output.status, Some(3));
        assert_eq!(output.stderr.trim(), "oops");
    }

    #[test]
    fn applies_the_working_directory_and_environment() {
        let directory = std::env::temp_dir();
        let output = runner()
            .run(
                &CommandSpec::new("sh")
                    .args(["-c", "printf %s \"$BRIAR_TEST_VALUE\"; pwd"])
                    .env("BRIAR_TEST_VALUE", "set")
                    .working_directory(&directory),
            )
            .unwrap();
        assert!(output.stdout.starts_with("set"));
        assert!(!output.stdout_trimmed().is_empty());
    }

    #[test]
    fn spawns_with_piped_stdio_for_the_agent_protocol() {
        use std::io::{BufRead, BufReader, Write};

        let mut child = runner()
            .spawn_piped(
                &CommandSpec::new("sh").args(["-c", "read line; printf '%s\\n' \"$line\""]),
            )
            .unwrap();
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"{\"type\":\"run\"}\n")
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.as_mut().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert_eq!(line.trim(), "{\"type\":\"run\"}");
        let _ = child.wait();
    }

    #[test]
    fn resolves_a_binary_that_exists_on_path() {
        assert!(runner().resolve_binary("sh").unwrap().contains("sh"));
    }

    #[test]
    fn reports_a_missing_binary_in_korean() {
        let error = runner()
            .resolve_binary("briar-does-not-exist")
            .expect_err("missing binary");
        assert!(error.contains("찾지 못했습니다"));
    }
}
