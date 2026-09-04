use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
};

use super::{
    sidecar::{SidecarExecutableConfig, SidecarProviderConfig},
    AgentProviderKind,
};

pub(super) const CONFIG: SidecarProviderConfig = SidecarProviderConfig {
    provider: AgentProviderKind::Codex,
    runner_name: "Codex App Server runner",
    request_name: "Codex",
    executable: SidecarExecutableConfig {
        name: "codex",
        home_candidates: &[".local/bin/codex", ".bun/bin/codex", ".cargo/bin/codex"],
        absolute_candidates: &["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
        companion_executables: &[],
        missing_error: "Codex CLI가 필요합니다. Codex를 설치하고 로그인한 뒤 Briar를 다시 여세요.",
    },
    missing_bun_error: "Codex App Server 실행에 필요한 Bun을 로컬 환경에서 찾지 못했습니다.",
    // Auto Hunt worktrees live outside the checkout and would otherwise be
    // read-only to a workspace-write sandbox.
    forwards_additional_directories: true,
    // Legacy desktop conversations were stored before provider namespaces
    // existed, so `briar:<project>:<thread>` must still resume.
    accepts_legacy_conversation_id: true,
    empty_session_error: "Codex App Server가 빈 대화 ID를 반환했습니다.",
    missing_session_error: "Codex App Server가 대화 ID를 반환하지 않았습니다.",
    request_failure_prefix: "Codex App Server 요청에 실패했습니다",
    blocked_prefix: "Codex 요청이 차단되었습니다",
    invalid_conversation_error:
        "이 대화는 현재 Briar 프로젝트에 속하지 않습니다. 새 대화를 시작하세요.",
};

/// Resolve the Codex CLI for status, login, and usage probes.
///
/// Unlike the shared sidecar lookup this keeps walking every PATH match until
/// one answers `--version`, because a stale `~/.bun/bin/codex` shim shadowing a
/// working install is common enough that reporting "not installed" would be
/// wrong.
pub(super) fn codex_binary(home: &Path, execution_path: &OsStr) -> Result<PathBuf, String> {
    let mut candidates = which::which_in_all("codex", Some(execution_path), home)
        .map(|paths| paths.collect::<Vec<_>>())
        .unwrap_or_default();
    for candidate in CONFIG
        .executable
        .home_candidates
        .iter()
        .map(|candidate| home.join(candidate))
        .chain(
            CONFIG
                .executable
                .absolute_candidates
                .iter()
                .map(PathBuf::from),
        )
    {
        if candidate.is_file() && !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }

    candidates
        .into_iter()
        .find(|candidate| codex_binary_is_usable(candidate, execution_path))
        .ok_or_else(|| CONFIG.executable.missing_error.to_string())
}

fn codex_binary_is_usable(candidate: &Path, execution_path: &OsStr) -> bool {
    Command::new(candidate)
        .env("PATH", execution_path)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| !output.stdout.is_empty() || !output.stderr.is_empty())
}
