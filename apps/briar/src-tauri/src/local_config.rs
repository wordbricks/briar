use super::*;
use briar_contracts::proto::briar::{local::v1 as local_proto, types::v1 as types_proto};

#[cfg(test)]
pub(super) use local_proto::LocalWorktreeConfig;
pub(super) use local_proto::{
    LocalAddedProviders, LocalAgentProviderSettings, LocalAppSettings, LocalAutoHuntConfig,
    LocalConfig, LocalExecutionWorkerConfig, LocalLinearConfig, LocalProjectConfig,
    LocalProjectLlmConfig, LocalSandboxConfig, LocalVertexAiCredential,
};

const DEFAULT_API_URL: &str = "http://127.0.0.1:8787";

/// A new config enables the built-in providers and nothing else. Everything
/// else stays inactive until the user adds it in settings.
pub(super) fn default_agent_provider_settings() -> LocalAgentProviderSettings {
    let mut settings = LocalAgentProviderSettings::default();
    for provider in agent::AgentProviderKind::all().filter(|provider| provider.built_in()) {
        set_provider_enabled(&mut settings, provider, true);
    }
    settings
}

pub(super) fn default_app_settings() -> LocalAppSettings {
    LocalAppSettings {
        prevent_sleep_while_running: false,
        browser_automation_provider: Some(
            local_proto::LocalBrowserAutomationProvider::AgentBrowser.into(),
        ),
        ..Default::default()
    }
}

pub(super) fn default_local_config(api_url: impl Into<String>) -> LocalConfig {
    LocalConfig {
        api_url: api_url.into(),
        agent_providers: default_agent_provider_settings().into(),
        app_settings: default_app_settings().into(),
        // Present and empty: this config has been initialised and has added
        // nothing, which is not the same as never having been initialised.
        added_providers: LocalAddedProviders::default().into(),
        ..Default::default()
    }
}

pub(super) fn read_cli_config(config_path: &Path) -> Result<LocalConfig, String> {
    if !config_path.exists() {
        return Ok(default_local_config(DEFAULT_API_URL));
    }
    let contents = fs::read_to_string(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 읽지 못했습니다: {error}"))?;
    match decode_local_config_json(&contents) {
        Ok(mut config) => {
            backfill_added_providers(&mut config);
            Ok(config)
        }
        Err(original_error) => {
            let Some(mut config) = migrate_pre_protojson_local_config(&contents)? else {
                return Err(original_error);
            };
            backfill_added_providers(&mut config);
            write_cli_config(config_path, &config)?;
            Ok(config)
        }
    }
}

/// Whether this config already holds the credential an upstream provider needs.
/// The backfill asks so a machine that was already talking to an upstream keeps
/// it after the built-in/added split.
fn has_saved_upstream_credential(config: &LocalConfig, provider: agent::AgentProviderKind) -> bool {
    let Some(upstream) = provider.opencode_upstream() else {
        return false;
    };
    match upstream.credential {
        agent::OpenCodeUpstreamCredential::ApiKey { .. } => config
            .openrouter_api_key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty()),
        agent::OpenCodeUpstreamCredential::GoogleAdc { .. } => config.vertex_ai.is_set(),
    }
}

/// Give a config written before the added list existed the list it implies.
///
/// Absence of the message means "never initialised", so every non-built-in
/// provider this machine was already enabled for, or holds a credential for,
/// counts as added. Existing installations therefore see no change; the value
/// is persisted the next time the config is written. Mirrors
/// `addedAgentProviders` in `src-cli/config-contract.ts`.
fn backfill_added_providers(config: &mut LocalConfig) {
    if config.added_providers.is_set() {
        return;
    }
    let settings = config
        .agent_providers
        .as_option()
        .cloned()
        .unwrap_or_default();
    let providers = agent::AgentProviderKind::all()
        .filter(|provider| !provider.built_in())
        .filter(|provider| {
            provider_is_enabled(&settings, *provider)
                || has_saved_upstream_credential(config, *provider)
        })
        .map(|provider| types_proto::AgentProvider::from(provider).into())
        .collect();
    config.added_providers = LocalAddedProviders {
        providers,
        ..Default::default()
    }
    .into();
}

fn replace_legacy_enum(
    object: &mut serde_json::Map<String, serde_json::Value>,
    field: &str,
    mappings: &[(&str, &str)],
) -> bool {
    let Some(serde_json::Value::String(value)) = object.get_mut(field) else {
        return false;
    };
    let Some((_, replacement)) = mappings.iter().find(|(legacy, _)| value == legacy) else {
        return false;
    };
    *value = (*replacement).to_string();
    true
}

