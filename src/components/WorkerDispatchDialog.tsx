import {
  Check,
  CircleAlert,
  Cpu,
  LoaderCircle,
  Waypoints,
  BrainCircuit,
} from "lucide-react";
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
import {
  agentEfforts,
  agentModels,
  agentProviders,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
import type {
  ExecutionWorker,
  HuntRun,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { NativeSelect } from "./NativeSelect";
import { WorkerIcon } from "./WorkerIcon";

export function WorkerDispatchDialog({
  error,
  isDispatching,
  onOpenChange,
  onSubmit,
  open,
  policy,
  run,
  workers,
}: {
  error: string | null;
  isDispatching: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
  }) => void;
  open: boolean;
  policy?: ProjectExecutionWorkerPolicy;
  run: HuntRun | null;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [workerId, setWorkerId] = useState("");
  const policyWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          policy?.selectionMode !== "allowlist" ||
          policy.allowedWorkerIds.includes(worker.id),
      ),
    [policy, workers],
  );
  const healthyProviders = useMemo(
    () =>
      agentProviders.filter((candidate) =>
        policyWorkers.some(
          (worker) =>
            (worker.providers ?? []).includes(candidate) &&
            worker.acceptingWork &&
            (worker.readiness === "available" ||
              worker.readiness === "busy"),
        ),
      ),
    [policyWorkers],
  );
  const eligibleWorkers = useMemo(
    () =>
      policyWorkers.filter(
        (worker) =>
          (worker.providers ?? []).includes(provider) &&
          worker.acceptingWork &&
          worker.readiness !== "disabled",
      ),
    [policyWorkers, provider],
  );

  useEffect(() => {
    if (!open) return;
    const preferredWorker = policyWorkers.find(
      (worker) =>
        worker.id === (run?.requestedWorkerId ?? policy?.defaultWorkerId),
    );
    const initialProvider =
      run?.preferredProvider ??
      run?.requestedProvider ??
      preferredWorker?.agentProvider ??
      healthyProviders[0] ??
      "codex";
    setProvider(initialProvider);
    setModel(
      run?.preferredProvider
        ? (run.preferredModel ?? "")
        : run?.requestedProvider
          ? (run.requestedModel ?? "")
          : "",
    );
    setEffort(
      run?.preferredProvider
        ? (run.preferredEffort ?? "")
        : (run?.requestedEffort ?? ""),
    );
    setWorkerId(run?.requestedWorkerId ?? policy?.defaultWorkerId ?? "");
  }, [
    healthyProviders,
    open,
    policy?.defaultWorkerId,
    policyWorkers,
    run?.preferredEffort,
    run?.preferredModel,
    run?.preferredProvider,
    run?.requestedEffort,
    run?.requestedModel,
    run?.requestedProvider,
    run?.requestedWorkerId,
  ]);

  useEffect(() => {
    if (!model && effort) setEffort("");
  }, [effort, model]);

  useEffect(() => {
    if (!open || healthyProviders.length === 0) return;
    if (healthyProviders.includes(provider)) return;
    setProvider(healthyProviders[0]);
  }, [healthyProviders, open, provider]);

  useEffect(() => {
    if (workerId === "") return;
    const selectedWorker = eligibleWorkers.find(
      (worker) => worker.id === workerId && worker.readiness === "available",
    );
    if (selectedWorker) return;
    setWorkerId("");
  }, [eligibleWorkers, workerId]);

  const canDispatch = workerId === ""
    ? eligibleWorkers.length > 0
    : eligibleWorkers.some(
        (worker) => worker.id === workerId && worker.readiness === "available",
      );
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
            <span><Waypoints size={15} />{t("worker.provider")}</span>
            <NativeSelect
              label={t("worker.provider")}
              onValueChange={(value) => {
                setProvider(value as AgentProvider);
                setModel("");
                setEffort("");
              }}
              options={healthyProviders.map((candidate) => ({
                label:
                  candidate === "codex"
                    ? "Codex"
                    : candidate === "claude"
                      ? "Claude"
                      : candidate === "grok"
                        ? "Grok"
                        : "OpenCode",
                value: candidate,
              }))}
              value={provider}
            />
          </label>
          <label>
            <span><BrainCircuit size={15} />{t("issue.preferredModel")}</span>
            <NativeSelect
              label={t("issue.preferredModel")}
              onValueChange={(value) => {
                setModel(value);
                if (!value) setEffort("");
              }}
              options={agentModels[provider].map((option) => ({
                ...option,
                label: option.value
                  ? option.label
                  : t("settings.providerDefaultModel"),
              }))}
              value={model}
            />
          </label>
          <label>
            <span><BrainCircuit size={15} />{t("settings.effort")}</span>
            <NativeSelect
              disabled={!model}
              label={t("settings.effort")}
              onValueChange={setEffort}
              options={[
                {
                  label: t("settings.providerDefaultEffort"),
                  value: "",
                },
                ...agentEfforts[provider].map((candidate) => ({
                  label: candidate,
                  value: candidate,
                })),
              ]}
              value={effort}
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
                  value: "",
                },
                ...eligibleWorkers.map((worker) => ({
                  disabled: worker.readiness !== "available",
                  label: `${worker.icon?.type === "emoji" ? `${worker.icon.value} ` : ""}${worker.label} · ${t(`worker.readiness.${worker.readiness}` as MessageKey)}`,
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
              <>
                <button
                  aria-pressed={workerId === ""}
                  className="worker-readiness-row"
                  onClick={() => setWorkerId("")}
                  type="button"
                >
                  <span className="worker-readiness-dot any" />
                  <span className="worker-readiness-any-icon">
                    <Waypoints size={30} />
                  </span>
                  <span>
                    <strong>{t("worker.anyAvailable")}</strong>
                    <small>{t("worker.anyAvailableDetail")}</small>
                  </span>
                  <Check
                    aria-hidden="true"
                    className="worker-readiness-check"
                    size={16}
                  />
                </button>
                {eligibleWorkers.map((worker) => (
                  <button
                    aria-pressed={workerId === worker.id}
                    className="worker-readiness-row"
                    disabled={worker.readiness !== "available"}
                    key={worker.id}
                    onClick={() => setWorkerId(worker.id)}
                    type="button"
                  >
                    <span className={`worker-readiness-dot ${worker.readiness}`} />
                    <WorkerIcon icon={worker.icon} size={30} />
                    <span>
                      <strong>{worker.label}</strong>
                      <small>
                        {t(`worker.readiness.${worker.readiness}` as MessageKey)}
                        {worker.readinessDetail
                          ? ` · ${worker.readinessDetail}`
                          : ""}
                      </small>
                    </span>
                    <Check
                      aria-hidden="true"
                      className="worker-readiness-check"
                      size={16}
                    />
                  </button>
                ))}
              </>
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
                provider,
                model: model || null,
                effort: (effort || null) as ModelEffort | null,
                workerId: workerId || null,
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
