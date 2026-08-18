use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CODEX_TIMEOUT: Duration = Duration::from_secs(10);
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(10);
const GROK_TIMEOUT: Duration = Duration::from_secs(10);
const AGY_TIMEOUT: Duration = Duration::from_secs(10);
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const AGY_LOAD_ASSIST_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const AGY_QUOTA_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GROK_DEFAULT_PROXY_BASE: &str = "https://cli-chat-proxy.grok.com/v1";
const GROK_WEEKLY_MINUTES: u64 = 10_080;
const GROK_MONTHLY_MINUTES: u64 = 43_200;
const GROK_TOKEN_SKEW_MILLIS: u64 = 5 * 60 * 1_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUsageWindow {
    used_percent: f64,
    window_minutes: u64,
    resets_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderUsage {
    provider: &'static str,
    status: &'static str,
    session: Option<AgentUsageWindow>,
    weekly: Option<AgentUsageWindow>,
    monthly: Option<AgentUsageWindow>,
    plan_type: Option<String>,
    account_label: Option<String>,
    authenticated: bool,
    updated_at: u64,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUsageSnapshot {
    codex: ProviderUsage,
    claude: ProviderUsage,
    grok: ProviderUsage,
    agy: ProviderUsage,
    opencode: ProviderUsage,
    cursor: ProviderUsage,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRateLimitWindow {
    used_percent: Option<f64>,
    #[serde(alias = "windowDurationMins")]
    window_minutes: Option<u64>,
    resets_at: Option<u64>,
}

#[derive(Deserialize)]
struct ClaudeCredentials {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<ClaudeOauthCredentials>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOauthCredentials {
    access_token: Option<String>,
    email: Option<String>,
    #[serde(alias = "emailAddress")]
    email_address: Option<String>,
    #[serde(alias = "subscriptionType")]
    subscription_type: Option<String>,
}

struct ClaudeAccountCredentials {
    access_token: String,
    account_label: Option<String>,
    plan_type: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeUsageResponse {
    five_hour: Option<ClaudeUsageWindow>,
    seven_day: Option<ClaudeUsageWindow>,
}

#[derive(Deserialize)]
struct ClaudeUsageWindow {
    utilization: Option<f64>,
    used_percentage: Option<f64>,
    resets_at: Option<Value>,
}

#[derive(Clone, Debug)]
struct GrokAuthSession {
    access_token: String,
    user_id: Option<String>,
    expires_at: Option<u64>,
    account_label: Option<String>,
}

#[derive(Deserialize)]
struct GrokAuthEntry {
    key: Option<String>,
    user_id: Option<String>,
    expires_at: Option<String>,
    email: Option<String>,
    #[serde(alias = "teamId")]
    team_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrokBillingConfig {
    credit_usage_percent: Option<f64>,
    current_period: Option<GrokUsagePeriod>,
    billing_period_start: Option<String>,
    billing_period_end: Option<String>,
    subscription_tier: Option<String>,
    monthly_limit: Option<GrokMoneyValue>,
    used: Option<GrokMoneyValue>,
}

#[derive(Clone, Debug, Deserialize)]
struct GrokUsagePeriod {
    #[serde(rename = "type")]
    kind: Option<String>,
    start: Option<String>,
    end: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct GrokMoneyValue {
    val: Option<Value>,
}

pub(crate) async fn load(home: PathBuf) -> AgentUsageSnapshot {
    let codex_home = home.clone();
    let claude_home = home.clone();
    let grok_home = home.clone();
    let agy_home = home.clone();
    let opencode_home = home.clone();
    let cursor_home = home;
    let codex = tauri::async_runtime::spawn_blocking(move || load_codex(&codex_home));
    let claude = tauri::async_runtime::spawn(async move { load_claude(&claude_home).await });
    let grok = tauri::async_runtime::spawn(async move { load_grok(&grok_home).await });
    let agy = tauri::async_runtime::spawn(async move { load_agy(&agy_home).await });
    let opencode = tauri::async_runtime::spawn_blocking(move || load_opencode(&opencode_home));
    let cursor = tauri::async_runtime::spawn_blocking(move || load_cursor(&cursor_home));
    let codex = codex.await.unwrap_or_else(|error| {
        failed_provider("codex", format!("Codex usage task failed: {error}"))
    });
    let claude = claude.await.unwrap_or_else(|error| {
        failed_provider("claude", format!("Claude usage task failed: {error}"))
    });
    let grok = grok.await.unwrap_or_else(|error| {
        failed_provider("grok", format!("Grok usage task failed: {error}"))
    });
    let agy = agy.await.unwrap_or_else(|error| {
        failed_provider("agy", format!("Antigravity usage task failed: {error}"))
    });
    let opencode = opencode.await.unwrap_or_else(|error| {
        failed_provider("opencode", format!("OpenCode usage task failed: {error}"))
    });
    let cursor = cursor.await.unwrap_or_else(|error| {
        failed_provider("cursor", format!("Cursor usage task failed: {error}"))
    });
    AgentUsageSnapshot {
        codex,
        claude,
        grok,
        agy,
        opencode,
        cursor,
        updated_at: now_millis(),
    }
}

pub(crate) fn codex_locally_authenticated(home: &Path) -> bool {
    read_codex_account_identity(home).0
}

fn parse_claude_auth_status(stdout: &[u8]) -> bool {
    serde_json::from_slice::<Value>(stdout)
        .ok()
        .and_then(|status| status.get("loggedIn").and_then(Value::as_bool))
        == Some(true)
}

pub(crate) fn claude_locally_authenticated(
    home: &Path,
    binary: &Path,
    execution_path: &OsStr,
) -> bool {
    Command::new(binary)
        .args(["auth", "status"])
        .env("HOME", home)
        .env("PATH", execution_path)
        .env_remove("AGY_ADC_AUTH")
        .env_remove("GEMINI_API_KEY")
        .env_remove("GOOGLE_API_KEY")
        .env_remove("GOOGLE_APPLICATION_CREDENTIALS")
        .output()
        .ok()
        .is_some_and(|output| parse_claude_auth_status(&output.stdout))
}

pub(crate) fn grok_locally_authenticated(home: &Path) -> bool {
    read_grok_auth_session(home).is_ok_and(|session| {
        session
            .expires_at
            .is_none_or(|expires_at| expires_at > now_millis() + GROK_TOKEN_SKEW_MILLIS)
    })
}

pub(crate) fn agy_locally_authenticated(
    home: &Path,
    binary: &Path,
    execution_path: &OsStr,
) -> bool {
    Command::new(binary)
        .args(["--output-format", "json", "models"])
        .env("HOME", home)
        .env("PATH", execution_path)
        .output()
        .ok()
        .is_some_and(|output| output.status.success())
}

pub(crate) fn cursor_locally_authenticated(home: &Path, binary: &Path) -> bool {
    env::var("CURSOR_API_KEY").is_ok_and(|value| !value.trim().is_empty())
        || read_cursor_account_identity(home, binary).0
}

fn load_codex(home: &Path) -> ProviderUsage {
    let (authenticated, account_label) = read_codex_account_identity(home);
    match fetch_codex(home) {
        Ok(mut usage) => {
            usage.account_label = account_label;
            usage.authenticated = true;
            usage
        }
        Err(error) => {
            let status = if error.contains("CLI") || error.contains("로그인") {
                "unavailable"
            } else {
                "error"
            };
            provider_without_usage_with_account(
                "codex",
                status,
                error,
                account_label,
                authenticated,
            )
        }
    }
}

fn read_codex_account_identity(home: &Path) -> (bool, Option<String>) {
    let codex_home = env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let Ok(contents) = fs::read_to_string(codex_home.join("auth.json")) else {
        return (false, None);
    };
    let Ok(auth) = serde_json::from_str::<Value>(&contents) else {
        return (false, None);
    };
    let has_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let tokens = auth.get("tokens");
    let id_token = tokens
        .and_then(|value| value.get("id_token").or_else(|| value.get("idToken")))
        .and_then(Value::as_str);
    let has_tokens = tokens.is_some_and(Value::is_object);
    let account_label = id_token.and_then(jwt_email);
    (has_api_key || has_tokens, account_label)
}

fn jwt_email(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value = serde_json::from_slice::<Value>(&decoded).ok()?;
    value
        .get("email")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .pointer("/https:~1~1api.openai.com~1profile/email")
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn fetch_codex(home: &Path) -> Result<ProviderUsage, String> {
    let execution_path = crate::cli_execution_path(home)?;
    let binary = crate::agent::codex_binary(home, &execution_path)?;
    let mut child = Command::new(binary)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Codex CLI를 시작하지 못했습니다: {error}"))?;
    let result = fetch_codex_from_child(&mut child);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn fetch_codex_from_child(child: &mut Child) -> Result<ProviderUsage, String> {
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex App Server 입력을 열지 못했습니다.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex App Server 출력을 열지 못했습니다.".to_string())?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    write_rpc(
        &mut stdin,
        &json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "briar",
                    "title": "Briar",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )?;

    let deadline = Instant::now() + CODEX_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err("Codex usage 조회 시간이 초과되었습니다.".to_string());
        }
        let line = match receiver.recv_timeout(remaining) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => {
                break Err(format!("Codex usage 응답을 읽지 못했습니다: {error}"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                break Err("Codex usage 조회 시간이 초과되었습니다.".to_string());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err("Codex App Server가 usage를 반환하지 않았습니다.".to_string());
            }
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match message.get("id").and_then(Value::as_u64) {
            Some(1) => {
                write_rpc(
                    &mut stdin,
                    &json!({ "method": "initialized", "params": {} }),
                )?;
                write_rpc(
                    &mut stdin,
                    &json!({
                        "method": "account/rateLimits/read",
                        "id": 2,
                        "params": {}
                    }),
                )?;
            }
            Some(2) => break parse_codex_response(&message),
            _ => {}
        }
    }
}

fn write_rpc(stdin: &mut impl Write, message: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdin, message)
        .map_err(|error| format!("Codex usage 요청을 만들지 못했습니다: {error}"))?;
    stdin
        .write_all(b"\n")
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Codex usage 요청을 보내지 못했습니다: {error}"))
}

fn parse_codex_response(message: &Value) -> Result<ProviderUsage, String> {
    if let Some(error) = message.pointer("/error/message").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    let rate_limits = message.pointer("/result/rateLimits").ok_or_else(|| {
        "Codex 계정에 usage 정보가 없습니다. 로그인 상태를 확인하세요.".to_string()
    })?;
    let primary = parse_codex_window(rate_limits.get("primary"), 300);
    let secondary = parse_codex_window(rate_limits.get("secondary"), 10_080);
    let (session, weekly) = classify_codex_windows(primary, secondary);
    if session.is_none() && weekly.is_none() {
        return Err("Codex 계정에 usage 정보가 없습니다. 로그인 상태를 확인하세요.".to_string());
    }
    Ok(ProviderUsage {
        provider: "codex",
        status: "ok",
        session,
        weekly,
        monthly: None,
        plan_type: rate_limits
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_string),
        account_label: None,
        authenticated: true,
        updated_at: now_millis(),
        error: None,
    })
}

fn classify_codex_windows(
    primary: Option<AgentUsageWindow>,
    secondary: Option<AgentUsageWindow>,
) -> (Option<AgentUsageWindow>, Option<AgentUsageWindow>) {
    let mut session = None;
    let mut weekly = None;
    for window in [primary, secondary].into_iter().flatten() {
        if window.window_minutes >= 24 * 60 {
            weekly.get_or_insert(window);
        } else {
            session.get_or_insert(window);
        }
    }
    (session, weekly)
}

fn parse_codex_window(value: Option<&Value>, fallback_minutes: u64) -> Option<AgentUsageWindow> {
    let raw = serde_json::from_value::<CodexRateLimitWindow>(value?.clone()).ok()?;
    Some(AgentUsageWindow {
        used_percent: clamp_percent(raw.used_percent?),
        window_minutes: raw.window_minutes.unwrap_or(fallback_minutes),
        resets_at: raw.resets_at.map(epoch_to_millis),
    })
}

async fn load_claude(home: &Path) -> ProviderUsage {
    let credentials = match read_claude_credentials(home) {
        Ok(credentials) => credentials,
        Err(error) => return provider_without_usage("claude", "unavailable", error),
    };
    match fetch_claude_usage(&credentials.access_token).await {
        Ok(mut usage) => {
            usage.account_label = credentials.account_label;
            usage.plan_type = credentials.plan_type;
            usage.authenticated = true;
            usage
        }
        Err(error) => provider_without_usage_with_account(
            "claude",
            "error",
            error,
            credentials.account_label,
            true,
        ),
    }
}

fn read_claude_credentials(home: &Path) -> Result<ClaudeAccountCredentials, String> {
    #[cfg(target_os = "macos")]
    if let Some(credentials) = read_claude_keychain(home) {
        return parse_claude_account_credentials(&credentials);
    }
    let config_directory = env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    let path = config_directory.join(".credentials.json");
    let credentials =
        fs::read_to_string(path).map_err(|_| "Claude 로그인이 필요합니다.".to_string())?;
    parse_claude_account_credentials(&credentials)
}

#[cfg(target_os = "macos")]
fn read_claude_keychain(home: &Path) -> Option<String> {
    let account = env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());
    let config_directory = env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    let digest = Sha256::digest(config_directory.to_string_lossy().as_bytes());
    let suffix = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    for service in [
        format!("Claude Code-credentials-{suffix}"),
        "Claude Code-credentials".to_string(),
    ] {
        let output = Command::new("/usr/bin/security")
            .args([
                "find-generic-password",
                "-s",
                &service,
                "-a",
                &account,
                "-w",
            ])
            .output()
            .ok()?;
        if output.status.success() {
            let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

#[cfg(test)]
fn extract_claude_access_token(credentials: &str) -> Result<String, String> {
    parse_claude_account_credentials(credentials).map(|value| value.access_token)
}

fn parse_claude_account_credentials(credentials: &str) -> Result<ClaudeAccountCredentials, String> {
    let oauth = serde_json::from_str::<ClaudeCredentials>(credentials)
        .ok()
        .and_then(|value| value.oauth)
        .ok_or_else(|| "Claude 로그인이 필요합니다.".to_string())?;
    let access_token = oauth
        .access_token
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Claude 로그인이 필요합니다.".to_string())?;
    Ok(ClaudeAccountCredentials {
        access_token,
        account_label: oauth
            .email_address
            .or(oauth.email)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        plan_type: oauth
            .subscription_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

async fn fetch_claude_usage(access_token: &str) -> Result<ProviderUsage, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut headers = HeaderMap::new();
    let authorization = HeaderValue::from_str(&format!("Bearer {access_token}"))
        .map_err(|_| "Claude 인증 정보를 읽지 못했습니다.".to_string())?;
    headers.insert(AUTHORIZATION, authorization);
    headers.insert(
        "anthropic-beta",
        HeaderValue::from_static("oauth-2025-04-20"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static("claude-code/2.1.0"));
    let response = reqwest::Client::builder()
        .timeout(CLAUDE_TIMEOUT)
        .default_headers(headers)
        .build()
        .map_err(|error| format!("Claude usage 연결을 만들지 못했습니다: {error}"))?
        .get(CLAUDE_USAGE_URL)
        .send()
        .await
        .map_err(|error| format!("Claude usage를 불러오지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Claude 로그인이 만료되었습니다.".to_string(),
            429 => "Claude usage 조회 한도에 도달했습니다. 잠시 후 다시 시도하세요.".to_string(),
            status => format!("Claude usage를 불러오지 못했습니다. HTTP {status}"),
        });
    }
    let body = response
        .json::<ClaudeUsageResponse>()
        .await
        .map_err(|error| format!("Claude usage 응답을 읽지 못했습니다: {error}"))?;
    let session = body
        .five_hour
        .as_ref()
        .and_then(|window| map_claude_window(window, 300));
    let weekly = body
        .seven_day
        .as_ref()
        .and_then(|window| map_claude_window(window, 10_080));
    if session.is_none() && weekly.is_none() {
        return Err("Claude 계정에 usage 정보가 없습니다.".to_string());
    }
    Ok(ProviderUsage {
        provider: "claude",
        status: "ok",
        session,
        weekly,
        monthly: None,
        plan_type: None,
        account_label: None,
        authenticated: true,
        updated_at: now_millis(),
        error: None,
    })
}

fn map_claude_window(raw: &ClaudeUsageWindow, minutes: u64) -> Option<AgentUsageWindow> {
    let used_percent = raw.utilization.or(raw.used_percentage)?;
    Some(AgentUsageWindow {
        used_percent: clamp_percent(used_percent),
        window_minutes: minutes,
        resets_at: raw.resets_at.as_ref().and_then(parse_reset_timestamp),
    })
}

async fn load_grok(home: &Path) -> ProviderUsage {
    let session = match read_grok_auth_session(home) {
        Ok(session) => session,
        Err(error) => {
            let status = if error.contains("로그인") {
                "unavailable"
            } else {
                "error"
            };
            return provider_without_usage("grok", status, error);
        }
    };
    if session
        .expires_at
        .is_some_and(|expires_at| expires_at <= now_millis() + GROK_TOKEN_SKEW_MILLIS)
    {
        return provider_without_usage_with_account(
            "grok",
            "error",
            "Grok 로그인이 만료되었습니다. Grok CLI를 실행해 인증을 갱신하세요.".to_string(),
            session.account_label,
            true,
        );
    }
    match fetch_grok_usage(&session).await {
        Ok(mut usage) => {
            usage.account_label = session.account_label;
            usage.authenticated = true;
            usage
        }
        Err(error) => {
            provider_without_usage_with_account("grok", "error", error, session.account_label, true)
        }
    }
}

fn read_grok_auth_session(home: &Path) -> Result<GrokAuthSession, String> {
    let grok_home = env::var_os("GROK_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".grok"));
    let contents = fs::read_to_string(grok_home.join("auth.json")).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Grok 로그인이 필요합니다. `grok login`을 실행하세요.".to_string()
        } else {
            "Grok 인증 파일을 읽지 못했습니다.".to_string()
        }
    })?;
    parse_grok_auth_session(&contents)
}

fn parse_grok_auth_session(contents: &str) -> Result<GrokAuthSession, String> {
    let entries = serde_json::from_str::<serde_json::Map<String, Value>>(contents)
        .map_err(|_| "Grok 인증 파일이 올바르지 않습니다.".to_string())?;
    let mut preferred_seen = false;
    let mut expired_preferred = None;
    let mut fallback = None;
    for (issuer, value) in entries {
        let preferred = issuer == "https://auth.x.ai" || issuer.starts_with("https://auth.x.ai::");
        preferred_seen |= preferred;
        let Ok(entry) = serde_json::from_value::<GrokAuthEntry>(value) else {
            continue;
        };
        let Some(access_token) = entry.key.filter(|value| !value.is_empty()) else {
            continue;
        };
        let session = GrokAuthSession {
            account_label: entry
                .email
                .or_else(|| jwt_email(&access_token))
                .or(entry.team_id)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            access_token,
            user_id: entry.user_id.filter(|value| !value.is_empty()),
            expires_at: entry.expires_at.as_deref().and_then(parse_iso_millis),
        };
        if preferred {
            if session
                .expires_at
                .is_none_or(|expires_at| expires_at > now_millis() + GROK_TOKEN_SKEW_MILLIS)
            {
                return Ok(session);
            }
            expired_preferred.get_or_insert(session);
        } else {
            fallback.get_or_insert(session);
        }
    }
    expired_preferred
        .or_else(|| (!preferred_seen).then_some(fallback).flatten())
        .ok_or_else(|| "Grok 로그인이 필요합니다. `grok login`을 실행하세요.".to_string())
}

async fn fetch_grok_usage(session: &GrokAuthSession) -> Result<ProviderUsage, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let proxy_base = env::var("GROK_CLI_CHAT_PROXY_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .unwrap_or_else(|| GROK_DEFAULT_PROXY_BASE.to_string());
    let client = reqwest::Client::builder()
        .timeout(GROK_TIMEOUT)
        .build()
        .map_err(|error| format!("Grok usage 연결을 만들지 못했습니다: {error}"))?;
    let credits = fetch_grok_billing(
        &client,
        &format!("{proxy_base}/billing?format=credits"),
        session,
    )
    .await?;
    let weekly = map_grok_weekly(&credits);
    let monthly = if weekly.is_none() {
        let default =
            fetch_grok_billing(&client, &format!("{proxy_base}/billing"), session).await?;
        map_grok_monthly(&default)
    } else {
        None
    };
    if weekly.is_none() && monthly.is_none() {
        return Err("Grok 계정에 usage 정보가 없습니다.".to_string());
    }
    Ok(ProviderUsage {
        provider: "grok",
        status: "ok",
        session: None,
        weekly,
        monthly,
        plan_type: credits
            .subscription_tier
            .filter(|value| !value.trim().is_empty()),
        account_label: None,
        authenticated: true,
        updated_at: now_millis(),
        error: None,
    })
}

async fn fetch_grok_billing(
    client: &reqwest::Client,
    url: &str,
    session: &GrokAuthSession,
) -> Result<GrokBillingConfig, String> {
    let mut request = client
        .get(url)
        .header(AUTHORIZATION, format!("Bearer {}", session.access_token))
        .header("X-XAI-Token-Auth", "xai-grok-cli")
        .header("Accept", "application/json");
    if let Some(user_id) = session.user_id.as_deref() {
        request = request.header("x-userid", user_id);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Grok usage를 불러오지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Grok 로그인이 만료되었습니다.".to_string(),
            status => format!("Grok usage를 불러오지 못했습니다. HTTP {status}"),
        });
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Grok usage 응답을 읽지 못했습니다: {error}"))?;
    let config = value.get("config").unwrap_or(&value);
    serde_json::from_value(config.clone())
        .map_err(|error| format!("Grok usage 응답을 해석하지 못했습니다: {error}"))
}

fn map_grok_weekly(config: &GrokBillingConfig) -> Option<AgentUsageWindow> {
    let confirmed_zero = config.credit_usage_percent.is_none()
        && config.current_period.as_ref()?.kind.as_deref() == Some("USAGE_PERIOD_TYPE_WEEKLY")
        && timestamps_match(
            config.current_period.as_ref()?.start.as_deref(),
            config.billing_period_start.as_deref(),
        )
        && timestamps_match(
            config.current_period.as_ref()?.end.as_deref(),
            config.billing_period_end.as_deref(),
        );
    let used_percent = config
        .credit_usage_percent
        .or_else(|| confirmed_zero.then_some(0.0))?;
    Some(AgentUsageWindow {
        used_percent: clamp_percent(used_percent),
        window_minutes: GROK_WEEKLY_MINUTES,
        resets_at: config
            .current_period
            .as_ref()
            .and_then(|period| period.end.as_deref())
            .or(config.billing_period_end.as_deref())
            .and_then(parse_iso_millis),
    })
}

fn map_grok_monthly(config: &GrokBillingConfig) -> Option<AgentUsageWindow> {
    let limit = parse_grok_money(config.monthly_limit.as_ref())?;
    let used = parse_grok_money(config.used.as_ref())?;
    if limit <= 0.0 {
        return None;
    }
    Some(AgentUsageWindow {
        used_percent: clamp_percent(used / limit * 100.0),
        window_minutes: GROK_MONTHLY_MINUTES,
        resets_at: config
            .current_period
            .as_ref()
            .and_then(|period| period.end.as_deref())
            .or(config.billing_period_end.as_deref())
            .and_then(parse_iso_millis),
    })
}

fn parse_grok_money(value: Option<&GrokMoneyValue>) -> Option<f64> {
    let value = value?.val.as_ref()?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

fn parse_iso_millis(value: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()?
        .timestamp_millis()
        .try_into()
        .ok()
}

fn timestamps_match(left: Option<&str>, right: Option<&str>) -> bool {
    left.and_then(parse_iso_millis)
        .zip(right.and_then(parse_iso_millis))
        .is_some_and(|(left, right)| left == right)
}

fn parse_reset_timestamp(value: &Value) -> Option<u64> {
    let raw = value
        .as_u64()
        .or_else(|| value.as_str()?.parse::<u64>().ok())?;
    Some(epoch_to_millis(raw))
}

fn epoch_to_millis(value: u64) -> u64 {
    if value < 10_000_000_000 {
        value.saturating_mul(1_000)
    } else {
        value
    }
}

fn clamp_percent(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

async fn load_agy(home: &Path) -> ProviderUsage {
    let execution_path = crate::cli_execution_path(home).unwrap_or_default();
    let binary = match crate::agent::agy_binary(home, &execution_path) {
        Ok(path) => path,
        Err(error) => return provider_without_usage("agy", "unavailable", error),
    };
    let authenticated = agy_locally_authenticated(home, &binary, &execution_path);
    let credentials = read_gemini_oauth_access(home);
    if let Some(credentials) = credentials.as_ref() {
        match fetch_agy_usage(&credentials.access_token).await {
            Ok(mut usage) => {
                usage.account_label = credentials.email.clone();
                usage.authenticated = true;
                return usage;
            }
            Err(error) => {
                return provider_without_usage_with_account(
                    "agy",
                    if authenticated {
                        "error"
                    } else {
                        "unavailable"
                    },
                    error,
                    credentials.email.clone(),
                    authenticated,
                );
            }
        }
    }
    if authenticated {
        return connected_provider_without_windows("agy", None);
    }
    provider_without_usage(
        "agy",
        "unavailable",
        "Antigravity 로그인이 필요합니다.".to_string(),
    )
}

fn load_opencode(home: &Path) -> ProviderUsage {
    let (authenticated, account_label) = read_opencode_account_identity(home);
    if authenticated {
        return connected_provider_without_windows("opencode", account_label);
    }
    provider_without_usage(
        "opencode",
        "unavailable",
        "OpenCode CLI가 필요합니다.".to_string(),
    )
}

fn load_cursor(home: &Path) -> ProviderUsage {
    if env::var("CURSOR_API_KEY").is_ok_and(|value| !value.trim().is_empty()) {
        return connected_provider_without_windows("cursor", None);
    }
    let execution_path = crate::cli_execution_path(home).unwrap_or_default();
    let binary = match crate::agent::cursor_binary(home, &execution_path) {
        Ok(path) => path,
        Err(error) => return provider_without_usage("cursor", "unavailable", error),
    };
    let (authenticated, account_label) = read_cursor_account_identity(home, &binary);
    if authenticated {
        return connected_provider_without_windows("cursor", account_label);
    }
    provider_without_usage(
        "cursor",
        "unavailable",
        "Cursor 로그인이 필요합니다.".to_string(),
    )
}

fn read_cursor_account_identity(home: &Path, binary: &Path) -> (bool, Option<String>) {
    let execution_path = crate::cli_execution_path(home).unwrap_or_default();
    let output = Command::new(binary)
        .env("HOME", home)
        .env("PATH", execution_path)
        .args(["about", "--format", "json"])
        .output()
        .ok();
    if let Some(output) = output.filter(|output| output.status.success()) {
        if let Some(email) = parse_cursor_about_email(&output.stdout) {
            return (true, Some(email));
        }
    }
    let output = Command::new(binary)
        .env("HOME", home)
        .args(["about"])
        .output()
        .ok();
    output
        .filter(|output| output.status.success())
        .and_then(|output| {
            parse_cursor_about_text(String::from_utf8_lossy(&output.stdout).as_ref())
        })
        .map(|email| (true, Some(email)))
        .unwrap_or((false, None))
}

fn parse_cursor_about_email(stdout: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<Value>(stdout).ok()?;
    usable_account_email(value.get("userEmail").and_then(Value::as_str))
}

fn parse_cursor_about_text(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        usable_account_email(line.trim().strip_prefix("User Email").map(str::trim))
    })
}

fn usable_account_email(value: Option<&str>) -> Option<String> {
    let email = value?.trim();
    let lowered = email.to_ascii_lowercase();
    if email.is_empty()
        || lowered == "not logged in"
        || lowered.contains("login required")
        || lowered.contains("authentication required")
    {
        return None;
    }
    Some(email.to_string())
}

fn read_opencode_account_identity(home: &Path) -> (bool, Option<String>) {
    let mut candidates = vec![
        home.join(".local/share/opencode/auth.json"),
        home.join("Library/Application Support/opencode/auth.json"),
    ];
    if let Some(xdg) = env::var_os("XDG_DATA_HOME") {
        candidates.insert(0, PathBuf::from(xdg).join("opencode/auth.json"));
    }
    if let Some(appdata) = env::var_os("APPDATA") {
        candidates.insert(0, PathBuf::from(appdata).join("opencode/auth.json"));
    }
    for path in candidates {
        let Ok(contents) = fs::read_to_string(path) else {
            continue;
        };
        if let Some(label) = parse_opencode_auth_label(&contents) {
            return (true, Some(label));
        }
        if serde_json::from_str::<Value>(&contents)
            .ok()
            .and_then(|value| value.as_object().map(|object| !object.is_empty()))
            == Some(true)
        {
            return (true, None);
        }
    }
    let execution_path = crate::cli_execution_path(home).unwrap_or_default();
    (
        crate::agent::opencode_binary(home, &execution_path).is_ok(),
        None,
    )
}

fn parse_opencode_auth_label(contents: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(contents).ok()?;
    collect_account_label(&value)
}

fn collect_account_label(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["email", "emailAddress", "account", "user"] {
                if let Some(label) = map.get(key).and_then(|item| match item {
                    Value::String(raw) => usable_account_email(Some(raw)),
                    other => collect_account_label(other),
                }) {
                    return Some(label);
                }
            }
            map.values().find_map(collect_account_label)
        }
        Value::Array(items) => items.iter().find_map(collect_account_label),
        _ => None,
    }
}

struct GeminiOauthAccess {
    access_token: String,
    email: Option<String>,
}

fn read_gemini_oauth_access(home: &Path) -> Option<GeminiOauthAccess> {
    let path = env::var_os("GEMINI_OAUTH_CREDS")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".gemini/oauth_creds.json"));
    let contents = fs::read_to_string(path).ok()?;
    parse_gemini_oauth_access(&contents)
}

fn parse_gemini_oauth_access(contents: &str) -> Option<GeminiOauthAccess> {
    let value = serde_json::from_str::<Value>(contents).ok()?;
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())?
        .to_string();
    if let Some(expiry) = value.get("expiry_date").and_then(Value::as_i64) {
        if expiry <= now_millis() as i64 {
            return None;
        }
    }
    Some(GeminiOauthAccess {
        access_token,
        email: usable_account_email(value.get("email").and_then(Value::as_str)),
    })
}

async fn fetch_agy_usage(access_token: &str) -> Result<ProviderUsage, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(AGY_TIMEOUT)
        .build()
        .map_err(|error| format!("Antigravity usage 연결을 만들지 못했습니다: {error}"))?;
    let project_id = fetch_agy_project_id(&client, access_token).await?;
    let response = client
        .post(AGY_QUOTA_URL)
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .json(&json!({ "project": project_id }))
        .send()
        .await
        .map_err(|error| format!("Antigravity usage를 불러오지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Antigravity 로그인이 만료되었습니다.".to_string(),
            status => format!("Antigravity usage를 불러오지 못했습니다. HTTP {status}"),
        });
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Antigravity usage 응답을 읽지 못했습니다: {error}"))?;
    parse_agy_quota(&body)
}

async fn fetch_agy_project_id(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<String, String> {
    if let Ok(project) = env::var("GOOGLE_CLOUD_PROJECT") {
        let project = project.trim();
        if !project.is_empty() {
            return Ok(project.to_string());
        }
    }
    let response = client
        .post(AGY_LOAD_ASSIST_URL)
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .json(&json!({
            "metadata": {
                "ideType": "GEMINI_CLI",
                "pluginType": "GEMINI"
            }
        }))
        .send()
        .await
        .map_err(|error| format!("Antigravity 프로젝트를 불러오지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Antigravity 로그인이 만료되었습니다.".to_string(),
            status => format!("Antigravity 프로젝트를 불러오지 못했습니다. HTTP {status}"),
        });
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Antigravity 프로젝트 응답을 읽지 못했습니다: {error}"))?;
    body.get("cloudaicompanionProject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Antigravity 프로젝트 ID를 찾지 못했습니다.".to_string())
}

fn parse_agy_quota(body: &Value) -> Result<ProviderUsage, String> {
    let buckets = parse_agy_quota_buckets(body);
    let session = buckets.into_iter().max_by(|left, right| {
        left.used_percent
            .partial_cmp(&right.used_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(ProviderUsage {
        provider: "agy",
        status: "ok",
        session,
        weekly: None,
        monthly: None,
        plan_type: None,
        account_label: None,
        authenticated: true,
        updated_at: now_millis(),
        error: None,
    })
}

fn parse_agy_quota_buckets(body: &Value) -> Vec<AgentUsageWindow> {
    let raw = if let Some(buckets) = body.get("buckets").and_then(Value::as_array) {
        buckets.clone()
    } else if let Some(array) = body.as_array() {
        array.clone()
    } else {
        Vec::new()
    };
    raw.iter().filter_map(map_agy_quota_bucket).collect()
}

fn map_agy_quota_bucket(value: &Value) -> Option<AgentUsageWindow> {
    let remaining = value.get("remainingFraction").and_then(Value::as_f64)?;
    if !remaining.is_finite() {
        return None;
    }
    let reset = value
        .get("resetTime")
        .and_then(Value::as_str)
        .and_then(parse_iso_millis);
    Some(AgentUsageWindow {
        used_percent: clamp_percent((1.0 - remaining) * 100.0),
        window_minutes: 60,
        resets_at: reset,
    })
}

fn connected_provider_without_windows(
    provider: &'static str,
    account_label: Option<String>,
) -> ProviderUsage {
    ProviderUsage {
        provider,
        status: "ok",
        session: None,
        weekly: None,
        monthly: None,
        plan_type: None,
        account_label,
        authenticated: true,
        updated_at: now_millis(),
        error: None,
    }
}

fn failed_provider(provider: &'static str, error: String) -> ProviderUsage {
    provider_without_usage(provider, "error", error)
}

fn provider_without_usage(
    provider: &'static str,
    status: &'static str,
    error: String,
) -> ProviderUsage {
    provider_without_usage_with_account(provider, status, error, None, false)
}

fn provider_without_usage_with_account(
    provider: &'static str,
    status: &'static str,
    error: String,
    account_label: Option<String>,
    authenticated: bool,
) -> ProviderUsage {
    ProviderUsage {
        provider,
        status,
        session: None,
        weekly: None,
        monthly: None,
        plan_type: None,
        account_label,
        authenticated,
        updated_at: now_millis(),
        error: Some(error),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_rate_limit_response() {
        let response = json!({
            "id": 2,
            "result": {
                "rateLimits": {
                    "primary": {
                        "usedPercent": 81,
                        "windowDurationMins": 10080,
                        "resetsAt": 1_800_000_000
                    },
                    "secondary": {
                        "usedPercent": 37.5,
                        "windowDurationMins": 300,
                        "resetsAt": 1_800_086_400
                    },
                    "planType": "plus"
                }
            }
        });
        let usage = parse_codex_response(&response).unwrap();
        assert_eq!(usage.status, "ok");
        assert_eq!(usage.session.unwrap().used_percent, 37.5);
        assert_eq!(usage.weekly.unwrap().window_minutes, 10_080);
        assert_eq!(usage.plan_type.as_deref(), Some("plus"));
    }

    #[test]
    fn maps_claude_percent_and_epoch_units() {
        let window = ClaudeUsageWindow {
            utilization: Some(104.0),
            used_percentage: None,
            resets_at: Some(json!("1800000000")),
        };
        let mapped = map_claude_window(&window, 300).unwrap();
        assert_eq!(mapped.used_percent, 100.0);
        assert_eq!(mapped.resets_at, Some(1_800_000_000_000));
    }

    #[test]
    fn reads_claude_oauth_token_without_exposing_other_fields() {
        let token = extract_claude_access_token(
            r#"{"claudeAiOauth":{"accessToken":"secret","refreshToken":"refresh"}}"#,
        )
        .unwrap();
        assert_eq!(token, "secret");
    }

    #[test]
    fn parses_claude_cli_login_status() {
        assert!(parse_claude_auth_status(br#"{"loggedIn":true}"#));
        assert!(!parse_claude_auth_status(br#"{"loggedIn":false}"#));
        assert!(!parse_claude_auth_status(b"not json"));
    }

    #[test]
    fn reads_provider_account_labels_from_auth_metadata() {
        let credentials = parse_claude_account_credentials(
            r#"{"claudeAiOauth":{"accessToken":"secret","emailAddress":"dev@example.com","subscriptionType":"max"}}"#,
        )
        .unwrap();
        assert_eq!(
            credentials.account_label.as_deref(),
            Some("dev@example.com")
        );
        assert_eq!(credentials.plan_type.as_deref(), Some("max"));

        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"codex@example.com"}"#);
        assert_eq!(
            jwt_email(&format!("header.{payload}.signature")).as_deref(),
            Some("codex@example.com")
        );
    }

    #[test]
    fn prefers_fresh_xai_grok_auth_session() {
        let session = parse_grok_auth_session(
            r#"{
                "https://alternate.example.com::client": {
                    "key": "stale-token",
                    "user_id": "stale-user"
                },
                "https://auth.x.ai::client": {
                    "key": "live-token",
                    "user_id": "live-user",
                    "expires_at": "2099-01-01T00:00:00Z"
                }
            }"#,
        )
        .unwrap();
        assert_eq!(session.access_token, "live-token");
        assert_eq!(session.user_id.as_deref(), Some("live-user"));
        assert_eq!(session.account_label, None);
    }

    #[test]
    fn maps_grok_weekly_and_confirmed_zero_usage() {
        let config = GrokBillingConfig {
            current_period: Some(GrokUsagePeriod {
                kind: Some("USAGE_PERIOD_TYPE_WEEKLY".to_string()),
                start: Some("2026-07-17T19:38:56Z".to_string()),
                end: Some("2026-07-24T19:38:56Z".to_string()),
            }),
            billing_period_start: Some("2026-07-17T19:38:56+00:00".to_string()),
            billing_period_end: Some("2026-07-24T19:38:56+00:00".to_string()),
            ..Default::default()
        };
        let window = map_grok_weekly(&config).unwrap();
        assert_eq!(window.used_percent, 0.0);
        assert_eq!(window.window_minutes, GROK_WEEKLY_MINUTES);
        assert_eq!(window.resets_at, parse_iso_millis("2026-07-24T19:38:56Z"));
    }

    #[test]
    fn maps_grok_monthly_money_values() {
        let config: GrokBillingConfig = serde_json::from_value(json!({
            "monthlyLimit": { "val": "150000" },
            "used": { "val": 75000 },
            "billingPeriodEnd": "2026-08-01T00:00:00Z"
        }))
        .unwrap();
        let window = map_grok_monthly(&config).unwrap();
        assert_eq!(window.used_percent, 50.0);
        assert_eq!(window.window_minutes, GROK_MONTHLY_MINUTES);
    }

    #[test]
    fn parses_cursor_about_email_and_rejects_login_placeholders() {
        assert_eq!(
            parse_cursor_about_email(br#"{"userEmail":"dev@example.com"}"#).as_deref(),
            Some("dev@example.com")
        );
        assert_eq!(
            parse_cursor_about_email(br#"{"userEmail":"Not logged in"}"#),
            None
        );
        assert_eq!(
            parse_cursor_about_text("Version 1.0\nUser Email  team@example.com\n"),
            Some("team@example.com".to_string())
        );
    }

    #[test]
    fn reads_opencode_account_email_from_nested_auth() {
        let label =
            parse_opencode_auth_label(r#"{"google":{"type":"oauth","email":"agy@example.com"}}"#);
        assert_eq!(label.as_deref(), Some("agy@example.com"));
    }

    #[test]
    fn maps_antigravity_quota_buckets_to_the_tightest_window() {
        let usage = parse_agy_quota(&json!({
            "buckets": [
                {
                    "remainingFraction": 0.8,
                    "resetTime": "2026-08-18T12:00:00Z",
                    "modelId": "gemini-3.1-flash"
                },
                {
                    "remainingFraction": 0.25,
                    "resetTime": "2026-08-18T11:00:00Z",
                    "modelId": "gemini-3.1-pro"
                }
            ]
        }))
        .unwrap();
        assert_eq!(usage.status, "ok");
        let session = usage.session.unwrap();
        assert_eq!(session.used_percent, 75.0);
        assert_eq!(session.window_minutes, 60);
        assert_eq!(session.resets_at, parse_iso_millis("2026-08-18T11:00:00Z"));
    }

    #[test]
    fn ignores_expired_gemini_oauth_access() {
        assert!(
            parse_gemini_oauth_access(r#"{"access_token":"secret","expiry_date":1}"#).is_none()
        );
        assert!(parse_gemini_oauth_access(
            r#"{"access_token":"secret","expiry_date":4102444800000}"#
        )
        .is_some());
    }
}
