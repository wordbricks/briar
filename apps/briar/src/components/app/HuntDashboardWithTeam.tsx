import { useAtomValue } from "@effect/atom-react";
import { useMemo, type ComponentProps } from "react";

import { processingIssueIdsAtom } from "../../state/agent-sessions/atoms";
import { useIssueActions } from "../../state/issues/actions";
import {
  deletingIssueIdAtom,
  isCreatingIssueAtom,
  recoveringRunIdAtom,
  recoveryErrorAtom,
  updatingIssueIdAtom,
} from "../../state/issues/atoms";
import { planningProjectsAtom } from "../../state/planning/atoms";
import { useRunDetailActions } from "../../state/run-detail/actions";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { HuntDashboard } from "../hunt/HuntDashboard";

/*
  The issue board wired to the store.

  `App.tsx` used to hand the board the dashboard plus about forty issue and run
  callbacks, at two render sites — once for the desktop shell and once for the
  companion one. Every one of those props was rebuilt on each App render, which
  is what made a polling tick reach the board at all. They come from here now.

  Since Phase 2C it no longer reads the dashboard either: the board resolves the
  team's runs itself, one id at a time, so nothing an issue edit touches passes
  through this component. What is left is the pending-mutation flags, the runs an
  agent is working on and the action bundles, none of which a delta tick moves.
*/

/** The props this wrapper supplies; `App` may not pass them. */
type ConnectedProps =
  | "currentUserId"
  | "deletingIssueId"
  | "isCreatingIssue"
  | "issueProjects"
  | "processingIssueIds"
  | "recoveringRunId"
  | "recoveryError"
  | "token"
  | "updatingIssueId"
  | "onAcceptIssueAction"
  | "onAcceptIssueExecution"
  | "onAcceptSkillExecution"
  | "onAddIssueDependency"
  | "onAddRelatedIssue"
  | "onCancelRun"
  | "onCompleteResultReview"
  | "onCreateIssue"
  | "onDeleteIssueMessage"
  | "onEditIssueMessage"
  | "onLoadAttachment"
  | "onLoadIssueMessages"
  | "onLoadRunEvents"
  | "onLoadRunEvidence"
  | "onLoadRunEvidenceImage"
  | "onMoveIssueProject"
  | "onMoveRun"
  | "onRemoveIssueDependency"
  | "onRemoveRelatedIssue"
  | "onResumeRun"
  | "onRetryRun"
  | "onReworkRun"
  | "onSetIssueParent"
  | "onUpdateIssue"
  | "onUpdateIssueCheckpoints"
  | "onUpdateIssuePreferences"
  | "onUpdateIssueSubscription";

export type HuntDashboardWithTeamProps = Omit<
  ComponentProps<typeof HuntDashboard>,
  ConnectedProps
>;

export function HuntDashboardWithTeam(props: HuntDashboardWithTeamProps) {
  const issueProjects = useAtomValue(planningProjectsAtom);
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const isCreatingIssue = useAtomValue(isCreatingIssueAtom);
  const updatingIssueId = useAtomValue(updatingIssueIdAtom);
  const deletingIssueId = useAtomValue(deletingIssueIdAtom);
  const recoveringRunId = useAtomValue(recoveringRunIdAtom);
  const recoveryError = useAtomValue(recoveryErrorAtom);
  const processingIssueIds = useAtomValue(processingIssueIdsAtom);
  const issueActions = useIssueActions();
  const runDetailActions = useRunDetailActions();

  /*
    Both action objects keep one identity for the registry's lifetime, so the
    only reason this memo exists is the two callbacks that need the selected
    team or an argument shape the board asks for.
  */
  const callbacks = useMemo(
    () => ({
      onAcceptIssueAction: issueActions.acceptConversationIssueAction,
      onAcceptIssueExecution: issueActions.acceptConversationIssueExecution,
      onAcceptSkillExecution: issueActions.acceptConversationSkillExecution,
      onAddIssueDependency: (
        dependentRunId: string,
        prerequisiteRunId: string,
      ) =>
        issueActions.changeIssueDependency(
          dependentRunId,
          prerequisiteRunId,
          "add",
        ),
      onAddRelatedIssue: (runId: string, relatedRunId: string) =>
        issueActions.changeRelatedIssue(runId, relatedRunId, "add"),
      onCancelRun: (runId: string) => issueActions.recoverRun(runId, "cancel"),
      onCompleteResultReview: issueActions.completeResultReview,
      onCreateIssue: issueActions.addIssue,
      onDeleteIssueMessage: runDetailActions.removeIssueMessage,
      onEditIssueMessage: runDetailActions.updateIssueMessage,
      onLoadAttachment: issueActions.readIssueAttachment,
      onLoadIssueMessages: runDetailActions.readIssueMessages,
      onLoadRunEvents: runDetailActions.readRunEvents,
      onLoadRunEvidence: runDetailActions.readRunEvidence,
      onLoadRunEvidenceImage: runDetailActions.readRunEvidenceImage,
      onMoveIssueProject: issueActions.moveIssueProject,
      onMoveRun: issueActions.moveRun,
      onRemoveIssueDependency: (
        dependentRunId: string,
        prerequisiteRunId: string,
      ) =>
        issueActions.changeIssueDependency(
          dependentRunId,
          prerequisiteRunId,
          "remove",
        ),
      onRemoveRelatedIssue: (runId: string, relatedRunId: string) =>
        issueActions.changeRelatedIssue(runId, relatedRunId, "remove"),
      onResumeRun: issueActions.resumeRun,
      onRetryRun: (runId: string) => issueActions.recoverRun(runId, "retry"),
      onReworkRun: issueActions.reworkRun,
      onSetIssueParent: issueActions.changeIssueParent,
      onUpdateIssue: issueActions.editIssue,
      onUpdateIssueCheckpoints: issueActions.editIssueCheckpoints,
      onUpdateIssuePreferences: issueActions.editIssueExecutionPreferences,
      onUpdateIssueSubscription: issueActions.editIssueSubscription,
    }),
    [issueActions, runDetailActions],
  );

  return (
    <HuntDashboard
      {...props}
      {...callbacks}
      currentUserId={user?.id ?? null}
      deletingIssueId={deletingIssueId}
      isCreatingIssue={isCreatingIssue}
      issueProjects={issueProjects}
      processingIssueIds={processingIssueIds}
      recoveringRunId={recoveringRunId}
      recoveryError={recoveryError}
      token={token}
      updatingIssueId={updatingIssueId}
    />
  );
}
