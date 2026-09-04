use super::*;

#[derive(Deserialize, Serialize)]
pub(super) struct StoredSession {
    pub(super) token: String,
}

#[derive(
    Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type, tauri_specta::Event,
)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "inbox-notification-open")]
pub(super) struct InboxNotificationTarget {
    pub(super) message_id: String,
    pub(super) project_id: String,
    pub(super) target_id: String,
    pub(super) kind: InboxNotificationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) conversation_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) channel_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) root_message_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(super) enum InboxNotificationKind {
    Issue,
    Conversation,
    Session,
    Channel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[serde(rename_all = "snake_case")]
pub(super) enum InboxNotificationPermissionStatus {
    Authorized,
    Denied,
    NotDetermined,
    Unsupported,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "project-llm-progress")]
pub(super) struct ProjectLlmProgressPayload {
    pub(super) request_id: String,
    pub(super) project_id: String,
    pub(super) provider: agent::AgentProviderKind,
    pub(super) event: agent::AgentEvent,
}

#[derive(Default)]
pub(super) struct PendingInboxNotificationOpens(Mutex<VecDeque<InboxNotificationTarget>>);

impl PendingInboxNotificationOpens {
    #[cfg(target_os = "macos")]
    pub(super) fn push(&self, target: InboxNotificationTarget) {
        self.0
            .lock()
            .expect("pending inbox notification opens lock")
            .push_back(target);
    }

    pub(super) fn drain(&self) -> Vec<InboxNotificationTarget> {
        self.0
            .lock()
            .expect("pending inbox notification opens lock")
            .drain(..)
            .collect()
    }
}

#[cfg(desktop)]
#[derive(Default)]
pub(super) struct ExitConfirmationState {
    pub(super) prompt_open: AtomicBool,
}

#[cfg(desktop)]
impl ExitConfirmationState {
    pub(super) fn try_open_prompt(&self) -> bool {
        self.prompt_open
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(super) fn close_prompt(&self) {
        self.prompt_open.store(false, Ordering::Release);
    }
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutoHuntConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) velen_org: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) data_source: Option<String>,
    pub(super) linear_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) linear_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) linear_team: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) github_repository_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) github_repository: Option<String>,
    #[serde(default = "repository_workflow_bootstrap")]
    pub(super) workflow: WorkflowConfig,
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowConfig {
    pub(super) version: u8,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) requirements: Vec<WorkflowRequirementConfig>,
    pub(super) stages: Vec<WorkflowStageConfig>,
    #[serde(default)]
    pub(super) execution: WorkflowExecutionConfig,
    #[serde(default)]
    pub(super) completion: WorkflowCompletionConfig,
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowRequirementConfig {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) kind: WorkflowRequirementKind,
    pub(super) tool: String,
    pub(super) reason: String,
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(super) enum WorkflowRequirementKind {
    Executable,
    Xcode,
    IosSimulator,
    AndroidSdk,
    AndroidEmulator,
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowStageConfig {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) checks: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowCheckpointConfig {
    pub(super) key: String,
    pub(super) stage: String,
    pub(super) position: WorkflowCheckpointPosition,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(super) enum WorkflowCheckpointPosition {
    Before,
    After,
}

#[derive(Clone, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowCompletionConfig {
    #[serde(default)]
    pub(super) required_stages: Vec<String>,
}

#[derive(Clone, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowExecutionConfig {
    #[serde(default)]
    pub(super) checkpoints: Vec<WorkflowCheckpointConfig>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConnectedLocalProject {
    pub(super) repository_path: String,
    pub(super) workflow: WorkflowConfig,
}

/// Why a provider cannot run this project's repository analysis. The vocabulary
/// matches the execution worker's provider health in `src-cli/provider-health.ts`
/// so both surfaces explain an unusable provider the same way.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(super) enum AgentProviderUnavailableReason {
    Disabled,
    NotInstalled,
    NotAuthenticated,
    UsageExhausted,
}