// TODO(remove after every pre-ProtoJSON Briar installation has launched at least once):
// Delete this one-time local config migration. The strict generated ProtoJSON decoder below
// remains the only supported storage contract after the installed user base has been rewritten.
fn migrate_pre_protojson_local_config(contents: &str) -> Result<Option<LocalConfig>, String> {
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(contents) else {
        return Ok(None);
    };
    let Some(root) = root.as_object_mut() else {
        return Ok(None);
    };

    let mut changed = root
        .get_mut("appSettings")
        .and_then(serde_json::Value::as_object_mut)
        .is_some_and(|settings| {
            replace_legacy_enum(
                settings,
                "browserAutomationProvider",
                &[
                    (
                        "ego-browser",
                        "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
                    ),
                    (
                        "agent-browser",
                        "LOCAL_BROWSER_AUTOMATION_PROVIDER_AGENT_BROWSER",
                    ),
                    ("aside", "LOCAL_BROWSER_AUTOMATION_PROVIDER_ASIDE"),
                ],
            )
        });

    if let Some(projects) = root
        .get_mut("projects")
        .and_then(serde_json::Value::as_array_mut)
    {
        for project in projects {
            let Some(project) = project.as_object_mut() else {
                continue;
            };
            if let Some(llm) = project
                .get_mut("llm")
                .and_then(serde_json::Value::as_object_mut)
            {
                changed |= replace_legacy_enum(
                    llm,
                    "provider",
                    &[
                        ("codex", "AGENT_PROVIDER_CODEX"),
                        ("claude", "AGENT_PROVIDER_CLAUDE"),
                        ("cursor", "AGENT_PROVIDER_CURSOR"),
                        ("grok", "AGENT_PROVIDER_GROK"),
                        ("agy", "AGENT_PROVIDER_AGY"),
                        ("opencode", "AGENT_PROVIDER_OPENCODE"),
                        ("openrouter", "AGENT_PROVIDER_OPENROUTER"),
                        ("vertex", "AGENT_PROVIDER_VERTEX"),
                    ],
                );
                changed |= replace_legacy_enum(
                    llm,
                    "approvalPolicy",
                    &[
                        ("untrusted", "LOCAL_APPROVAL_POLICY_UNTRUSTED"),
                        ("on-request", "LOCAL_APPROVAL_POLICY_ON_REQUEST"),
                        ("never", "LOCAL_APPROVAL_POLICY_NEVER"),
                    ],
                );
            }
            if let Some(claim) = project
                .get_mut("activeClaim")
                .and_then(serde_json::Value::as_object_mut)
            {
                changed |= replace_legacy_enum(
                    claim,
                    "terminalStatus",
                    &[
                        ("completed", "LOCAL_CLAIM_TERMINAL_STATUS_COMPLETED"),
                        ("cancelled", "LOCAL_CLAIM_TERMINAL_STATUS_CANCELLED"),
                        ("blocked", "LOCAL_CLAIM_TERMINAL_STATUS_BLOCKED"),
                        ("failed", "LOCAL_CLAIM_TERMINAL_STATUS_FAILED"),
                    ],
                );
            }
            if let Some(auto_hunt) = project
                .get_mut("autoHunt")
                .and_then(serde_json::Value::as_object_mut)
            {
                if let Some(repository_id) = auto_hunt.get_mut("githubRepositoryId") {
                    if let Some(repository_id_number) = repository_id.as_u64() {
                        *repository_id =
                            serde_json::Value::String(repository_id_number.to_string());
                        changed = true;
                    }
                }
                if let Some(checkpoints) = auto_hunt
                    .get_mut("workflow")
                    .and_then(serde_json::Value::as_object_mut)
                    .and_then(|workflow| workflow.get_mut("execution"))
                    .and_then(serde_json::Value::as_object_mut)
                    .and_then(|execution| execution.get_mut("checkpoints"))
                    .and_then(serde_json::Value::as_array_mut)
                {
                    for checkpoint in checkpoints {
                        if let Some(checkpoint) = checkpoint.as_object_mut() {
                            changed |= replace_legacy_enum(
                                checkpoint,
                                "position",
                                &[("before", "POSITION_BEFORE"), ("after", "POSITION_AFTER")],
                            );
                        }
                    }
                }
            }
        }
    }

    if !changed {
        return Ok(None);
    }
    let migrated = serde_json::to_string(root)
        .map_err(|error| format!("Briar 로컬 설정을 변환하지 못했습니다: {error}"))?;
    decode_local_config_json(&migrated).map(Some)
}

fn decode_local_config_json(contents: &str) -> Result<LocalConfig, String> {
    let mut deserializer = serde_json::Deserializer::from_str(contents);
    let mut unknown_fields = Vec::new();
    let config = serde_ignored::deserialize(&mut deserializer, |path| {
        unknown_fields.push(path.to_string());
    })
    .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    deserializer
        .end()
        .map_err(|error| format!("Briar 로컬 설정이 손상되었습니다: {error}"))?;
    if let Some(field) = unknown_fields.first() {
        return Err(format!(
            "Briar 로컬 설정이 손상되었습니다: 알 수 없는 필드 {field}"
        ));
    }
    validate_local_config(&config)?;
    Ok(config)
}

