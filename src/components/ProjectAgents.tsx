import {
  Bot,
  CircleAlert,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  createProjectAgent,
  loadProjectAgents,
  updateProjectAgent,
} from "../lib/api";
import {
  agentModels,
  type AgentProvider,
} from "../lib/project-llm";
import { demoProjectAgents } from "../lib/demo-project-agents";
import type {
  CreateProjectAgentInput,
  Project,
  ProjectAgent,
  UpdateProjectAgentInput,
} from "../types";
import { NativeSelect } from "./NativeSelect";

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
};

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<ProjectAgent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const load = token
      ? loadProjectAgents(token, project.id, locale)
      : Promise.resolve(demoProjectAgents(project.id, locale));
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
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  };

  const editAgent = async (input: UpdateProjectAgentInput) => {
    if (!editingAgent) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const updatedAt = new Date().toISOString();
      const agent = token
        ? await updateProjectAgent(token, project.id, editingAgent.id, input)
        : {
            ...editingAgent,
            name: input.name ?? `${providerLabels[input.provider]} Agent`,
            provider: input.provider,
            model: input.model,
            responsibility: input.responsibility,
            updatedAt,
          };
      setAgents((current) =>
        current.map((candidate) =>
          candidate.id === agent.id ? agent : candidate,
        ),
      );
      setIsDialogOpen(false);
      setEditingAgent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateDialog = () => {
    setEditingAgent(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAgent(null);
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
              onClick={openCreateDialog}
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
                <button onClick={openCreateDialog} type="button">
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
                      <button
                        aria-label={t("agents.editAgent", {
                          name: agent.name,
                        })}
                        onClick={() => {
                          setEditingAgent(agent);
                          setIsDialogOpen(true);
                        }}
                        type="button"
                      >
                        <Pencil size={12} />
                        {t("agents.edit")}
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {isDialogOpen && (
        <ProjectAgentDialog
          agent={editingAgent}
          isSubmitting={isSubmitting}
          key={editingAgent?.id ?? "create"}
          onClose={closeDialog}
          onSubmit={editingAgent ? editAgent : addAgent}
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

export function ProjectAgentDialog({
  agent,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  agent: ProjectAgent | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectAgentInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(agent?.name ?? "");
  const [provider, setProvider] = useState<AgentProvider>(
    agent?.provider ?? "codex",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [responsibility, setResponsibility] = useState(
    agent?.responsibility ?? "",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEditing = agent !== null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label={t(
          isEditing ? "agents.editDialog" : "agents.createDialog",
        )}
        aria-modal="true"
        className="project-agent-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!responsibility.trim() || isSubmitting) return;
          setSubmitError(null);
          void onSubmit({
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
            <p className="eyebrow">
              {t(isEditing ? "agents.editEyebrow" : "agents.newEyebrow")}
            </p>
            <h2>
              {t(isEditing ? "agents.editDialog" : "agents.create")}
            </h2>
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
            ) : isEditing ? (
              <Pencil size={14} />
            ) : (
              <Plus size={14} />
            )}
            {isSubmitting
              ? t(isEditing ? "agents.updating" : "agents.creating")
              : t(isEditing ? "common.save" : "agents.create")}
          </button>
        </footer>
      </form>
    </div>
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
  return (
    <ProjectAgentDialog
      agent={null}
      isSubmitting={isSubmitting}
      onClose={onClose}
      onSubmit={onCreate}
    />
  );
}
