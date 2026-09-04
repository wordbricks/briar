use crate::{agent, provider_cli};
use briar_contracts::proto::briar::local::v1 as local_proto;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

// Provider quota and sign-in state are read by `briar provider usage|auth`.
// The credential stores, provider endpoints and provider CLI protocols behind
// them have a single implementation in the Briar CLI, so the desktop app and
// the Bun execution workers can never drift apart.

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUsageWindow {
    #[specta(type = specta_typescript::Number)]
    used_percent: f64,
    window_minutes: u64,
    resets_at: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProviderUsageStatus {
    Ok,
    Error,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderUsage {
    provider: agent::AgentProviderKind,
    status: ProviderUsageStatus,
    session: Option<AgentUsageWindow>,
    weekly: Option<AgentUsageWindow>,
    monthly: Option<AgentUsageWindow>,
    plan_type: Option<String>,
    account_label: Option<String>,
    authenticated: bool,
    /// True when the stored credentials cannot be used again without a fresh
    /// sign-in, so the UI must stop reporting the account as connected.
    reauthentication_required: bool,
    updated_at: u64,
    error: Option<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUsageSnapshot {
    codex: ProviderUsage,
    claude: ProviderUsage,
    grok: ProviderUsage,
    agy: ProviderUsage,
    opencode: ProviderUsage,
    openrouter: ProviderUsage,
    cursor: ProviderUsage,
    updated_at: u64,
}

/// Provider sign-in state for the onboarding prerequisite list.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ProviderAuthentication {
    pub(crate) codex: bool,
    pub(crate) claude: bool,
    pub(crate) cursor: bool,
    pub(crate) grok: bool,
    pub(crate) agy: bool,
}

pub(crate) async fn load(home: PathBuf, openrouter_configured: bool) -> AgentUsageSnapshot {
    tauri::async_runtime::spawn_blocking(move || load_sync(&home, openrouter_configured))
        .await
        .unwrap_or_else(|error| {
            unavailable_snapshot(format!("Usage 조회 작업에 실패했습니다: {error}"))
        })
}

fn load_sync(home: &Path, openrouter_configured: bool) -> AgentUsageSnapshot {
    match provider_cli::provider_usage_snapshot(home, openrouter_configured) {
        Ok(snapshot) => AgentUsageSnapshot {
            codex: provider_usage(
                agent::AgentProviderKind::Codex,
                snapshot.codex.into_option(),
            ),
            claude: provider_usage(
                agent::AgentProviderKind::Claude,
                snapshot.claude.into_option(),
            ),
            grok: provider_usage(agent::AgentProviderKind::Grok, snapshot.grok.into_option()),
            agy: provider_usage(agent::AgentProviderKind::Agy, snapshot.agy.into_option()),
            opencode: provider_usage(
                agent::AgentProviderKind::Opencode,
                snapshot.opencode.into_option(),
            ),
            openrouter: provider_usage(
                agent::AgentProviderKind::Openrouter,
                snapshot.openrouter.into_option(),
            ),
            cursor: provider_usage(
                agent::AgentProviderKind::Cursor,
                snapshot.cursor.into_option(),
            ),
            updated_at: snapshot
                .updated_at
                .as_option()
                .map(|value| timestamp_millis(value.seconds, value.nanos))
                .unwrap_or_else(now_millis),
        },
        // A CLI that cannot run is reported the way a missing provider always
        // has been: connected accounts are never invented from a failure.
        Err(error) => unavailable_snapshot(error),
    }
}

/// Which providers are signed in on this machine, for onboarding prerequisites.
pub(crate) fn local_authentication(home: &Path) -> ProviderAuthentication {
    let snapshot = provider_cli::provider_auth_snapshot(home).ok();
    let read = |select: fn(&local_proto::LocalProviderAuthSnapshot) -> Option<bool>| {
        snapshot.as_ref().and_then(select).unwrap_or(false)
    };
    ProviderAuthentication {
        codex: read(|snapshot| snapshot.codex),
        claude: read(|snapshot| snapshot.claude),
        cursor: read(|snapshot| snapshot.cursor),
        grok: read(|snapshot| snapshot.grok),
        agy: read(|snapshot| snapshot.agy),
    }
}

fn provider_usage(
    provider: agent::AgentProviderKind,
    value: Option<local_proto::LocalProviderUsage>,
) -> ProviderUsage {
    let Some(value) = value else {
        return provider_without_usage(
            provider,
            ProviderUsageStatus::Unavailable,
            "Briar CLI가 이 provider의 usage를 반환하지 않았습니다.".to_string(),
        );
    };
    ProviderUsage {
        provider,
        status: match value.status.as_known() {
            Some(local_proto::LocalProviderUsageStatus::LOCAL_PROVIDER_USAGE_STATUS_OK) => {
                ProviderUsageStatus::Ok
            }
            Some(
                local_proto::LocalProviderUsageStatus::LOCAL_PROVIDER_USAGE_STATUS_UNAVAILABLE,
            ) => ProviderUsageStatus::Unavailable,
            _ => ProviderUsageStatus::Error,
        },
        session: usage_window(value.session.into_option()),
        weekly: usage_window(value.weekly.into_option()),
        monthly: usage_window(value.monthly.into_option()),
        plan_type: value.plan_type,
        account_label: value.account_label,
        authenticated: value.authenticated,
        reauthentication_required: value.reauthentication_required,
        updated_at: value
            .updated_at
            .as_option()
            .map(|value| timestamp_millis(value.seconds, value.nanos))
            .unwrap_or_else(now_millis),
        error: value.error,
    }
}

fn usage_window(value: Option<local_proto::LocalProviderUsageWindow>) -> Option<AgentUsageWindow> {
    let value = value?;
    Some(AgentUsageWindow {
        used_percent: clamp_percent(value.used_percent),
        window_minutes: value.window_minutes,
        resets_at: value
            .resets_at
            .as_option()
            .map(|value| timestamp_millis(value.seconds, value.nanos)),
    })
}

fn timestamp_millis(seconds: i64, nanos: i32) -> u64 {
    (seconds.max(0) as u64)
        .saturating_mul(1_000)
        .saturating_add((nanos.max(0) as u64) / 1_000_000)
}

fn clamp_percent(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 100.0)
    } else {
        0.0
    }
}