pub(super) fn write_cli_config(config_path: &Path, config: &LocalConfig) -> Result<(), String> {
    validate_local_config(config)?;
    let config_directory = config_path
        .parent()
        .ok_or_else(|| "Briar 설정 폴더를 찾을 수 없습니다.".to_string())?;
    fs::create_dir_all(config_directory)
        .map_err(|error| format!("Briar 설정 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Briar 설정 폴더 권한을 지정하지 못했습니다: {error}"))?;
    }

    let mut serialized = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Briar 로컬 설정을 만들지 못했습니다: {error}"))?;
    serialized.push(b'\n');
    let mut temporary = tempfile::Builder::new()
        .prefix(".config.")
        .suffix(".tmp")
        .tempfile_in(config_directory)
        .map_err(|error| format!("Briar 임시 설정을 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 임시 설정 권한을 지정하지 못했습니다: {error}"))?;
    }
    temporary
        .write_all(&serialized)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Briar 로컬 설정을 저장하지 못했습니다: {error}"))?;
    temporary
        .persist(config_path)
        .map_err(|error| format!("Briar 로컬 설정을 교체하지 못했습니다: {}", error.error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 로컬 설정 권한을 지정하지 못했습니다: {error}"))?;
        fs::File::open(config_directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Briar 설정 폴더를 동기화하지 못했습니다: {error}"))?;
    }
    Ok(())
}

fn nonempty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("Briar 로컬 설정의 {field} 값이 비어 있습니다."))
    } else {
        Ok(())
    }
}

fn valid_uuid(value: &str, field: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("Briar 로컬 설정의 {field} 값이 UUID가 아닙니다."))
}

fn valid_url(value: &str, field: &str) -> Result<(), String> {
    reqwest::Url::parse(value)
        .map(|_| ())
        .map_err(|_| format!("Briar 로컬 설정의 {field} 값이 URL이 아닙니다."))
}

fn valid_managed_device_id(value: &str, field: &str) -> Result<(), String> {
    let id = value
        .strip_prefix("managed-")
        .ok_or_else(|| format!("Briar 로컬 설정의 {field} 값이 올바르지 않습니다."))?;
    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| format!("Briar 로컬 설정의 {field} 값이 올바르지 않습니다."))?;
    if id.get_version_num() != 4 || !matches!(id.get_variant(), uuid::Variant::RFC4122) {
        return Err(format!(
            "Briar 로컬 설정의 {field} 값이 UUID v4가 아닙니다."
        ));
    }
    Ok(())
}

fn validate_timestamp(seconds: i64, nanos: i32, field: &str) -> Result<(), String> {
    let nanos = u32::try_from(nanos)
        .map_err(|_| format!("Briar 로컬 설정의 {field} 값이 올바르지 않습니다."))?;
    chrono::DateTime::from_timestamp(seconds, nanos)
        .map(|_| ())
        .ok_or_else(|| format!("Briar 로컬 설정의 {field} 값이 올바르지 않습니다."))
}

pub(super) fn validate_local_config(config: &LocalConfig) -> Result<(), String> {
    valid_url(&config.api_url, "apiUrl")?;
    config
        .agent_providers
        .as_option()
        .ok_or_else(|| "Briar 로컬 설정의 agentProviders 값이 없습니다.".to_string())?;
    let app_settings = config
        .app_settings
        .as_option()
        .ok_or_else(|| "Briar 로컬 설정의 appSettings 값이 없습니다.".to_string())?;
    browser_automation_provider_from_proto(app_settings)?;

    if let Some(identity) = config.worker_device_identity.as_deref() {
        let digest = identity.strip_prefix("briar_device_").unwrap_or_default();
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(
                "Briar 로컬 설정의 workerDeviceIdentity 값이 올바르지 않습니다.".to_string(),
            );
        }
    }

    if let Some(api_key) = config.openrouter_api_key.as_deref() {
        let trimmed = api_key.trim();
        if !(10..=500).contains(&trimmed.len()) {
            return Err("Briar 로컬 설정의 openrouterApiKey 값은 10~500자여야 합니다.".to_string());
        }
    }

    let managed = config.managed_computer.as_option();
    if let Some(managed) = managed {
        valid_uuid(
            &managed.managed_computer_id,
            "managedComputer.managedComputerId",
        )?;
        valid_managed_device_id(&managed.device_id, "managedComputer.deviceId")?;
        valid_uuid(&managed.organization_id, "managedComputer.organizationId")?;
        if !Path::new(&managed.credential_file).is_absolute() {
            return Err(
                "Briar 로컬 설정의 managedComputer.credentialFile 경로는 절대 경로여야 합니다."
                    .to_string(),
            );
        }
    }

    for project in &config.projects {
        valid_uuid(&project.id, "projects.id")?;
        nonempty(&project.repository_path, "projects.repositoryPath")?;
        valid_url(&project.api_url, "projects.apiUrl")?;
        if let Some(agent_token) = project.agent_token.as_deref() {
            if !agent_token.starts_with("briar_agent_") {
                return Err(
                    "Briar 로컬 설정의 projects.agentToken 값이 올바르지 않습니다.".to_string(),
                );
            }
        }
        if let Some(llm) = project.llm.as_option() {
            project_llm_settings_from_proto(llm)?;
        }
        if let Some(auto_hunt) = project.auto_hunt.as_option() {
            validate_auto_hunt(auto_hunt)?;
        }
        let worker = project.execution_worker.as_option();
        if let Some(worker) = worker {
            validate_execution_worker(worker)?;
        }
        if let Some(claim) = project.active_claim.as_option() {
            validate_active_claim(claim)?;
        }

        let managed_credential = managed.zip(worker).is_some_and(|(managed, worker)| {
            managed.device_id == worker.device_id
                && managed.organization_id == worker.organization_id
        });
        if project.agent_token.is_none()
            && worker.and_then(|worker| worker.token.as_ref()).is_none()
            && !managed_credential
        {
            return Err(format!(
                "Briar 로컬 설정의 프로젝트 {}에 실행 credential이 없습니다.",
                project.id
            ));
        }
    }
    Ok(())
}

