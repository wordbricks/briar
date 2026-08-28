import { BadgeCheck, CircleAlert, Play } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { ChannelExecutionProposal } from "../lib/channels-contract";
import type { IssueExecutionApprovalInput } from "../types";
import type { ExecutionApprovalContext } from "./IssueExecutionApproval";
import { WorkerDispatchDialog } from "./WorkerDispatchDialog";

type Props = {
  creating: boolean;
  declining: boolean;
  disabledReason?: string | null;
  executionProposal?: ChannelExecutionProposal | null;
  issueAccepted: boolean;
  loadExecutionContext: () => Promise<ExecutionApprovalContext>;
  onAccept: (
    input: IssueExecutionApprovalInput,
  ) => Promise<string | null | undefined>;
  onCreate: () => Promise<string | null | undefined>;
  onDecline: () => void | Promise<void>;
  projectName?: string | null;
  proposalId: string;
  targetTitle: string;
};

/**
 * One approval boundary for the paired issue-create and execution request.
 * Opening the dialog only reviews settings. The parent sends both decisions
 * in the authenticated create-proposal acceptance request after the final click.
 */
export function IssueCreateExecutionApproval({
  creating,
  declining,
  disabledReason = null,
  executionProposal = null,
  issueAccepted,
  loadExecutionContext,
  onAccept,
  onCreate,
  onDecline,
  projectName = null,
  proposalId,
  targetTitle,
}: Props) {
  const { t } = useI18n();
  const [context, setContext] = useState<ExecutionApprovalContext | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const acceptingRef = useRef(false);
  const executionAccepted = executionProposal?.status === "accepted";
  const pending = !executionAccepted;
  const initialSelection = useMemo<IssueExecutionApprovalInput | null>(
    () => executionProposal?.requestedProvider
      ? {
          provider: executionProposal.requestedProvider,
          model: executionProposal.requestedModel,
          effort: executionProposal.requestedEffort,
          workerId: executionProposal.requestedWorkerId,
        }
      : null,
    [executionProposal],
  );

  useEffect(() => {
    openingRef.current = false;
    acceptingRef.current = false;
    setContext(null);
    setDialogOpen(false);
    setOpening(false);
    setAccepting(false);
    setError(null);
  }, [proposalId]);

  useEffect(() => {
    if (!executionAccepted && !disabledReason) return;
    setDialogOpen(false);
    setError(null);
  }, [disabledReason, executionAccepted]);

  const openApproval = useCallback(async () => {
    if (!pending || disabledReason || openingRef.current || acceptingRef.current) {
      return;
    }
    openingRef.current = true;
    setOpening(true);
    setError(null);
    try {
      setContext(await loadExecutionContext());
      setDialogOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, [disabledReason, loadExecutionContext, pending]);

  const accept = useCallback(async (input: IssueExecutionApprovalInput) => {
    if (!pending || disabledReason || acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    setError(null);
    try {
      // Refresh immediately before mutation. The server repeats project,
      // membership, policy, provider, and Worker checks authoritatively.
      setContext(await loadExecutionContext());
      const failure = await onAccept(input);
      if (failure) {
        setError(failure);
        return;
      }
      setDialogOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }, [disabledReason, loadExecutionContext, onAccept, pending]);

  const acceptedWorker = executionProposal?.requestedWorkerId ??
    t("worker.anyAvailable");

  return (
    <>
      {executionAccepted && executionProposal ? (
        <div className="execution-proposal-accepted">
          <BadgeCheck aria-hidden="true" size={15} />
          <span>
            {t("executionApproval.acceptedSettings", {
              provider: executionProposal.requestedProvider ?? "—",
              model: executionProposal.requestedModel ??
                t("settings.providerDefaultModel"),
              effort: executionProposal.requestedEffort ??
                t("settings.providerDefaultEffort"),
              worker: acceptedWorker,
            })}
          </span>
        </div>
      ) : (
        <div className="channel-proposal-actions">
          {!issueAccepted ? (
            <button
              aria-busy={creating}
              className="channel-proposal-create-button"
              disabled={Boolean(disabledReason) || creating || declining || opening || accepting}
              onClick={() => void onCreate()}
              type="button"
            >
              {creating ? <Spinner aria-hidden="true" size={15} /> : null}
              {creating ? t("channel.creatingIssue") : t("channel.createIssue")}
            </button>
          ) : null}
          <button
            aria-busy={opening || accepting}
            className="channel-proposal-approve-button"
            disabled={Boolean(disabledReason) || creating || declining || opening || accepting}
            onClick={() => void openApproval()}
            type="button"
          >
            {opening || accepting ? (
              <Spinner aria-hidden="true" size={15} />
            ) : (
              <Play aria-hidden="true" size={15} />
            )}
            {opening
              ? t("executionApproval.loading")
              : accepting
                ? t("channel.creatingIssue")
                : issueAccepted
                  ? t("channel.retryCreateExecution")
                  : t("channel.approveCreateAndExecute")}
          </button>
          {!issueAccepted ? (
            <button
              aria-busy={declining}
              className="channel-proposal-decline-button"
              disabled={Boolean(disabledReason) || creating || declining || opening || accepting}
              onClick={() => void onDecline()}
              type="button"
            >
              {declining ? <Spinner aria-hidden="true" size={15} /> : null}
              {declining
                ? t("channel.decliningIssueProposal")
                : t("channel.declineIssueProposal")}
            </button>
          ) : null}
        </div>
      )}
      {error || (pending ? disabledReason : null) ? (
        <p className="execution-proposal-error" role="alert">
          <CircleAlert aria-hidden="true" size={14} />
          {error ?? disabledReason}
        </p>
      ) : null}
      {projectName ? (
        <span className="execution-proposal-project">
          {t("executionApproval.project", { project: projectName })}
        </span>
      ) : null}
      <WorkerDispatchDialog
        error={error ?? disabledReason}
        initialSelection={initialSelection}
        intent="create_and_execute"
        isDispatching={accepting}
        onOpenChange={(open) => {
          if (!open && acceptingRef.current) return;
          setDialogOpen(open);
          if (!open) setError(null);
        }}
        onSubmit={(input) => void accept(input)}
        open={dialogOpen}
        policy={context?.policy}
        run={context?.run ?? null}
        selectionKey={proposalId}
        submissionDisabled={!pending || Boolean(disabledReason)}
        targetTitle={targetTitle}
        workers={context?.workers ?? []}
      />
    </>
  );
}
