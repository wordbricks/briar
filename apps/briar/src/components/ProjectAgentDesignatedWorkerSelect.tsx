import { useI18n } from "../i18n";
import {
  executionWorkerSupportsSelection,
  isProjectWorkerCatalogEligible,
  projectPolicyWorkers,
} from "../lib/project-worker-capabilities";
import type {
  ExecutionWorker,
  ProjectExecutionWorkerPolicy,
} from "../types";
import type { AgentProvider, ModelEffort } from "../lib/project-llm";
import { Label } from "./ui/label";
import { Typography } from "./ui/typography";
import { NativeSelect } from "./NativeSelect";

export function projectAgentDesignatedWorkerOptions(input: {
  workers: readonly ExecutionWorker[];
  policy?: ProjectExecutionWorkerPolicy;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  selectedWorkerId: string | null;
  selectedWorkerLabel: string | null;
  automaticLabel: string;
  unavailableLabel: (label: string) => string;
}) {
  const eligibleWorkers = projectPolicyWorkers(input.workers, input.policy)
    .filter((worker) =>
      isProjectWorkerCatalogEligible(worker) &&
      executionWorkerSupportsSelection(
        worker,
        input.provider,
        input.model,
        input.effort,
      )
    );
  const options = [
    { label: input.automaticLabel, value: "" },
    ...eligibleWorkers.map((worker) => ({
      label: worker.label,
      value: worker.id,
    })),
  ];
  if (
    input.selectedWorkerId &&
    !eligibleWorkers.some((worker) => worker.id === input.selectedWorkerId)
  ) {
    const liveWorker = input.workers.find(
      (worker) => worker.id === input.selectedWorkerId,
    );
    options.push({
      label: input.unavailableLabel(
        liveWorker?.label ?? input.selectedWorkerLabel ?? input.selectedWorkerId,
      ),
      value: input.selectedWorkerId,
    });
  }
  return options;
}

export function ProjectAgentDesignatedWorkerSelect({
  disabled,
  effort,
  model,
  onChange,
  policy,
  provider,
  selectedWorkerId,
  selectedWorkerLabel,
  workers,
}: {
  disabled?: boolean;
  effort: ModelEffort | null;
  model: string | null;
  onChange: (workerId: string | null) => void;
  policy?: ProjectExecutionWorkerPolicy;
  provider: AgentProvider;
  selectedWorkerId: string | null;
  selectedWorkerLabel: string | null;
  workers: readonly ExecutionWorker[];
}) {
  const { t } = useI18n();
  const options = projectAgentDesignatedWorkerOptions({
    workers,
    policy,
    provider,
    model,
    effort,
    selectedWorkerId,
    selectedWorkerLabel,
    automaticLabel: t("agents.designatedWorkerAutomatic"),
    unavailableLabel: (label) =>
      t("agents.designatedWorkerUnavailable", { worker: label }),
  });
  return (
    <div className="grid min-w-0 gap-2">
      <Label>{t("agents.designatedWorker")}</Label>
      <NativeSelect
        disabled={disabled}
        label={t("agents.designatedWorker")}
        onValueChange={(value) => onChange(value || null)}
        options={options}
        value={selectedWorkerId ?? ""}
      />
      <Typography as="small" tone="muted" variant="caption">
        {t("agents.designatedWorkerHint")}
      </Typography>
    </div>
  );
}