fn validate_execution_worker(worker: &LocalExecutionWorkerConfig) -> Result<(), String> {
    if worker.device_id.starts_with("managed-") {
        valid_managed_device_id(&worker.device_id, "projects.executionWorker.deviceId")?;
    } else {
        valid_uuid(&worker.device_id, "projects.executionWorker.deviceId")?;
    }
    nonempty(&worker.worker_id, "projects.executionWorker.workerId")?;
    valid_uuid(
        &worker.organization_id,
        "projects.executionWorker.organizationId",
    )?;
    if let Some(token) = worker.token.as_deref() {
        if !token.starts_with("briar_worker_") {
            return Err(
                "Briar 로컬 설정의 projects.executionWorker.token 값이 올바르지 않습니다."
                    .to_string(),
            );
        }
    }
    if worker.label.trim().is_empty() || worker.label.chars().count() > 100 {
        return Err(
            "Briar 로컬 설정의 projects.executionWorker.label 값이 올바르지 않습니다.".to_string(),
        );
    }
    if !(1..=16).contains(&worker.max_concurrent_sessions) {
        return Err(
            "Briar 로컬 설정의 projects.executionWorker.maxConcurrentSessions 값은 1~16이어야 합니다."
                .to_string(),
        );
    }
    Ok(())
}

fn validate_active_claim(claim: &local_proto::LocalActiveClaimConfig) -> Result<(), String> {
    valid_uuid(&claim.run_id, "projects.activeClaim.runId")?;
    nonempty(&claim.source_key, "projects.activeClaim.sourceKey")?;
    if claim
        .token
        .as_deref()
        .is_some_and(|token| !token.starts_with("briar_claim_"))
    {
        return Err(
            "Briar 로컬 설정의 projects.activeClaim.token 값이 올바르지 않습니다.".to_string(),
        );
    }
    let lease_expires_at = claim.lease_expires_at.as_option().ok_or_else(|| {
        "Briar 로컬 설정의 projects.activeClaim.leaseExpiresAt 값이 없습니다.".to_string()
    })?;
    validate_timestamp(
        lease_expires_at.seconds,
        lease_expires_at.nanos,
        "projects.activeClaim.leaseExpiresAt",
    )?;
    if let Some(worktree) = claim.worktree.as_option() {
        nonempty(&worktree.path, "projects.activeClaim.worktree.path")?;
        nonempty(&worktree.branch, "projects.activeClaim.worktree.branch")?;
        nonempty(&worktree.base_ref, "projects.activeClaim.worktree.baseRef")?;
        nonempty(&worktree.base_sha, "projects.activeClaim.worktree.baseSha")?;
    }
    if claim.terminal_status.as_ref().is_some_and(|status| {
        !matches!(
            status.as_known(),
            Some(
                local_proto::LocalClaimTerminalStatus::Completed
                    | local_proto::LocalClaimTerminalStatus::Cancelled
                    | local_proto::LocalClaimTerminalStatus::Blocked
                    | local_proto::LocalClaimTerminalStatus::Failed
            )
        )
    }) {
        return Err(
            "Briar 로컬 설정의 projects.activeClaim.terminalStatus 값이 올바르지 않습니다."
                .to_string(),
        );
    }
    if let Some(finished_at) = claim.finished_at.as_option() {
        validate_timestamp(
            finished_at.seconds,
            finished_at.nanos,
            "projects.activeClaim.finishedAt",
        )?;
    }
    Ok(())
}

fn validate_auto_hunt(auto_hunt: &LocalAutoHuntConfig) -> Result<(), String> {
    for (value, field) in [
        (auto_hunt.velen_org.as_deref(), "projects.autoHunt.velenOrg"),
        (
            auto_hunt.data_source.as_deref(),
            "projects.autoHunt.dataSource",
        ),
        (
            auto_hunt.github_repository.as_deref(),
            "projects.autoHunt.githubRepository",
        ),
    ] {
        if let Some(value) = value {
            nonempty(value, field)?;
        }
    }
    if auto_hunt.github_repository_id == Some(0) {
        return Err(
            "Briar 로컬 설정의 projects.autoHunt.githubRepositoryId 값이 올바르지 않습니다."
                .to_string(),
        );
    }
    if let Some(worktrees) = auto_hunt.worktrees.as_option() {
        if let Some(root) = worktrees.root.as_deref() {
            nonempty(root, "projects.autoHunt.worktrees.root")?;
        }
        if let Some(prefix) = worktrees.branch_prefix.as_deref() {
            nonempty(prefix, "projects.autoHunt.worktrees.branchPrefix")?;
        }
    }
    if let Some(linear) = auto_hunt.linear.as_option() {
        if let Some(source) = linear.source.as_deref() {
            let slug = source.strip_prefix("linear://").unwrap_or_default();
            if slug.is_empty()
                || !slug
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
            {
                return Err(
                    "Briar 로컬 설정의 projects.autoHunt.linear.source 값이 올바르지 않습니다."
                        .to_string(),
                );
            }
        }
        if let Some(team_key) = linear.team_key.as_deref() {
            nonempty(team_key, "projects.autoHunt.linear.teamKey")?;
        }
    }
    if let Some(workflow) = auto_hunt.workflow.as_option() {
        let workflow = workflow_from_proto(workflow)?;
        validate_generated_workflow(&workflow)?;
    }
    Ok(())
}

