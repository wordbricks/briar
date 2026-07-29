//! SSH execution host: target resolution, authentication helpers, and the
//! runner that executes Briar's tools on a remote machine.
//!
//! Briar drives the system `ssh` binary rather than linking an SSH library, so
//! `ProxyJump`, `Match` blocks, hardware keys, and agent forwarding keep
//! working exactly as they do in the user's own shell.

use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use super::shell::{remote_command_script, remote_tool_lookup_script, shell_quote};
use super::{CommandOutput, CommandRunner, CommandSpec, ExecutionHostKind};

const CONNECT_TIMEOUT_SECONDS: u32 = 10;
const SERVER_ALIVE_INTERVAL_SECONDS: u32 = 15;
const SERVER_ALIVE_COUNT_MAX: u32 = 3;
const ASKPASS_DIRECTORY_NAME: &str = "briar-ssh-askpass";
const ASKPASS_SECRET_VARIABLE: &str = "BRIAR_SSH_AUTH_SECRET";

/// A saved SSH host. Stored in the local Briar config, never in D1.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshHost {
    pub(crate) id: String,
    pub(crate) label: String,
    /// Host alias resolved through OpenSSH config (`ssh -G`).
    pub(crate) alias: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) hostname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) port: Option<u16>,
    /// Set after a connection that needed a passphrase or password prompt, so
    /// startup checks can skip hosts that would block on a prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_required_passphrase: Option<bool>,
}

impl SshHost {
    /// `user@alias`, or `alias` when the config supplies the user.
    pub(crate) fn destination(&self) -> Result<String, String> {
        let alias = self.alias.trim();
        if alias.is_empty() {
            return Err("SSH 호스트 별칭이 비어 있습니다.".to_string());
        }
        Ok(match self.username.as_deref().map(str::trim) {
            Some(username) if !username.is_empty() => format!("{username}@{alias}"),
            _ => alias.to_string(),
        })
    }
}

/// Effective connection settings OpenSSH reports for an alias.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshResolvedTarget {
    pub(crate) alias: String,
    pub(crate) hostname: String,
    pub(crate) username: Option<String>,
    pub(crate) port: Option<u16>,
}

/// How much interaction an SSH invocation may perform.
#[derive(Clone, Debug, Default)]
pub(crate) struct SshAuth {
    /// Allow OpenSSH to ask for a passphrase or password through the askpass
    /// helper. Off by default so a misconfigured host fails fast.
    pub(crate) interactive: bool,
    /// Secret the askpass helper echoes. Held in memory for the session only.
    pub(crate) secret: Option<String>,
    /// Directory holding the askpass helper script.
    pub(crate) askpass_directory: Option<PathBuf>,
}

impl SshAuth {
    fn batch_mode(&self) -> &'static str {
        if self.interactive {
            "no"
        } else {
            "yes"
        }
    }
}

pub(crate) fn ssh_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "ssh.exe"
    } else {
        "ssh"
    }
}

/// Literal host aliases declared in the user's OpenSSH config.
///
/// OpenSSH can resolve one known alias with `ssh -G`, but it does not expose a
/// command that lists aliases. We therefore read only `Host` and `Include`
/// directives, follow included files, and leave every other directive to
/// OpenSSH itself. Wildcard and negated patterns are not selectable machines.
pub(crate) fn discover_ssh_config_aliases(home: &Path) -> Result<Vec<String>, String> {
    let mut aliases = Vec::new();
    let mut seen_aliases = HashSet::new();
    let mut visited_files = HashSet::new();
    collect_ssh_config_aliases(
        &home.join(".ssh").join("config"),
        home,
        &mut visited_files,
        &mut seen_aliases,
        &mut aliases,
    )?;
    Ok(aliases)
}

