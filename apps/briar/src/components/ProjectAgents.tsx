import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, MainContent, PageHeader } from "@/components/layout";
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
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
} from "../lib/agent-limits";
import {
  projectAgentTemplates,
  projectAgentTemplateSkillInputs,
  type ProjectAgentTemplate,
} from "../lib/agent-templates";
import {
  agentEffortOptions,
  agentModelDisplayName,
  agentModelOptions,
  agentProviderLabels,
  type AgentProvider,
  type AgentProviderModelCatalog,
  type ModelEffort,
} from "../lib/project-llm";
import { demoProjectAgents } from "../lib/demo-project-agents";
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
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import type {
  CreateProjectAgentInput,
  DashboardPayload,
  ExecutionWorker,
  HuntRun,
  Project,
  ProjectAgent,
  ProjectAgentSkillInput,
  ProjectExecutionWorkerPolicy,
  UpdateProjectAgentInput,
} from "../types";
import { AgentProviderIcon } from "./AgentIcons";
import { NativeSelect } from "./NativeSelect";
import { ProviderSelect } from "./ProviderSelect";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";
import { ProjectAgentDetail } from "./ProjectAgentDetail";
import { ProjectAgentSettings } from "./ProjectAgentSettings";
import { ProjectAgentDesignatedWorkerSelect } from "./ProjectAgentDesignatedWorkerSelect";
import {
  ProjectAgentTaskDialog,
  type ProjectAgentTaskDialogSubmit,
} from "./ProjectAgentTaskDialog";
import { cn } from "../lib/utils";

