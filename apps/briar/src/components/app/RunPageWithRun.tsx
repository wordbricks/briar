import { useAtomValue } from "@effect/atom-react";
import { lazy, useMemo, type ComponentProps } from "react";

import { teamMembersAtom } from "../../state/entities/members";
import { teamOrganizationProvidersAtom } from "../../state/entities/providers";
import { runAtom, teamRunsAtom } from "../../state/entities/runs";
import { teamEntityAtom } from "../../state/entities/teams";
import { teamWorkersAtom } from "../../state/entities/workers";
import { useIssueActions } from "../../state/issues/actions";
import {
  deletingIssueIdAtom,
  recoveringRunIdAtom,
  recoveryErrorAtom,
  updatingIssueIdAtom,
} from "../../state/issues/atoms";
import { useRunDetailActions } from "../../state/run-detail/actions";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import {
  activeTeamIdAtom,
  teamExecutionPolicyAtom,
  teamsAtom,
} from "../../state/team/atoms";
import type { AgentProvider } from "../../lib/team-llm";
// The detail page pulls the whole markdown stack, so it keeps the code split
// boundary `App.tsx` gave it; the type import below is erased at build time.
import type { RunPage as RunPageComponent } from "../hunt/detail/RunPage";

const RunPage = lazy(() =>
  import("../hunt/detail/RunPage").then((m) => ({ default: m.RunPage })),
);

/*
  The issue detail page wired to the store.

  It takes a run *id* rather than a run: the run itself comes from
  `runAtom(runId)`, so an edit to a different run never reaches this view, and
  an edit to this one arrives without `App.tsx` re-rendering. The twenty five
  callbacks `App` used to bind to the run one by one come from the action hooks
  and keep their identity between renders.
*/

/** Props this wrapper supplies from the store. */
type ConnectedProps =
  | "availableProviders"
  | "availableRuns"
  | "currentUserId"
  | "error"
  | "executionPolicy"
  | "executionWorkers"
  | "isDeletingIssue"
  | "isRecovering"
  | "isUpdatingIssue"
  | "issueKeyPrefix"
  | "mentionMembers"
  | "organizationId"
  | "run"
  | "token"
  | "onAcceptIssueAction"
  | "onAcceptIssueExecution"
  | "onAcceptSkillExecution"
  | "onAddDependency"
  | "onAddRelated"
  | "onCancel"
  | "onCompleteResultReview"
  | "onDeleteIssueMessage"
  | "onEditIssueMessage"
  | "onLinkSubIssue"
  | "onLoadAttachment"
  | "onLoadIssueMessages"
  | "onLoadRunEvents"
  | "onLoadRunEvidence"
  | "onLoadRunEvidenceImage"
  | "onMove"
  | "onRemoveDependency"
  | "onRemoveRelated"
  | "onResume"
  | "onRetry"
  | "onRework"
  | "onSetParent"
  | "onUnlinkSubIssue"
  | "onUpdateIssue"
  | "onUpdateIssueCheckpoints"
  | "onUpdateIssuePreferences"
  | "onUpdateIssueSubscription";

export type RunPageWithRunProps = Omit<
  ComponentProps<typeof RunPageComponent>,
  ConnectedProps
> & {
  /** The run to render. Nothing renders while the store does not hold it. */
  readonly runId: string;
};

