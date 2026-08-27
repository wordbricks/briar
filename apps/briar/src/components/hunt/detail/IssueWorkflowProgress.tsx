import { Check, Clock3 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";
import { type AutoHuntWorkflowCheckpoint, type AutoHuntWorkflowCheckpointPosition } from "@/lib/auto-hunt-contract";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import { canEditIssueCheckpoints, checkpointBoundaryKey, toggleIssueCheckpoint } from "../model/checkpoints";
import { localizeWorkflowStage } from "../model/formatters";
import { IssueWorkflowProgressState, issueWorkflowProgressState } from "../model/workflow";
import { cn } from "@/lib/utils";
export function IssueWorkflowProgress({
  onCheckpointsChange,
  run
}: {
  onCheckpointsChange?: (checkpoints: AutoHuntWorkflowCheckpoint[]) => Promise<unknown>;
  run: HuntRun;
}) {
  const {
    t
  } = useI18n();
  const [savingBoundary, setSavingBoundary] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const issueCheckpoints = run.issueCheckpoints ?? [];
  const issueBoundaries = new Set(issueCheckpoints.map(checkpointBoundaryKey));
  const effectiveBoundaries = new Set(run.workflow.execution.checkpoints.map(checkpointBoundaryKey));
  const editable = !run.fullAuto && Boolean(onCheckpointsChange) && canEditIssueCheckpoints(run);
  const stateLabels = {
    complete: t("status.completed"),
    active: t("status.running"),
    paused: t("status.paused"),
    blocked: t("status.blocked"),
    failed: t("status.failed"),
    cancelled: t("status.cancelled"),
    upcoming: t("status.queued")
  } satisfies Record<IssueWorkflowProgressState, string>;
  return <div className="issue-workflow-progress min-h-[70px] min-w-0 flex-none overflow-x-auto border-t border-border bg-card/95 px-6 py-2.5">
      <ol aria-label={t("run.totalProgress")} aria-live="polite" className="m-0 flex min-w-max list-none p-0">
        {run.workflow.stages.map((stage, index) => {
        const state = issueWorkflowProgressState(run, index);
        const label = localizeWorkflowStage(t, stage.id, stage.label);
        const isCurrent = !["complete", "upcoming"].includes(state);
        const renderCheckpoint = (position: AutoHuntWorkflowCheckpointPosition) => {
          const boundary = `${stage.id}:${position}`;
          const issueSpecific = issueBoundaries.has(boundary);
          const configured = effectiveBoundaries.has(boundary);
          const inherited = configured && !issueSpecific;
          if (!editable && !configured) return null;
          const action = issueSpecific ? t("issue.checkpointRemove") : t("issue.checkpointAdd");
          return <button aria-label={inherited ? t("issue.checkpointRequiredAt", {
            stage: label
          }) : `${action}: ${position === "before" ? t("run.checkpointBefore", {
            stage: label
          }) : t("run.checkpointAfter", {
            stage: label
          })}`} className="issue-workflow-checkpoint absolute z-[2] grid size-[20px] place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 outline-none transition-opacity hover:border-ring hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-0 data-[active=true]:border-[#b7a8e4] data-[active=true]:bg-[#f1edfc] data-[active=true]:text-[#654bb8] data-[position=before]:left-0 data-[position=before]:top-0 data-[position=after]:right-0 data-[position=after]:top-0 group-hover:opacity-100 group-focus-within:opacity-100" data-active={configured} data-inherited={inherited} data-position={position} disabled={inherited || !editable || savingBoundary !== null} onClick={() => {
            if (!onCheckpointsChange || inherited || !editable) return;
            setCheckpointError(null);
            setSavingBoundary(boundary);
            void onCheckpointsChange(toggleIssueCheckpoint(issueCheckpoints, stage.id, position)).catch(error => setCheckpointError(error instanceof Error ? error.message : String(error))).finally(() => setSavingBoundary(null));
          }} title={inherited ? t("issue.checkpointRequired") : action} type="button">
                {savingBoundary === boundary ? <Spinner aria-hidden="true" size={10} /> : <Clock3 aria-hidden="true" size={10} />}
              </button>;
        };
        return <li aria-current={isCurrent ? "step" : undefined} aria-label={`${label}: ${stateLabels[state]}`} className="group relative grid min-w-[94px] flex-1 grid-rows-[24px_auto] justify-items-center gap-1 px-1 text-center text-2xs text-muted-foreground before:absolute before:left-0 before:right-0 before:top-3 before:z-0 before:h-px before:bg-border first:before:left-1/2 last:before:right-1/2 data-[reached=true]:before:bg-[#b9a9e8] data-[state=active]:font-semibold data-[state=complete]:text-foreground" data-reached={state !== "upcoming"} data-state={state} key={stage.id}>
              {renderCheckpoint("before")}
              <span aria-hidden="true" className="issue-workflow-marker relative z-[1] grid size-6 place-items-center rounded-full border-2 border-border bg-card text-muted-foreground group-data-[state=complete]:border-primary group-data-[state=complete]:bg-primary group-data-[state=complete]:text-primary-foreground group-data-[state=active]:border-[#8068ce] group-data-[state=active]:text-[#654bb8] group-data-[state=paused]:border-[var(--status-warning-border)] group-data-[state=paused]:text-[var(--status-warning-foreground)] group-data-[state=failed]:border-[var(--status-destructive-border)] group-data-[state=failed]:text-[var(--status-destructive-foreground)]">
                {state === "complete" ? <Check size={11} strokeWidth={3} /> : <i className="size-2 rounded-full bg-border group-data-[state=active]:bg-[#8068ce] group-data-[state=paused]:bg-[var(--warning)]" />}
              </span>
              <span aria-hidden="true" className="issue-workflow-label max-w-24 overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
              </span>
              {renderCheckpoint("after")}
            </li>;
      })}
      </ol>
      {checkpointError ? <span className="issue-workflow-checkpoint-error mt-1 block text-center text-2xs text-destructive" role="alert">
          {checkpointError}
        </span> : null}
    </div>;
}