export function ProjectAgents({
  agentListRequestKey = 0,
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
  agentListRequestKey?: number;
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
  const providerModels = useAgentProviderModels();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [settingsAgent, setSettingsAgent] = useState<ProjectAgent | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<ProjectAgent | null>(null);
  const [taskDialogAgent, setTaskDialogAgent] = useState<ProjectAgent | null>(
    null,
  );
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
      ? loadProjectAgents(token, project.id)
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
    setIsDialogOpen(false);
  }, [agentListRequestKey, project.id]);

  useEffect(() => {
    if (!requestedSessionId || agents.length === 0) return;
    const requestedSession = sessions.find(
      (session) =>
        session.projectId === project.id && session.id === requestedSessionId,
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
        : localProjectAgent(
            input,
            project.id,
            createdAt,
            dashboard?.workers ?? [],
          );
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
          avatar: input.avatar === undefined ? agent.avatar : input.avatar,
          codexPet:
            input.codexPet === undefined ? agent.codexPet : input.codexPet,
          provider: input.provider,
          model: input.model,
          effort: input.effort === undefined ? agent.effort : input.effort,
          designatedWorkerId: input.designatedWorkerId === undefined
            ? agent.designatedWorkerId
            : input.designatedWorkerId,
          designatedWorkerLabel: input.designatedWorkerId === undefined
            ? agent.designatedWorkerLabel
            : dashboard?.workers?.find(
                (worker) => worker.id === input.designatedWorkerId,
              )?.label ?? null,
          description: input.description?.trim() ?? "",
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
      current?.id === updated.id ? updated : current,
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
    setSelectedAgent((current) => (current?.id === agent.id ? null : current));
    setSettingsAgent((current) => (current?.id === agent.id ? null : current));
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
    if (!dashboard || startingAgentIds.has(agent.id)) {
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
      toast(caught instanceof Error ? caught.message : String(caught), {
        tone: "error",
      });
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
        policy={dashboard?.executionPolicy}
        project={project}
        workers={dashboard?.workers ?? []}
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
          onStart(selectedAgent, runs, options)
        }
        onStartTaskSession={(session) =>
          onStartTaskSession(selectedAgent, session)
        }
        requestedSessionId={requestedSessionId}
        isStarting={startingAgentIds.has(selectedAgent.id)}
        sessions={sessions}
        token={token}
      />
    );
  }

  return (
    <MainContent id="project-agents">
      {companionMode ? (
        <div className="flex min-h-12 items-center justify-end border-b border-border bg-card px-[max(16px,env(safe-area-inset-right))] py-1.5 pl-[max(16px,env(safe-area-inset-left))]">
          <Button
            className="h-9 px-3 text-sm"
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
              className="h-[34px] px-3 text-xs active:scale-[.97] max-[760px]:size-[38px] max-[760px]:px-0 max-[760px]:text-[0px]"
              onClick={openCreateDialog}
              type="button"
            >
              <Plus size={16} />
              {t("agents.create")}
            </Button>
          }
          className={cn(
            "app-page-header px-5 [&_.page-header-description]:hidden max-[760px]:px-4",
            !isSidebarOpen && "sidebar-closed",
          )}
          data-tauri-drag-region
          title={t("agents.title")}
          titleId="project-agents-title"
        />
      )}
      <div
        className={cn(
          "scrollbar-subtle min-h-0 flex-1 overflow-y-auto bg-card",
          companionMode && "pb-[calc(106px_+_env(safe-area-inset-bottom))]",
        )}
      >
        <section
          aria-label={companionMode ? t("agents.title") : undefined}
          aria-labelledby={companionMode ? undefined : "project-agents-title"}
          className={cn(
            "min-h-full pb-[54px] max-[760px]:pb-[38px]",
            companionMode && "pb-0",
          )}
        >
          <div
            className={cn(
              "px-8 pt-8 max-[760px]:px-4 max-[760px]:pt-6",
              companionMode &&
                "px-[max(16px,env(safe-area-inset-right))] pt-5 pl-[max(16px,env(safe-area-inset-left))]",
            )}
          >
            <header
              className={cn(
                "mb-7 flex items-center gap-2.5",
                companionMode && "mb-4",
              )}
            >
              <div className="flex items-center gap-2.5">
                <Typography as="strong" variant="body">
                  {t("agents.list")}
                </Typography>
                <Typography
                  as="span"
                  className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-secondary px-2 font-mono font-semibold text-secondary-foreground"
                  variant="caption"
                >
                  {t("agents.count", { count: agents.length })}
                </Typography>
              </div>
            </header>

            {error ? (
              <div
                className="flex min-h-[330px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] p-10 text-center text-[var(--status-destructive-foreground)] [&>strong]:mt-2 [&>strong]:text-[var(--status-destructive-foreground)]"
                role="alert"
              >
                <CircleAlert size={20} />
                <Typography as="strong" variant="body">
                  {t("agents.loadFailed")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {error}
                </Typography>
              </div>
            ) : isLoading ? (
              <div
                className="flex min-h-[330px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground [&>strong]:mt-2"
                aria-live="polite"
              >
                <Spinner size={21} />
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
                className="min-h-[330px] rounded-2xl border border-dashed border-border bg-card"
                description={t("agents.emptyDescription")}
                icon={<Bot size={24} />}
                title={t("agents.emptyTitle")}
              />
            ) : (
              <div
                aria-label={t("agents.list")}
                className={cn(
                  "grid grid-cols-[repeat(auto-fill,minmax(286px,320px))] gap-4 max-[760px]:grid-cols-1",
                  companionMode && "grid-cols-1 gap-3.5",
                )}
              >
                {agents.map((agent) => {
                  const isStarting = startingAgentIds.has(agent.id);
                  const isRunning = runningAgentIds.has(agent.id) || isStarting;
                  const summary = agent.description || agent.responsibility;
                  return (
                    <article
                      className={cn(
                        "flex min-h-[304px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-input hover:shadow-sm motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                        companionMode && "min-h-0",
                      )}
                      key={agent.id}
                    >
                      <button
                        aria-label={t("agents.openAgent", { name: agent.name })}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col border-0 bg-transparent p-0 text-left text-inherit focus-visible:-outline-offset-3 focus-visible:outline-3 focus-visible:outline-ring/25 [&>header]:grid [&>header]:min-h-[90px] [&>header]:grid-cols-[46px_minmax(0,1fr)] [&>header]:items-center [&>header]:gap-3 [&>header]:px-5 [&>header]:pt-5 [&>header]:pb-3.5 [&>header>div]:grid [&>header>div]:min-w-0 [&>header>div]:gap-1 [&>header_h2]:m-0 [&>header_h2]:truncate [&>header_h2]:text-md [&>header_h2]:tracking-normal [&>header>div>span]:flex [&>header>div>span]:w-max [&>header>div>span]:items-center [&>header>div>span]:gap-1.5 [&>header>div>span]:text-xs [&>header>div>span]:font-medium [&>header>div>span]:text-muted-foreground [&>header>div>span]:before:size-[7px] [&>header>div>span]:before:rounded-full [&>header>div>span]:before:bg-success [&>header>div>span]:before:content-[''] [&>section]:flex-1 [&>section]:px-5 [&>section]:pt-4 [&>section]:pb-5 [&>section>small]:text-xs [&>section>small]:font-semibold [&>section>small]:tracking-wide [&>section>small]:text-muted-foreground [&>section>small]:uppercase"
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
                        <div className="mx-5 flex min-h-9 flex-wrap content-start items-center gap-1.5 text-xs font-semibold text-muted-foreground [&>span]:inline-flex [&>span]:min-h-[27px] [&>span]:items-center [&>span]:gap-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-border [&>span]:bg-card [&>span]:px-2 [&>span]:py-1">
                          <span
                            aria-label={agentProviderLabels[agent.provider]}
                            className={cn(
                              "w-[27px]! justify-center px-0!",
                              agent.provider === "claude" && "text-[#ca6d43]",
                              agent.provider === "grok" && "text-[#39776f]",
                            )}
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
                              providerModels,
                              agent,
                              t("agents.providerDefaultModel"),
                            )}
                          </span>
                          <span>
                            <i
                              aria-hidden="true"
                              className="size-[7px] shrink-0 rounded-full border border-foreground/10"
                              style={{ backgroundColor: agent.calendarColor }}
                            />
                            {agent.calendarColor.toUpperCase()}
                          </span>
                        </div>
                        <section>
                          <small>
                            {t(
                              agent.description
                                ? "agents.agentDescription"
                                : "agents.responsibility",
                            )}
                          </small>
                          <p
                            className="mt-2 mb-0 line-clamp-6 [overflow-wrap:anywhere] text-md leading-relaxed text-foreground"
                            title={summary}
                          >
                            {summary}
                          </p>
                          <div className="mt-4 grid gap-2 [&_ul]:m-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-wrap [&_ul]:gap-1.5 [&_ul]:p-0 [&_li]:min-h-6 [&_li]:max-w-full [&_li]:truncate [&_li]:rounded-full [&_li]:border [&_li]:border-border [&_li]:bg-muted [&_li]:px-2 [&_li]:py-0.5 [&_li]:text-micro [&_li]:font-semibold [&_li]:text-muted-foreground">
                            <small>{t("agents.skills")}</small>
                            <ul>
                              {agent.skills.slice(0, 3).map((skill) => (
                                <li key={skill.id} title={skill.description}>
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
                      <footer className="flex min-h-[52px] items-center justify-between gap-2 border-t border-border bg-card pr-3 pl-5 font-mono text-xs font-medium text-muted-foreground [&>time]:mr-auto [&>svg]:text-muted-foreground [&>button]:flex [&>button]:h-[34px] [&>button]:cursor-pointer [&>button]:items-center [&>button]:gap-1 [&>button]:rounded-lg [&>button]:border [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-xs [&>button]:font-semibold [&>button]:text-muted-foreground [&>button]:hover:border-border [&>button]:hover:bg-secondary [&>button]:hover:text-foreground [&>button]:disabled:cursor-not-allowed [&>button]:disabled:opacity-50">
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
                          className="w-[34px] justify-center px-0! not-disabled:text-primary"
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
                            <Spinner aria-hidden="true" size={14} />
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
                          className="w-[34px] justify-center px-0!"
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
                  className={cn(
                    "flex min-h-[304px] min-w-0 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-input bg-card px-7 py-9 text-center text-foreground transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-muted-foreground hover:bg-muted motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&>span]:mb-3.5 [&>span]:grid [&>span]:size-[46px] [&>span]:place-items-center [&>span]:rounded-xl [&>span]:border [&>span]:border-border [&>span]:bg-muted [&>span]:text-muted-foreground [&>strong]:text-md [&>p]:mt-2.5 [&>p]:mb-0 [&>p]:max-w-[230px] [&>p]:text-base [&>p]:leading-relaxed [&>p]:text-muted-foreground",
                    companionMode && "min-h-0",
                  )}
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
          policy={dashboard?.executionPolicy}
          workers={dashboard?.workers ?? []}
        />
      )}
      <ProjectAgentTaskDialog
        agent={taskDialogAgent}
        dashboard={dashboard}
        isOpen={taskDialogAgent !== null}
        isSubmitting={
          taskDialogAgent ? startingAgentIds.has(taskDialogAgent.id) : false
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
  providerModels: AgentProviderModelCatalog,
  agent: Pick<ProjectAgent, "provider" | "model">,
  providerDefault: string,
) {
  if (!agent.model) return providerDefault;
  return agentModelDisplayName(providerModels, agent.provider, agent.model);
}

type ProjectAgentCreationStep = "form" | "start" | "templates";

export function ProjectAgentDialog({
  agent,
  isSubmitting,
  onClose,
  onSubmit,
  policy,
  workers,
}: {
  agent: ProjectAgent | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectAgentInput) => Promise<void>;
  policy?: ProjectExecutionWorkerPolicy;
  workers: readonly ExecutionWorker[];
}) {
  const { t } = useI18n();
  const providerModels = useAgentProviderModels();
  const [name, setName] = useState(agent?.name ?? "");
  const [provider, setProvider] = useState<AgentProvider>(
    agent?.provider ?? "codex",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [effort, setEffort] = useState<ModelEffort | null>(
    agent?.effort ?? null,
  );
  const [designatedWorkerId, setDesignatedWorkerId] = useState<string | null>(
    agent?.designatedWorkerId ?? null,
  );
  const [description, setDescription] = useState(agent?.description ?? "");
  const [responsibility, setResponsibility] = useState(
    agent?.responsibility ?? "",
  );
  const [calendarColor, setCalendarColor] = useState(
    agent?.calendarColor ?? defaultProjectAgentCalendarColor,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [creationStep, setCreationStep] = useState<ProjectAgentCreationStep>(
    agent ? "form" : "start",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEditing = agent !== null;
  const selectedTemplate = projectAgentTemplates.find(
    (template) => template.id === selectedTemplateId,
  );

  const applyTemplate = (template: ProjectAgentTemplate) => {
    setSelectedTemplateId(template.id);
    setName(template.name);
    setDescription(template.description);
    setResponsibility(template.responsibility);
    setCalendarColor(template.calendarColor);
    setCreationStep("form");
    setSubmitError(null);
  };

  const startBlankAgent = () => {
    setSelectedTemplateId(null);
    setName("");
    setProvider("codex");
    setModel("");
    setEffort(null);
    setDesignatedWorkerId(null);
    setDescription("");
    setResponsibility("");
    setCalendarColor(defaultProjectAgentCalendarColor);
    setCreationStep("form");
    setSubmitError(null);
  };

  const templateDivisionLabel = (template: ProjectAgentTemplate) => {
    switch (template.division) {
      case "design":
        return t("agents.templateDesign");
      case "marketing":
        return t("agents.templateMarketing");
      case "product":
        return t("agents.templateProduct");
      default:
        return t("agents.templateEngineering");
    }
  };

  const canSubmit = isEditing || creationStep === "form";

  return (
    <div
      aria-label={t(isEditing ? "agents.editDialog" : "agents.createDialog")}
      aria-modal="true"
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
      role="dialog"
    >
      <form
        className="flex max-h-[calc(100vh_-_48px)] w-[min(640px,calc(100vw_-_48px))] flex-col overflow-hidden rounded-[20px] border border-border bg-card shadow-2xl max-[760px]:max-h-[calc(100dvh_-_28px)] max-[760px]:w-[calc(100vw_-_28px)] [&>header]:flex [&>header]:min-h-16 [&>header]:items-center [&>header]:justify-between [&>header]:border-b [&>header]:border-border [&>header]:px-5 [&>header_h2]:m-0 [&>header_h2]:text-xl [&>header_.eyebrow]:mb-1 [&>header>button]:grid [&>header>button]:size-[34px] [&>header>button]:cursor-pointer [&>header>button]:place-items-center [&>header>button]:rounded-lg [&>header>button]:border [&>header>button]:border-border [&>header>button]:bg-muted [&>header>button]:p-0 [&>header>button]:text-muted-foreground [&>footer]:flex [&>footer]:min-h-16 [&>footer]:items-center [&>footer]:justify-end [&>footer]:gap-2 [&>footer]:border-t [&>footer]:border-border [&>footer]:bg-muted [&>footer]:px-5 [&>footer>button]:flex [&>footer>button]:h-9 [&>footer>button]:min-w-[72px] [&>footer>button]:cursor-pointer [&>footer>button]:items-center [&>footer>button]:justify-center [&>footer>button]:gap-1.5 [&>footer>button]:rounded-lg [&>footer>button]:border [&>footer>button]:border-border [&>footer>button]:bg-card [&>footer>button]:px-3 [&>footer>button]:text-xs [&>footer>button]:text-foreground [&>footer>button]:disabled:cursor-not-allowed [&>footer>button]:disabled:opacity-55"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || !responsibility.trim() || isSubmitting) return;
          setSubmitError(null);
          void onSubmit({
            name: name.trim() || null,
            provider,
            model: model || null,
            effort,
            designatedWorkerId,
            description: description.trim(),
            responsibility: responsibility.trim(),
            ...(selectedTemplate
              ? {
                  avatar: selectedTemplate.avatar ?? null,
                  skills: projectAgentTemplateSkillInputs(selectedTemplate, {
                    provider,
                    model: model || null,
                    effort,
                  }),
                }
              : {}),
            calendarColor,
          }).catch((caught) => {
            setSubmitError(
              caught instanceof Error ? caught.message : String(caught),
            );
          });
        }}
      >
        <header>
          <div>
            <p className="eyebrow">
              {t(isEditing ? "agents.editEyebrow" : "agents.newEyebrow")}
            </p>
            <h2>
              {t(
                isEditing
                  ? "agents.editDialog"
                  : creationStep === "templates"
                    ? "agents.chooseTemplate"
                    : "agents.create",
              )}
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

        <div className="scrollbar-subtle grid gap-4 overflow-y-auto px-6 py-5 max-[760px]:px-4 max-[760px]:py-4 [&>label]:grid [&>label]:min-w-0 [&>label]:gap-1.5 [&>label]:text-micro [&>label]:font-semibold [&>label]:text-foreground [&>label>span_em]:text-muted-foreground [&>label>span_em]:not-italic [&>label>small]:text-micro [&>label>small]:font-medium [&>label>small]:leading-relaxed [&>label>small]:text-muted-foreground [&_input:not([type=color])]:w-full [&_input:not([type=color])]:resize-y [&_input:not([type=color])]:rounded-xl [&_input:not([type=color])]:border [&_input:not([type=color])]:border-border [&_input:not([type=color])]:bg-muted [&_input:not([type=color])]:px-3 [&_input:not([type=color])]:py-2.5 [&_input:not([type=color])]:text-xs [&_input:not([type=color])]:text-foreground [&_input:not([type=color])]:outline-none [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-muted [&_textarea]:px-3 [&_textarea]:py-2.5 [&_textarea]:text-xs [&_textarea]:text-foreground [&_textarea]:outline-none [&_input:not([type=color])]:focus:border-ring [&_input:not([type=color])]:focus:bg-card [&_input:not([type=color])]:focus:ring-3 [&_input:not([type=color])]:focus:ring-ring/15 [&_textarea]:focus:border-ring [&_textarea]:focus:bg-card [&_textarea]:focus:ring-3 [&_textarea]:focus:ring-ring/15 [&_.native-select]:w-full [&_.select-menu-trigger]:h-[42px] [&_.select-menu-trigger]:w-full [&_.select-menu-trigger]:rounded-xl">
          {!isEditing && creationStep === "start" && (
            <section className="grid gap-4 px-0 pt-1.5 pb-2">
              <header className="grid gap-1">
                <strong className="text-md text-foreground">
                  {t("agents.createStartTitle")}
                </strong>
                <small className="text-xs leading-relaxed text-muted-foreground">
                  {t("agents.createStartDescription")}
                </small>
              </header>
              <div className="grid gap-2.5 [&>button]:grid [&>button]:min-h-[94px] [&>button]:w-full [&>button]:cursor-pointer [&>button]:grid-cols-[46px_minmax(0,1fr)_18px] [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-xl [&>button]:border [&>button]:border-border [&>button]:bg-card [&>button]:px-4 [&>button]:py-3.5 [&>button]:text-left [&>button]:text-foreground [&>button]:transition-[border-color,background-color,transform,box-shadow] [&>button]:hover:-translate-y-px [&>button]:hover:border-primary/30 [&>button]:hover:bg-muted [&>button]:hover:shadow-xs motion-reduce:[&>button]:transition-none motion-reduce:[&>button]:hover:translate-y-0 max-[760px]:[&>button]:min-h-[88px] max-[760px]:[&>button]:grid-cols-[42px_minmax(0,1fr)_16px] max-[760px]:[&>button]:gap-2.5 max-[760px]:[&>button]:p-3 [&>button>span:first-child]:grid [&>button>span:first-child]:size-[46px] [&>button>span:first-child]:place-items-center [&>button>span:first-child]:rounded-xl [&>button>span:first-child]:border [&>button>span:first-child]:border-border [&>button>span:first-child]:bg-muted [&>button>span:first-child]:text-muted-foreground max-[760px]:[&>button>span:first-child]:size-[42px] [&>button>span:nth-child(2)]:grid [&>button>span:nth-child(2)]:min-w-0 [&>button>span:nth-child(2)]:gap-1 [&_strong]:text-sm [&_small]:text-micro [&_small]:leading-relaxed [&_small]:text-muted-foreground [&>button>svg]:text-muted-foreground">
                <button
                  className="border-primary/25! bg-primary/5! [&>span:first-child]:border-primary/20! [&>span:first-child]:bg-primary/10! [&>span:first-child]:text-primary!"
                  onClick={() => setCreationStep("templates")}
                  type="button"
                >
                  <span aria-hidden="true">
                    <LayoutTemplate size={21} />
                  </span>
                  <span>
                    <strong>{t("agents.templateTitle")}</strong>
                    <small>{t("agents.templateDescription")}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
                <button onClick={startBlankAgent} type="button">
                  <span aria-hidden="true">
                    <Plus size={21} />
                  </span>
                  <span>
                    <strong>{t("agents.blankAgentTitle")}</strong>
                    <small>{t("agents.blankAgentDescription")}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </div>
            </section>
          )}

          {!isEditing && creationStep === "templates" && (
            <section
              aria-labelledby="project-agent-template-title"
              className="grid gap-2.5"
            >
              <button
                className="-mt-1 flex min-h-[30px] w-max cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1 py-0 text-micro font-semibold text-muted-foreground hover:text-foreground"
                onClick={() => setCreationStep("start")}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={14} />
                {t("agents.creationBack")}
              </button>
              <header className="flex items-start justify-between gap-4">
                <span className="grid min-w-0 gap-0.5">
                  <strong id="project-agent-template-title">
                    {t("agents.chooseTemplateTitle")}
                  </strong>
                  <small className="text-micro font-medium leading-relaxed text-muted-foreground">
                    {t("agents.chooseTemplateDescription")}
                  </small>
                </span>
                <em className="shrink-0 text-micro text-muted-foreground not-italic">
                  {t("agents.templateCount", {
                    count: projectAgentTemplates.length,
                  })}
                </em>
              </header>
              <div className="grid gap-2.5 [&>article]:overflow-hidden [&>article]:rounded-xl [&>article]:border [&>article]:border-border [&>article]:bg-card [&>article]:transition-[border-color,box-shadow] [&>article]:hover:border-primary/30 [&>article]:hover:shadow-xs motion-reduce:[&>article]:transition-none">
                {projectAgentTemplates.map((template) => (
                  <article key={template.id}>
                    <button
                      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_18px] grid-rows-[auto_auto] items-center border-0 bg-transparent p-0 text-left text-inherit [&>svg]:col-start-2 [&>svg]:row-span-2 [&>svg]:mr-3 [&>svg]:text-muted-foreground"
                      onClick={() => applyTemplate(template)}
                      type="button"
                    >
                      <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] items-start gap-2.5 px-3.5 pt-3.5 pb-2 [&>span]:grid [&>span]:size-[38px] [&>span]:place-items-center [&>span]:overflow-hidden [&>span]:rounded-xl [&>span]:border [&>span]:border-[color-mix(in_srgb,var(--template-color,#06b6d4)_32%,var(--border))] [&>span]:bg-[color-mix(in_srgb,var(--template-color,#06b6d4)_11%,var(--card))] [&>span]:text-[19px] [&>span>img]:block [&>span>img]:size-full [&>span>img]:object-cover [&>div]:min-w-0 [&_h3]:mt-0.5 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:leading-snug [&_p]:m-0 [&_p]:text-micro [&_p]:leading-relaxed [&_p]:text-muted-foreground">
                        <span
                          aria-hidden="true"
                          style={
                            {
                              "--template-color": template.calendarColor,
                            } as React.CSSProperties
                          }
                        >
                          {template.avatar ? (
                            <img alt="" src={template.avatar} />
                          ) : (
                            template.emoji
                          )}
                        </span>
                        <div>
                          <h3>{template.name}</h3>
                          <p>{template.description}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 px-3.5 pb-3 pl-[63px] max-[760px]:pl-3.5 [&>span]:inline-flex [&>span]:min-h-[22px] [&>span]:items-center [&>span]:rounded-full [&>span]:border [&>span]:border-border [&>span]:bg-muted [&>span]:px-1.5 [&>span]:py-0.5 [&>span]:text-[10px] [&>span]:font-semibold [&>span]:text-foreground">
                        <span>{templateDivisionLabel(template)}</span>
                        <span>
                          {t("agents.templateSkillCount", {
                            count: template.skills.length,
                          })}
                        </span>
                        <span>{t("agents.templateProviderNeutral")}</span>
                      </div>
                      <ChevronRight aria-hidden="true" size={17} />
                    </button>
                    <div className="flex min-h-[46px] items-center justify-between gap-2.5 border-t border-border bg-muted py-2 pr-2.5 pl-3.5 max-[760px]:items-stretch max-[760px]:flex-col [&>div:first-child]:flex [&>div:first-child]:min-w-0 [&>div:first-child]:flex-wrap [&>div:first-child]:items-center [&>div:first-child]:gap-x-2.5 [&>div:first-child]:gap-y-1 [&_a]:inline-flex [&_a]:cursor-pointer [&_a]:items-center [&_a]:gap-1 [&_a]:text-[10px] [&_a]:font-semibold [&_a]:text-foreground [&_a]:no-underline [&_summary]:inline-flex [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:gap-1 [&_summary]:text-[10px] [&_summary]:font-semibold [&_summary]:text-foreground [&_details]:relative [&_details[open]]:w-full [&_pre]:mt-2 [&_pre]:mb-0.5 [&_pre]:max-h-[170px] [&_pre]:max-w-[450px] [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[10px] [&_pre]:leading-relaxed [&_pre]:font-medium [&_pre]:text-foreground max-[760px]:[&_pre]:max-w-full">
                      <div>
                        <a
                          href={template.source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {t("agents.templateSource")}
                          <ExternalLink aria-hidden="true" size={12} />
                        </a>
                        <details>
                          <summary>{t("agents.templateLicense")}</summary>
                          <pre>{template.source.licenseNotice}</pre>
                        </details>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5 max-[760px]:w-full">
                        {template.skills.map((skill) => (
                          <div
                            className="grid min-h-[34px] min-w-[190px] grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-primary max-[760px]:w-full max-[760px]:min-w-0 [&>span]:grid [&>span]:min-w-0 [&>span]:gap-0.5 [&_strong]:truncate [&_strong]:text-micro [&_strong]:text-foreground [&_small]:text-[10px] [&_small]:leading-snug [&_small]:text-foreground"
                            key={skill.name}
                          >
                            <Wrench aria-hidden="true" size={15} />
                            <span>
                              <strong>{skill.name}</strong>
                              <small>
                                {t("agents.templateInstructionsCount", {
                                  count: skill.body.length,
                                })}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {(isEditing || creationStep === "form") && (
            <>
              {!isEditing && (
                <button
                  className="-mt-1 flex min-h-[30px] w-max cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1 py-0 text-micro font-semibold text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setCreationStep(selectedTemplate ? "templates" : "start")
                  }
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  {t(
                    selectedTemplate
                      ? "agents.backToTemplates"
                      : "agents.creationBack",
                  )}
                </button>
              )}
              {selectedTemplate && (
                <section className="grid min-h-[68px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--template-color,#8068ce)_22%,var(--border))] bg-muted px-3 py-2.5 max-[760px]:grid-cols-[38px_minmax(0,1fr)] [&>span]:grid [&>span]:size-[38px] [&>span]:place-items-center [&>span]:overflow-hidden [&>span]:rounded-xl [&>span]:border [&>span]:border-[color-mix(in_srgb,var(--template-color,#06b6d4)_32%,var(--border))] [&>span]:bg-[color-mix(in_srgb,var(--template-color,#06b6d4)_11%,var(--card))] [&>span]:text-[19px] [&>span>img]:block [&>span>img]:size-full [&>span>img]:object-cover [&>div]:grid [&>div]:min-w-0 [&>div]:gap-0.5 [&>div>small]:text-[10px] [&>div>small]:font-semibold [&>div>small]:text-muted-foreground [&>div>small]:uppercase [&>div>strong]:text-xs [&_p]:m-0 [&_p]:truncate [&_p]:text-[10px] [&_p]:text-muted-foreground [&_a]:flex [&_a]:w-max [&_a]:items-center [&_a]:gap-1 [&_a]:text-[10px] [&_a]:font-semibold [&_a]:text-foreground [&_a]:no-underline [&>button]:min-h-[30px] [&>button]:cursor-pointer [&>button]:rounded-lg [&>button]:border [&>button]:border-border [&>button]:bg-card [&>button]:px-2 [&>button]:text-micro [&>button]:font-semibold [&>button]:text-foreground max-[760px]:[&>button]:col-start-2 max-[760px]:[&>button]:justify-self-start">
                  <span
                    aria-hidden="true"
                    style={
                      {
                        "--template-color": selectedTemplate.calendarColor,
                      } as React.CSSProperties
                    }
                  >
                    {selectedTemplate.avatar ? (
                      <img alt="" src={selectedTemplate.avatar} />
                    ) : (
                      selectedTemplate.emoji
                    )}
                  </span>
                  <div>
                    <small>{t("agents.selectedTemplate")}</small>
                    <strong>{selectedTemplate.name}</strong>
                    <p>
                      {selectedTemplate.skills
                        .map((skill) => skill.name)
                        .join(", ")}{" "}
                      · {t("agents.templateCopyHint")}
                    </p>
                    <a
                      href={selectedTemplate.source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {t("agents.templateSource")}
                      <ExternalLink aria-hidden="true" size={11} />
                    </a>
                  </div>
                  <button
                    onClick={() => setCreationStep("templates")}
                    type="button"
                  >
                    {t("agents.changeTemplate")}
                  </button>
                </section>
              )}
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
              <label>
                <span>
                  {t("agents.agentDescription")} <em>{t("common.optional")}</em>
                </span>
                <textarea
                  maxLength={agentDescriptionMaxLength}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("agents.agentDescriptionPlaceholder")}
                  rows={3}
                  value={description}
                />
                <small>{t("agents.agentDescriptionHint")}</small>
              </label>
              <div className="grid grid-cols-[1fr_1.35fr] gap-2.5 max-[760px]:grid-cols-1">
                <label>
                  <span>
                    {t("agents.provider")} <em>{t("common.required")}</em>
                  </span>
                  <ProviderSelect
                    label={t("agents.provider")}
                    onValueChange={(value) => {
                      setProvider(value as AgentProvider);
                      setModel("");
                      setEffort(null);
                    }}
                    value={provider}
                  />
                </label>
                <label>
                  <span>
                    {t("agents.model")} <em>{t("common.required")}</em>
                  </span>
                  <NativeSelect
                    label={t("agents.model")}
                    onValueChange={(value) => {
                      setModel(value);
                      setEffort(null);
                    }}
                    options={agentModelOptions(
                      providerModels,
                      provider,
                      t("agents.providerDefaultModel"),
                      model,
                    )}
                    searchEmptyMessage={t("issue.noModelsFound")}
                    searchPlaceholder={t("issue.searchModels")}
                    searchable={provider === "opencode" || provider === "agy"}
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
                      ...agentEffortOptions(
                        providerModels,
                        provider,
                        model,
                        effort,
                      ),
                    ]}
                    value={effort ?? ""}
                  />
                </label>
              </div>
              <small className="-mt-2 text-micro leading-relaxed text-muted-foreground">
                {t("agents.skillDefaultsHint")}
              </small>
              <ProjectAgentDesignatedWorkerSelect
                effort={effort}
                model={model || null}
                onChange={setDesignatedWorkerId}
                policy={policy}
                provider={provider}
                selectedWorkerId={designatedWorkerId}
                selectedWorkerLabel={agent?.designatedWorkerLabel ?? null}
                workers={workers}
              />
              <label>
                <span>
                  {t("agents.responsibility")} <em>{t("common.required")}</em>
                </span>
                <textarea
                  maxLength={agentResponsibilityMaxLength}
                  onChange={(event) => setResponsibility(event.target.value)}
                  placeholder={t("agents.responsibilityPlaceholder")}
                  required
                  rows={6}
                  value={responsibility}
                />
                <small>{t("agents.responsibilityHint")}</small>
              </label>
              <label>
                <span>
                  {t("agents.calendarColor")} <em>{t("common.required")}</em>
                </span>
                <div className="flex h-[42px] items-center gap-2.5 rounded-xl border border-border bg-muted px-2.5 [&>input[type=color]]:size-7 [&>input[type=color]]:cursor-pointer [&>input[type=color]]:rounded-lg [&>input[type=color]]:border [&>input[type=color]]:border-border [&>input[type=color]]:bg-card [&>input[type=color]]:p-0.5 [&>code]:font-mono [&>code]:text-micro [&>code]:font-semibold [&>code]:text-foreground">
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
                <div
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-2.5 py-2 text-micro text-[var(--status-destructive-foreground)]"
                  role="alert"
                >
                  <CircleAlert size={14} />
                  {submitError}
                </div>
              )}
            </>
          )}
        </div>

        {(isEditing || creationStep === "form") && (
          <footer>
            <button disabled={isSubmitting} onClick={onClose} type="button">
              {t("common.cancel")}
            </button>
            <button
              className="min-w-[116px]! border-primary! bg-primary! text-primary-foreground!"
              disabled={isSubmitting || !responsibility.trim()}
              type="submit"
            >
              {isSubmitting ? (
                <Spinner size={14} />
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
        )}
      </form>
    </div>
  );
}

function localProjectAgent(
  input: CreateProjectAgentInput,
  projectId: string,
  createdAt: string,
  workers: readonly ExecutionWorker[],
): ProjectAgent {
  const id = crypto.randomUUID();
  const name = input.name ?? `${agentProviderLabels[input.provider]} Agent`;
  return {
    id,
    projectId,
    name,
    avatar: input.avatar ?? null,
    codexPet: null,
    provider: input.provider,
    model: input.model,
    effort: input.effort ?? null,
    designatedWorkerId: input.designatedWorkerId ?? null,
    designatedWorkerLabel: workers.find(
      (worker) => worker.id === input.designatedWorkerId,
    )?.label ?? null,
    description: input.description?.trim() ?? "",
    responsibility: input.responsibility,
    skill: projectAgentSkill({ name, responsibility: input.responsibility }),
    skills: localProjectAgentSkills(id, input.skills ?? [], createdAt, []),
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
      executionMode: input.executionMode ?? "task",
      approvalPolicy: input.approvalPolicy ?? "explicit",
      position,
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt,
    };
  });
}