export function RunPageWithRun({ runId, ...props }: RunPageWithRunProps) {
  const run = useAtomValue(runAtom(runId));
  /*
    Six projections of the open team, each read on its own. The page used to
    take the whole payload, so a worker heartbeat re-rendered it to hand it a
    run list it already had; now only the projection that changed does.
  */
  const teamId = useAtomValue(activeTeamIdAtom) ?? "";
  const team = useAtomValue(teamEntityAtom(teamId));
  const runs = useAtomValue(teamRunsAtom(teamId));
  const workers = useAtomValue(teamWorkersAtom(teamId));
  const members = useAtomValue(teamMembersAtom(teamId));
  const executionPolicy = useAtomValue(teamExecutionPolicyAtom(teamId));
  const organizationProviders = useAtomValue(
    teamOrganizationProvidersAtom(teamId),
  );
  const teams = useAtomValue(teamsAtom);
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const updatingIssueId = useAtomValue(updatingIssueIdAtom);
  const deletingIssueId = useAtomValue(deletingIssueIdAtom);
  const recoveringRunId = useAtomValue(recoveringRunIdAtom);
  const recoveryError = useAtomValue(recoveryErrorAtom);
  const issueActions = useIssueActions();
  const runDetailActions = useRunDetailActions();

  /**
   * The providers the account may pick from: the organization's list when the
   * payload carries one, and otherwise whatever the team's workers advertise.
   */
  const availableProviders = useMemo((): AgentProvider[] => {
    if (organizationProviders && organizationProviders.length > 0) {
      return organizationProviders;
    }
    return [
      ...new Set((workers ?? []).flatMap((worker) => worker.providers)),
    ];
  }, [organizationProviders, workers]);

  const callbacks = useMemo(
    () => ({
      onAcceptIssueAction: (proposal: Parameters<
        typeof issueActions.acceptConversationIssueAction
      >[1]) => issueActions.acceptConversationIssueAction(runId, proposal),
      onAcceptIssueExecution: (
        proposal: Parameters<
          typeof issueActions.acceptConversationIssueExecution
        >[1],
        input: Parameters<
          typeof issueActions.acceptConversationIssueExecution
        >[2],
      ) => issueActions.acceptConversationIssueExecution(runId, proposal, input),
      onAcceptSkillExecution: (
        proposal: Parameters<
          typeof issueActions.acceptConversationSkillExecution
        >[1],
        input: Parameters<
          typeof issueActions.acceptConversationSkillExecution
        >[2],
      ) => issueActions.acceptConversationSkillExecution(runId, proposal, input),
      onAddDependency: (prerequisiteRunId: string) =>
        issueActions.changeIssueDependency(runId, prerequisiteRunId, "add"),
      onAddRelated: (relatedRunId: string) =>
        issueActions.changeRelatedIssue(runId, relatedRunId, "add"),
      onCancel: () => issueActions.recoverRun(runId, "cancel"),
      onCompleteResultReview: () => issueActions.completeResultReview(runId),
      onDeleteIssueMessage: (messageId: string) =>
        runDetailActions.removeIssueMessage(runId, messageId),
      onEditIssueMessage: (
        messageId: string,
        input: { body: string; mentionedUserIds?: string[] },
      ) => runDetailActions.updateIssueMessage(runId, messageId, input),
      onLinkSubIssue: (childRunId: string) =>
        issueActions.changeIssueParent(childRunId, runId),
      onLoadAttachment: issueActions.readIssueAttachment,
      onLoadIssueMessages: () => runDetailActions.readIssueMessages(runId),
      onLoadRunEvents: () => runDetailActions.readRunEvents(runId),
      onLoadRunEvidence: () => runDetailActions.readRunEvidence(runId),
      onLoadRunEvidenceImage: runDetailActions.readRunEvidenceImage,
      onMove: (placement: Parameters<typeof issueActions.moveRun>[1]) =>
        issueActions.moveRun(runId, placement),
      onRemoveDependency: (prerequisiteRunId: string) =>
        issueActions.changeIssueDependency(runId, prerequisiteRunId, "remove"),
      onRemoveRelated: (relatedRunId: string) =>
        issueActions.changeRelatedIssue(runId, relatedRunId, "remove"),
      onResume: () => issueActions.resumeRun(runId),
      onRetry: () => issueActions.recoverRun(runId, "retry"),
      onRework: (input: { workflowStage: string; reason: string }) =>
        issueActions.reworkRun(runId, input),
      onSetParent: (parentRunId: string | null) =>
        issueActions.changeIssueParent(runId, parentRunId),
      onUnlinkSubIssue: (childRunId: string) =>
        issueActions.changeIssueParent(childRunId, null),
      onUpdateIssue: (input: Parameters<typeof issueActions.editIssue>[1]) =>
        issueActions.editIssue(runId, input),
      onUpdateIssueCheckpoints: (
        checkpoints: Parameters<typeof issueActions.editIssueCheckpoints>[1],
      ) => issueActions.editIssueCheckpoints(runId, checkpoints),
      onUpdateIssuePreferences: (
        input: Parameters<
          typeof issueActions.editIssueExecutionPreferences
        >[1],
      ) => issueActions.editIssueExecutionPreferences(runId, input),
      onUpdateIssueSubscription: (subscribed: boolean) =>
        issueActions.editIssueSubscription(runId, subscribed),
    }),
    [issueActions, runDetailActions, runId],
  );

  if (!run) return null;
  return (
    <RunPage
      {...props}
      {...callbacks}
      availableProviders={availableProviders}
      availableRuns={runs ?? []}
      currentUserId={user?.id ?? null}
      error={recoveryError}
      executionPolicy={executionPolicy ?? undefined}
      executionWorkers={workers ?? []}
      isDeletingIssue={deletingIssueId === runId}
      isRecovering={recoveringRunId === runId}
      isUpdatingIssue={updatingIssueId === runId}
      issueKeyPrefix={team?.issueKeyPrefix}
      mentionMembers={members ?? []}
      organizationId={
        teams.find((team) => team.id === props.projectId)?.organizationId ?? null
      }
      run={run}
      token={token}
    />
  );
}
