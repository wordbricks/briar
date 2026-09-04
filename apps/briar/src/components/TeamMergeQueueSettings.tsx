import { Check, ExternalLink, GitMerge, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SettingsAlert } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  loadMergeQueueProfile,
  loadMergeQueueStatus,
  updateMergeQueueProfile,
} from "../lib/api";
import type { AutoHuntWorkflowStage } from "../lib/auto-hunt-contract";
import type {
  MergeQueueBatchState,
  MergeQueueCandidateState,
  MergeQueueProfile,
  MergeQueueStatus,
  Project,
} from "../types";
import { hasOrganizationCapability } from "../lib/organization-role";
import { SelectMenu } from "./SelectMenu";
import { Spinner } from "./ui/spinner";

export type TeamMergeQueueSettingsApi = {
  load: typeof loadMergeQueueProfile;
  loadStatus: typeof loadMergeQueueStatus;
  update: typeof updateMergeQueueProfile;
};

const defaultApi: TeamMergeQueueSettingsApi = {
  load: loadMergeQueueProfile,
  loadStatus: loadMergeQueueStatus,
  update: updateMergeQueueProfile,
};

const statusTone = (
  state: MergeQueueBatchState | MergeQueueCandidateState,
): "destructive" | "secondary" | "soft" | "success" | "warning" =>
  state === "completed" || state === "merged"
    ? "success"
    : state === "blocked" || state === "failed"
      ? "destructive"
      : state === "collecting" || state === "ready"
        ? "warning"
        : state === "dequeued"
          ? "secondary"
          : "soft";