pub(super) fn agent_provider_from_proto(
    value: buffa::EnumValue<types_proto::AgentProvider>,
) -> Result<agent::AgentProviderKind, String> {
    value
        .as_known()
        .and_then(agent::AgentProviderKind::from_wire)
        .ok_or_else(|| "Briar 로컬 설정의 Agent provider가 올바르지 않습니다.".to_string())
}

pub(super) fn agent_provider_to_proto(
    value: agent::AgentProviderKind,
) -> buffa::EnumValue<types_proto::AgentProvider> {
    value.wire().into()
}

pub(super) fn project_llm_settings_from_proto(
    value: &LocalProjectLlmConfig,
) -> Result<agent::ProjectLlmSettings, String> {
    let provider = value
        .provider
        .ok_or_else(|| "Briar 로컬 설정의 projects.llm.provider 값이 없습니다.".to_string())?;
    let approval_policy = match value
        .approval_policy
        .as_ref()
        .and_then(buffa::EnumValue::as_known)
    {
        Some(local_proto::LocalApprovalPolicy::Untrusted) => agent::ApprovalPolicy::Untrusted,
        Some(local_proto::LocalApprovalPolicy::OnRequest) => agent::ApprovalPolicy::OnRequest,
        Some(local_proto::LocalApprovalPolicy::Never) => agent::ApprovalPolicy::Never,
        _ => {
            return Err(
                "Briar 로컬 설정의 projects.llm.approvalPolicy 값이 올바르지 않습니다.".to_string(),
            )
        }
    };
    if value.model.as_deref().is_some_and(|model| {
        model.is_empty() || model.len() > 128 || model.chars().any(char::is_whitespace)
    }) {
        return Err("Briar 로컬 설정의 projects.llm.model 값이 올바르지 않습니다.".to_string());
    }
    if value
        .effort
        .as_deref()
        .is_some_and(|effort| effort.is_empty() || effort.len() > 64)
    {
        return Err("Briar 로컬 설정의 projects.llm.effort 값이 올바르지 않습니다.".to_string());
    }
    Ok(agent::ProjectLlmSettings {
        provider: agent_provider_from_proto(provider)?,
        model: value.model.clone(),
        effort: value.effort.clone().map(agent::ModelEffort::from_id),
        approval_policy,
    })
}

pub(super) fn project_llm_settings_to_proto(
    value: &agent::ProjectLlmSettings,
) -> LocalProjectLlmConfig {
    let approval_policy = match value.approval_policy {
        agent::ApprovalPolicy::Untrusted => local_proto::LocalApprovalPolicy::Untrusted,
        agent::ApprovalPolicy::OnRequest => local_proto::LocalApprovalPolicy::OnRequest,
        agent::ApprovalPolicy::Never => local_proto::LocalApprovalPolicy::Never,
    };
    LocalProjectLlmConfig {
        provider: Some(agent_provider_to_proto(value.provider)),
        model: value.model.clone(),
        effort: value.effort.as_ref().map(|effort| effort.id().to_string()),
        approval_policy: Some(approval_policy.into()),
        ..Default::default()
    }
}

