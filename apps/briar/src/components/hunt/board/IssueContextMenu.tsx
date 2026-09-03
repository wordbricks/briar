import { Activity, Bot, BrainCircuit, Check, ChevronRight, Clock3, Folder, FolderInput, Pencil, Signal, Trash2, Users, Waypoints } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { type ReactElement } from "react";
import { AgentProviderIcon } from "@/components/AgentIcons";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import type { HuntRun, HuntRunPlacement, IssueExecutionPreferences, PlanningProject, Project } from "@/types";
import { agentEffortOptions, agentModelDisplayName, agentModelOptions, agentProviderLabels, type AgentProvider } from "@/lib/team-llm";
import { useAgentProviderModels } from "@/hooks/useAgentProviderModels";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { canEditIssueCheckpoints, checkpointBoundaryKey, inheritedCheckpointBoundaries, toggleIssueCheckpoint } from "../model/checkpoints";
import { localizeWorkflowStage } from "../model/formatters";
import { placementForId, placementIdForRun, placementMatchesRun } from "../model/kanban";
export function IssueContextMenu({
  availableProviders,
  children,
  disabled,
  onDelete,
  onTransfer,
  onEdit,
  onMove,
  onOpen,
  onProcessNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  onTeamChange,
  onProjectChange,
  teams = [],
  currentTeamId = null,
  planningProjects = [],
  run,
  isProcessing
}: {
  availableProviders: AgentProvider[];
  children: ReactElement;
  disabled: boolean;
  onDelete: () => void;
  onTransfer?: () => void;
  onEdit: () => void;
  onMove: (placement: HuntRunPlacement) => void;
  onOpen: () => void;
  onProcessNow?: () => void;
  onPriorityChange: (priority: number | null) => void;
  onPreferencesChange: (preferences: IssueExecutionPreferences) => void;
  onCheckpointsChange: (checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  onTeamChange?: (teamId: string) => void;
  onProjectChange?: (projectId: string) => void;
  teams?: Array<Pick<Project, "id" | "name">>;
  currentTeamId?: string | null;
  planningProjects?: Array<Pick<PlanningProject, "id" | "name" | "teamId">>;
  run: HuntRun;
  isProcessing: boolean;
}) {
  const {
    t
  } = useI18n();
  const providerModels = useAgentProviderModels();
  const statusOptions = [{
    label: t("status.backlog"),
    value: "status:backlog"
  }, {
    label: t("status.queued"),
    value: "status:queued"
  }, ...run.workflow.stages.map(stage => ({
    label: localizeWorkflowStage(t, stage.id, stage.label),
    value: `stage:${stage.id}`
  })), {
    label: t("status.blocked"),
    value: "status:blocked"
  }, {
    label: t("status.failed"),
    value: "status:failed"
  }, {
    label: t("status.completed"),
    value: "status:completed"
  }, {
    label: t("status.cancelled"),
    value: "status:cancelled"
  }];
  const currentStatus = placementIdForRun(run);
  const currentStatusLabel = statusOptions.find(option => option.value === currentStatus)?.label ?? t(`status.${run.status}` as MessageKey);
  const currentPriority = run.priority === null ? "none" : String(run.priority);
  const priorityOptions = [{
    label: t("run.notSet"),
    value: "none"
  }, {
    label: t("issue.priority1"),
    value: "1"
  }, {
    label: t("issue.priority2"),
    value: "2"
  }, {
    label: t("issue.priority3"),
    value: "3"
  }, {
    label: t("issue.priority4"),
    value: "4"
  }];
  const currentPriorityLabel = priorityOptions.find(option => option.value === currentPriority)?.label ?? t("run.notSet");
  const currentProvider = run.preferredProvider ?? "none";
  const currentProviderLabel = run.preferredProvider ? agentProviderLabels[run.preferredProvider] : t("issue.agentDefault");
  const currentModelLabel = run.preferredProvider ? run.preferredModel ? `${agentModelDisplayName(providerModels, run.preferredProvider, run.preferredModel)}${run.preferredEffort ? ` · ${run.preferredEffort}` : ""}` : t("settings.providerDefaultModel") : t("run.notSet");
  const currentProviderModelOptions = run.preferredProvider ? agentModelOptions(providerModels, run.preferredProvider, t("settings.providerDefaultModel"), run.preferredModel) : [];
  const issueCheckpoints = run.issueCheckpoints ?? [];
  const inheritedBoundaries = inheritedCheckpointBoundaries(run.workflow, issueCheckpoints);
  const selectedIssueBoundaries = new Set(issueCheckpoints.map(checkpointBoundaryKey));
  const checkpointsEditable = !run.fullAuto && canEditIssueCheckpoints(run);
  const isClaimed = run.status === "queued" && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt!) > Date.now();
  const canReassign = Boolean(run.workerId || run.requestedWorkerId) && !["completed", "cancelled", "paused"].includes(run.status);
  const processNowDisabled = !onProcessNow || run.executionReadiness === "waiting" || run.status !== "queued" && !canReassign || isClaimed && !canReassign || isProcessing;
  return <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={disabled}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={t("issue.actions")} className="issue-context-menu" collisionPadding={10}>
          <ContextMenu.Item className="issue-context-item" disabled={processNowDisabled} onSelect={() => onProcessNow?.()}>
            {isProcessing ? <Spinner aria-hidden="true" size={17} /> : <Bot aria-hidden="true" size={17} />}
            <span>{t(canReassign ? "worker.reassign" : "issue.processNow")}</span>
            {isProcessing ? <small>{t("issue.processNowRunning")}</small> : run.executionReadiness === "waiting" ? <small>{t("issue.waitingOnPrerequisites", {
              count: run.waitingOnPrerequisiteCount ?? 0
            })}</small> : run.status !== "queued" ? <small>{t("issue.processNowQueuedOnly")}</small> : isClaimed ? <small>{t("issue.processNowClaimed")}</small> : null}
          </ContextMenu.Item>

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item" disabled={run.status === "paused"}>
              <Activity aria-hidden="true" size={17} />
              <span>{t("dashboard.status")}</span>
              <small>{currentStatusLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentStatus}>
                  {statusOptions.map(option => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" disabled={run.status === "paused"} key={option.value} onSelect={() => {
                  const placement = placementForId(option.value);
                  if (run.status === "paused" || !placement || placementMatchesRun(run, placement)) {
                    return;
                  }
                  onMove(placement);
                }} value={option.value}>
                      <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                        {option.value === currentStatus ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>)}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Signal aria-hidden="true" size={17} />
              <span>{t("issue.priority")}</span>
              <small>{currentPriorityLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentPriority}>
                  {priorityOptions.map(option => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={option.value} onSelect={() => {
                  if (option.value === currentPriority) return;
                  onPriorityChange(option.value === "none" ? null : Number(option.value));
                }} value={option.value}>
                      <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                        {option.value === currentPriority ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>)}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item" disabled={run.fullAuto}>
              <Clock3 aria-hidden="true" size={17} />
              <span>{t("issue.checkpoints")}</span>
              <small>
                {run.fullAuto ? t("issue.fullAuto") : checkpointsEditable ? t("issue.checkpointCount", {
                count: issueCheckpoints.length
              }) : t("issue.checkpointsLocked")}
              </small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="issue-context-menu issue-context-submenu issue-checkpoint-context-menu" collisionPadding={10} sideOffset={7}>
                {run.workflow.stages.flatMap(stage => (["before", "after"] as const).map(position => {
                const boundary = `${stage.id}:${position}`;
                const inherited = inheritedBoundaries.has(boundary);
                const checked = inherited || selectedIssueBoundaries.has(boundary);
                const stageLabel = localizeWorkflowStage(t, stage.id, stage.label);
                return <ContextMenu.CheckboxItem checked={checked} className="issue-context-item issue-context-choice" disabled={inherited || !checkpointsEditable} key={boundary} onSelect={() => {
                  if (inherited || !checkpointsEditable) return;
                  onCheckpointsChange(toggleIssueCheckpoint(issueCheckpoints, stage.id, position));
                }}>
                        <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                          {checked ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>
                          {position === "before" ? t("run.checkpointBefore", {
                      stage: stageLabel
                    }) : t("run.checkpointAfter", {
                      stage: stageLabel
                    })}
                        </span>
                        {inherited ? <small>{t("issue.checkpointRequired")}</small> : null}
                      </ContextMenu.CheckboxItem>;
              }))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Waypoints aria-hidden="true" size={17} />
              <span>{t("issue.preferredProvider")}</span>
              <small>{currentProviderLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentProvider}>
                  <ContextMenu.RadioItem className="issue-context-item issue-context-choice" onSelect={() => {
                  if (!run.preferredProvider) return;
                  onPreferencesChange({
                    provider: null,
                    model: null,
                    effort: null
                  });
                }} value="none">
                    <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                      {!run.preferredProvider ? <Check aria-hidden="true" size={14} /> : null}
                    </ContextMenu.ItemIndicator>
                    <span>{t("issue.agentDefault")}</span>
                  </ContextMenu.RadioItem>
                  {availableProviders.map(provider => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={provider} onSelect={() => {
                  if (provider === run.preferredProvider) return;
                  onPreferencesChange({
                    provider,
                    model: null,
                    effort: null
                  });
                }} value={provider}>
                      <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                        {provider === run.preferredProvider ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>
                        <AgentProviderIcon provider={provider} size={14} />
                        {agentProviderLabels[provider]}
                      </span>
                    </ContextMenu.RadioItem>)}
                  {availableProviders.length === 0 ? <ContextMenu.Item className="issue-context-item" disabled>
                      <span>{t("issue.noProviders")}</span>
                    </ContextMenu.Item> : null}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item" disabled={!run.preferredProvider}>
              <BrainCircuit aria-hidden="true" size={17} />
              <span>{t("issue.preferredModel")}</span>
              <small>{currentModelLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            {run.preferredProvider ? <ContextMenu.Portal>
                <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                  <ContextMenu.Label className="issue-context-label">
                    {t("settings.model")}
                  </ContextMenu.Label>
                  <ContextMenu.RadioGroup value={run.preferredModel ?? ""}>
                    {currentProviderModelOptions.map(option => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={option.value || "default"} onSelect={() => {
                  if ((run.preferredModel ?? "") === option.value) {
                    return;
                  }
                  onPreferencesChange({
                    provider: run.preferredProvider!,
                    model: option.value || null,
                    effort: null
                  });
                }} value={option.value}>
                        <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                          {(run.preferredModel ?? "") === option.value ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>
                          {option.value ? option.label : t("settings.providerDefaultModel")}
                        </span>
                      </ContextMenu.RadioItem>)}
                  </ContextMenu.RadioGroup>
                  {run.preferredModel ? <>
                      <ContextMenu.Separator className="issue-context-separator" />
                      <ContextMenu.Label className="issue-context-label">
                        {t("settings.effort")}
                      </ContextMenu.Label>
                      <ContextMenu.RadioGroup value={run.preferredEffort ?? ""}>
                        {[null, ...agentEffortOptions(providerModels, run.preferredProvider, run.preferredModel, run.preferredEffort).map(option => option.value)].map(effort => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={effort ?? "default"} onSelect={() => onPreferencesChange({
                    provider: run.preferredProvider!,
                    model: run.preferredModel!,
                    effort
                  })} value={effort ?? ""}>
                            <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                              {(run.preferredEffort ?? null) === effort ? <Check aria-hidden="true" size={14} /> : null}
                            </ContextMenu.ItemIndicator>
                            <span>
                              {effort ?? t("settings.providerDefaultEffort")}
                            </span>
                          </ContextMenu.RadioItem>)}
                      </ContextMenu.RadioGroup>
                    </> : null}
                </ContextMenu.SubContent>
              </ContextMenu.Portal> : null}
          </ContextMenu.Sub>

          {onTeamChange && teams.length > 0 ? <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="issue-context-item">
                <Users aria-hidden="true" size={17} />
                <span>{t("issue.team")}</span>
                <small>{teams.find(team => team.id === (run.teamId ?? currentTeamId))?.name ?? t("run.notSet")}</small>
                <ChevronRight aria-hidden="true" size={14} />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                  <ContextMenu.RadioGroup value={run.teamId ?? currentTeamId ?? ""}>
                    {teams.map(team => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={team.id} onSelect={() => {
                  if ((run.teamId ?? currentTeamId) === team.id) return;
                  onTeamChange(team.id);
                }} value={team.id}>
                        <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                          {(run.teamId ?? currentTeamId) === team.id ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>{team.name}</span>
                      </ContextMenu.RadioItem>)}
                  </ContextMenu.RadioGroup>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub> : null}

          {onProjectChange && planningProjects.length > 0 ? <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="issue-context-item">
                <Folder aria-hidden="true" size={17} />
                <span>{t("issue.project")}</span>
                <small>{planningProjects.find(project => project.id === run.projectId)?.name ?? run.projectName ?? t("run.notSet")}</small>
                <ChevronRight aria-hidden="true" size={14} />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="issue-context-menu issue-context-submenu" collisionPadding={10} sideOffset={7}>
                  <ContextMenu.RadioGroup value={run.projectId ?? ""}>
                    {planningProjects.map(project => <ContextMenu.RadioItem className="issue-context-item issue-context-choice" key={project.id} onSelect={() => {
                  if (run.projectId === project.id) return;
                  onProjectChange(project.id);
                }} value={project.id}>
                        <ContextMenu.ItemIndicator className="issue-context-check" forceMount>
                          {run.projectId === project.id ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>{project.name}</span>
                      </ContextMenu.RadioItem>)}
                  </ContextMenu.RadioGroup>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub> : null}

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Item className="issue-context-item" onSelect={onOpen}>
            <ChevronRight aria-hidden="true" size={17} />
            <span>{t("common.open")}</span>
          </ContextMenu.Item>
          <ContextMenu.Item className="issue-context-item" onSelect={onEdit}>
            <Pencil aria-hidden="true" size={17} />
            <span>{t("issue.edit")}</span>
          </ContextMenu.Item>
          {onTransfer && !onTeamChange && !onProjectChange ? <ContextMenu.Item className="issue-context-item" onSelect={onTransfer}>
              <FolderInput aria-hidden="true" size={17} />
              <span>{t("issue.transfer")}</span>
            </ContextMenu.Item> : null}

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Item className="issue-context-item danger" onSelect={onDelete}>
            <Trash2 aria-hidden="true" size={17} />
            <span>{t("issue.delete")}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>;
}