export function TeamMergeQueueSettings({
  api = defaultApi,
  githubRepositoryConnected,
  onProfileChange,
  project,
  stages,
  token,
}: {
  api?: TeamMergeQueueSettingsApi;
  githubRepositoryConnected: boolean;
  onProfileChange: (profile: MergeQueueProfile | null) => void;
  project: Project;
  stages: AutoHuntWorkflowStage[];
  token: string | null;
}) {
  const { localeTag, t } = useI18n();
  const canManage = hasOrganizationCapability(
    project.role,
    "development:manage",
  );
  const [profile, setProfile] = useState<MergeQueueProfile | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [readinessStageId, setReadinessStageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MergeQueueStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const statusRequestSequence = useRef(0);

  const refreshStatus = async () => {
    if (!token || statusLoading) return;
    const requestId = ++statusRequestSequence.current;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const loaded = await api.loadStatus(token, project.id);
      if (statusRequestSequence.current === requestId) {
        setStatus(loaded.status);
      }
    } catch (caught) {
      if (statusRequestSequence.current === requestId) {
        setStatusError(
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    } finally {
      if (statusRequestSequence.current === requestId) {
        setStatusLoading(false);
      }
    }
  };

  useEffect(() => {
    const statusRequestId = ++statusRequestSequence.current;
    setProfile(null);
    setEnabled(false);
    setReadinessStageId("");
    setError(null);
    setStatus(null);
    setStatusError(null);
    onProfileChange(null);
    if (!token) {
      setStatus({ batches: [], candidates: [] });
      setLoading(false);
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setStatusLoading(true);
    void api.load(token, project.id)
      .then(({ profile: loaded }) => {
        if (cancelled) return;
        setProfile(loaded);
        setEnabled(loaded?.enabled ?? false);
        setReadinessStageId(loaded?.readinessStageId ?? "");
        onProfileChange(loaded);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void api.loadStatus(token, project.id)
      .then(({ status: loaded }) => {
        if (!cancelled && statusRequestSequence.current === statusRequestId) {
          setStatus(loaded);
        }
      })
      .catch((caught) => {
        if (!cancelled && statusRequestSequence.current === statusRequestId) {
          setStatusError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (!cancelled && statusRequestSequence.current === statusRequestId) {
          setStatusLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, onProfileChange, project.id, token]);

  const stageOptions = useMemo(() => {
    const options = stages.map((stage) => ({
      description: stage.id,
      label: stage.label,
      value: stage.id,
    }));
    if (
      readinessStageId &&
      !stages.some((stage) => stage.id === readinessStageId)
    ) {
      options.unshift({
        description: readinessStageId,
        label: t("settings.mergeQueueMissingStage"),
        value: readinessStageId,
      });
    }
    return options;
  }, [readinessStageId, stages, t]);
  const statusDateFormatter = useMemo(() => new Intl.DateTimeFormat(localeTag, {
    dateStyle: "short",
    timeStyle: "short",
  }), [localeTag]);
  const boundaryValid = stages.some((stage) =>
    stage.id === readinessStageId
  );
  const validationCommands = stages.find((stage) =>
    stage.id === readinessStageId
  )?.checks?.map((command) => command.trim()).filter(Boolean) ?? [];
  const validationCommandsValid = validationCommands.length > 0;
  const dirty = enabled !== (profile?.enabled ?? false) ||
    readinessStageId !== (profile?.readinessStageId ?? "") ||
    JSON.stringify(validationCommands) !==
      JSON.stringify(profile?.validationCommands ?? []);
  const saveDisabled = !canManage || !token || saving || !dirty ||
    (enabled && (
      !boundaryValid || !validationCommandsValid || !githubRepositoryConnected
    ));

  const save = async () => {
    if (saveDisabled || !token) return;
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.update(
        token,
        project.id,
        { enabled, readinessStageId },
      );
      setProfile(updated);
      setEnabled(updated.enabled);
      setReadinessStageId(updated.readinessStageId);
      onProfileChange(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-4 py-3.5">
        <span className="flex min-w-0 items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <GitMerge size={17} strokeWidth={1.8} />
          </span>
          <span className="grid gap-1">
            <Typography as="strong" variant="bodySm">
              {t("settings.mergeQueueTitle")}
            </Typography>
            <Typography tone="muted" variant="caption">
              {t("settings.mergeQueueDescription")}
            </Typography>
          </span>
        </span>
        <Switch
          aria-label={t("settings.mergeQueueEnabled")}
          checked={enabled}
          disabled={
            loading || saving || !canManage ||
            (!enabled && !githubRepositoryConnected)
          }
          onCheckedChange={setEnabled}
        />
      </header>

      {loading ? (
        <div className="grid min-h-32 place-items-center">
          <Spinner className="size-[20px]" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-4">
            <div className="grid gap-2">
              <Label htmlFor={`merge-queue-stage-${project.id}`}>
                {t("settings.mergeQueueBoundary")}
              </Label>
              <SelectMenu
                disabled={!canManage || saving}
                id={`merge-queue-stage-${project.id}`}
                label={t("settings.mergeQueueBoundary")}
                onValueChange={setReadinessStageId}
                options={stageOptions}
                placeholder={t("settings.mergeQueueSelectStage")}
                searchable={stages.length > 8}
                size="small"
                value={readinessStageId}
              />
              <Typography tone="muted" variant="caption">
                {t("settings.mergeQueueBoundaryDescription")}
              </Typography>
            </div>
            {!githubRepositoryConnected && !enabled ? (
              <SettingsAlert>
                {t("settings.mergeQueueNeedsRepository")}
              </SettingsAlert>
            ) : null}
            {readinessStageId && !boundaryValid ? (
              <SettingsAlert>
                {t("settings.mergeQueueInvalidBoundary")}
              </SettingsAlert>
            ) : null}
            {readinessStageId && boundaryValid ? (
              <div className="grid gap-2">
                <Typography as="strong" tone="muted" variant="caption">
                  {t("settings.mergeQueueValidationCommands")}
                </Typography>
                {validationCommandsValid ? (
                  <div className="grid gap-1">
                    {validationCommands.map((command) => (
                      <code
                        className="rounded-md border border-border bg-muted/35 px-2.5 py-2 text-xs"
                        key={command}
                      >
                        {command}
                      </code>
                    ))}
                  </div>
                ) : (
                  <SettingsAlert>
                    {t("settings.mergeQueueNeedsValidationCommands")}
                  </SettingsAlert>
                )}
              </div>
            ) : null}
            {!canManage ? (
              <Typography tone="muted" variant="caption">
                {t("settings.mergeQueuePermission")}
              </Typography>
            ) : null}
            {error ? <SettingsAlert>{error}</SettingsAlert> : null}
          </div>
          <div className="grid gap-3 border-t border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="grid gap-1">
                <Typography as="strong" variant="bodySm">
                  {t("settings.mergeQueueStatusTitle")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("settings.mergeQueueStatusDescription")}
                </Typography>
              </span>
              <Button
                aria-label={t("common.refresh")}
                disabled={!token || statusLoading}
                onClick={() => void refreshStatus()}
                size="icon"
                type="button"
                variant="ghost"
              >
                {statusLoading ? (
                  <Spinner className="size-[14px]" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </Button>
            </div>
            {statusError ? <SettingsAlert>{statusError}</SettingsAlert> : null}
            {!statusLoading && status ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid content-start gap-2">
                  <Typography as="strong" tone="muted" variant="caption">
                    {t("settings.mergeQueueBatches")}
                  </Typography>
                  {status.batches.length === 0 ? (
                    <Typography tone="muted" variant="caption">
                      {t("settings.mergeQueueNoBatches")}
                    </Typography>
                  ) : (
                    <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                      {status.batches.map((batch) => (
                        <div
                          className="grid gap-1 rounded-lg border border-border bg-muted/25 px-3 py-2.5"
                          key={batch.id}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <code className="text-xs text-muted-foreground">
                              {batch.id.slice(0, 8)}
                            </code>
                            <Badge variant={statusTone(batch.state)}>
                              {t(`settings.mergeQueueState.${batch.state}`)}
                            </Badge>
                          </div>
                          <Typography tone="muted" variant="caption">
                            {t("settings.mergeQueueCandidateCount", {
                              count: batch.candidateCount,
                            })} · {statusDateFormatter.format(
                              new Date(batch.updatedAt),
                            )}
                          </Typography>
                          {batch.failureCode ? (
                            <code className="truncate text-xs text-destructive">
                              {batch.failureCode}
                            </code>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid content-start gap-2">
                  <Typography as="strong" tone="muted" variant="caption">
                    {t("settings.mergeQueueCandidates")}
                  </Typography>
                  {status.candidates.length === 0 ? (
                    <Typography tone="muted" variant="caption">
                      {t("settings.mergeQueueNoCandidates")}
                    </Typography>
                  ) : (
                    <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                      {status.candidates.map((candidate) => (
                        <div
                          className="grid gap-1 rounded-lg border border-border bg-muted/25 px-3 py-2.5"
                          key={candidate.id}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <a
                              className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-foreground hover:text-primary"
                              href={candidate.pullRequestUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              PR #{candidate.pullRequestNumber}
                              <ExternalLink className="shrink-0" size={11} />
                            </a>
                            <Badge variant={statusTone(candidate.state)}>
                              {t(`settings.mergeQueueState.${candidate.state}`)}
                            </Badge>
                          </div>
                          <Typography tone="muted" variant="caption">
                            {statusDateFormatter.format(
                              new Date(candidate.updatedAt),
                            )}
                          </Typography>
                          {candidate.failureCode ? (
                            <code className="truncate text-xs text-destructive">
                              {candidate.failureCode}
                            </code>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <footer className="flex justify-end border-t border-border px-4 py-3">
            <Button
              disabled={saveDisabled}
              onClick={() => void save()}
              type="button"
            >
              {saving ? (
                <Spinner className="size-[14px]" />
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
    </section>
  );
}