pub(super) fn workflow_from_proto(
    value: &types_proto::AutoHuntWorkflow,
) -> Result<WorkflowConfig, String> {
    let version = u8::try_from(value.version)
        .map_err(|_| "Briar 로컬 workflow version이 올바르지 않습니다.".to_string())?;
    let requirements = value
        .requirements
        .iter()
        .map(|requirement| {
            let kind = match requirement.kind.as_str() {
                "executable" => WorkflowRequirementKind::Executable,
                "xcode" => WorkflowRequirementKind::Xcode,
                "ios_simulator" => WorkflowRequirementKind::IosSimulator,
                "android_sdk" => WorkflowRequirementKind::AndroidSdk,
                "android_emulator" => WorkflowRequirementKind::AndroidEmulator,
                _ => {
                    return Err(format!(
                        "Briar 로컬 workflow requirement kind {}가 올바르지 않습니다.",
                        requirement.kind
                    ))
                }
            };
            Ok(WorkflowRequirementConfig {
                id: requirement.id.clone(),
                label: requirement.label.clone(),
                kind,
                tool: requirement.tool.clone(),
                reason: requirement.reason.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let stages = value
        .stages
        .iter()
        .map(|stage| WorkflowStageConfig {
            id: stage.id.clone(),
            label: stage.label.clone(),
            required: stage.required,
            evidence: stage.evidence.clone(),
            checks: stage.checks.clone(),
        })
        .collect();
    let execution = value
        .execution
        .as_option()
        .ok_or_else(|| "Briar 로컬 workflow execution 값이 없습니다.".to_string())?;
    let checkpoints = execution
        .checkpoints
        .iter()
        .map(|checkpoint| {
            let position = match checkpoint.position.as_known() {
                Some(types_proto::workflow_checkpoint::Position::Before) => {
                    WorkflowCheckpointPosition::Before
                }
                Some(types_proto::workflow_checkpoint::Position::After) => {
                    WorkflowCheckpointPosition::After
                }
                _ => {
                    return Err(
                        "Briar 로컬 workflow checkpoint position이 올바르지 않습니다.".to_string(),
                    )
                }
            };
            Ok(WorkflowCheckpointConfig {
                key: checkpoint.key.clone(),
                stage: checkpoint.stage.clone(),
                position,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let completion = value
        .completion
        .as_option()
        .ok_or_else(|| "Briar 로컬 workflow completion 값이 없습니다.".to_string())?;
    Ok(WorkflowConfig {
        version,
        requirements,
        stages,
        execution: WorkflowExecutionConfig { checkpoints },
        completion: WorkflowCompletionConfig {
            required_stages: completion.required_stages.clone(),
        },
    })
}

pub(super) fn workflow_to_proto(value: &WorkflowConfig) -> types_proto::AutoHuntWorkflow {
    types_proto::AutoHuntWorkflow {
        version: u32::from(value.version),
        requirements: value
            .requirements
            .iter()
            .map(|requirement| types_proto::WorkflowRequirement {
                id: requirement.id.clone(),
                label: requirement.label.clone(),
                kind: match requirement.kind {
                    WorkflowRequirementKind::Executable => "executable",
                    WorkflowRequirementKind::Xcode => "xcode",
                    WorkflowRequirementKind::IosSimulator => "ios_simulator",
                    WorkflowRequirementKind::AndroidSdk => "android_sdk",
                    WorkflowRequirementKind::AndroidEmulator => "android_emulator",
                }
                .to_string(),
                tool: requirement.tool.clone(),
                reason: requirement.reason.clone(),
                ..Default::default()
            })
            .collect(),
        stages: value
            .stages
            .iter()
            .map(|stage| types_proto::WorkflowStage {
                id: stage.id.clone(),
                label: stage.label.clone(),
                required: stage.required,
                evidence: stage.evidence.clone(),
                checks: stage.checks.clone(),
                ..Default::default()
            })
            .collect(),
        execution: types_proto::WorkflowExecution {
            checkpoints: value
                .execution
                .checkpoints
                .iter()
                .map(|checkpoint| types_proto::WorkflowCheckpointSpec {
                    key: checkpoint.key.clone(),
                    stage: checkpoint.stage.clone(),
                    position: match checkpoint.position {
                        WorkflowCheckpointPosition::Before => {
                            types_proto::workflow_checkpoint::Position::Before
                        }
                        WorkflowCheckpointPosition::After => {
                            types_proto::workflow_checkpoint::Position::After
                        }
                    }
                    .into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
        .into(),
        completion: types_proto::WorkflowCompletion {
            required_stages: value.completion.required_stages.clone(),
            ..Default::default()
        }
        .into(),
        ..Default::default()
    }
}

pub(super) fn auto_hunt_to_proto(value: &AutoHuntConfig) -> LocalAutoHuntConfig {
    LocalAutoHuntConfig {
        velen_org: value.velen_org.clone(),
        data_source: value.data_source.clone(),
        linear: LocalLinearConfig {
            enabled: value.linear_enabled,
            source: value.linear_source.clone(),
            team_key: value.linear_team.clone(),
            ..Default::default()
        }
        .into(),
        github_repository_id: value.github_repository_id,
        github_repository: value.github_repository.clone(),
        workflow: workflow_to_proto(&canonicalize_workflow(value.workflow.clone())).into(),
        ..Default::default()
    }
}

pub(super) fn browser_automation_provider_from_proto(
    value: &LocalAppSettings,
) -> Result<BrowserAutomationProvider, String> {
    match value
        .browser_automation_provider
        .as_ref()
        .and_then(buffa::EnumValue::as_known)
    {
        Some(local_proto::LocalBrowserAutomationProvider::EgoBrowser) => {
            Ok(BrowserAutomationProvider::EgoBrowser)
        }
        Some(local_proto::LocalBrowserAutomationProvider::AgentBrowser) => {
            Ok(BrowserAutomationProvider::AgentBrowser)
        }
        Some(local_proto::LocalBrowserAutomationProvider::Aside) => {
            Ok(BrowserAutomationProvider::Aside)
        }
        _ => Err(
            "Briar 로컬 설정의 appSettings.browserAutomationProvider 값이 올바르지 않습니다."
                .to_string(),
        ),
    }
}

pub(super) fn browser_automation_provider_to_proto(
    value: BrowserAutomationProvider,
) -> buffa::EnumValue<local_proto::LocalBrowserAutomationProvider> {
    match value {
        BrowserAutomationProvider::EgoBrowser => {
            local_proto::LocalBrowserAutomationProvider::EgoBrowser
        }
        BrowserAutomationProvider::AgentBrowser => {
            local_proto::LocalBrowserAutomationProvider::AgentBrowser
        }
        BrowserAutomationProvider::Aside => local_proto::LocalBrowserAutomationProvider::Aside,
    }
    .into()
}

pub(super) fn provider_is_enabled(
    settings: &LocalAgentProviderSettings,
    provider: agent::AgentProviderKind,
) -> bool {
    match provider {
        agent::AgentProviderKind::Codex => settings.codex,
        agent::AgentProviderKind::Claude => settings.claude,
        agent::AgentProviderKind::Cursor => settings.cursor,
        agent::AgentProviderKind::Grok => settings.grok,
        agent::AgentProviderKind::Agy => settings.agy,
        agent::AgentProviderKind::Opencode => settings.opencode,
        agent::AgentProviderKind::Openrouter => settings.openrouter,
        agent::AgentProviderKind::Vertex => settings.vertex,
        agent::AgentProviderKind::Pi => settings.pi,
    }
}

pub(super) fn set_provider_enabled(
    settings: &mut LocalAgentProviderSettings,
    provider: agent::AgentProviderKind,
    enabled: bool,
) {
    match provider {
        agent::AgentProviderKind::Codex => settings.codex = enabled,
        agent::AgentProviderKind::Claude => settings.claude = enabled,
        agent::AgentProviderKind::Cursor => settings.cursor = enabled,
        agent::AgentProviderKind::Grok => settings.grok = enabled,
        agent::AgentProviderKind::Agy => settings.agy = enabled,
        agent::AgentProviderKind::Opencode => settings.opencode = enabled,
        agent::AgentProviderKind::Openrouter => settings.openrouter = enabled,
        agent::AgentProviderKind::Vertex => settings.vertex = enabled,
        agent::AgentProviderKind::Pi => settings.pi = enabled,
    }
}

pub(super) fn providers_any_enabled(settings: &LocalAgentProviderSettings) -> bool {
    agent::AgentProviderKind::all().any(|provider| provider_is_enabled(settings, provider))
}

/// Providers this machine has added, in wire order. Values a build cannot name
/// are ignored rather than failing the read.
pub(super) fn added_providers(config: &LocalConfig) -> Vec<agent::AgentProviderKind> {
    let stored = config
        .added_providers
        .as_option()
        .map(|added| {
            added
                .providers
                .iter()
                .filter_map(|provider| provider.as_known())
                .filter_map(agent::AgentProviderKind::from_wire)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    agent::AgentProviderKind::all()
        .filter(|provider| !provider.built_in() && stored.contains(provider))
        .collect()
}

/// Whether a provider is enabled *and* this machine may use it at all.
pub(super) fn provider_is_active(config: &LocalConfig, provider: agent::AgentProviderKind) -> bool {
    let Some(settings) = config.agent_providers.as_option() else {
        return false;
    };
    provider_is_enabled(settings, provider)
        && (provider.built_in() || added_providers(config).contains(&provider))
}

/// The enabled record every availability decision is made from: the saved
/// switches, with a provider this machine has not added forced off. Mirrors
/// `effectiveEnabledProviders` in `src/lib/agent-provider.ts`.
pub(super) fn effective_provider_settings(config: &LocalConfig) -> LocalAgentProviderSettings {
    let mut settings = LocalAgentProviderSettings::default();
    for provider in agent::AgentProviderKind::all() {
        set_provider_enabled(
            &mut settings,
            provider,
            provider_is_active(config, provider),
        );
    }
    settings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_browser_automation_to_agent_browser() {
        assert_eq!(
            default_app_settings()
                .browser_automation_provider
                .as_ref()
                .and_then(buffa::EnumValue::as_known),
            Some(local_proto::LocalBrowserAutomationProvider::AgentBrowser)
        );
    }

    fn managed_config(max_concurrent_sessions: u32) -> LocalConfig {
        let managed_computer_id = "44444444-4444-4444-8444-444444444444";
        let device_id = format!("managed-{managed_computer_id}");
        let organization_id = "55555555-5555-4555-8555-555555555555";
        LocalConfig {
            managed_computer: local_proto::LocalManagedComputerConfig {
                managed_computer_id: managed_computer_id.to_string(),
                device_id: device_id.clone(),
                organization_id: organization_id.to_string(),
                credential_file: "/var/lib/briar/worker-credential.json".to_string(),
                ..Default::default()
            }
            .into(),
            projects: vec![LocalProjectConfig {
                id: "11111111-1111-4111-8111-111111111111".to_string(),
                repository_path: "/projects/briar".to_string(),
                api_url: "https://briar.example.com".to_string(),
                execution_worker: LocalExecutionWorkerConfig {
                    device_id,
                    worker_id: "worker-1".to_string(),
                    organization_id: organization_id.to_string(),
                    label: "Managed computer".to_string(),
                    max_concurrent_sessions,
                    ..Default::default()
                }
                .into(),
                ..Default::default()
            }],
            ..default_local_config("https://briar.example.com")
        }
    }

    #[test]
    fn strict_protojson_rejects_unknown_fields_and_zero_concurrency() {
        let valid = serde_json::to_value(managed_config(1)).expect("config should encode");
        let mut unknown = valid.clone();
        unknown
            .as_object_mut()
            .expect("config should be an object")
            .insert("futureRoot".to_string(), serde_json::Value::Bool(true));
        assert!(decode_local_config_json(&unknown.to_string())
            .expect_err("unknown fields must fail")
            .contains("futureRoot"));

        let invalid = serde_json::to_string(&managed_config(0)).expect("config should encode");
        assert!(decode_local_config_json(&invalid)
            .expect_err("zero concurrency must fail")
            .contains("maxConcurrentSessions"));
    }

    #[test]
    fn startup_ports_legacy_domain_json_once_without_masking_corruption() {
        let legacy = serde_json::json!({
            "apiUrl": "https://briar.example.com",
            "userToken": "preserved-user-token",
            "agentProviders": {
                "codex": true,
                "claude": true,
                "cursor": true,
                "grok": true,
                "agy": true,
                "opencode": true,
                "openrouter": true
            },
            "appSettings": {
                "preventSleepWhileRunning": false,
                "browserAutomationProvider": "ego-browser"
            },
            "projects": [{
                "id": "11111111-1111-4111-8111-111111111111",
                "repositoryPath": "/projects/briar",
                "agentToken": "briar_agent_preserved",
                "apiUrl": "https://briar.example.com",
                "llm": {
                    "provider": "codex",
                    "model": "gpt-5",
                    "approvalPolicy": "on-request"
                },
                "autoHunt": {
                    "githubRepositoryId": 9007199254740991_u64,
                    "workflow": {
                        "version": 2,
                        "requirements": [],
                        "stages": [{
                            "id": "build",
                            "label": "Build",
                            "required": true
                        }],
                        "execution": {
                            "checkpoints": [{
                                "key": "before-build",
                                "stage": "build",
                                "position": "before"
                            }]
                        },
                        "completion": { "requiredStages": ["build"] }
                    }
                },
                "activeClaim": {
                    "runId": "22222222-2222-4222-8222-222222222222",
                    "sourceKey": "BRIAR-1",
                    "token": "briar_claim_preserved",
                    "leaseExpiresAt": "2026-09-01T00:00:00Z",
                    "finished": true,
                    "terminalStatus": "completed",
                    "finishedAt": "2026-09-01T00:00:00Z"
                }
            }]
        });
        let directory = tempfile::tempdir().expect("temporary directory should be created");
        let config_path = directory.path().join("config.json");
        let legacy_contents = serde_json::to_string_pretty(&legacy).expect("legacy config encodes");
        fs::write(&config_path, &legacy_contents).expect("legacy config should be written");

        let migrated = read_cli_config(&config_path).expect("legacy config should migrate");
        assert_eq!(migrated.user_token.as_deref(), Some("preserved-user-token"));
        assert_eq!(
            migrated.projects[0].agent_token.as_deref(),
            Some("briar_agent_preserved")
        );

        let canonical_contents =
            fs::read_to_string(&config_path).expect("config should be rewritten");
        decode_local_config_json(&canonical_contents).expect("rewritten config must be strict");
        let canonical: serde_json::Value =
            serde_json::from_str(&canonical_contents).expect("canonical config should be JSON");
        assert_eq!(
            canonical.pointer("/appSettings/browserAutomationProvider"),
            Some(&serde_json::json!(
                "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER"
            ))
        );
        assert_eq!(
            canonical.pointer("/projects/0/llm/provider"),
            Some(&serde_json::json!("AGENT_PROVIDER_CODEX"))
        );
        assert_eq!(
            canonical.pointer("/projects/0/llm/approvalPolicy"),
            Some(&serde_json::json!("LOCAL_APPROVAL_POLICY_ON_REQUEST"))
        );
        assert_eq!(
            canonical.pointer("/projects/0/autoHunt/githubRepositoryId"),
            Some(&serde_json::json!("9007199254740991"))
        );
        assert_eq!(
            canonical.pointer("/projects/0/autoHunt/workflow/execution/checkpoints/0/position"),
            Some(&serde_json::json!("POSITION_BEFORE"))
        );
        assert_eq!(
            canonical.pointer("/projects/0/activeClaim/terminalStatus"),
            Some(&serde_json::json!("LOCAL_CLAIM_TERMINAL_STATUS_COMPLETED"))
        );

        let corrupt_path = directory.path().join("corrupt.json");
        let mut corrupt = legacy;
        corrupt
            .as_object_mut()
            .expect("config should be an object")
            .insert("futureRoot".to_string(), serde_json::Value::Bool(true));
        let corrupt_contents =
            serde_json::to_string_pretty(&corrupt).expect("config should encode");
        fs::write(&corrupt_path, &corrupt_contents).expect("corrupt config should be written");
        assert!(read_cli_config(&corrupt_path)
            .expect_err("unknown fields must remain an error")
            .contains("futureRoot"));
        assert_eq!(
            fs::read_to_string(corrupt_path).expect("corrupt config should remain readable"),
            corrupt_contents
        );
    }
}
