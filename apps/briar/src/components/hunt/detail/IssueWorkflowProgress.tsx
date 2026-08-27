import { Check, Clock3 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";
import { type AutoHuntWorkflowCheckpoint, type AutoHuntWorkflowCheckpointPosition } from "@/lib/auto-hunt-contract";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import { canEditIssueCheckpoints, checkpointBoundaryKey, toggleIssueCheckpoint } from "../model/checkpoints";
import { localizeWorkflowStage } from "../model/formatters";
import { IssueWorkflowProgressState, issueWorkflowProgressState } from "../model/workflow";
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
  return <div className="issue-workflow-progress">
      <ol aria-label={t("run.totalProgress")} aria-live="polite">
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
          })}`} className="issue-workflow-checkpoint" data-active={configured} data-inherited={inherited} data-position={position} disabled={inherited || !editable || savingBoundary !== null} onClick={() => {
            if (!onCheckpointsChange || inherited || !editable) return;
            setCheckpointError(null);
            setSavingBoundary(boundary);
            void onCheckpointsChange(toggleIssueCheckpoint(issueCheckpoints, stage.id, position)).catch(error => setCheckpointError(error instanceof Error ? error.message : String(error))).finally(() => setSavingBoundary(null));
          }} title={inherited ? t("issue.checkpointRequired") : action} type="button">
                {savingBoundary === boundary ? <Spinner aria-hidden="true" size={10} /> : <Clock3 aria-hidden="true" size={10} />}
              </button>;
        };
        return <li aria-current={isCurrent ? "step" : undefined} aria-label={`${label}: ${stateLabels[state]}`} data-reached={state !== "upcoming"} data-state={state} key={stage.id}>
              {renderCheckpoint("before")}
              <span aria-hidden="true" className="issue-workflow-marker">
                {state === "complete" ? <Check size={11} strokeWidth={3} /> : <i />}
              </span>
              <span aria-hidden="true" className="issue-workflow-label">
                {label}
              </span>
              {renderCheckpoint("after")}
            </li>;
      })}
      </ol>
      {checkpointError ? <span className="issue-workflow-checkpoint-error" role="alert">
          {checkpointError}
        </span> : null}
    </div>;
}