fn collect_ssh_config_aliases(
    config_path: &Path,
    home: &Path,
    visited_files: &mut HashSet<PathBuf>,
    seen_aliases: &mut HashSet<String>,
    aliases: &mut Vec<String>,
) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    let resolved_path = fs::canonicalize(config_path).unwrap_or_else(|_| config_path.to_path_buf());
    if !visited_files.insert(resolved_path) {
        return Ok(());
    }
    let contents = fs::read_to_string(config_path).map_err(|error| {
        format!(
            "SSH 설정을 읽지 못했습니다 ({}): {error}",
            config_path.display()
        )
    })?;
    for line in contents.lines() {
        let tokens = ssh_config_tokens(line);
        let Some(keyword) = tokens.first() else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("host") {
            for alias in tokens.iter().skip(1) {
                if alias.starts_with('-')
                    || alias.contains('*')
                    || alias.contains('?')
                    || alias.contains('!')
                {
                    continue;
                }
                if seen_aliases.insert(alias.to_ascii_lowercase()) {
                    aliases.push(alias.clone());
                }
            }
        } else if keyword.eq_ignore_ascii_case("include") {
            for pattern in tokens.iter().skip(1) {
                for included_path in ssh_include_paths(config_path, home, pattern) {
                    collect_ssh_config_aliases(
                        &included_path,
                        home,
                        visited_files,
                        seen_aliases,
                        aliases,
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn ssh_config_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in line.trim().chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(expected) = quote {
            if character == expected {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
        } else if character == '#' {
            break;
        } else if character.is_whitespace() || (character == '=' && tokens.is_empty()) {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn ssh_include_paths(config_path: &Path, home: &Path, pattern: &str) -> Vec<PathBuf> {
    let expanded = if pattern == "~" {
        home.to_path_buf()
    } else if let Some(relative) = pattern.strip_prefix("~/") {
        home.join(relative)
    } else {
        let path = PathBuf::from(pattern);
        if path.is_absolute() {
            path
        } else {
            config_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .join(path)
        }
    };
    let Some(pattern) = expanded.to_str() else {
        return Vec::new();
    };
    let Ok(paths) = glob::glob(pattern) else {
        return Vec::new();
    };
    let mut paths = paths.filter_map(Result::ok).collect::<Vec<_>>();
    paths.sort();
    paths
}

/// Connection options shared by every SSH invocation Briar makes.
pub(crate) fn ssh_base_args(host: &SshHost, auth: &SshAuth) -> Vec<String> {
    let mut args = vec![
        "-T".to_string(),
        "-o".to_string(),
        format!("BatchMode={}", auth.batch_mode()),
        "-o".to_string(),
        format!("ConnectTimeout={CONNECT_TIMEOUT_SECONDS}"),
        "-o".to_string(),
        format!("ServerAliveInterval={SERVER_ALIVE_INTERVAL_SECONDS}"),
        "-o".to_string(),
        format!("ServerAliveCountMax={SERVER_ALIVE_COUNT_MAX}"),
    ];
    if let Some(port) = host.port {
        args.push("-p".to_string());
        args.push(port.to_string());
    }
    args
}

/// Full argument vector for running one remote script through `sh`.
pub(crate) fn ssh_script_args(
    host: &SshHost,
    auth: &SshAuth,
    script: &str,
) -> Result<Vec<String>, String> {
    let mut args = ssh_base_args(host, auth);
    args.push(host.destination()?);
    args.push("--".to_string());
    args.push("sh".to_string());
    args.push("-c".to_string());
    // OpenSSH joins the remote argv with spaces before handing it to the
    // account's login shell. Quote the complete script so `sh -c` receives it
    // as one argument instead of letting the login shell execute its lines.
    args.push(shell_quote(script));
    Ok(args)
}

pub(crate) const ASKPASS_POSIX_SCRIPT: &str = r#"#!/bin/sh
# Invoked by ssh through SSH_ASKPASS when Briar re-runs ssh with a secret the
# user typed into the desktop prompt. No native dialog is ever shown here: a
# missing secret is a caller bug, so fail loudly instead of hanging.
if [ -n "${BRIAR_SSH_AUTH_SECRET+x}" ]; then
  printf '%s\n' "$BRIAR_SSH_AUTH_SECRET"
  exit 0
fi
printf 'Briar ssh-askpass was invoked without BRIAR_SSH_AUTH_SECRET.\n' >&2
exit 1
"#;

/// Write the askpass helper and return its path.
pub(crate) fn ensure_askpass_helper(directory: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("SSH 인증 도우미 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("SSH 인증 도우미 폴더 권한을 지정하지 못했습니다: {error}"))?;
    }
    let script = directory.join("briar-ssh-askpass.sh");
    fs::write(&script, ASKPASS_POSIX_SCRIPT)
        .map_err(|error| format!("SSH 인증 도우미를 저장하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("SSH 인증 도우미 권한을 지정하지 못했습니다: {error}"))?;
    }
    Ok(script)
}

pub(crate) fn default_askpass_directory(home: &Path) -> PathBuf {
    home.join(".cache").join(ASKPASS_DIRECTORY_NAME)
}

/// Environment additions that let OpenSSH collect a secret without a terminal.
pub(crate) fn askpass_environment(
    auth: &SshAuth,
    home: &Path,
) -> Result<Vec<(OsString, OsString)>, String> {
    if !auth.interactive {
        return Ok(Vec::new());
    }
    let directory = auth
        .askpass_directory
        .clone()
        .unwrap_or_else(|| default_askpass_directory(home));
    let script = ensure_askpass_helper(&directory)?;
    let mut environment = vec![
        (OsString::from("SSH_ASKPASS"), script.into_os_string()),
        (
            OsString::from("SSH_ASKPASS_REQUIRE"),
            OsString::from("force"),
        ),
    ];
    if let Some(secret) = auth.secret.as_ref() {
        environment.push((
            OsString::from(ASKPASS_SECRET_VARIABLE),
            OsString::from(secret),
        ));
    }
    // OpenSSH only consults SSH_ASKPASS when it believes a display exists.
    if std::env::var_os("DISPLAY").is_none() && !cfg!(target_os = "windows") {
        environment.push((OsString::from("DISPLAY"), OsString::from("briar")));
    }
    Ok(environment)
}

/// Parse `ssh -G <alias>` output into effective connection settings.
pub(crate) fn parse_ssh_resolve_output(alias: &str, stdout: &str) -> SshResolvedTarget {
    let mut values: HashMap<&str, &str> = HashMap::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(key) = parts.next() else {
            continue;
        };
        let Some(value) = parts.next().map(str::trim) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        // OpenSSH prints the effective value first; later duplicates are noise.
        values.entry(key).or_insert(value);
    }

    let hostname = values
        .get("hostname")
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| alias.to_string());
    let username = values
        .get("user")
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty());
    let port = values
        .get("port")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    SshResolvedTarget {
        alias: alias.to_string(),
        hostname,
        username,
        port,
    }
}

/// Runs Briar's tools on a remote host over the system `ssh` binary.
pub(crate) struct SshRunner {
    host: SshHost,
    auth: SshAuth,
    home: PathBuf,
    resolved_tools: Mutex<HashMap<String, String>>,
}

impl SshRunner {
    pub(crate) fn new(host: SshHost, auth: SshAuth, home: PathBuf) -> Self {
        Self {
            host,
            auth,
            home,
            resolved_tools: Mutex::new(HashMap::new()),
        }
    }

    fn ssh_command_for(&self, script: &str) -> Result<Command, String> {
        let args = ssh_script_args(&self.host, &self.auth, script)?;
        let mut command = Command::new(ssh_command());
        command.args(args);
        for (key, value) in askpass_environment(&self.auth, &self.home)? {
            command.env(key, value);
        }
        Ok(command)
    }

    fn script_for(&self, spec: &CommandSpec) -> String {
        remote_command_script(
            &spec.program,
            &spec.args,
            spec.working_directory.as_deref(),
            &spec.environment,
        )
    }
}

impl CommandRunner for SshRunner {
    fn kind(&self) -> ExecutionHostKind {
        ExecutionHostKind::Ssh
    }

    fn label(&self) -> String {
        self.host.label.clone()
    }

    fn resolve_binary(&self, tool: &str) -> Result<String, String> {
        if let Ok(cache) = self.resolved_tools.lock() {
            if let Some(path) = cache.get(tool) {
                return Ok(path.clone());
            }
        }
        let output = self
            .ssh_command_for(&remote_tool_lookup_script(tool))?
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("SSH 명령을 실행하지 못했습니다: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "원격 호스트 {}에 {tool}이(가) 없습니다. 설치하거나 비대화형 셸에서 PATH에 노출해 주세요.",
                self.host.label
            ));
        }
        let path = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or_default()
            .to_string();
        if path.is_empty() {
            return Err(format!(
                "원격 호스트 {}에서 {tool} 경로를 확인하지 못했습니다.",
                self.host.label
            ));
        }
        if let Ok(mut cache) = self.resolved_tools.lock() {
            cache.insert(tool.to_string(), path.clone());
        }
        Ok(path)
    }

    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, String> {
        let mut command = self.ssh_command_for(&self.script_for(spec))?;
        command.stdin(Stdio::null());
        let output = command
            .output()
            .map_err(|error| format!("SSH 명령을 실행하지 못했습니다: {error}"))?;
        Ok(CommandOutput {
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    fn spawn_piped(&self, spec: &CommandSpec) -> Result<Child, String> {
        self.ssh_command_for(&self.script_for(spec))?
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("SSH 세션을 시작하지 못했습니다: {error}"))
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        let script = format!(
            "{}cd -- {} >/dev/null 2>&1 || exit 1\npwd -P\n",
            super::shell::REMOTE_PATH_BOOTSTRAP,
            shell_quote(&path.to_string_lossy())
        );
        let output = self
            .ssh_command_for(&script)?
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("SSH 명령을 실행하지 못했습니다: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "원격 호스트 {}에서 경로를 열지 못했습니다: {}",
                self.host.label,
                path.display()
            ));
        }
        let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if resolved.is_empty() {
            return Err(format!(
                "원격 호스트 {}에서 경로를 확인하지 못했습니다: {}",
                self.host.label,
                path.display()
            ));
        }
        Ok(PathBuf::from(resolved))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn host() -> SshHost {
        SshHost {
            id: "ssh-1".to_string(),
            label: "build-box".to_string(),
            alias: "build-box".to_string(),
            hostname: Some("10.0.0.5".to_string()),
            username: Some("dev".to_string()),
            port: Some(2222),
            last_required_passphrase: None,
        }
    }

    fn ssh_config_test_home(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("briar-ssh-config-{name}-{unique}"))
    }

    #[test]
    fn discovers_literal_hosts_and_included_configs() {
        let home = ssh_config_test_home("aliases");
        let ssh = home.join(".ssh");
        fs::create_dir_all(ssh.join("conf.d")).expect("ssh config directory should exist");
        fs::write(
            ssh.join("config"),
            r#"
Host work kiwi *
  User dev
Include conf.d/*.conf
Host !blocked build-?
"#,
        )
        .expect("root config should be written");
        fs::write(
            ssh.join("conf.d").join("personal.conf"),
            "Host lab WORK\n  HostName 10.0.0.8\n",
        )
        .expect("included config should be written");

        assert_eq!(
            discover_ssh_config_aliases(&home).expect("aliases should be discovered"),
            vec!["work", "kiwi", "lab"]
        );
        fs::remove_dir_all(home).expect("test home should be removed");
    }

    #[test]
    fn accepts_equals_quotes_and_comments_in_host_directives() {
        assert_eq!(
            ssh_config_tokens(r#"Host="build box" staging # ignored"#),
            vec!["Host", "build box", "staging"]
        );
        assert_eq!(
            ssh_config_tokens("Include ~/.ssh/conf.d/*.conf"),
            vec!["Include", "~/.ssh/conf.d/*.conf"]
        );
    }

    #[test]
    fn builds_a_destination_from_the_alias() {
        assert_eq!(host().destination().unwrap(), "dev@build-box");
        let mut without_user = host();
        without_user.username = None;
        assert_eq!(without_user.destination().unwrap(), "build-box");
        let mut blank_alias = host();
        blank_alias.alias = "  ".to_string();
        assert!(blank_alias.destination().is_err());
    }

    #[test]
    fn base_args_are_non_interactive_and_keep_alive() {
        let args = ssh_base_args(&host(), &SshAuth::default());
        assert_eq!(
            args,
            vec![
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=3",
                "-p",
                "2222",
            ]
        );
    }

    #[test]
    fn interactive_auth_relaxes_batch_mode_only() {
        let auth = SshAuth {
            interactive: true,
            ..SshAuth::default()
        };
        let args = ssh_base_args(&host(), &auth);
        assert!(args.contains(&"BatchMode=no".to_string()));
        assert!(args.contains(&"ConnectTimeout=10".to_string()));
    }

    #[test]
    fn script_args_shell_quote_the_complete_remote_program() {
        let script = "exec sh -c 'printf \"%s\" \"$HOME\"'\n";
        let args = ssh_script_args(&host(), &SshAuth::default(), script).unwrap();
        assert_eq!(
            &args[args.len() - 5..],
            &[
                "dev@build-box".to_string(),
                "--".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                shell_quote(script),
            ]
        );
        assert_eq!(
            args[args.len() - 3..].join(" "),
            format!("sh -c {}", shell_quote(script)),
        );
    }

    #[test]
    fn omits_the_port_flag_when_the_config_owns_it() {
        let mut without_port = host();
        without_port.port = None;
        let args = ssh_base_args(&without_port, &SshAuth::default());
        assert!(!args.contains(&"-p".to_string()));
    }

    #[test]
    fn parses_effective_settings_from_ssh_g_output() {
        let stdout = "user dev\nhostname 10.0.0.5\nport 2222\naddressfamily any\n";
        let resolved = parse_ssh_resolve_output("build-box", stdout);
        assert_eq!(
            resolved,
            SshResolvedTarget {
                alias: "build-box".to_string(),
                hostname: "10.0.0.5".to_string(),
                username: Some("dev".to_string()),
                port: Some(2222),
            }
        );
    }

    #[test]
    fn keeps_the_first_value_for_repeated_keys() {
        let stdout = "hostname first.example.com\nhostname second.example.com\n";
        let resolved = parse_ssh_resolve_output("alias", stdout);
        assert_eq!(resolved.hostname, "first.example.com");
    }

    #[test]
    fn falls_back_to_the_alias_when_output_is_unusable() {
        let resolved = parse_ssh_resolve_output("build-box", "port not-a-number\nuser \n");
        assert_eq!(resolved.hostname, "build-box");
        assert_eq!(resolved.username, None);
        assert_eq!(resolved.port, None);
    }

    #[test]
    fn askpass_environment_is_empty_without_interactive_auth() {
        let temporary = std::env::temp_dir().join("briar-askpass-none");
        let environment = askpass_environment(&SshAuth::default(), &temporary).unwrap();
        assert!(environment.is_empty());
    }

    #[test]
    fn askpass_environment_forces_the_helper_and_carries_the_secret() {
        let directory =
            std::env::temp_dir().join(format!("briar-askpass-{}-{}", std::process::id(), "helper"));
        let auth = SshAuth {
            interactive: true,
            secret: Some("hunter2".to_string()),
            askpass_directory: Some(directory.clone()),
        };
        let environment = askpass_environment(&auth, &std::env::temp_dir()).unwrap();
        let lookup = |name: &str| {
            environment
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.to_string_lossy().to_string())
        };
        assert_eq!(
            lookup("SSH_ASKPASS_REQUIRE"),
            Some("force".to_string()),
            "askpass must be forced so ssh never falls back to a tty prompt"
        );
        assert_eq!(lookup("BRIAR_SSH_AUTH_SECRET"), Some("hunter2".to_string()));
        let script = lookup("SSH_ASKPASS").expect("helper path");
        assert!(script.ends_with("briar-ssh-askpass.sh"));
        let contents = fs::read_to_string(&script).unwrap();
        assert!(contents.contains("BRIAR_SSH_AUTH_SECRET"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&script).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn the_askpass_script_never_prints_the_secret_without_the_variable() {
        assert!(ASKPASS_POSIX_SCRIPT.contains("exit 1"));
        assert!(!ASKPASS_POSIX_SCRIPT.contains("read "));
    }
}
