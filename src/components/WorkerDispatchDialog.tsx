import { Bot, CircleAlert, Cpu, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type {
  ExecutionWorker,
  HuntRun,
  ProjectAgent,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { NativeSelect } from "./NativeSelect";

export function WorkerDispatchDialog({
  agents,
  error,
  isDispatching,
  onOpenChange,
  onSubmit,
  open,
  policy,
  run,
  workers,
}: {
  agents: ProjectAgent[];
  error: string | null;
  isDispatching: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { agentId: string; workerId: string | null }) => void;
  open: boolean;
  policy?: ProjectExecutionWorkerPolicy;
  run: HuntRun | null;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [agentId, setAgentId] = useState("");
  const [workerId, setWorkerId] = useState("any");
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const eligibleWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          (policy?.selectionMode !== "allowlist" ||
            policy.allowedWorkerIds.includes(worker.id)) &&
          worker.agentProvider === selectedAgent?.provider &&
          worker.acceptingWork &&
          worker.readiness !== "disabled",
      ),
    [policy, selectedAgent?.provider, workers],
  );

  useEffect(() => {
    if (!open) return;
    const preferredAgent =
      agents.find((agent) => agent.id === run?.agentId) ?? agents[0] ?? null;
    setAgentId(preferredAgent?.id ?? "");
    setWorkerId(run?.requestedWorkerId ?? policy?.defaultWorkerId ?? "any");
  }, [
    agents,
    open,
    policy?.defaultWorkerId,
    run?.agentId,
    run?.requestedWorkerId,
  ]);

  useEffect(() => {
    if (workerId === "any") return;
    if (!eligibleWorkers.some((worker) => worker.id === workerId)) {
      setWorkerId("any");
    }
  }, [eligibleWorkers, workerId]);

  const available = eligibleWorkers.filter(
    (worker) => worker.readiness === "available",
  );
  const canDispatch =
    Boolean(selectedAgent) &&
    (workerId === "any"
      ? available.length > 0
      : available.some((worker) => worker.id === workerId));
  const isReassign = Boolean(run?.dispatchedAt || run?.workerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("worker.dispatchTitle")}</DialogTitle>
          <DialogDescription>
            {t("worker.dispatchDescription", { title: run?.title ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="worker-dispatch-form">
          <label>
            <span><Bot size={15} />{t("worker.agent")}</span>
            <NativeSelect
              label={t("worker.agent")}
              onValueChange={setAgentId}
              options={agents.map((agent) => ({
                label: `${agent.name} · ${agent.provider}`,
                value: agent.id,
              }))}
              value={agentId}
            />
          </label>
          <label>
            <span><Cpu size={15} />{t("worker.executionEnvironment")}</span>
            <NativeSelect
              label={t("worker.executionEnvironment")}
              onValueChange={setWorkerId}
              options={[
                {
                  label: t("worker.anyAvailable"),
                  value: "any",
                },
                ...eligibleWorkers.map((worker) => ({
                  label: `${worker.label} · ${t(`worker.readiness.${worker.readiness}` as MessageKey)}`,
                  value: worker.id,
                })),
              ]}
              value={workerId}
            />
          </label>

          <div className="worker-readiness-list">
            {eligibleWorkers.length === 0 ? (
              <p><CircleAlert size={15} />{t("worker.noneForProvider")}</p>
            ) : (
              eligibleWorkers.map((worker) => (
                <div className="worker-readiness-row" key={worker.id}>
                  <span className={`worker-readiness-dot ${worker.readiness}`} />
                  <span>
                    <strong>{worker.label}</strong>
                    <small>
                      {t(`worker.readiness.${worker.readiness}` as MessageKey)}
                      {worker.readinessDetail
                        ? ` · ${worker.readinessDetail}`
                        : ""}
                    </small>
                  </span>
                </div>
              ))
            )}
          </div>
          {error && <p className="run-status-error"><CircleAlert size={13} />{error}</p>}
        </div>

        <DialogFooter>
          <Button
            disabled={isDispatching}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!canDispatch || isDispatching}
            onClick={() =>
              onSubmit({
                agentId,
                workerId: workerId === "any" ? null : workerId,
              })
            }
          >
            {isDispatching && <LoaderCircle className="spin" size={15} />}
            {t(isReassign ? "worker.reassign" : "worker.dispatch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
