import {
  BadgeCheck,
  CircleAlert,
  Play,
  ShieldCheck,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { issueExecutionApprovalUnavailable } from "../lib/issue-execution-approval";
import type { AgentProvider, ModelEffort } from "../lib/team-llm";
import type {
  ExecutionWorker,
  HuntRun,
  IssueExecutionApprovalInput,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { WorkerDispatchDialog } from "./WorkerDispatchDialog";

export type ExecutionProposalView = {
  id: string;
  status: "pending" | "accepted";
  projectId: string;
  runId: string;
  title: string;
  createdAt: string;
  acceptedAt: string | null;
  requestedProvider: AgentProvider | null;
  requestedModel: string | null;
  requestedEffort: ModelEffort | null;
  requestedWorkerId: string | null;
  delegatedByAgentId: string | null;
  delegatedByAgentName: string | null;
};

export type ExecutionApprovalContext = {
  run: HuntRun | null;
  workers: ExecutionWorker[];
  policy?: ProjectExecutionWorkerPolicy;
};

type Props<T extends ExecutionProposalView> = {
  disabledReason?: string | null;
  executionContext?: ExecutionApprovalContext;
  loadExecutionContext?: () => Promise<ExecutionApprovalContext>;
  onAccept: (input: IssueExecutionApprovalInput) => Promise<T>;
  onAccepted: (proposal: T) => void;
  onIssueOpen?: (runId: string) => void | Promise<void>;
  projectName?: string | null;
  proposal: T;
  surfaceKey: string;
};

/**
 * Shared approval boundary used by desktop channels, mobile Companion, and
 * issue conversations. Opening the card never dispatches work: the member must
 * review all execution settings and press the approval action in the dialog.
 */
export function IssueExecutionApproval<T extends ExecutionProposalView>({
  disabledReason = null,
  executionContext,
  loadExecutionContext,
  onAccept,
  onAccepted,
  onIssueOpen,
  projectName = null,
  proposal,
  surfaceKey,
}: Props<T>) {
  const { t } = useI18n();
  const [dialogContext, setDialogContext] =
    useState<ExecutionApprovalContext | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedProposal, setAcceptedProposal] = useState<T | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const openingRef = useRef(false);
  const acceptingRef = useRef(false);

  const displayProposal =
    acceptedProposal?.id === proposal.id && acceptedProposal.status === "accepted"
      ? acceptedProposal
      : proposal;
  const approvalBoundaryActive =
    proposal.status === "pending" && !disabledReason;
  const approvalBoundaryActiveRef = useRef(approvalBoundaryActive);
  approvalBoundaryActiveRef.current = approvalBoundaryActive;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    generation.current += 1;
    openingRef.current = false;
    acceptingRef.current = false;
    setOpening(false);
    setAccepting(false);
    setError(null);
    setDialogOpen(false);
    setDialogContext(null);
    setAcceptedProposal((current) =>
      current?.id === proposal.id &&
      current.status === "accepted" &&
      proposal.status === "pending"
        ? current
        : null,
    );
  }, [proposal.id, proposal.runId, surfaceKey]);

  useEffect(() => {
    if (approvalBoundaryActive) return;
    generation.current += 1;
    openingRef.current = false;
    acceptingRef.current = false;
    setOpening(false);
    setAccepting(false);
    setError(null);
    setDialogOpen(false);
    setDialogContext(null);
    if (proposal.status === "accepted") setAcceptedProposal(null);
  }, [approvalBoundaryActive, proposal.status]);

  const getContext = useCallback(async () => {
    if (loadExecutionContext) return loadExecutionContext();
    if (executionContext) return executionContext;
    return { run: null, workers: [] } satisfies ExecutionApprovalContext;
  }, [executionContext, loadExecutionContext]);

  useEffect(() => {
    if (
      proposal.status !== "accepted" ||
      !proposal.requestedWorkerId ||
      executionContext ||
      !loadExecutionContext
    ) return;
    const requestGeneration = generation.current;
    let cancelled = false;
    void loadExecutionContext()
      .then((context) => {
        if (
          cancelled || !mounted.current ||
          generation.current !== requestGeneration
        ) return;
        setDialogContext(context);
      })
      .catch(() => {
        // Accepted approval history remains usable with its immutable Worker
        // ID when the friendly-label lookup is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [
    executionContext,
    loadExecutionContext,
    proposal.id,
    proposal.requestedWorkerId,
    proposal.status,
    surfaceKey,
  ]);

  const unavailableMessage = useCallback(
    (reason: ReturnType<typeof issueExecutionApprovalUnavailable>) => {
      if (reason === "prerequisites") {
        return t("executionApproval.prerequisites");
      }
      if (reason === "state_changed") {
        return t("executionApproval.stateChanged");
      }
      return t("executionApproval.targetUnavailable");
    },
    [t],
  );

  const openApproval = useCallback(async () => {
    if (
      !approvalBoundaryActiveRef.current ||
      displayProposal.status !== "pending" ||
      disabledReason ||
      openingRef.current ||
      acceptingRef.current
    ) return;
    const requestGeneration = ++generation.current;
    openingRef.current = true;
    setOpening(true);
    setError(null);
    try {
      const context = await getContext();
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !approvalBoundaryActiveRef.current
      ) return;
      const unavailable = issueExecutionApprovalUnavailable(
        context.run,
        displayProposal.runId,
      );
      if (unavailable) {
        setError(unavailableMessage(unavailable));
        return;
      }
      setDialogContext(context);
      setDialogOpen(true);
    } catch (caught) {
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !approvalBoundaryActiveRef.current
      ) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current && generation.current === requestGeneration) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  }, [
    disabledReason,
    displayProposal.status,
    displayProposal.runId,
    getContext,
    unavailableMessage,
  ]);

  const acceptExecution = useCallback(async (
    input: IssueExecutionApprovalInput,
  ) => {
    if (
      !approvalBoundaryActiveRef.current ||
      displayProposal.status !== "pending" ||
      disabledReason ||
      acceptingRef.current
    ) return;
    const requestGeneration = generation.current;
    acceptingRef.current = true;
    setAccepting(true);
    setError(null);
    try {
      // Re-read the target immediately before the mutation. This catches a
      // transfer, assignment, or prerequisite change while the dialog was open.
      const context = await getContext();
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !approvalBoundaryActiveRef.current
      ) return;
      const unavailable = issueExecutionApprovalUnavailable(
        context.run,
        displayProposal.runId,
      );
      if (unavailable) {
        setDialogContext(context);
        setError(unavailableMessage(unavailable));
        setDialogOpen(false);
        return;
      }
      setDialogContext(context);
      if (!approvalBoundaryActiveRef.current) return;
      const accepted = await onAccept(input);
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !approvalBoundaryActiveRef.current
      ) return;
      setAcceptedProposal(accepted);
      setDialogOpen(false);
      onAccepted(accepted);
    } catch (caught) {
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !approvalBoundaryActiveRef.current
      ) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current && generation.current === requestGeneration) {
        acceptingRef.current = false;
        setAccepting(false);
      }
    }
  }, [
    disabledReason,
    displayProposal.status,
    displayProposal.runId,
    getContext,
    onAccept,
    onAccepted,
    unavailableMessage,
  ]);

  const workerLabel = useMemo(() => {
    if (!displayProposal.requestedWorkerId) {
      return t("worker.anyAvailable");
    }
    return dialogContext?.workers.find(
      (worker) => worker.id === displayProposal.requestedWorkerId,
    )?.label ?? executionContext?.workers.find(
      (worker) => worker.id === displayProposal.requestedWorkerId,
    )?.label ?? displayProposal.requestedWorkerId;
  }, [
    dialogContext?.workers,
    executionContext?.workers,
    displayProposal.requestedWorkerId,
    t,
  ]);

  return (
    <>
      <section className="execution-proposal-card">
        <header>
          <span className="execution-proposal-icon" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <span>
            <strong>{t("executionApproval.cardTitle")}</strong>
            <small>
              {displayProposal.status === "accepted"
                ? t("executionApproval.accepted")
                : t("executionApproval.pending")}
            </small>
          </span>
        </header>
        <strong className="execution-proposal-target">
          {displayProposal.title || dialogContext?.run?.title ||
            displayProposal.runId}
        </strong>
        {projectName ? (
          <span className="execution-proposal-project">
            {t("executionApproval.project", { project: projectName })}
          </span>
        ) : null}
        {displayProposal.delegatedByAgentName ? (
          <span className="execution-proposal-delegation">
            {t("executionApproval.delegatedBy", {
              agent: displayProposal.delegatedByAgentName,
            })}
          </span>
        ) : null}
        {displayProposal.status === "accepted" ? (
          <div className="execution-proposal-accepted">
            <BadgeCheck aria-hidden="true" size={15} />
            <span>
              {t("executionApproval.acceptedSettings", {
                provider: displayProposal.requestedProvider ?? "—",
                model: displayProposal.requestedModel ??
                  t("settings.providerDefaultModel"),
                effort: displayProposal.requestedEffort ??
                  t("settings.providerDefaultEffort"),
                worker: workerLabel,
              })}
            </span>
          </div>
        ) : (
          <p>{t("executionApproval.separateBoundary")}</p>
        )}
        {error || (
          displayProposal.status === "pending" ? disabledReason : null
        ) ? (
          <p className="execution-proposal-error" role="alert">
            <CircleAlert aria-hidden="true" size={14} />
            {error ?? (displayProposal.status === "pending"
              ? disabledReason
              : null)}
          </p>
        ) : null}
        <footer>
          {displayProposal.status === "pending" ? (
            <button
              className="execution-proposal-approve"
              disabled={Boolean(disabledReason) || opening || accepting}
              onClick={() => void openApproval()}
              type="button"
            >
              {opening ? (
                <Spinner aria-hidden="true" size={15} />
              ) : (
                <Play aria-hidden="true" size={15} />
              )}
              {opening
                ? t("executionApproval.loading")
                : t("executionApproval.review")}
            </button>
          ) : onIssueOpen ? (
            <button
              className="execution-proposal-view"
              onClick={() => void onIssueOpen(
                displayProposal.runId,
              )}
              type="button"
            >
              {t("channel.viewIssue")}
            </button>
          ) : null}
        </footer>
      </section>

      <WorkerDispatchDialog
        didDispatchSuccessfully={displayProposal.status === "accepted"}
        error={error ?? disabledReason}
        intent="approve_execution"
        isDispatching={accepting}
        onOpenChange={(open) => {
          if (open && !approvalBoundaryActiveRef.current) return;
          if (!open && acceptingRef.current) return;
          setDialogOpen(open);
          if (!open) setError(null);
        }}
        onSubmit={(input) => void acceptExecution(input)}
        open={dialogOpen}
        policy={dialogContext?.policy}
        run={dialogContext?.run ?? null}
        submissionDisabled={!approvalBoundaryActive}
        workers={dialogContext?.workers ?? []}
      />
    </>
  );
}
