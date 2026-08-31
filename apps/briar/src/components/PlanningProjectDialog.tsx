import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import type { PlanningProject, PlanningProjectStatus } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export function PlanningProjectDialog({
  onCreate,
  onUpdate,
  onOpenChange,
  open,
  project = null,
  teamName,
}: {
  onCreate: (input: {
    name: string;
    description?: string;
    status?: PlanningProjectStatus;
  }) => Promise<unknown>;
  onUpdate: (projectId: string, input: {
    name: string;
    description: string;
    status: PlanningProjectStatus;
  }) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project?: PlanningProject | null;
  teamName: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<PlanningProjectStatus>("planned");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setStatus(project?.status ?? "planned");
    setError(null);
  }, [open, project]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (project) {
        await onUpdate(project.id, {
          name: normalizedName,
          description: description.trim(),
          status,
        });
      } else {
        await onCreate({
          name: normalizedName,
          description: description.trim() || undefined,
          status,
        });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {t(project
                ? "planningProject.editTitle"
                : "planningProject.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t(
                project
                  ? "planningProject.editDescription"
                  : "planningProject.createDescription",
                { name: teamName },
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="planning-project-name">
              {t("planningProject.name")}
            </Label>
            <Input
              autoFocus
              disabled={submitting}
              id="planning-project-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("planningProject.namePlaceholder")}
              required
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planning-project-description">
              {t("planningProject.description")}
            </Label>
            <Textarea
              disabled={submitting}
              id="planning-project-description"
              maxLength={10_000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("planningProject.descriptionPlaceholder")}
              rows={4}
              value={description}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planning-project-status">
              {t("planningProject.status")}
            </Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={submitting}
              id="planning-project-status"
              onChange={(event) =>
                setStatus(event.target.value as PlanningProjectStatus)}
              value={status}
            >
              <option value="planned">{t("planningProject.statusPlanned")}</option>
              <option value="active">{t("planningProject.statusActive")}</option>
              {project ? (
                <option value="completed">
                  {t("planningProject.statusCompleted")}
                </option>
              ) : null}
              {project && !project.isDefault ? (
                  <option value="cancelled">
                    {t("planningProject.statusCancelled")}
                  </option>
                ) : null}
            </select>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={submitting || !name.trim()} type="submit">
              {submitting
                ? t(project
                  ? "planningProject.saving"
                  : "planningProject.creating")
                : t(project
                  ? "planningProject.save"
                  : "planningProject.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
