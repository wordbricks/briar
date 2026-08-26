import { Check, GitMerge, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SettingsAlert } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  loadMergeQueueProfile,
  updateMergeQueueProfile,
} from "../lib/api";
import type { AutoHuntWorkflowStage } from "../lib/auto-hunt-contract";
import type { MergeQueueProfile, Project } from "../types";
import { SelectMenu } from "./SelectMenu";
import { Spinner } from "./ui/spinner";

export type ProjectMergeQueueSettingsApi = {
  load: typeof loadMergeQueueProfile;
  update: typeof updateMergeQueueProfile;
};

const defaultApi: ProjectMergeQueueSettingsApi = {
  load: loadMergeQueueProfile,
  update: updateMergeQueueProfile,
};

export function ProjectMergeQueueSettings({
  api = defaultApi,
  githubRepositoryConnected,
  onProfileChange,
  project,
  stages,
  token,
}: {
  api?: ProjectMergeQueueSettingsApi;
  githubRepositoryConnected: boolean;
  onProfileChange: (profile: MergeQueueProfile | null) => void;
  project: Project;
  stages: AutoHuntWorkflowStage[];
  token: string | null;
}) {
  const { t } = useI18n();
  const canManage = project.role === "owner" || project.role === "admin";
  const [profile, setProfile] = useState<MergeQueueProfile | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [readinessStageId, setReadinessStageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setEnabled(false);
    setReadinessStageId("");
    setError(null);
    onProfileChange(null);
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
  const boundaryValid = stages.some((stage) =>
    stage.id === readinessStageId
  );
  const dirty = enabled !== (profile?.enabled ?? false) ||
    readinessStageId !== (profile?.readinessStageId ?? "");
  const saveDisabled = !canManage || !token || saving || !dirty ||
    (enabled && (!boundaryValid || !githubRepositoryConnected));

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
          <Spinner size={20} />
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
            {!canManage ? (
              <Typography tone="muted" variant="caption">
                {t("settings.mergeQueuePermission")}
              </Typography>
            ) : null}
            {error ? <SettingsAlert>{error}</SettingsAlert> : null}
          </div>
          <footer className="flex justify-end border-t border-border px-4 py-3">
            <Button
              disabled={saveDisabled}
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
    </section>
  );
}