fn unavailable_snapshot(error: String) -> AgentUsageSnapshot {
    let provider = |provider| {
        provider_without_usage(provider, ProviderUsageStatus::Unavailable, error.clone())
    };
    AgentUsageSnapshot {
        codex: provider(agent::AgentProviderKind::Codex),
        claude: provider(agent::AgentProviderKind::Claude),
        grok: provider(agent::AgentProviderKind::Grok),
        agy: provider(agent::AgentProviderKind::Agy),
        opencode: provider(agent::AgentProviderKind::Opencode),
        openrouter: provider(agent::AgentProviderKind::Openrouter),
        cursor: provider(agent::AgentProviderKind::Cursor),
        updated_at: now_millis(),
    }
}

fn provider_without_usage(
    provider: agent::AgentProviderKind,
    status: ProviderUsageStatus,
    error: String,
) -> ProviderUsage {
    ProviderUsage {
        provider,
        status,
        session: None,
        weekly: None,
        monthly: None,
        plan_type: None,
        account_label: None,
        authenticated: false,
        reauthentication_required: false,
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

    fn usage_from(json: &str) -> ProviderUsage {
        provider_usage(
            agent::AgentProviderKind::Codex,
            Some(serde_json::from_str(json).expect("provider usage should decode")),
        )
    }

    #[test]
    fn maps_cli_usage_windows_and_account_metadata() {
        let usage = usage_from(
            r#"{"status":"LOCAL_PROVIDER_USAGE_STATUS_OK","session":{"usedPercent":37.5,"windowMinutes":"300"},"weekly":{"usedPercent":81,"windowMinutes":"10080","resetsAt":"2027-01-15T22:40:00Z"},"planType":"plus","accountLabel":"dev@example.com","authenticated":true,"updatedAt":"2026-09-04T02:14:48.100Z"}"#,
        );
        assert_eq!(usage.status, ProviderUsageStatus::Ok);
        assert_eq!(usage.session.as_ref().unwrap().used_percent, 37.5);
        let weekly = usage.weekly.as_ref().unwrap();
        assert_eq!(weekly.window_minutes, 10_080);
        assert_eq!(weekly.resets_at, Some(1_800_052_800_000));
        assert_eq!(usage.plan_type.as_deref(), Some("plus"));
        assert_eq!(usage.account_label.as_deref(), Some("dev@example.com"));
        assert!(usage.authenticated);
        assert_eq!(usage.updated_at, 1_788_488_088_100);
    }

    #[test]
    fn reports_an_unreadable_cli_as_an_unavailable_provider() {
        let snapshot = unavailable_snapshot(provider_cli::MISSING_CLI_ERROR.to_string());
        assert_eq!(snapshot.codex.status, ProviderUsageStatus::Unavailable);
        assert!(!snapshot.cursor.authenticated);
        assert_eq!(
            snapshot.claude.error.as_deref(),
            Some(provider_cli::MISSING_CLI_ERROR)
        );
    }

    #[test]
    fn treats_a_provider_the_cli_did_not_report_as_unavailable() {
        let usage = provider_usage(agent::AgentProviderKind::Cursor, None);
        assert_eq!(usage.status, ProviderUsageStatus::Unavailable);
        assert!(usage.error.is_some());
    }

    #[test]
    fn clamps_out_of_range_percentages() {
        let usage = usage_from(
            r#"{"status":"LOCAL_PROVIDER_USAGE_STATUS_ERROR","session":{"usedPercent":104,"windowMinutes":"300"},"error":"boom"}"#,
        );
        assert_eq!(usage.status, ProviderUsageStatus::Error);
        assert_eq!(usage.session.as_ref().unwrap().used_percent, 100.0);
        assert_eq!(usage.error.as_deref(), Some("boom"));
    }
}
