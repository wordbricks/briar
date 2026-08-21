import {
  Check,
  CircleAlert,
  Cpu,
  Waypoints,
  BrainCircuit,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  agentEffortOptions,
  agentModelOptions,
  agentProviders,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import { useAgentProviderModelPreferences } from "../hooks/useAgentProviderModelPreferences";
import type {
  ExecutionWorker,
  HuntRun,
  IssueExecutionApprovalInput,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { NativeSelect } from "./NativeSelect";
import { ProviderSelect } from "./ProviderSelect";
import { WorkerIcon } from "./WorkerIcon";

export function WorkerDispatchDialog({
  didDispatchSuccessfully = false,
  error,
  initialSelection = null,
  intent = "dispatch",
  isDispatching,
  onOpenChange,
  onSubmit,
  open,
  policy,
  run,
  selectionKey,
  submissionDisabled = false,
  targetTitle,
  workers,
}: {
  didDispatchSuccessfully?: boolean;
  error: string | null;
  initialSelection?: IssueExecutionApprovalInput | null;
  intent?: "dispatch" | "approve_execution" | "create_and_execute";
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
  selectionKey?: string;
  submissionDisabled?: boolean;
  targetTitle?: string;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [workerId, setWorkerId] = useState("");
  const providerModels = useAgentProviderModels(open);
  const providerModelPreferences = useAgentProviderModelPreferences();
  const selectionSessionRef = useRef<string | null>(null);
  const selectionDirtyRef = useRef(false);
  const initializingProviderRef = useRef<AgentProvider | null>(null);
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
  const modelOptions = useMemo(
    () =>
      agentModelOptions(
        providerModels,
        provider,
        t("settings.providerDefaultModel"),
        model,
        providerModelPreferences[provider].favoriteModels,
      ),
    [model, provider, providerModelPreferences, providerModels, t],
  );
  const selectedModelKnown = modelOptions.some(
    (option) => option.value === model,
  );
  const normalizedModel = model.trim();
  const selectionSessionKey = run?.id ?? selectionKey ?? "__without-run__";

  useEffect(() => {
    if (!open) {
      selectionSessionRef.current = null;
      selectionDirtyRef.current = false;
      initializingProviderRef.current = null;
      return;
    }
    const startsNewSelectionSession =
      selectionSessionRef.current !== selectionSessionKey;
    if (!startsNewSelectionSession && selectionDirtyRef.current) return;
    selectionSessionRef.current = selectionSessionKey;
    const preferredWorker = policyWorkers.find(
      (worker) =>
        worker.id === (
          initialSelection?.workerId ??
          run?.requestedWorkerId ??
          policy?.defaultWorkerId
        ),
    );
    const initialProvider =
      (initialSelection && healthyProviders.includes(initialSelection.provider)
        ? initialSelection.provider
        : null) ??
      run?.preferredProvider ??
      run?.requestedProvider ??
      preferredWorker?.agentProvider ??
      healthyProviders[0] ??
      "codex";
    initializingProviderRef.current = initialProvider;
    const requestedModel = initialSelection
      ? initialSelection.model
      : run?.preferredProvider
        ? run.preferredModel
        : run?.requestedProvider
          ? run.requestedModel
          : null;
    setProvider(initialProvider);
    setModel(
      requestedModel ??
        providerModelPreferences[initialProvider].defaultModel ??
        "",
    );
    setEffort(
      initialSelection
        ? (initialSelection.effort ?? "")
        : run?.preferredProvider
          ? (run.preferredEffort ?? "")
          : (run?.requestedEffort ?? ""),
    );
    setWorkerId(
      initialSelection?.workerId ??
      run?.requestedWorkerId ??
      policy?.defaultWorkerId ??
      "",
    );
  }, [
    healthyProviders,
    initialSelection,
    open,
    policy?.defaultWorkerId,
    policyWorkers,
    providerModelPreferences,
    run?.preferredEffort,
    run?.preferredModel,
    run?.preferredProvider,
    run?.requestedEffort,
    run?.requestedModel,
    run?.requestedProvider,
    run?.requestedWorkerId,
    selectionSessionKey,
  ]);

  useEffect(() => {
    if (!normalizedModel && effort) setEffort("");
  }, [effort, normalizedModel]);

  useEffect(() => {
    if (!open || healthyProviders.length === 0) return;
    if (
      initializingProviderRef.current &&
      provider !== initializingProviderRef.current
    ) return;
    initializingProviderRef.current = null;
    if (healthyProviders.includes(provider)) return;
    const nextProvider = healthyProviders[0];
    setProvider(nextProvider);
    setModel(providerModelPreferences[nextProvider].defaultModel ?? "");
    setEffort("");
  }, [healthyProviders, open, provider, providerModelPreferences]);

  useEffect(() => {
    if (workerId === "") return;
    const selectedWorker = eligibleWorkers.find(
      (worker) => worker.id === workerId && worker.readiness === "available",
    );
    if (selectedWorker) return;
    setWorkerId("");
  }, [eligibleWorkers, workerId]);

  const providerIsHealthy = healthyProviders.includes(provider);
  const canDispatch = providerIsHealthy && (workerId === ""
    ? eligibleWorkers.some(
        (worker) => worker.readiness === "available" ||
          worker.readiness === "busy",
      )
    : eligibleWorkers.some(
        (worker) => worker.id === workerId && worker.readiness === "available",
      ));
  const isReassign = Boolean(run?.dispatchedAt || run?.workerId);
  const isApproval = intent === "approve_execution";
  const isCreateAndExecute = intent === "create_and_execute";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              isCreateAndExecute
                ? "worker.createExecutionApprovalTitle"
                : isApproval
                  ? "worker.executionApprovalTitle"
                  : "worker.dispatchTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              isCreateAndExecute
                ? "worker.createExecutionApprovalDescription"
                : isApproval
                  ? "worker.executionApprovalDescription"
                  : "worker.dispatchDescription",
              { title: targetTitle ?? run?.title ?? "" },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="worker-dispatch-form">
          <label>
            <span><Waypoints size={15} />{t("worker.provider")}</span>
            <ProviderSelect
              label={t("worker.provider")}
              onValueChange={(value) => {
                selectionDirtyRef.current = true;
                const nextProvider = value as AgentProvider;
                setProvider(nextProvider);
                setModel(
                  providerModelPreferences[nextProvider].defaultModel ?? "",
                );
                setEffort("");
              }}
              providers={healthyProviders}
              value={provider}
            />
          </label>
          <label>
            <span><BrainCircuit size={15} />{t("issue.preferredModel")}</span>
            <NativeSelect
              label={t("issue.preferredModel")}
              onValueChange={(value) => {
                selectionDirtyRef.current = true;
                setModel(value);
                setEffort("");
              }}
              options={[
                ...(!selectedModelKnown && model
                  ? [{ label: model, value: model }]
                  : []),
                ...modelOptions,
              ]}
              searchable={provider === "opencode" || provider === "agy"}
              searchEmptyMessage={t("issue.noModelsFound")}
              searchPlaceholder={t("issue.searchModels")}
              value={model}
            />
          </label>
          <label>
            <span><BrainCircuit size={15} />{t("settings.effort")}</span>
            <NativeSelect
              disabled={!normalizedModel}
              label={t("settings.effort")}
              onValueChange={(value) => {
                selectionDirtyRef.current = true;
                setEffort(value);
              }}
              options={[
                {
                  label: t("settings.providerDefaultEffort"),
                  value: "",
                },
                ...agentEffortOptions(
                  providerModels,
                  provider,
                  normalizedModel,
                  effort,
                ),
              ]}
              value={effort}
            />
          </label>
          <label>
            <span><Cpu size={15} />{t("worker.executionEnvironment")}</span>
            <NativeSelect
              label={t("worker.executionEnvironment")}
              onValueChange={(value) => {
                selectionDirtyRef.current = true;
                setWorkerId(value);
              }}
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
                <ChoiceCard
                  className="worker-readiness-row"
                  description={t("worker.anyAvailableDetail")}
                  icon={<Waypoints />}
                  iconClassName="[&_svg]:size-[26px]"
                  layout="horizontal"
                  leading={<span className="worker-readiness-dot any" />}
                  onClick={() => {
                    selectionDirtyRef.current = true;
                    setWorkerId("");
                  }}
                  selected={workerId === ""}
                  title={t("worker.anyAvailable")}
                  trailing={workerId === "" ? <Check aria-hidden="true" /> : null}
                />
                {eligibleWorkers.map((worker) => (
                  <ChoiceCard
                    className="worker-readiness-row"
                    description={
                      <>
                        {t(`worker.readiness.${worker.readiness}` as MessageKey)}
                        {worker.readinessDetail
                          ? ` · ${worker.readinessDetail}`
                          : ""}
                      </>
                    }
                    disabled={worker.readiness !== "available"}
                    icon={<WorkerIcon icon={worker.icon} size={30} />}
                    iconClassName="bg-transparent"
                    key={worker.id}
                    layout="horizontal"
                    leading={
                      <span className={`worker-readiness-dot ${worker.readiness}`} />
                    }
                    onClick={() => {
                      selectionDirtyRef.current = true;
                      setWorkerId(worker.id);
                    }}
                    selected={workerId === worker.id}
                    title={worker.label}
                    trailing={
                      workerId === worker.id ? <Check aria-hidden="true" /> : null
                    }
                  />
                ))}
              </>
            )}
          </div>
          {error && (
            <p className="run-status-error" role="alert">
              <CircleAlert aria-hidden="true" size={13} />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={isDispatching || didDispatchSuccessfully}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            aria-label={
              didDispatchSuccessfully
                ? t(isApproval
                  ? "worker.executionApprovalComplete"
                  : "worker.dispatchComplete")
                : undefined
            }
            disabled={
              submissionDisabled || !canDispatch || isDispatching ||
              didDispatchSuccessfully
            }
            onClick={() =>
              onSubmit({
                provider,
                model: normalizedModel || null,
                effort: (effort || null) as ModelEffort | null,
                workerId: workerId || null,
              })
            }
          >
            {didDispatchSuccessfully ? (
              <Check aria-hidden="true" size={15} />
            ) : isDispatching ? (
              <Spinner size={15} />
            ) : null}
            {didDispatchSuccessfully
              ? t(isApproval
                ? "worker.executionApprovalComplete"
                : "worker.dispatchComplete")
              : t(isCreateAndExecute
                ? "worker.approveCreateExecution"
                : isApproval
                  ? "worker.approveExecution"
                  : isReassign
                    ? "worker.reassign"
                    : "worker.dispatch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
