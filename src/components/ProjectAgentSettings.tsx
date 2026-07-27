import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  agentEfforts,
  agentModels,
  agentProviders,
  defaultAppProviderSettings,
  defaultProjectLlmSettings,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  updateProjectLlmSettings,
  type AgentProvider,
  type AppProviderSettings,
  type ApprovalPolicy,
  type ModelEffort,
} from "../lib/project-llm";
import type {
  Project,
  ProjectAgent,
  UpdateProjectAgentInput,
} from "../types";
import { NativeSelect } from "./NativeSelect";
import { SelectMenu } from "./SelectMenu";

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
};

export function ProjectAgentSettings({
  agent,
  isSidebarOpen,
  onBack,
  onSave,
  project,
}: {
  agent: ProjectAgent;
  isSidebarOpen: boolean;
  onBack: () => void;
  onSave: (input: UpdateProjectAgentInput) => Promise<ProjectAgent>;
  project: Project;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(agent.name);
  const [provider, setProvider] = useState<AgentProvider>(agent.provider);
  const [model, setModel] = useState(agent.model ?? "");
  const [responsibility, setResponsibility] = useState(agent.responsibility);
  const [savedProfile, setSavedProfile] = useState({
    name: agent.name,
    provider: agent.provider,
    model: agent.model ?? "",
    responsibility: agent.responsibility,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [runtimeProvider, setRuntimeProvider] = useState<AgentProvider>(
    defaultProjectLlmSettings.provider,
  );
  const [runtimeModel, setRuntimeModel] = useState<string | null>(
    defaultProjectLlmSettings.model,
  );
  const [runtimeEffort, setRuntimeEffort] = useState<ModelEffort | null>(
    defaultProjectLlmSettings.effort,
  );
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    defaultProjectLlmSettings.approvalPolicy,
  );
  const [savedRuntime, setSavedRuntime] = useState(defaultProjectLlmSettings);
  const [providerAvailability, setProviderAvailability] =
    useState<AppProviderSettings>(defaultAppProviderSettings);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuntimeLoading(true);
    setRuntimeError(null);
    void Promise.all([
      loadProjectLlmSettings(project.id),
      loadAppProviderSettings(),
    ])
      .then(([settings, availability]) => {
        if (cancelled) return;
        setRuntimeProvider(settings.provider);
        setRuntimeModel(settings.model);
        setRuntimeEffort(settings.effort);
        setApprovalPolicy(settings.approvalPolicy);
        setSavedRuntime(settings);
        setProviderAvailability(availability);
      })
      .catch((caught) => {
        if (!cancelled) {
          setRuntimeError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const profileChanged =
    name !== savedProfile.name ||
    provider !== savedProfile.provider ||
    model !== savedProfile.model ||
    responsibility !== savedProfile.responsibility;
  const runtimeChanged =
    runtimeProvider !== savedRuntime.provider ||
    runtimeModel !== savedRuntime.model ||
    runtimeEffort !== savedRuntime.effort ||
    approvalPolicy !== savedRuntime.approvalPolicy;
  const runtimeModels = agentModels[runtimeProvider];
  const runtimeEfforts = agentEfforts[runtimeProvider];
  const selectedRuntimeModelKnown = runtimeModels.some(
    (option) => option.value === (runtimeModel ?? ""),
  );

  const saveProfile = async () => {
    if (!responsibility.trim() || profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const saved = await onSave({
        name: name.trim() || null,
        provider,
        model: model || null,
        responsibility: responsibility.trim(),
      });
      const nextProfile = {
        name: saved.name,
        provider: saved.provider,
        model: saved.model ?? "",
        responsibility: saved.responsibility,
      };
      setName(nextProfile.name);
      setProvider(nextProfile.provider);
      setModel(nextProfile.model);
      setResponsibility(nextProfile.responsibility);
      setSavedProfile(nextProfile);
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProfileSaving(false);
    }
  };

  const saveRuntime = async () => {
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      const saved = await updateProjectLlmSettings(project.id, {
        provider: runtimeProvider,
        model: runtimeModel,
        effort: runtimeEffort,
        approvalPolicy,
      });
      setRuntimeProvider(saved.provider);
      setRuntimeModel(saved.model);
      setRuntimeEffort(saved.effort);
      setApprovalPolicy(saved.approvalPolicy);
      setSavedRuntime(saved);
    } catch (caught) {
      setRuntimeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRuntimeSaving(false);
    }
  };

  return (
    <main
      className="main-content project-agent-settings-page"
      id="project-agent-settings"
    >
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
      <div className="project-agent-settings-scroll">
        <section
          aria-labelledby="project-agent-settings-title"
          className="project-agent-settings-content"
        >
          <button
            className="auto-hunt-session-back project-agent-settings-back"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} />
            {t("agents.back")}
          </button>
          <header className="project-agent-settings-heading">
            <p className="eyebrow">
              <Bot size={13} />
              {t("agents.settingsEyebrow")}
            </p>
            <h1 id="project-agent-settings-title">
              {t("agents.settingsTitle")}
            </h1>
            <p>
              {t("agents.settingsDescription", {
                name: agent.name,
                project: project.name,
              })}
            </p>
          </header>

          <form
            className="project-agent-settings-card"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            <header>
              <span className="project-agent-settings-card-icon">
                <Bot size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("agents.profileTitle")}</strong>
                <small>{t("agents.profileDescription")}</small>
              </span>
            </header>

            <div className="project-agent-settings-fields">
              <label>
                <span>{t("agents.name")}</span>
                <input
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("agents.namePlaceholder")}
                  value={name}
                />
              </label>
              <div className="project-agent-settings-field-grid">
                <label>
                  <span>{t("agents.provider")}</span>
                  <NativeSelect
                    label={t("agents.provider")}
                    onValueChange={(value) => {
                      setProvider(value as AgentProvider);
                      setModel("");
                    }}
                    options={agentProviders.map((candidate) => ({
                      label: providerLabels[candidate],
                      value: candidate,
                    }))}
                    value={provider}
                  />
                </label>
                <label>
                  <span>{t("agents.model")}</span>
                  <NativeSelect
                    label={t("agents.model")}
                    onValueChange={setModel}
                    options={agentModels[provider].map((option) => ({
                      ...option,
                      label:
                        option.value === ""
                          ? t("agents.providerDefaultModel")
                          : option.label,
                    }))}
                    value={model}
                  />
                </label>
              </div>
              <label>
                <span>{t("agents.responsibility")}</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setResponsibility(event.target.value)}
                  placeholder={t("agents.responsibilityPlaceholder")}
                  required
                  rows={6}
                  value={responsibility}
                />
                <small>{t("agents.responsibilityHint")}</small>
              </label>
            </div>

            {profileError ? (
              <p className="project-agent-settings-error" role="alert">
                <CircleAlert size={14} />
                {profileError}
              </p>
            ) : null}
            <footer>
              <button
                className="project-agent-settings-save"
                disabled={
                  profileSaving || !responsibility.trim() || !profileChanged
                }
                type="submit"
              >
                {profileSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !profileChanged ? (
                  <Check size={14} />
                ) : (
                  <Save size={14} />
                )}
                {profileSaving
                  ? t("agents.updating")
                  : !profileChanged
                    ? t("common.saved")
                    : t("agents.saveProfile")}
              </button>
            </footer>
          </form>

          <section className="project-agent-settings-card runtime">
            <header>
              <span className="project-agent-settings-card-icon">
                <ShieldCheck size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("agents.runtimeTitle")}</strong>
                <small>{t("agents.runtimeDescription")}</small>
              </span>
            </header>

            <div className="project-agent-settings-runtime-controls">
              <label htmlFor="project-agent-runtime-provider">
                {t("settings.provider")}
              </label>
              <SelectMenu
                disabled={runtimeLoading || runtimeSaving}
                id="project-agent-runtime-provider"
                label={t("settings.provider")}
                onValueChange={(value) => {
                  setRuntimeProvider(value as AgentProvider);
                  setRuntimeModel(null);
                  setRuntimeEffort(null);
                }}
                options={agentProviders.map((candidate) => ({
                  description: !providerAvailability[candidate]
                    ? t("settings.providerDisabled")
                    : undefined,
                  disabled: !providerAvailability[candidate],
                  label: providerLabels[candidate],
                  value: candidate,
                }))}
                size="small"
                value={runtimeProvider}
              />

              <label htmlFor="project-agent-runtime-model">
                {t("settings.model")}
              </label>
              <SelectMenu
                disabled={runtimeLoading || runtimeSaving}
                id="project-agent-runtime-model"
                label={t("settings.model")}
                onValueChange={(value) => setRuntimeModel(value || null)}
                options={[
                  ...(!selectedRuntimeModelKnown && runtimeModel
                    ? [{ label: runtimeModel, value: runtimeModel }]
                    : []),
                  ...runtimeModels.map((option) => ({
                    label: option.value
                      ? option.label
                      : t("settings.providerDefaultModel"),
                    value: option.value,
                  })),
                ]}
                size="small"
                value={runtimeModel ?? ""}
              />

              <label htmlFor="project-agent-runtime-effort">
                {t("settings.effort")}
              </label>
              <SelectMenu
                disabled={runtimeLoading || runtimeSaving}
                id="project-agent-runtime-effort"
                label={t("settings.effort")}
                onValueChange={(value) =>
                  setRuntimeEffort((value as ModelEffort) || null)}
                options={[
                  {
                    label: t("settings.providerDefaultEffort"),
                    value: "",
                  },
                  ...runtimeEfforts.map((candidate) => ({
                    label: candidate,
                    value: candidate,
                  })),
                ]}
                size="small"
                value={runtimeEffort ?? ""}
              />

              <label htmlFor="project-agent-runtime-approval">
                {t("settings.approvalRequest")}
              </label>
              <SelectMenu
                disabled={runtimeLoading || runtimeSaving}
                id="project-agent-runtime-approval"
                label={t("settings.approvalRequest")}
                onValueChange={(value) =>
                  setApprovalPolicy(value as ApprovalPolicy)}
                options={[
                  {
                    description: t("settings.approvalUntrustedDescription"),
                    label: t("settings.approvalUntrusted"),
                    value: "untrusted",
                  },
                  {
                    description: t("settings.approvalOnRequestDescription"),
                    label: t("settings.approvalOnRequest"),
                    value: "on-request",
                  },
                  {
                    description: t("settings.approvalNeverDescription"),
                    label: t("settings.approvalNever"),
                    value: "never",
                  },
                ]}
                size="small"
                value={approvalPolicy}
              />
            </div>

            <p className="project-agent-settings-runtime-note">
              {t(
                approvalPolicy === "untrusted"
                  ? "settings.approvalUntrustedDescription"
                  : approvalPolicy === "on-request"
                    ? "settings.approvalOnRequestDescription"
                    : "settings.approvalNeverDescription",
              ).replace("Codex", providerLabels[runtimeProvider])}
            </p>
            {runtimeError ? (
              <p className="project-agent-settings-error" role="alert">
                <CircleAlert size={14} />
                {runtimeError}
              </p>
            ) : null}
            <footer>
              <button
                className="project-agent-settings-save"
                disabled={
                  runtimeLoading ||
                  runtimeSaving ||
                  !providerAvailability[runtimeProvider] ||
                  !runtimeChanged
                }
                onClick={() => void saveRuntime()}
                type="button"
              >
                {runtimeSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !runtimeChanged ? (
                  <Check size={14} />
                ) : (
                  <Save size={14} />
                )}
                {runtimeSaving
                  ? t("common.saving")
                  : !runtimeChanged
                    ? t("common.saved")
                    : t("agents.saveRuntime")}
              </button>
            </footer>
          </section>
        </section>
      </div>
    </main>
  );
}
