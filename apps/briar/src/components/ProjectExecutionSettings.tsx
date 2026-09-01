import { Check, Cpu, Save } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useMemo, useState } from "react";

import {
  SettingsAlert,
  SettingsCard,
  SettingsSection,
} from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  loadProjectExecutionWorkerPolicy,
  updateProjectExecutionWorkerPolicy,
} from "../lib/api";
import type {
  ExecutionWorker,
  Project,
  ProjectExecutionWorkerPolicy,
} from "../types";
import { SelectMenu } from "./SelectMenu";
import { WorkerIcon } from "./WorkerIcon";
import { WorkerProviderIcons } from "./WorkerProviderIcons";

const defaultPolicy: ProjectExecutionWorkerPolicy = {
  selectionMode: "any",
  defaultWorkerId: null,
  allowedWorkerIds: [],
  updatedAt: null,
};

export function ProjectExecutionSettings({
  canManage,
  initialPolicy,
  project,
  token,
  workers,
}: {
  canManage: boolean;
  initialPolicy?: ProjectExecutionWorkerPolicy;
  project: Project;
  token: string | null;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState(initialPolicy ?? defaultPolicy);
  const [savedPolicy, setSavedPolicy] = useState(
    initialPolicy ?? defaultPolicy,
  );
  const [loading, setLoading] = useState(!initialPolicy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPolicy) {
      setPolicy(initialPolicy);
      setSavedPolicy(initialPolicy);
      setLoading(false);
      return;
    }
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadProjectExecutionWorkerPolicy(token, project.id)
      .then(({ policy: loaded }) => {
        if (cancelled) return;
        setPolicy(loaded);
        setSavedPolicy(loaded);
        setError(null);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPolicy, project.id, token]);

  const eligibleWorkers = useMemo(
    () =>
      policy.selectionMode === "any"
        ? workers
        : workers.filter((worker) =>
            policy.allowedWorkerIds.includes(worker.id),
          ),
    [policy.allowedWorkerIds, policy.selectionMode, workers],
  );
  const dirty =
    policy.selectionMode !== savedPolicy.selectionMode ||
    policy.defaultWorkerId !== savedPolicy.defaultWorkerId ||
    policy.allowedWorkerIds.join(",") !==
      savedPolicy.allowedWorkerIds.join(",");

  const setSelectionMode = (selectionMode: "any" | "allowlist") => {
    setPolicy((current) => {
      const allowedWorkerIds =
        selectionMode === "any"
          ? current.allowedWorkerIds
          : current.allowedWorkerIds;
      return {
        ...current,
        selectionMode,
        allowedWorkerIds,
        defaultWorkerId:
          selectionMode === "allowlist" &&
          current.defaultWorkerId &&
          !allowedWorkerIds.includes(current.defaultWorkerId)
            ? null
            : current.defaultWorkerId,
      };
    });
  };

  const toggleAllowedWorker = (workerId: string, enabled: boolean) => {
    setPolicy((current) => {
      const allowedWorkerIds = enabled
        ? [...new Set([...current.allowedWorkerIds, workerId])]
        : current.allowedWorkerIds.filter((id) => id !== workerId);
      return {
        ...current,
        allowedWorkerIds,
        defaultWorkerId:
          current.defaultWorkerId === workerId && !enabled
            ? null
            : current.defaultWorkerId,
      };
    });
  };

  const save = async () => {
    if (!token || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      const { policy: updated } = await updateProjectExecutionWorkerPolicy(
        token,
        project.id,
        {
          selectionMode: policy.selectionMode,
          defaultWorkerId: policy.defaultWorkerId,
          allowedWorkerIds: policy.allowedWorkerIds,
        },
      );
      setPolicy(updated);
      setSavedPolicy(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection>
      <SettingsCard aria-busy={loading || saving} className="p-5 shadow-xs">
        <header className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Cpu size={18} strokeWidth={1.8} />
          </span>
          <span className="grid min-w-0 gap-1">
            <Typography as="strong" variant="bodySm">
              {t("executionPolicy.title")}
            </Typography>
            <Typography as="small" tone="muted" variant="caption">
              {t("executionPolicy.description")}
            </Typography>
          </span>
        </header>

        {loading ? (
          <div className="grid min-h-32 place-items-center">
            <Spinner size={20} />
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-5">
              <Button
                className={`h-auto flex-col items-start gap-1 whitespace-normal rounded-lg p-4 text-left ${
                  policy.selectionMode === "any"
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
                disabled={!canManage}
                onClick={() => setSelectionMode("any")}
                type="button"
                variant="outline"
              >
                <Typography as="strong" className="block" variant="bodySm">
                  {t("executionPolicy.any")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("executionPolicy.anyDescription")}
                </Typography>
              </Button>
              <Button
                className={`h-auto flex-col items-start gap-1 whitespace-normal rounded-lg p-4 text-left ${
                  policy.selectionMode === "allowlist"
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
                disabled={!canManage}
                onClick={() => setSelectionMode("allowlist")}
                type="button"
                variant="outline"
              >
                <Typography as="strong" className="block" variant="bodySm">
                  {t("executionPolicy.allowlist")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("executionPolicy.allowlistDescription")}
                </Typography>
              </Button>
            </div>

            {policy.selectionMode === "allowlist" ? (
              <div className="border-t border-border">
                {workers.length === 0 ? (
                  <Typography className="p-5" tone="muted" variant="bodySm">
                    {t("executionPolicy.noWorkers")}
                  </Typography>
                ) : (
                  workers.map((worker) => (
                    <div
                      className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
                      key={worker.id}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <WorkerIcon icon={worker.icon} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Typography as="strong" variant="bodySm">
                              {worker.label}
                            </Typography>
                            <Badge variant="outline">
                              <WorkerProviderIcons
                                providers={
                                  worker.providers
                                }
                              />
                            </Badge>
                            <Badge
                              variant={
                                worker.readiness === "available"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {t(`worker.readiness.${worker.readiness}`)}
                            </Badge>
                          </div>
                          {worker.readinessDetail ? (
                            <Typography tone="muted" variant="micro">
                              {worker.readinessDetail}
                            </Typography>
                          ) : null}
                        </div>
                      </div>
                      <Switch
                        aria-label={t("executionPolicy.allowWorker", {
                          name: worker.label,
                        })}
                        checked={policy.allowedWorkerIds.includes(worker.id)}
                        disabled={!canManage}
                        onCheckedChange={(checked) =>
                          toggleAllowedWorker(worker.id, checked)
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <div className="grid gap-2 border-t border-border p-5">
              <Typography as="strong" variant="bodySm">
                {t("executionPolicy.defaultWorker")}
              </Typography>
              <Typography tone="muted" variant="caption">
                {t("executionPolicy.defaultWorkerDescription")}
              </Typography>
              <SelectMenu
                disabled={!canManage}
                label={t("executionPolicy.defaultWorker")}
                onValueChange={(value) =>
                  setPolicy((current) => ({
                    ...current,
                    defaultWorkerId: value || null,
                  }))
                }
                options={[
                  {
                    label: t("executionPolicy.noDefault"),
                    value: "",
                  },
                  ...eligibleWorkers.map((worker) => ({
                    description: `${(
                      worker.providers
                    ).join(", ")} · ${t(
                      `worker.readiness.${worker.readiness}`,
                    )}`,
                    label: `${worker.icon?.type === "emoji" ? `${worker.icon.value} ` : ""}${worker.label}`,
                    value: worker.id,
                  })),
                ]}
                size="small"
                value={policy.defaultWorkerId ?? ""}
              />
            </div>

            {!canManage ? (
              <Typography className="px-5 pb-5" tone="muted" variant="caption">
                {t("executionPolicy.permission")}
              </Typography>
            ) : null}
            {error ? (
              <SettingsAlert className="mx-5 mb-5 mt-0">{error}</SettingsAlert>
            ) : null}
            <footer className="mt-4 flex justify-end border-t border-border pt-3.5 max-[760px]:[&>button]:w-full">
              <Button
                disabled={!canManage || saving || !dirty}
                onClick={() => void save()}
                type="button"
              >
                {saving ? (
                  <Spinner size={14} />
                ) : !dirty ? (
                  <Check size={14} />
                ) : (
                  <Save size={14} />
                )}
                {saving
                  ? t("common.saving")
                  : !dirty
                    ? t("common.saved")
                    : t("common.save")}
              </Button>
            </footer>
          </>
        )}
      </SettingsCard>

      <Typography className="mt-4" tone="muted" variant="caption">
        {t("executionPolicy.registrationHint")}
      </Typography>
    </SettingsSection>
  );
}
