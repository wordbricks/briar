import {
  BadgeCheck,
  Bot,
  CircleAlert,
  Cpu,
  LoaderCircle,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  ExecutionWorker,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { NativeSelect } from "./NativeSelect";

export type AgentSkillExecutionContext = {
  workers: ExecutionWorker[];
  policy?: ProjectExecutionWorkerPolicy;
};

type Props<T extends AgentSkillExecutionProposal> = {
  disabledReason?: string | null;
  executionContext?: AgentSkillExecutionContext;
  loadExecutionContext?: () => Promise<AgentSkillExecutionContext>;
  onAccept: (input: AgentSkillExecutionApprovalInput) => Promise<T>;
  onAccepted: (proposal: T) => void;
  proposal: T;
  surfaceKey: string;
};

const workerSupportsProvider = (
  worker: ExecutionWorker,
  provider: AgentSkillExecutionProposal["provider"],
) => (worker.providers ?? [worker.agentProvider]).includes(provider);

const policyAllowsWorker = (
  worker: ExecutionWorker,
  policy?: ProjectExecutionWorkerPolicy,
) =>
  policy?.selectionMode !== "allowlist" ||
  policy.allowedWorkerIds.includes(worker.id);

const selectableWorker = (
  worker: ExecutionWorker,
  provider: AgentSkillExecutionProposal["provider"],
  policy?: ProjectExecutionWorkerPolicy,
) =>
  workerSupportsProvider(worker, provider) &&
  policyAllowsWorker(worker, policy) &&
  worker.acceptingWork &&
  worker.readiness === "available";

/**
 * Shared approval boundary for a natural-language request matched to a saved
 * Project Agent Skill. Runtime settings are immutable; approval only chooses
 * one exact, currently available Worker.
 */
export function AgentSkillExecutionApproval<
  T extends AgentSkillExecutionProposal,
>({
  disabledReason = null,
  executionContext,
  loadExecutionContext,
  onAccept,
  onAccepted,
  proposal,
  surfaceKey,
}: Props<T>) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContext, setDialogContext] =
    useState<AgentSkillExecutionContext | null>(null);
  const [workerId, setWorkerId] = useState("");
  const [opening, setOpening] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedProposal, setAcceptedProposal] = useState<T | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const openingRef = useRef(false);
  const acceptingRef = useRef(false);

  const displayProposal =
    acceptedProposal?.id === proposal.id && acceptedProposal.status === "accepted"
      ? acceptedProposal
      : proposal;
  const proposalSnapshotKey = JSON.stringify([
    proposal.id,
    proposal.type,
    proposal.projectId,
    proposal.agentId,
    proposal.agentName,
    proposal.skillId,
    proposal.skillName,
    proposal.request,
    proposal.provider,
    proposal.model,
    proposal.effort,
    proposal.createdAt,
    proposal.delegatedByAgentId,
    proposal.delegatedByAgentName,
  ]);
  const active = proposal.status === "pending" && !disabledReason;
  const activeRef = useRef(active);
  activeRef.current = active;

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
    setDialogOpen(false);
    setDialogContext(null);
    setWorkerId("");
    setOpening(false);
    setAccepting(false);
    setError(null);
    setAcceptedProposal((current) =>
      current?.id === proposal.id &&
      current.status === "accepted" &&
      proposal.status === "pending"
        ? current
        : null,
    );
  }, [proposal.id, proposal.projectId, proposalSnapshotKey, surfaceKey]);

  useEffect(() => {
    if (active) return;
    generation.current += 1;
    openingRef.current = false;
    acceptingRef.current = false;
    setDialogOpen(false);
    setWorkerId("");
    setOpening(false);
    setAccepting(false);
    setError(null);
    if (proposal.status === "accepted") setAcceptedProposal(null);
  }, [active, proposal.status]);

  const getContext = useCallback(async () => {
    if (loadExecutionContext) return loadExecutionContext();
    return executionContext ?? { workers: [] };
  }, [executionContext, loadExecutionContext]);

  useEffect(() => {
    if (
      proposal.status !== "accepted" ||
      proposal.requestedWorkerLabel ||
      !proposal.requestedWorkerId ||
      executionContext ||
      !loadExecutionContext
    ) return;
    const requestGeneration = generation.current;
    let cancelled = false;
    void loadExecutionContext()
      .then((context) => {
        if (
          cancelled ||
          !mounted.current ||
          generation.current !== requestGeneration
        ) return;
        setDialogContext(context);
      })
      .catch(() => {
        // The immutable Worker label/ID in history remains the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [
    executionContext,
    loadExecutionContext,
    proposal.id,
    proposal.requestedWorkerId,
    proposal.requestedWorkerLabel,
    proposal.status,
    surfaceKey,
  ]);

  const openApproval = useCallback(async () => {
    if (
      !activeRef.current ||
      openingRef.current ||
      acceptingRef.current ||
      displayProposal.status !== "pending"
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
        !activeRef.current
      ) return;
      setDialogContext(context);
      setWorkerId("");
      setDialogOpen(true);
    } catch (caught) {
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !activeRef.current
      ) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current && generation.current === requestGeneration) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  }, [displayProposal.status, getContext]);

  const accept = useCallback(async () => {
    if (
      !activeRef.current ||
      !workerId ||
      acceptingRef.current ||
      displayProposal.status !== "pending"
    ) return;
    const requestGeneration = generation.current;
    acceptingRef.current = true;
    setAccepting(true);
    setError(null);
    try {
      // Refresh immediately before the mutation. The UI does not treat the
      // Worker selected when opening the dialog as an authorization snapshot.
      const context = await getContext();
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !activeRef.current
      ) return;
      setDialogContext(context);
      const selected = context.workers.find(
        (worker) => worker.id === workerId,
      );
      if (!selected || !selectableWorker(
        selected,
        displayProposal.provider,
        context.policy,
      )) {
        setWorkerId("");
        setError(t("skillExecution.workerChanged"));
        return;
      }
      const accepted = await onAccept({ workerId });
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !activeRef.current
      ) return;
      setAcceptedProposal(accepted);
      setDialogOpen(false);
      onAccepted(accepted);
    } catch (caught) {
      if (
        !mounted.current ||
        generation.current !== requestGeneration ||
        !activeRef.current
      ) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current && generation.current === requestGeneration) {
        acceptingRef.current = false;
        setAccepting(false);
      }
    }
  }, [displayProposal.provider, displayProposal.status, getContext, onAccept, onAccepted, t, workerId]);

  const compatibleWorkers = useMemo(
    () => (dialogContext?.workers ?? executionContext?.workers ?? []).filter(
      (worker) =>
        workerSupportsProvider(worker, displayProposal.provider) &&
        policyAllowsWorker(
          worker,
          dialogContext?.policy ?? executionContext?.policy,
        ),
    ),
    [
      dialogContext?.policy,
      dialogContext?.workers,
      displayProposal.provider,
      executionContext?.policy,
      executionContext?.workers,
    ],
  );
  const selectableWorkers = useMemo(
    () => compatibleWorkers.filter((worker) =>
      selectableWorker(
        worker,
        displayProposal.provider,
        dialogContext?.policy ?? executionContext?.policy,
      )),
    [
      compatibleWorkers,
      dialogContext?.policy,
      displayProposal.provider,
      executionContext?.policy,
    ],
  );
  const hasSelectableWorker = selectableWorkers.length > 0;
  const canAccept = selectableWorkers.some((worker) => worker.id === workerId);
  const workerLabel =
    displayProposal.requestedWorkerLabel ??
    compatibleWorkers.find(
      (worker) => worker.id === displayProposal.requestedWorkerId,
    )?.label ??
    displayProposal.requestedWorkerId;

  return (
    <>
      <section className="skill-execution-proposal-card">
        <header>
          <span className="skill-execution-proposal-icon" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <span>
            <strong>{t("skillExecution.cardTitle")}</strong>
            <small>
              {displayProposal.status === "accepted"
                ? t("skillExecution.accepted")
                : t("skillExecution.pending")}
            </small>
          </span>
        </header>
        <dl className="skill-execution-proposal-details">
          <div><dt><Bot size={13} />{t("skillExecution.agent")}</dt><dd>{displayProposal.agentName}</dd></div>
          <div><dt><Sparkles size={13} />{t("skillExecution.skill")}</dt><dd>{displayProposal.skillName}</dd></div>
          <div className="skill-execution-proposal-request"><dt>{t("skillExecution.request")}</dt><dd>{displayProposal.request}</dd></div>
          <div><dt>{t("skillExecution.runtime")}</dt><dd>{displayProposal.provider} · {displayProposal.model ?? t("settings.providerDefaultModel")} · {displayProposal.effort ?? t("settings.providerDefaultEffort")}</dd></div>
        </dl>
        {displayProposal.delegatedByAgentName ? (
          <p>{t("skillExecution.delegatedBy", { agent: displayProposal.delegatedByAgentName })}</p>
        ) : null}
        {displayProposal.status === "accepted" ? (
          <div className="skill-execution-proposal-accepted">
            <BadgeCheck aria-hidden="true" size={15} />
            <span>
              <strong>{t("skillExecution.acceptedWorker", { worker: workerLabel ?? "—" })}</strong>
              {displayProposal.resultSessionId ? (
                <small>{t("skillExecution.sessionHistory", { id: displayProposal.resultSessionId })}</small>
              ) : null}
            </span>
          </div>
        ) : (
          <>
            <p>{t("skillExecution.separateBoundary")}</p>
            {disabledReason ? (
              <p className="skill-execution-proposal-error" role="alert">
                <CircleAlert aria-hidden="true" size={14} />
                {disabledReason}
              </p>
            ) : null}
            {error && !dialogOpen ? (
              <p className="skill-execution-proposal-error" role="alert">
                <CircleAlert aria-hidden="true" size={14} />
                {error}
              </p>
            ) : null}
            <footer>
              <button
                disabled={!active || opening || accepting}
                onClick={() => void openApproval()}
                type="button"
              >
                {opening ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
                {opening ? t("skillExecution.loading") : t("skillExecution.review")}
              </button>
            </footer>
          </>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!accepting) setDialogOpen(open);
        }}
      >
        <DialogContent className="skill-execution-approval-dialog">
          <div className="skill-execution-approval-scroll">
            <DialogHeader>
              <DialogTitle>{t("skillExecution.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("skillExecution.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <dl className="skill-execution-approval-runtime">
              <div><dt>{t("skillExecution.agent")}</dt><dd>{displayProposal.agentName}</dd></div>
              <div><dt>{t("skillExecution.skill")}</dt><dd>{displayProposal.skillName}</dd></div>
              <div><dt>{t("skillExecution.request")}</dt><dd>{displayProposal.request}</dd></div>
              <div><dt>{t("worker.provider")}</dt><dd>{displayProposal.provider}</dd></div>
              <div><dt>{t("issue.preferredModel")}</dt><dd>{displayProposal.model ?? t("settings.providerDefaultModel")}</dd></div>
              <div><dt>{t("settings.effort")}</dt><dd>{displayProposal.effort ?? t("settings.providerDefaultEffort")}</dd></div>
            </dl>
            <label className="skill-execution-worker-select">
              <span><Cpu size={15} />{t("skillExecution.exactWorker")}</span>
              <NativeSelect
                disabled={accepting || !hasSelectableWorker}
                label={t("skillExecution.exactWorker")}
                onValueChange={setWorkerId}
                options={compatibleWorkers.map((worker) => ({
                  disabled: !selectableWorker(
                    worker,
                    displayProposal.provider,
                    dialogContext?.policy ?? executionContext?.policy,
                  ),
                  label: `${worker.icon?.type === "emoji" ? `${worker.icon.value} ` : ""}${worker.label} · ${t(`worker.readiness.${worker.readiness}` as MessageKey)}`,
                  value: worker.id,
                }))}
                placeholder={t("skillExecution.selectWorker")}
                value={workerId}
              />
            </label>
            {!hasSelectableWorker ? (
              <p className="skill-execution-proposal-error" role="alert">
                <CircleAlert aria-hidden="true" size={14} />
                {t("skillExecution.noWorker")}
              </p>
            ) : null}
            {error ? (
              <p className="skill-execution-proposal-error" role="alert">
                <CircleAlert aria-hidden="true" size={14} />
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="skill-execution-approval-footer">
            <Button disabled={accepting} onClick={() => setDialogOpen(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={!canAccept || accepting} onClick={() => void accept()}>
              {accepting ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
              {accepting ? t("skillExecution.approving") : t("skillExecution.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
