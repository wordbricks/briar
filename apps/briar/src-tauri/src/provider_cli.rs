use briar_contracts::proto::briar::local::v1 as local_proto;
use serde::de::DeserializeOwned;
use std::{
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

/// Provider quota, model and sign-in discovery lives in the Briar CLI. The
/// credential stores, provider endpoints and provider CLI protocols are read by
/// exactly one implementation, and the desktop app consumes its `briar.local.v1`
/// ProtoJSON instead of keeping a second copy of them in Rust.
///
/// The CLI is run from the copy installed under
/// `~/.local/share/briar/briar.js` — the same entry point the execution Worker
/// and the issue-processing runtime already spawn — because these helpers only
/// receive a home directory. Reading it from the app resource bundle would
/// require an `AppHandle` at every call site, and the installed copy is
/// refreshed from that bundle whenever the app syncs its CLI assets.
const USAGE_TIMEOUT: Duration = Duration::from_secs(30);
const MODELS_TIMEOUT: Duration = Duration::from_secs(120);
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) const MISSING_CLI_ERROR: &str =
    "Briar CLI 번들을 찾지 못했습니다. 연결 상태에서 CLI 및 스킬 복구를 실행하세요.";
const MISSING_BUN_ERROR: &str = "Briar에 포함된 Bun runtime을 찾지 못했습니다.";

fn briar_cli_entry(home: &Path) -> Result<PathBuf, String> {
    let entry = home.join(".local/share/briar/briar.js");
    if entry.is_file() {
        Ok(entry)
    } else {
        Err(MISSING_CLI_ERROR.to_string())
    }
}

fn bun_binary(home: &Path, execution_path: &std::ffi::OsStr) -> Result<PathBuf, String> {
    // The bundled runtime is the shipped Bun version; a development build
    // without it still runs the CLI from the execution path.
    crate::bundled_bun_binary()
        .or_else(|| which::which_in("bun", Some(execution_path), home).ok())
        .ok_or_else(|| MISSING_BUN_ERROR.to_string())
}

fn run_briar_cli(home: &Path, arguments: &[&str], timeout: Duration) -> Result<String, String> {
    let execution_path = crate::cli_execution_path(home)?;
    let entry = briar_cli_entry(home)?;
    let bun = bun_binary(home, &execution_path)?;
    let mut child = Command::new(&bun)
        .arg(&entry)
        .args(arguments)
        .env("HOME", home)
        .env("PATH", &execution_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Briar CLI를 시작하지 못했습니다: {error}"))?;
    // The model catalog is larger than a pipe buffer, so both streams are
    // drained while the process runs instead of after it exits.
    let stdout = child.stdout.take().map(read_stream);
    let stderr = child.stderr.take().map(read_stream);
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Briar CLI 실행 상태를 확인하지 못했습니다: {error}"
                ));
            }
        }
    };
    let stdout = stdout.map(join_stream).unwrap_or_default();
    let stderr = stderr.map(join_stream).unwrap_or_default();
    let Some(status) = status else {
        return Err("Briar CLI 조회 시간이 초과되었습니다.".to_string());
    };
    if !status.success() {
        let detail = [stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|value| !value.is_empty())
            .unwrap_or("Briar CLI가 오류를 반환했습니다.");
        return Err(detail.to_string());
    }
    Ok(stdout)
}

fn read_stream(stream: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = String::new();
        let _ = BufReader::new(stream).read_to_string(&mut buffer);
        buffer
    })
}

fn join_stream(handle: thread::JoinHandle<String>) -> String {
    handle.join().unwrap_or_default()
}

fn decode<T: DeserializeOwned>(stdout: &str) -> Result<T, String> {
    serde_json::from_str::<T>(stdout.trim())
        .map_err(|error| format!("Briar CLI ProtoJSON을 읽지 못했습니다: {error}"))
}

pub(crate) fn provider_usage_snapshot(
    home: &Path,
    openrouter_configured: bool,
) -> Result<local_proto::LocalProviderUsageSnapshot, String> {
    let execution_path = crate::cli_execution_path(home)?;
    let execution_path = execution_path.to_string_lossy().into_owned();
    let home_argument = home.to_string_lossy().into_owned();
    let mut arguments = vec![
        "provider",
        "usage",
        "--json",
        "--home",
        &home_argument,
        "--execution-path",
        &execution_path,
    ];
    if openrouter_configured {
        arguments.push("--openrouter-configured");
    }
    decode(&run_briar_cli(home, &arguments, USAGE_TIMEOUT)?)
}

pub(crate) fn provider_model_catalog(
    home: &Path,
) -> Result<local_proto::LocalProviderModelCatalog, String> {
    let execution_path = crate::cli_execution_path(home)?;
    let execution_path = execution_path.to_string_lossy().into_owned();
    let home_argument = home.to_string_lossy().into_owned();
    decode(&run_briar_cli(
        home,
        &[
            "provider",
            "models",
            "--json",
            "--home",
            &home_argument,
            "--execution-path",
            &execution_path,
        ],
        MODELS_TIMEOUT,
    )?)
}

pub(crate) fn provider_auth_snapshot(
    home: &Path,
) -> Result<local_proto::LocalProviderAuthSnapshot, String> {
    let execution_path = crate::cli_execution_path(home)?;
    let execution_path = execution_path.to_string_lossy().into_owned();
    let home_argument = home.to_string_lossy().into_owned();
    decode(&run_briar_cli(
        home,
        &[
            "provider",
            "auth",
            "--json",
            "--home",
            &home_argument,
            "--execution-path",
            &execution_path,
        ],
        AUTH_TIMEOUT,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_missing_cli_bundle_instead_of_running_bun() {
        let home = tempfile::tempdir().expect("temporary home");
        assert_eq!(
            provider_auth_snapshot(home.path()).unwrap_err(),
            MISSING_CLI_ERROR
        );
    }

    #[test]
    fn decodes_the_provider_auth_snapshot_protojson() {
        let snapshot =
            decode::<local_proto::LocalProviderAuthSnapshot>(r#"{"codex":true,"claude":false}"#)
                .expect("auth snapshot should decode");
        assert_eq!(snapshot.codex, Some(true));
        assert_eq!(snapshot.claude, Some(false));
        // A provider the CLI was not asked about stays unknown.
        assert_eq!(snapshot.cursor, None);
    }

    #[test]
    fn decodes_provider_usage_windows_and_timestamps() {
        let snapshot = decode::<local_proto::LocalProviderUsageSnapshot>(
            r#"{"codex":{"status":"LOCAL_PROVIDER_USAGE_STATUS_OK","weekly":{"usedPercent":81,"windowMinutes":"10080","resetsAt":"2026-09-07T02:28:39Z"},"planType":"pro","authenticated":true,"updatedAt":"2026-09-04T02:14:48.100Z"},"updatedAt":"2026-09-04T02:14:48.101Z"}"#,
        )
        .expect("usage snapshot should decode");
        let codex = snapshot.codex.as_option().expect("codex usage");
        assert_eq!(
            codex.status.as_known(),
            Some(local_proto::LocalProviderUsageStatus::Ok)
        );
        let weekly = codex.weekly.as_option().expect("weekly window");
        assert_eq!(weekly.used_percent, 81.0);
        assert_eq!(weekly.window_minutes, 10_080);
        assert!(weekly.resets_at.as_option().is_some());
        assert_eq!(codex.plan_type.as_deref(), Some("pro"));
    }
}
