import {
  Bot,
  CircleAlert,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  createProjectAgent,
  loadProjectAgents,
} from "../lib/api";
import {
  agentModels,
  type AgentProvider,
} from "../lib/project-llm";
import { defaultProjectAgentCopy } from "../lib/project-agent";
import type {
  CreateProjectAgentInput,
  Project,
  ProjectAgent,
} from "../types";
import { NativeSelect } from "./NativeSelect";

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
};

function demoAgents(
  projectId: string,
  locale: "ko" | "en" | "zh",
): ProjectAgent[] {
  const createdAt = new Date("2026-07-26T09:00:00.000Z").toISOString();
  const defaultAgent = defaultProjectAgentCopy(locale);
  return [
    {
      id: "demo-agent-jay",
      projectId,
      name: defaultAgent.name,
      provider: "codex",
      model: null,
      responsibility: defaultAgent.responsibility,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-sentry",
      projectId,
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      responsibility:
        "Sentry의 에러 내역들을 보고 issue를 만들어서 배정하는 에이전트",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-feedback",
      projectId,
      name: "Feedback 분석 에이전트",
      provider: "grok",
      model: "grok-4.5",
      responsibility:
        "유저 피드백 채널에 들어오는 피드백을 취합하고 분석해서 액션아이템을 만들어 이슈를 만드는 에이전트",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

export function ProjectAgents({
  isSidebarOpen,
  project,
  token,
}: {
  isSidebarOpen: boolean;
  project: Project;
  token: string | null;
}) {
  const { locale, localeTag, t } = useI18n();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const load = token
      ? loadProjectAgents(token, project.id, locale)
      : Promise.resolve(demoAgents(project.id, locale));
    void load
      .then((nextAgents) => {
        if (!cancelled) setAgents(nextAgents);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, project.id, token]);

  const addAgent = async (input: CreateProjectAgentInput) => {
    setIsCreating(true);
    setError(null);
    try {
      const createdAt = new Date().toISOString();
      const agent = token
        ? await createProjectAgent(token, project.id, input)
        : {
            id: crypto.randomUUID(),
            projectId: project.id,
            name: input.name ?? `${providerLabels[input.provider]} Agent`,
            provider: input.provider,
            model: input.model,
            responsibility: input.responsibility,
            createdAt,
            updatedAt: createdAt,
          };
      setAgents((current) => [...current, agent]);
      setIsDialogOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="main-content project-agents-page" id="project-agents">
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
      <div className="project-agents-scroll">
        <section
          aria-labelledby="project-agents-title"
          className="project-agents-content"
        >
          <header className="project-agents-heading">
            <div>
              <p className="eyebrow">
                <Sparkles size={13} />
                {t("agents.eyebrow")}
              </p>
              <h1 id="project-agents-title">{t("agents.title")}</h1>
              <p>{t("agents.description", { project: project.name })}</p>
            </div>
            <button
              className="project-agent-create"
              onClick={() => setIsDialogOpen(true)}
              type="button"
            >
              <Plus size={15} />
              {t("agents.create")}
            </button>
          </header>

          <div className="project-agents-body">
            <header>
              <div>
                <strong>{t("agents.list")}</strong>
                <span>{t("agents.count", { count: agents.length })}</span>
              </div>
              <p>{t("agents.listDescription")}</p>
            </header>

            {error ? (
              <div className="project-agents-state error" role="alert">
                <CircleAlert size={20} />
                <strong>{t("agents.loadFailed")}</strong>
                <p>{error}</p>
              </div>
            ) : isLoading ? (
              <div className="project-agents-state" aria-live="polite">
                <LoaderCircle className="spin" size={21} />
                <strong>{t("agents.loading")}</strong>
              </div>
            ) : agents.length === 0 ? (
              <div className="project-agents-state">
                <span>
                  <Bot size={24} />
                </span>
                <strong>{t("agents.emptyTitle")}</strong>
                <p>{t("agents.emptyDescription")}</p>
                <button onClick={() => setIsDialogOpen(true)} type="button">
                  <Plus size={14} />
                  {t("agents.create")}
                </button>
              </div>
            ) : (
              <div
                aria-label={t("agents.list")}
                className="project-agent-grid"
              >
                {agents.map((agent) => (
                  <article className="project-agent-card" key={agent.id}>
                    <header>
                      <span className={`project-agent-avatar ${agent.provider}`}>
                        <Bot size={19} />
                      </span>
                      <div>
                        <h2>{agent.name}</h2>
                        <span>{t("agents.ready")}</span>
                      </div>
                    </header>
                    <div className="project-agent-runtime">
                      <span>{providerLabels[agent.provider]}</span>
                      <i aria-hidden="true" />
                      <span>
                        {modelLabel(agent, t("agents.providerDefaultModel"))}
                      </span>
                    </div>
                    <section>
                      <small>{t("agents.responsibility")}</small>
                      <p>{agent.responsibility}</p>
                    </section>
                    <footer>
                      <time dateTime={agent.createdAt}>
                        {t("agents.created", {
                          date: new Intl.DateTimeFormat(localeTag, {
                            dateStyle: "medium",
                          }).format(new Date(agent.createdAt)),
                        })}
                      </time>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {isDialogOpen && (
        <CreateProjectAgentDialog
          isSubmitting={isCreating}
          onClose={() => setIsDialogOpen(false)}
          onCreate={addAgent}
        />
      )}
    </main>
  );
}

function modelLabel(agent: ProjectAgent, providerDefault: string) {
  if (!agent.model) return providerDefault;
  return (
    agentModels[agent.provider].find((model) => model.value === agent.model)
      ?.label ?? agent.model
  );
}

export function CreateProjectAgentDialog({
  isSubmitting,
  onClose,
  onCreate,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectAgentInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [model, setModel] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label={t("agents.createDialog")}
        aria-modal="true"
        className="project-agent-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!responsibility.trim() || isSubmitting) return;
          setSubmitError(null);
          void onCreate({
            name: name.trim() || null,
            provider,
            model: model || null,
            responsibility: responsibility.trim(),
          }).catch((caught) => {
            setSubmitError(
              caught instanceof Error ? caught.message : String(caught),
            );
          });
        }}
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">{t("agents.newEyebrow")}</p>
            <h2>{t("agents.create")}</h2>
          </div>
          <button
            aria-label={t("common.close")}
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="project-agent-form">
          <label>
            <span>
              {t("agents.name")} <em>{t("common.optional")}</em>
            </span>
            <input
              autoFocus
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("agents.namePlaceholder")}
              value={name}
            />
          </label>
          <div className="project-agent-form-runtime">
            <label>
              <span>
                {t("agents.provider")} <em>{t("common.required")}</em>
              </span>
              <NativeSelect
                label={t("agents.provider")}
                onValueChange={(value) => {
                  setProvider(value as AgentProvider);
                  setModel("");
                }}
                options={(
                  ["codex", "claude", "grok"] as AgentProvider[]
                ).map((candidate) => ({
                  label: providerLabels[candidate],
                  value: candidate,
                }))}
                value={provider}
              />
            </label>
            <label>
              <span>
                {t("agents.model")} <em>{t("common.required")}</em>
              </span>
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
            <span>
              {t("agents.responsibility")} <em>{t("common.required")}</em>
            </span>
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
          {submitError && (
            <div className="project-agent-form-error" role="alert">
              <CircleAlert size={14} />
              {submitError}
            </div>
          )}
        </div>

        <footer>
          <button disabled={isSubmitting} onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="project-agent-submit"
            disabled={isSubmitting || !responsibility.trim()}
            type="submit"
          >
            {isSubmitting ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Plus size={14} />
            )}
            {isSubmitting ? t("agents.creating") : t("agents.create")}
          </button>
        </footer>
      </form>
    </div>
  );
}
