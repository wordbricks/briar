import {
  Bot,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  createProjectAgent,
  deleteProjectAgent,
  loadProjectAgents,
  updateProjectAgent,
} from "../lib/api";
import {
  agentEfforts,
  agentModels,
  agentProviderLabels,
  agentProviders,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
import { demoProjectAgents } from "../lib/demo-project-agents";
import { handleFromName } from "../lib/channels-contract";
import {
  agentWithSkillRuntime,
  defaultProjectAgentCalendarColor,
  projectAgentSkill,
} from "../lib/project-agent";
import {
  executeProjectAgentTask,
  type ProjectAgentTaskSessionSettlement,
  type ProjectAgentTaskSessionStart,
} from "../lib/project-agent-execution";
import { runProjectAgent } from "../lib/project-llm";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import type {
  CreateProjectAgentInput,
  DashboardPayload,
  HuntRun,
  Project,
  ProjectAgent,
  ProjectAgentSkillInput,
  UpdateProjectAgentInput,
} from "../types";
import { AgentProviderIcon } from "./AgentIcons";
import { NativeSelect } from "./NativeSelect";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";
import { ProjectAgentDetail } from "./ProjectAgentDetail";
import { ProjectAgentSettings } from "./ProjectAgentSettings";
import {
  ProjectAgentTaskDialog,
  type ProjectAgentTaskDialogSubmit,
} from "./ProjectAgentTaskDialog";

export function ProjectAgents({
  companionMode = false,
  dashboard,
  error: appError,
  isSidebarOpen,
  onIssueOpen,
  onRequestedSessionOpen,
  onSettleTaskSession,
  onStopSession,
  onStart,
  onStartRemoteTask,
  onStartTaskSession,
  project,
  requestedSessionId = null,
  sessions,
  token,
}: {
  companionMode?: boolean;
  dashboard: DashboardPayload | null;
  error: string | null;
  isSidebarOpen: boolean;
  onIssueOpen: (runId: string) => void;
  onRequestedSessionOpen?: () => void;
  onSettleTaskSession: (
    sessionId: string,
    settlement: ProjectAgentTaskSessionSettlement,
  ) => void;
  onStopSession: (sessionId: string) => Promise<boolean>;
  onStart: (
    agent: ProjectAgent,
    runs: HuntRun[],
    options?: {
      coordinatorConversationId?: string | null;
      parentSessionId?: string;
      maxIssues?: number;
      targetRunIds?: string[];
      retryReason?: string | null;
    },
  ) => string | Promise<string>;
  onStartRemoteTask?: (
    agent: ProjectAgent,
    input: { request: string; workerId: string; skillId: string },
  ) => string | Promise<string>;
  onStartTaskSession: (
    agent: ProjectAgent,
    session: ProjectAgentTaskSessionStart,
  ) => void;
  project: Project;
  requestedSessionId?: string | null;
  sessions: AutoHuntSession[];
  token: string | null;
}) {
  const { locale, localeTag, t } = useI18n();
  const { toast } = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [settingsAgent, setSettingsAgent] = useState<ProjectAgent | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<ProjectAgent | null>(null);
  const [taskDialogAgent, setTaskDialogAgent] =
    useState<ProjectAgent | null>(null);
  const [startingAgentIds, setStartingAgentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appError) return;
    toast(appError, { tone: "error" });
  }, [appError, toast]);
  const runningAgentIds = useMemo(
    () =>
      new Set(
        sessions
          .filter(
            (session) =>
              session.projectId === project.id &&
              session.status === "running" &&
              session.agentId,
          )
          .map((session) => session.agentId as string),
      ),
    [project.id, sessions],
  );
  useMobileBackHandler(
    () => {
      if (!companionMode) return false;
      if (taskDialogAgent) {
        setTaskDialogAgent(null);
        return true;
      }
      if (isDialogOpen) {
        setIsDialogOpen(false);
        return true;
      }
      if (settingsAgent) {
        setSettingsAgent(null);
        return true;
      }
      if (selectedAgent) {
        setSelectedAgent(null);
        return true;
      }
      return false;
    },
    { enabled: companionMode, priority: 150 },
  );

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

  useEffect(() => {
    setSelectedAgent(null);
    setSettingsAgent(null);
    setTaskDialogAgent(null);
  }, [project.id]);

  useEffect(() => {
    if (!requestedSessionId || agents.length === 0) return;
    const requestedSession = sessions.find(
      (session) =>
        session.projectId === project.id &&
        session.id === requestedSessionId,
    );
    if (!requestedSession) return;
    const agent = agents.find(
      (candidate) => candidate.id === requestedSession.agentId,
    );
    if (!agent) return;
    setSelectedAgent(agent);
  }, [agents, project.id, requestedSessionId, sessions]);

  const addAgent = async (input: CreateProjectAgentInput) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const createdAt = new Date().toISOString();
      const agent = token
        ? await createProjectAgent(token, project.id, input)
        : localProjectAgent(input, project.id, createdAt);
      setAgents((current) => [...current, agent]);
      setIsDialogOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const editAgent = async (
    agent: ProjectAgent,
    input: UpdateProjectAgentInput,
  ) => {
    setError(null);
    const updatedAt = new Date().toISOString();
    const updated = token
      ? await updateProjectAgent(token, project.id, agent.id, input)
      : {
          ...agent,
          name: input.name ?? `${agentProviderLabels[input.provider]} Agent`,
          avatar:
            input.avatar === undefined ? agent.avatar : input.avatar,
          codexPet:
            input.codexPet === undefined ? agent.codexPet : input.codexPet,
          provider: input.provider,
          model: input.model,
          effort:
            input.effort === undefined ? agent.effort : input.effort,
          responsibility: input.responsibility,
          skills: localProjectAgentSkills(
            agent.id,
            input.skills,
            updatedAt,
            agent.skills,
          ),
          skill: projectAgentSkill({
            name: input.name ?? `${agentProviderLabels[input.provider]} Agent`,
            responsibility: input.responsibility,
          }),
          updatedAt,
        };
    setAgents((current) =>
      current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    );
    setSelectedAgent((current) =>
      current?.id === updated.id ? updated : current
    );
    setSettingsAgent(updated);
    return updated;
  };

  const removeAgent = async (agent: ProjectAgent) => {
    setError(null);
    if (token) {
      await deleteProjectAgent(token, project.id, agent.id);
    }
    setAgents((current) =>
      current.filter((candidate) => candidate.id !== agent.id),
    );
    setSelectedAgent((current) =>
      current?.id === agent.id ? null : current,
    );
    setSettingsAgent((current) =>
      current?.id === agent.id ? null : current,
    );
  };

  const openCreateDialog = () => {
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
  };

  const runTask = async (
    agent: ProjectAgent,
    input: ProjectAgentTaskDialogSubmit,
  ) => {
    if (
      !dashboard ||
      startingAgentIds.has(agent.id)
    ) {
      return;
    }
    setStartingAgentIds((current) => new Set(current).add(agent.id));
    try {
      if (input.workerId) {
        if (!onStartRemoteTask) {
          throw new Error(t("agents.selectRunnableWorker"));
        }
        await onStartRemoteTask(agent, {
          request: input.request,
          workerId: input.workerId,
          skillId: input.skill.id,
        });
        return;
      }
      const runtimeAgent = agentWithSkillRuntime(agent, input.skill);
      await executeProjectAgentTask(
        {
          runAgent: runProjectAgent,
          startSession: (session) => {
            onStartTaskSession(runtimeAgent, session);
            setStartingAgentIds((current) => {
              const next = new Set(current);
              next.delete(agent.id);
              return next;
            });
          },
          settleSession: onSettleTaskSession,
          startAutoHunt: (runs, options) =>
            onStart(runtimeAgent, runs, options),
        },
        {
          agent: runtimeAgent,
          dashboard,
          message: input.request,
          skillId: input.skill.id,
        },
      );
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : String(caught),
        { tone: "error" },
      );
    } finally {
      setStartingAgentIds((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
    }
  };

  if (settingsAgent) {
    return (
      <ProjectAgentSettings
        agent={settingsAgent}
        isDeleteDisabled={runningAgentIds.has(settingsAgent.id)}
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSettingsAgent(null)}
        onDelete={() => removeAgent(settingsAgent)}
        onSave={(input) => editAgent(settingsAgent, input)}
        project={project}
      />
    );
  }

  if (selectedAgent) {
    return (
      <ProjectAgentDetail
        agent={selectedAgent}
        companionMode={companionMode}
        dashboard={dashboard}
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSelectedAgent(null)}
        onIssueOpen={onIssueOpen}
        onRequestedSessionOpen={onRequestedSessionOpen}
        onStartRemoteTask={
          onStartRemoteTask
            ? (input) => onStartRemoteTask(selectedAgent, input)
            : undefined
        }
        onSettleTaskSession={onSettleTaskSession}
        onStopSession={onStopSession}
        onStartAutoHunt={(runs, options) =>
          onStart(selectedAgent, runs, options)}
        onStartTaskSession={(session) =>
          onStartTaskSession(selectedAgent, session)}
        requestedSessionId={requestedSessionId}
        isStarting={startingAgentIds.has(selectedAgent.id)}
        sessions={sessions}
        token={token}
      />
    );
  }

  return (
    <MainContent className="project-agents-page" id="project-agents">
      {companionMode ? (
        <div className="project-agents-companion-actions">
          <Button
            className="project-agent-create"
            onClick={openCreateDialog}
            type="button"
          >
            <Plus size={16} />
            {t("agents.create")}
          </Button>
        </div>
      ) : (
        <PageHeader
          action={
            <Button
              className="project-agent-create"
              onClick={openCreateDialog}
              type="button"
            >
              <Plus size={16} />
              {t("agents.create")}
            </Button>
          }
          className={`app-page-header project-agents-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
          data-tauri-drag-region
          title={t("agents.title")}
          titleId="project-agents-title"
        />
      )}
      <div className="project-agents-scroll">
        <section
          aria-label={companionMode ? t("agents.title") : undefined}
          aria-labelledby={companionMode ? undefined : "project-agents-title"}
          className="project-agents-content"
        >
          <div className="project-agents-body">
            <header>
              <div>
                <Typography as="strong" variant="body">
                  {t("agents.list")}
                </Typography>
                <Typography as="span" tone="muted" variant="caption">
                  {t("agents.count", { count: agents.length })}
                </Typography>
              </div>
            </header>

            {error ? (
              <div className="project-agents-state error" role="alert">
                <CircleAlert size={20} />
                <Typography as="strong" variant="body">
                  {t("agents.loadFailed")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {error}
                </Typography>
              </div>
            ) : isLoading ? (
              <div className="project-agents-state" aria-live="polite">
                <LoaderCircle className="spin" size={21} />
                <Typography as="strong" variant="body">
                  {t("agents.loading")}
                </Typography>
              </div>
            ) : agents.length === 0 ? (
              <EmptyState
                action={
                  <Button onClick={openCreateDialog} type="button">
                    <Plus size={14} />
                    {t("agents.create")}
                  </Button>
                }
                className="project-agents-state"
                description={t("agents.emptyDescription")}
                icon={<Bot size={24} />}
                title={t("agents.emptyTitle")}
              />
            ) : (
              <div
                aria-label={t("agents.list")}
                className="project-agent-grid"
              >
                {agents.map((agent) => {
                  const isStarting = startingAgentIds.has(agent.id);
                  const isRunning =
                    runningAgentIds.has(agent.id) ||
                    isStarting;
                  return (
                    <article className="project-agent-card" key={agent.id}>
                      <button
                        aria-label={t("agents.openAgent", { name: agent.name })}
                        className="project-agent-card-open"
                        onClick={() => setSelectedAgent(agent)}
                        type="button"
                      >
                        <header>
                          <ProjectAgentAvatar
                            agent={agent}
                            isRunning={isRunning}
                            token={token}
                          />
                          <div>
                            <h2>{agent.name}</h2>
                            <span>
                              {t(isRunning ? "agents.running" : "agents.ready")}
                            </span>
                          </div>
                        </header>
                        <div className="project-agent-runtime">
                          <span
                            aria-label={agentProviderLabels[agent.provider]}
                            className={`project-agent-provider-icon ${agent.provider}`}
                            role="img"
                            title={agentProviderLabels[agent.provider]}
                          >
                            <AgentProviderIcon
                              provider={agent.provider}
                              size={14}
                            />
                          </span>
                          <span>
                            {modelLabel(
                              agent,
                              t("agents.providerDefaultModel"),
                            )}
                          </span>
                          <span>
                            <i
                              aria-hidden="true"
                              className="project-agent-calendar-color"
                              style={{ backgroundColor: agent.calendarColor }}
                            />
                            {agent.calendarColor.toUpperCase()}
                          </span>
                        </div>
                        <section>
                          <small>{t("agents.responsibility")}</small>
                          <p>{agent.responsibility}</p>
                          <div className="project-agent-card-skills">
                            <small>{t("agents.skills")}</small>
                            <ul>
                              {agent.skills.slice(0, 3).map((skill) => (
                                <li
                                  key={skill.id}
                                  title={skill.instructions}
                                >
                                  {skill.name}
                                </li>
                              ))}
                              {agent.skills.length > 3 ? (
                                <li>
                                  {t("agents.moreSkills", {
                                    count: agent.skills.length - 3,
                                  })}
                                </li>
                              ) : null}
                            </ul>
                          </div>
                        </section>
                      </button>
                      <footer>
                        <time dateTime={agent.createdAt}>
                          {t("agents.created", {
                            date: new Intl.DateTimeFormat(localeTag, {
                              dateStyle: "medium",
                            }).format(new Date(agent.createdAt)),
                          })}
                        </time>
                        <button
                          aria-label={t("agents.runAgent", {
                            name: agent.name,
                          })}
                          className="project-agent-run-button"
                          disabled={
                            isStarting ||
                            !dashboard ||
                            agent.skills.length === 0
                          }
                          onClick={() => {
                            setTaskDialogAgent(agent);
                          }}
                          title={t("agents.runAgent", { name: agent.name })}
                          type="button"
                        >
                          {isStarting ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="spin"
                              size={14}
                            />
                          ) : (
                            <Play
                              aria-hidden="true"
                              fill="currentColor"
                              size={14}
                            />
                          )}
                        </button>
                        <button
                          aria-label={t("agents.settingsAgent", {
                            name: agent.name,
                          })}
                          className="project-agent-settings-button"
                          onClick={() => setSettingsAgent(agent)}
                          type="button"
                        >
                          <Settings size={14} />
                        </button>
                        <ChevronRight aria-hidden="true" size={14} />
                      </footer>
                    </article>
                  );
                })}
                <button
                  className="project-agent-create-card"
                  onClick={openCreateDialog}
                  type="button"
                >
                  <span>
                    <Plus aria-hidden="true" size={20} />
                  </span>
                  <strong>{t("agents.create")}</strong>
                  <p>{t("agents.createDescription")}</p>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {isDialogOpen && (
        <ProjectAgentDialog
          agent={null}
          isSubmitting={isSubmitting}
          key="create"
          onClose={closeDialog}
          onSubmit={addAgent}
        />
      )}
      <ProjectAgentTaskDialog
        agent={taskDialogAgent}
        dashboard={dashboard}
        isOpen={taskDialogAgent !== null}
        isSubmitting={
          taskDialogAgent
            ? startingAgentIds.has(taskDialogAgent.id)
            : false
        }
        onOpenChange={(open) => {
          if (!open) {
            setTaskDialogAgent(null);
          }
        }}
        onSubmit={(input) => {
          if (!taskDialogAgent) return;
          return runTask(taskDialogAgent, input);
        }}
        workerSelectionRequired={Boolean(onStartRemoteTask)}
      />
    </MainContent>
  );
}
function modelLabel(
  agent: Pick<ProjectAgent, "provider" | "model">,
  providerDefault: string,
) {
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
  const [handle, setHandle] = useState(
    agent?.handle ?? handleFromName(agent?.name ?? ""),
  );
  const [isHandleCustomized, setIsHandleCustomized] = useState(agent !== null);
  const [provider, setProvider] = useState<AgentProvider>(
    agent?.provider ?? "codex",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [effort, setEffort] = useState<ModelEffort | null>(
    agent?.effort ?? null,
  );
  const [responsibility, setResponsibility] = useState(
    agent?.responsibility ?? "",
  );
  const [calendarColor, setCalendarColor] = useState(
    agent?.calendarColor ?? defaultProjectAgentCalendarColor,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEditing = agent !== null;
  const generatedHandle = useMemo(() => handleFromName(name), [name]);
  const handleValid =
    !handle || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(handle);

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
          if (!responsibility.trim() || !handleValid || isSubmitting) return;
          setSubmitError(null);
          void onSubmit({
            name: name.trim() || null,
            handle: handle || undefined,
            provider,
            model: model || null,
            effort,
            responsibility: responsibility.trim(),
            calendarColor,
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
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!isHandleCustomized) setHandle(handleFromName(nextName));
              }}
              placeholder={t("agents.namePlaceholder")}
              value={name}
            />
          </label>
          <label>
            <span>{t("agents.handle")}</span>
            <div className="project-agent-handle-input">
              <span>@</span>
              <input
                maxLength={63}
                onChange={(event) => {
                  setIsHandleCustomized(true);
                  setHandle(event.target.value.toLowerCase());
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder={generatedHandle || t("agents.handleGenerated")}
                value={handle}
              />
            </div>
            <small>
              {name.trim() && !generatedHandle && !handle
                ? t("agents.handleFallback")
                : t("agents.handleHint")}
            </small>
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
                  setEffort(null);
                }}
                options={agentProviders.map((candidate) => ({
                  label: agentProviderLabels[candidate],
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
            <label>
              <span>
                {t("agents.effort")} <em>{t("common.optional")}</em>
              </span>
              <NativeSelect
                label={t("agents.effort")}
                onValueChange={(value) =>
                  setEffort((value || null) as ModelEffort | null)
                }
                options={[
                  {
                    label: t("agents.providerDefaultEffort"),
                    value: "",
                  },
                  ...agentEfforts[provider].map((candidate) => ({
                    label: candidate,
                    value: candidate,
                  })),
                ]}
                value={effort ?? ""}
              />
            </label>
          </div>
          <small className="project-agent-form-runtime-hint">
            {t("agents.skillDefaultsHint")}
          </small>
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
          <label className="project-agent-color-field">
            <span>
              {t("agents.calendarColor")} <em>{t("common.required")}</em>
            </span>
            <div>
              <input
                aria-label={t("agents.calendarColor")}
                onChange={(event) => setCalendarColor(event.target.value)}
                type="color"
                value={calendarColor}
              />
              <code>{calendarColor.toUpperCase()}</code>
            </div>
            <small>{t("agents.calendarColorHint")}</small>
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
            disabled={isSubmitting || !responsibility.trim() || !handleValid}
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

function localProjectAgent(
  input: CreateProjectAgentInput,
  projectId: string,
  createdAt: string,
): ProjectAgent {
  const id = crypto.randomUUID();
  const name = input.name ?? `${agentProviderLabels[input.provider]} Agent`;
  const initialSkills: ProjectAgentSkillInput[] = [
    {
      name,
      instructions: input.responsibility,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      kind: "custom",
      position: 0,
    },
  ];
  return {
    id,
    projectId,
    handle: input.handle ?? (handleFromName(name) || null),
    name,
    avatar: input.avatar ?? null,
    codexPet: null,
    provider: input.provider,
    model: input.model,
    effort: input.effort ?? null,
    responsibility: input.responsibility,
    skill: projectAgentSkill({ name, responsibility: input.responsibility }),
    skills: localProjectAgentSkills(
      id,
      input.skills?.length ? input.skills : initialSkills,
      createdAt,
      [],
    ),
    calendarColor: input.calendarColor,
    createdAt,
    updatedAt: createdAt,
  };
}

function localProjectAgentSkills(
  agentId: string,
  inputs: readonly ProjectAgentSkillInput[],
  updatedAt: string,
  existing: readonly ProjectAgent["skills"][number][],
): ProjectAgent["skills"] {
  return inputs.map((input, position) => {
    const current = input.id
      ? existing.find((skill) => skill.id === input.id)
      : null;
    return {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      agentId,
      position,
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt,
    };
  });
}
