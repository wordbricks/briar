//! POSIX shell quoting and the remote command wrapper.
//!
//! Every remote invocation is assembled here so that repository content, issue
//! text, and agent output can never be interpolated into a remote shell
//! command by a caller.

use std::path::Path;

/// Wrap a value so a POSIX shell reads it as one literal argument.
pub(crate) fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'/'))
    {
        return value.to_string();
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for character in value.chars() {
        if character == '\'' {
            // A single quote cannot appear inside single quotes: close, escape, reopen.
            quoted.push_str("'\\''");
        } else {
            quoted.push(character);
        }
    }
    quoted.push('\'');
    quoted
}

/// PATH bootstrap for non-interactive remote shells.
///
/// Login shells are not guaranteed here, so a remote `bun`, `node`, `git`, or
/// agent CLI installed through a version manager is invisible without this.
/// Ported from the T3 Code remote launcher, extended with Briar's own tools.
pub(crate) const REMOTE_PATH_BOOTSTRAP: &str = r#"prepend_path_if_dir() {
  if [ -d "$1" ]; then
    case ":$PATH:" in
      *":$1:"*) ;;
      *) PATH="$1:$PATH" ;;
    esac
  fi
}
prepend_path_if_dir "$HOME/.local/bin"
prepend_path_if_dir "$HOME/bin"
prepend_path_if_dir "$HOME/.bun/bin"
prepend_path_if_dir "$HOME/.cargo/bin"
prepend_path_if_dir "$HOME/.volta/bin"
prepend_path_if_dir "$HOME/.asdf/shims"
prepend_path_if_dir "$HOME/.asdf/bin"
prepend_path_if_dir "$HOME/.local/share/mise/shims"
prepend_path_if_dir "$HOME/.mise/shims"
prepend_path_if_dir "$HOME/.nodenv/shims"
prepend_path_if_dir "$HOME/.nodenv/bin"
prepend_path_if_dir /opt/homebrew/bin
prepend_path_if_dir /usr/local/bin
prepend_path_if_dir /usr/bin
prepend_path_if_dir /bin
export PATH
if [ -s "$HOME/.asdf/asdf.sh" ]; then
  . "$HOME/.asdf/asdf.sh" >/dev/null 2>&1 || true
fi
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate sh 2>/dev/null)" >/dev/null 2>&1 || true
fi
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell sh 2>/dev/null)" >/dev/null 2>&1 || true
fi
if command -v nodenv >/dev/null 2>&1; then
  eval "$(nodenv init - 2>/dev/null)" >/dev/null 2>&1 || true
fi
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  nvm use default >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
fi
"#;

/// Remote script that prints the absolute path of one tool, or exits non-zero.
pub(crate) fn remote_tool_lookup_script(tool: &str) -> String {
    format!(
        "{REMOTE_PATH_BOOTSTRAP}command -v {tool} 2>/dev/null || exit 127\n",
        tool = shell_quote(tool)
    )
}

/// Render a command as one `sh` program: PATH bootstrap, optional `cd`,
/// optional environment assignments, then the argument vector.
pub(crate) fn remote_command_script(
    program: &str,
    args: &[String],
    working_directory: Option<&Path>,
    environment: &[(String, String)],
) -> String {
    let mut script = String::from(REMOTE_PATH_BOOTSTRAP);
    if let Some(directory) = working_directory {
        script.push_str(&format!(
            "cd -- {} || exit 1\n",
            shell_quote(&directory.to_string_lossy())
        ));
    }
    let mut invocation = String::new();
    if !environment.is_empty() {
        invocation.push_str("env");
        for (key, value) in environment {
            invocation.push(' ');
            invocation.push_str(&shell_quote(&format!("{key}={value}")));
        }
        invocation.push(' ');
    }
    invocation.push_str(&shell_quote(program));
    for argument in args {
        invocation.push(' ');
        invocation.push_str(&shell_quote(argument));
    }
    // exec so the remote shell is replaced by the tool: signals and the exit
    // status belong to the tool, and closing the channel kills the tool itself
    // instead of leaving it orphaned under a surviving shell.
    script.push_str("exec ");
    script.push_str(&invocation);
    script.push('\n');
    script
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_safe_values_unquoted() {
        assert_eq!(shell_quote("codex"), "codex");
        assert_eq!(shell_quote("/usr/bin/git"), "/usr/bin/git");
        assert_eq!(shell_quote("--json"), "--json");
    }

    #[test]
    fn quotes_values_with_shell_metacharacters() {
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("rm -rf /; echo"), "'rm -rf /; echo'");
        assert_eq!(shell_quote("$(whoami)"), "'$(whoami)'");
        assert_eq!(shell_quote("back`tick`"), "'back`tick`'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn escapes_embedded_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("'"), "''\\'''");
    }

    #[test]
    fn renders_a_remote_command_with_cd_and_environment() {
        let script = remote_command_script(
            "git",
            &["status".to_string(), "--porcelain".to_string()],
            Some(Path::new("/home/dev/my repo")),
            &[("GIT_TERMINAL_PROMPT".to_string(), "0".to_string())],
        );
        assert!(script.contains("prepend_path_if_dir \"$HOME/.bun/bin\""));
        assert!(script.contains("cd -- '/home/dev/my repo' || exit 1"));
        // The whole KEY=VALUE pair is quoted, so a value carrying shell syntax
        // cannot escape the assignment.
        assert!(script.ends_with("exec env 'GIT_TERMINAL_PROMPT=0' git status --porcelain\n"));
    }

    #[test]
    fn renders_a_remote_command_without_cd_or_environment() {
        let script = remote_command_script("velen", &["--version".to_string()], None, &[]);
        assert!(!script.contains("cd -- "));
        assert!(script.ends_with("exec velen --version\n"));
    }

    #[test]
    fn quotes_untrusted_arguments_in_remote_commands() {
        let script = remote_command_script(
            "briar",
            &["--title".to_string(), "'; rm -rf ~; #".to_string()],
            None,
            &[],
        );
        assert!(script.ends_with("exec briar --title ''\\''; rm -rf ~; #'\n"));
    }

    #[test]
    fn looks_up_a_tool_through_the_bootstrapped_path() {
        let script = remote_tool_lookup_script("bun");
        assert!(script.contains("command -v bun 2>/dev/null || exit 127"));
    }
}
