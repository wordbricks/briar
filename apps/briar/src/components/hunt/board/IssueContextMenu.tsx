import { Activity, Bot, BrainCircuit, Check, ChevronRight, Clock3, FolderInput, Pencil, Signal, Trash2, Waypoints } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { type ReactElement } from "react";
import { AgentProviderIcon } from "@/components/AgentIcons";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import type { HuntRun, HuntRunPlacement, IssueExecutionPreferences } from "@/types";
import { agentEffortOptions, agentModelDisplayName, agentModelOptions, agentProviderLabels, type AgentProvider } from "@/lib/project-llm";
import { useAgentProviderModels } from "@/hooks/useAgentProviderModels";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { canEditIssueCheckpoints, checkpointBoundaryKey, inheritedCheckpointBoundaries, toggleIssueCheckpoint } from "../model/checkpoints";
import { localizeWorkflowStage } from "../model/formatters";
import { placementForId, placementIdForRun, placementMatchesRun } from "../model/kanban";
import { cn } from "@/lib/utils";

const contextMenuClass = "issue-context-menu z-[150] min-w-[224px] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl backdrop-blur-md";
const contextItemClass = "issue-context-item relative flex min-h-[39px] select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-muted-foreground [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>small]:ml-auto [&>small]:max-w-[140px] [&>small]:truncate [&>small]:text-2xs [&>small]:text-muted-foreground";
const contextChoiceClass = "issue-context-item issue-context-choice relative grid min-h-[38px] select-none grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 pl-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span]:min-w-0 [&>span]:truncate";
const contextCheckClass = "issue-context-check absolute left-2 grid size-[18px] place-items-center text-[#654bb8]";
const contextSeparatorClass = "issue-context-separator my-1.5 h-px bg-border";
const contextLabelClass = "issue-context-label px-2 py-1.5 text-2xs font-semibold uppercase tracking-[.04em] text-muted-foreground";
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
        <ContextMenu.Content aria-label={t("issue.actions")} className={contextMenuClass} collisionPadding={10}>
          <ContextMenu.Item className={contextItemClass} disabled={processNowDisabled} onSelect={() => onProcessNow?.()}>
            {isProcessing ? <Spinner aria-hidden="true" size={17} /> : <Bot aria-hidden="true" size={17} />}
            <span>{t(canReassign ? "worker.reassign" : "issue.processNow")}</span>
            {isProcessing ? <small>{t("issue.processNowRunning")}</small> : run.executionReadiness === "waiting" ? <small>{t("issue.waitingOnPrerequisites", {
              count: run.waitingOnPrerequisiteCount ?? 0
            })}</small> : run.status !== "queued" ? <small>{t("issue.processNowQueuedOnly")}</small> : isClaimed ? <small>{t("issue.processNowClaimed")}</small> : null}
          </ContextMenu.Item>

          <ContextMenu.Separator className={contextSeparatorClass} />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={contextItemClass} disabled={run.status === "paused"}>
              <Activity aria-hidden="true" size={17} />
              <span>{t("dashboard.status")}</span>
              <small>{currentStatusLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={cn(contextMenuClass, "issue-context-submenu w-[246px]")} collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentStatus}>
                  {statusOptions.map(option => <ContextMenu.RadioItem className={contextChoiceClass} disabled={run.status === "paused"} key={option.value} onSelect={() => {
                  const placement = placementForId(option.value);
                  if (run.status === "paused" || !placement || placementMatchesRun(run, placement)) {
                    return;
                  }
                  onMove(placement);
                }} value={option.value}>
                      <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
                        {option.value === currentStatus ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>)}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={contextItemClass}>
              <Signal aria-hidden="true" size={17} />
              <span>{t("issue.priority")}</span>
              <small>{currentPriorityLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={cn(contextMenuClass, "issue-context-submenu w-[246px]")} collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentPriority}>
                  {priorityOptions.map(option => <ContextMenu.RadioItem className={contextChoiceClass} key={option.value} onSelect={() => {
                  if (option.value === currentPriority) return;
                  onPriorityChange(option.value === "none" ? null : Number(option.value));
                }} value={option.value}>
                      <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
                        {option.value === currentPriority ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>)}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={contextItemClass} disabled={run.fullAuto}>
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
              <ContextMenu.SubContent className={cn(contextMenuClass, "issue-context-submenu issue-checkpoint-context-menu w-[310px] max-h-[75vh] overflow-y-auto")} collisionPadding={10} sideOffset={7}>
                {run.workflow.stages.flatMap(stage => (["before", "after"] as const).map(position => {
                const boundary = `${stage.id}:${position}`;
                const inherited = inheritedBoundaries.has(boundary);
                const checked = inherited || selectedIssueBoundaries.has(boundary);
                const stageLabel = localizeWorkflowStage(t, stage.id, stage.label);
                return <ContextMenu.CheckboxItem checked={checked} className={contextChoiceClass} disabled={inherited || !checkpointsEditable} key={boundary} onSelect={() => {
                  if (inherited || !checkpointsEditable) return;
                  onCheckpointsChange(toggleIssueCheckpoint(issueCheckpoints, stage.id, position));
                }}>
                        <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
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
            <ContextMenu.SubTrigger className={contextItemClass}>
              <Waypoints aria-hidden="true" size={17} />
              <span>{t("issue.preferredProvider")}</span>
              <small>{currentProviderLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={cn(contextMenuClass, "issue-context-submenu w-[246px]")} collisionPadding={10} sideOffset={7}>
                <ContextMenu.RadioGroup value={currentProvider}>
                  <ContextMenu.RadioItem className={contextChoiceClass} onSelect={() => {
                  if (!run.preferredProvider) return;
                  onPreferencesChange({
                    provider: null,
                    model: null,
                    effort: null
                  });
                }} value="none">
                    <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
                      {!run.preferredProvider ? <Check aria-hidden="true" size={14} /> : null}
                    </ContextMenu.ItemIndicator>
                    <span>{t("issue.agentDefault")}</span>
                  </ContextMenu.RadioItem>
                  {availableProviders.map(provider => <ContextMenu.RadioItem className={contextChoiceClass} key={provider} onSelect={() => {
                  if (provider === run.preferredProvider) return;
                  onPreferencesChange({
                    provider,
                    model: null,
                    effort: null
                  });
                }} value={provider}>
                      <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
                        {provider === run.preferredProvider ? <Check aria-hidden="true" size={14} /> : null}
                      </ContextMenu.ItemIndicator>
                      <span>
                        <AgentProviderIcon provider={provider} size={14} />
                        {agentProviderLabels[provider]}
                      </span>
                    </ContextMenu.RadioItem>)}
                  {availableProviders.length === 0 ? <ContextMenu.Item className={contextItemClass} disabled>
                      <span>{t("issue.noProviders")}</span>
                    </ContextMenu.Item> : null}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={contextItemClass} disabled={!run.preferredProvider}>
              <BrainCircuit aria-hidden="true" size={17} />
              <span>{t("issue.preferredModel")}</span>
              <small>{currentModelLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            {run.preferredProvider ? <ContextMenu.Portal>
                <ContextMenu.SubContent className={cn(contextMenuClass, "issue-context-submenu w-[246px]")} collisionPadding={10} sideOffset={7}>
                  <ContextMenu.Label className={contextLabelClass}>
                    {t("settings.model")}
                  </ContextMenu.Label>
                  <ContextMenu.RadioGroup value={run.preferredModel ?? ""}>
                    {currentProviderModelOptions.map(option => <ContextMenu.RadioItem className={contextChoiceClass} key={option.value || "default"} onSelect={() => {
                  if ((run.preferredModel ?? "") === option.value) {
                    return;
                  }
                  onPreferencesChange({
                    provider: run.preferredProvider!,
                    model: option.value || null,
                    effort: null
                  });
                }} value={option.value}>
                        <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
                          {(run.preferredModel ?? "") === option.value ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>
                          {option.value ? option.label : t("settings.providerDefaultModel")}
                        </span>
                      </ContextMenu.RadioItem>)}
                  </ContextMenu.RadioGroup>
                  {run.preferredModel ? <>
                      <ContextMenu.Separator className={contextSeparatorClass} />
                      <ContextMenu.Label className={contextLabelClass}>
                        {t("settings.effort")}
                      </ContextMenu.Label>
                      <ContextMenu.RadioGroup value={run.preferredEffort ?? ""}>
                        {[null, ...agentEffortOptions(providerModels, run.preferredProvider, run.preferredModel, run.preferredEffort).map(option => option.value)].map(effort => <ContextMenu.RadioItem className={contextChoiceClass} key={effort ?? "default"} onSelect={() => onPreferencesChange({
                    provider: run.preferredProvider!,
                    model: run.preferredModel!,
                    effort
                  })} value={effort ?? ""}>
                            <ContextMenu.ItemIndicator className={contextCheckClass} forceMount>
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

          <ContextMenu.Separator className={contextSeparatorClass} />

          <ContextMenu.Item className={contextItemClass} onSelect={onOpen}>
            <ChevronRight aria-hidden="true" size={17} />
            <span>{t("common.open")}</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={onEdit}>
            <Pencil aria-hidden="true" size={17} />
            <span>{t("issue.edit")}</span>
          </ContextMenu.Item>
          {onTransfer ? <ContextMenu.Item className={contextItemClass} onSelect={onTransfer}>
              <FolderInput aria-hidden="true" size={17} />
              <span>{t("issue.transfer")}</span>
            </ContextMenu.Item> : null}

          <ContextMenu.Separator className={contextSeparatorClass} />

          <ContextMenu.Item className={`${contextItemClass} danger text-destructive`} onSelect={onDelete}>
            <Trash2 aria-hidden="true" size={17} />
            <span>{t("issue.delete")}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>;
}