/// One provider the connection screen may offer. `selectable` covers everything
/// the app can act on — install, sign-in and the app settings switch — while an
/// exhausted quota only downgrades the recommendation, because a limit that
/// resets in an hour is the user's call, not a reason to hide the provider.
#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentProviderAvailability {
    pub(super) provider: agent::AgentProviderKind,
    pub(super) enabled: bool,
    pub(super) installed: bool,
    pub(super) authenticated: bool,
    pub(super) selectable: bool,
    pub(super) usage_exhausted: bool,
    #[specta(type = Option<specta_typescript::Number>)]
    pub(super) max_used_percent: Option<f64>,
    pub(super) usage_resets_at: Option<u64>,
    pub(super) reason: Option<AgentProviderUnavailableReason>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalProjectConnectionPreflight {
    pub(super) repository_path: String,
    pub(super) repository_remote: Option<String>,
    pub(super) provider: agent::AgentProviderKind,
    /// Every provider in wire order, so the connection screen can offer a
    /// choice instead of only reporting the one that was resolved.
    pub(super) providers: Vec<AgentProviderAvailability>,
}

pub(super) fn repository_workflow_bootstrap() -> WorkflowConfig {
    WorkflowConfig {
        version: 2,
        requirements: Vec::new(),
        stages: vec![WorkflowStageConfig {
            id: "repository_workflow_pending".to_string(),
            label: "Repository workflow pending".to_string(),
            required: true,
            evidence: Vec::new(),
            checks: Vec::new(),
        }],
        execution: WorkflowExecutionConfig {
            checkpoints: vec![WorkflowCheckpointConfig {
                key: "project-after-repository_workflow_pending".to_string(),
                stage: "repository_workflow_pending".to_string(),
                position: WorkflowCheckpointPosition::After,
            }],
        },
        completion: WorkflowCompletionConfig {
            required_stages: vec!["repository_workflow_pending".to_string()],
        },
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectSandboxSettings {
    pub(super) full_access: bool,
}

impl Default for ProjectSandboxSettings {
    fn default() -> Self {
        Self { full_access: true }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct VelenOrganization {
    pub(super) name: String,
    pub(super) slug: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct VelenSource {
    pub(super) source_key: String,
    pub(super) source_ref: String,
    pub(super) provider: String,
    pub(super) status: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct VelenInspection {
    pub(super) authenticated: bool,
    pub(super) email: Option<String>,
    pub(super) current_org: Option<String>,
    pub(super) organizations: Vec<VelenOrganization>,
    pub(super) sources: Vec<VelenSource>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct OnboardingPrerequisiteStatus {
    pub(super) installed: bool,
    pub(super) version: Option<String>,
    pub(super) authenticated: bool,
}

#[derive(Serialize, specta::Type)]
pub(super) struct OnboardingPrerequisites {
    pub(super) git: OnboardingPrerequisiteStatus,
    pub(super) codex: OnboardingPrerequisiteStatus,
    pub(super) claude: OnboardingPrerequisiteStatus,
    pub(super) cursor: OnboardingPrerequisiteStatus,
    pub(super) grok: OnboardingPrerequisiteStatus,
    pub(super) agy: OnboardingPrerequisiteStatus,
    pub(super) opencode: OnboardingPrerequisiteStatus,
    pub(super) openrouter: OnboardingPrerequisiteStatus,
    pub(super) vertex: OnboardingPrerequisiteStatus,
    pub(super) pi: OnboardingPrerequisiteStatus,
}

impl OnboardingPrerequisites {
    /// The CLI status behind a provider. Exhaustive, so a new provider cannot
    /// be silently left out of onboarding.
    pub(super) fn provider(
        &self,
        provider: agent::AgentProviderKind,
    ) -> &OnboardingPrerequisiteStatus {
        match provider {
            agent::AgentProviderKind::Codex => &self.codex,
            agent::AgentProviderKind::Claude => &self.claude,
            agent::AgentProviderKind::Cursor => &self.cursor,
            agent::AgentProviderKind::Grok => &self.grok,
            agent::AgentProviderKind::Agy => &self.agy,
            agent::AgentProviderKind::Opencode => &self.opencode,
            agent::AgentProviderKind::Openrouter => &self.openrouter,
            agent::AgentProviderKind::Vertex => &self.vertex,
            agent::AgentProviderKind::Pi => &self.pi,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentProviderModel {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) is_default: bool,
    pub(super) default_effort_id: Option<String>,
    pub(super) efforts: Vec<AgentProviderEffort>,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentProviderEffort {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) description: Option<String>,
    pub(super) is_default: bool,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentProviderModelCatalogEntry {
    pub(super) models: Vec<AgentProviderModel>,
    pub(super) default_efforts: Vec<AgentProviderEffort>,
    pub(super) allow_custom_models: bool,
    pub(super) error: Option<String>,
}

#[derive(Serialize, specta::Type)]
pub(super) struct AgentProviderModelCatalog {
    pub(super) codex: AgentProviderModelCatalogEntry,
    pub(super) claude: AgentProviderModelCatalogEntry,
    pub(super) cursor: AgentProviderModelCatalogEntry,
    pub(super) grok: AgentProviderModelCatalogEntry,
    pub(super) agy: AgentProviderModelCatalogEntry,
    pub(super) opencode: AgentProviderModelCatalogEntry,
    pub(super) openrouter: AgentProviderModelCatalogEntry,
    pub(super) vertex: AgentProviderModelCatalogEntry,
    pub(super) pi: AgentProviderModelCatalogEntry,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct OpenCodeTerminalPathStatus {
    pub(super) supported: bool,
    pub(super) configured: bool,
    pub(super) binary_path: Option<String>,
    pub(super) config_path: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentBrowserStatus {
    pub(super) supported: bool,
    pub(super) installed: bool,
    pub(super) browser_ready: bool,
    pub(super) version: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct EgoBrowserStatus {
    pub(super) supported: bool,
    pub(super) installed: bool,
    pub(super) browser_ready: bool,
    pub(super) version: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AsideBrowserStatus {
    pub(super) supported: bool,
    pub(super) installed: bool,
    pub(super) cli_ready: bool,
    pub(super) mcp_ready: bool,
    pub(super) skill_ready: bool,
    pub(super) browser_ready: bool,
    pub(super) version: Option<String>,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositoryReadiness {
    pub(super) repository_path: String,
    pub(super) git_installed: bool,
    pub(super) git_version: Option<String>,
    pub(super) repository_healthy: bool,
    pub(super) remote: Option<String>,
    pub(super) remote_reachable: bool,
    pub(super) push_access: bool,
    pub(super) requires_github: bool,
    pub(super) github_repository_id: Option<u64>,
    pub(super) github_repository: Option<String>,
    pub(super) gh_installed: bool,
    pub(super) gh_version: Option<String>,
    pub(super) gh_authenticated: bool,
    pub(super) gh_account: Option<String>,
    pub(super) github_write_access: bool,
    pub(super) git_ready: bool,
    pub(super) pr_ready: bool,
    pub(super) issues: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub(super) enum LovableStack {
    TanstackStart,
    ViteReact,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(super) enum LovablePackageManager {
    Bun,
    Npm,
    Pnpm,
    Yarn,
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectGithubCredential {
    pub(super) project: ProjectGithubCredentialProject,
    pub(super) repository: ProjectGithubCredentialRepository,
    pub(super) username: String,
    pub(super) password: String,
    pub(super) expires_at: String,
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectGithubCredentialProject {
    pub(super) id: String,
    pub(super) organization_id: String,
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectGithubCredentialRepository {
    pub(super) id: u64,
    pub(super) full_name: String,
    pub(super) clone_url: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreparedProjectRepository {
    pub(super) repository_path: String,
    pub(super) repository_id: u64,
    pub(super) repository: String,
    pub(super) reused: bool,
    pub(super) completed_steps: Vec<String>,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct LovableRepositoryCompatibility {
    pub(super) compatible: bool,
    pub(super) stack: Option<LovableStack>,
    pub(super) package_manager: Option<LovablePackageManager>,
    pub(super) scripts: Vec<String>,
    pub(super) issues: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutoHuntHealth {
    pub(super) project_id: String,
    pub(super) healthy: bool,
    pub(super) repository_path: Option<String>,
    pub(super) repository_remote: Option<String>,
    pub(super) repository_healthy: bool,
    pub(super) cli_path: String,
    pub(super) cli_installed: bool,
    pub(super) cli_version: Option<String>,
    pub(super) cli_expected_version: String,
    pub(super) cli_current: bool,
    pub(super) skill_path: String,
    pub(super) skill_installed: bool,
    pub(super) skill_version: Option<String>,
    pub(super) skill_expected_version: String,
    pub(super) skill_current: bool,
    pub(super) velen_org: Option<String>,
    pub(super) velen_authenticated: bool,
    pub(super) velen_email: Option<String>,
    pub(super) velen_healthy: bool,
    pub(super) requirements: Vec<WorkflowRequirementHealth>,
    pub(super) issues: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkflowRequirementHealth {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) kind: WorkflowRequirementKind,
    pub(super) tool: String,
    pub(super) reason: String,
    pub(super) healthy: bool,
    pub(super) detail: String,
}

#[derive(Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalExecutionWorkerStatus {
    pub(super) project_id: String,
    pub(super) registered: bool,
    pub(super) worker_id: Option<String>,
    pub(super) device_id: Option<String>,
    pub(super) label: Option<String>,
    pub(super) max_concurrent_sessions: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub(super) enum BrowserAutomationProvider {
    #[default]
    EgoBrowser,
    AgentBrowser,
    Aside,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserAutomationSettings {
    pub(super) provider: BrowserAutomationProvider,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AppRuntimeSettings {
    pub(super) prevent_sleep_while_running: bool,
    pub(super) prevent_sleep_supported: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AppRuntimeSettingsUpdate {
    pub(super) prevent_sleep_while_running: bool,
}

impl From<LocalAppSettings> for AppRuntimeSettings {
    fn from(settings: LocalAppSettings) -> Self {
        Self {
            prevent_sleep_while_running: settings.prevent_sleep_while_running,
            prevent_sleep_supported: cfg!(target_os = "macos"),
        }
    }
}

pub(super) struct SleepPreventionState {
    pub(super) enabled: AtomicBool,
    #[cfg(target_os = "macos")]
    pub(super) process: Mutex<Option<Child>>,
}

#[derive(Clone, Default)]
pub(super) struct AgentSessionCancellationState {
    pub(super) sessions: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

pub(super) struct AgentSessionCancellation {
    pub(super) session_id: String,
    pub(super) cancelled: Arc<AtomicBool>,
    pub(super) sessions: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

impl AgentSessionCancellationState {
    pub(super) fn register(&self, session_id: &str) -> Result<AgentSessionCancellation, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "에이전트 세션 중단 상태 잠금이 손상되었습니다.".to_string())?;
        if sessions.contains_key(session_id) {
            return Err("같은 ID의 에이전트 세션이 이미 실행 중입니다.".to_string());
        }
        sessions.insert(session_id.to_string(), Arc::clone(&cancelled));
        Ok(AgentSessionCancellation {
            session_id: session_id.to_string(),
            cancelled,
            sessions: Arc::clone(&self.sessions),
        })
    }

    pub(super) fn stop(&self, session_id: &str) -> Result<bool, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "에이전트 세션 중단 상태 잠금이 손상되었습니다.".to_string())?;
        let Some(cancelled) = sessions.get(session_id) else {
            return Ok(false);
        };
        cancelled.store(true, Ordering::SeqCst);
        Ok(true)
    }

    pub(super) fn active_session_ids(&self) -> Result<Vec<String>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "에이전트 세션 중단 상태 잠금이 손상되었습니다.".to_string())?;
        Ok(sessions.keys().cloned().collect())
    }
}

impl AgentSessionCancellation {
    pub(super) fn signal(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

impl Drop for AgentSessionCancellation {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if sessions
                .get(&self.session_id)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancelled))
            {
                sessions.remove(&self.session_id);
            }
        }
    }
}

pub(super) fn ensure_agent_session_running(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err(AGENT_SESSION_STOPPED_ERROR.to_string())
    } else {
        Ok(())
    }
}

impl Default for SleepPreventionState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            #[cfg(target_os = "macos")]
            process: Mutex::new(None),
        }
    }
}

impl SleepPreventionState {
    pub(super) fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.enabled.store(enabled, Ordering::SeqCst);
        self.refresh()
    }

    fn refresh(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let mut process = self
                .process
                .lock()
                .map_err(|_| "절전 방지 상태 잠금이 손상되었습니다.".to_string())?;
            if self.enabled.load(Ordering::SeqCst) {
                if process
                    .as_mut()
                    .is_some_and(|child| child.try_wait().is_ok_and(|status| status.is_none()))
                {
                    return Ok(());
                }
                if let Some(mut child) = process.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let app_process_id = std::process::id().to_string();
                *process = Some(
                    Command::new("/usr/bin/caffeinate")
                        .args(["-i", "-w", &app_process_id])
                        .spawn()
                        .map_err(|error| {
                            format!("macOS 절전 방지를 시작하지 못했습니다: {error}")
                        })?,
                );
            } else if let Some(mut child) = process.take() {
                child
                    .kill()
                    .map_err(|error| format!("macOS 절전 방지를 중지하지 못했습니다: {error}"))?;
                let _ = child.wait();
            }
        }
        Ok(())
    }
}

impl Drop for SleepPreventionState {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        if let Ok(process) = self.process.get_mut() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct OpenRouterCredentialStatus {
    pub(super) configured: bool,
}

/// Vertex AI addressing the settings screen shows back to the user. Neither
/// field is a secret: the credential is the machine's Application Default
/// Credentials, which Briar never reads or stores.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct VertexAiCredentialStatus {
    pub(super) configured: bool,
    pub(super) project_id: Option<String>,
    pub(super) location: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct AppProviderSettings {
    pub(super) codex: bool,
    pub(super) claude: bool,
    pub(super) cursor: bool,
    pub(super) grok: bool,
    pub(super) agy: bool,
    pub(super) opencode: bool,
    pub(super) openrouter: bool,
    pub(super) vertex: bool,
    pub(super) pi: bool,
}

impl From<LocalAgentProviderSettings> for AppProviderSettings {
    fn from(settings: LocalAgentProviderSettings) -> Self {
        Self {
            codex: settings.codex,
            claude: settings.claude,
            cursor: settings.cursor,
            grok: settings.grok,
            agy: settings.agy,
            opencode: settings.opencode,
            openrouter: settings.openrouter,
            vertex: settings.vertex,
            pi: settings.pi,
        }
    }
}

impl From<AppProviderSettings> for LocalAgentProviderSettings {
    fn from(settings: AppProviderSettings) -> Self {
        Self {
            codex: settings.codex,
            claude: settings.claude,
            cursor: settings.cursor,
            grok: settings.grok,
            agy: settings.agy,
            opencode: settings.opencode,
            openrouter: settings.openrouter,
            vertex: settings.vertex,
            pi: settings.pi,
            ..Default::default()
        }
    }
}

pub(super) fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(SESSION_FILE_NAME))
}

pub(super) fn read_session_token_from(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Briar 로그인 세션을 읽지 못했습니다: {error}"))?;
    let session = serde_json::from_str::<StoredSession>(&contents)
        .map_err(|error| format!("Briar 로그인 세션이 손상되었습니다: {error}"))?;
    if session.token.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(session.token))
}

pub(super) fn write_session_token_to(path: &Path, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("session token cannot be empty".to_string());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Briar 설정 폴더를 찾을 수 없습니다.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Briar 설정 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Briar 설정 폴더 권한을 지정하지 못했습니다: {error}"))?;
    }

    let temporary_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec(&StoredSession { token })
        .map_err(|error| format!("Briar 로그인 세션을 만들지 못했습니다: {error}"))?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .map_err(|error| format!("Briar 로그인 세션을 열지 못했습니다: {error}"))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Briar 로그인 세션을 저장하지 못했습니다: {error}"))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("Briar 로그인 세션을 교체하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Briar 로그인 세션 권한을 지정하지 못했습니다: {error}"))?;
    }
    Ok(())
}

pub(super) fn clear_session_token_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Briar 로그인 세션을 삭제하지 못했습니다: {error}")),
    }
}

#[tauri::command]
#[specta::specta]
pub(super) fn read_session_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_session_token_from(&session_file_path(&app)?)
}

#[tauri::command]
#[specta::specta]
pub(super) fn write_session_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    write_session_token_to(&session_file_path(&app)?, token)
}

#[tauri::command]
#[specta::specta]
pub(super) fn clear_session_token(app: tauri::AppHandle) -> Result<(), String> {
    clear_session_token_at(&session_file_path(&app)?)
}

#[tauri::command]
#[specta::specta]
pub(super) fn set_app_badge_count(window: tauri::Window, count: u32) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = (window, count);
        return Ok(());
    }
    #[cfg(desktop)]
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| format!("App badge count update failed: {error}"))
}

#[cfg(test)]
mod tests;
