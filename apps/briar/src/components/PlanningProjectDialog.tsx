import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, FolderKanban, Palette, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { hasOrganizationCapability } from "../lib/organization-role";
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
import { Spinner } from "./ui/spinner";
import { teamIconComponent } from "./TeamIcon";
import { TeamIconPicker } from "./TeamIconPicker";

export function PlanningProjectDialog({
  onCreate,
  onDelete,
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
  onDelete?: (projectId: string) => Promise<unknown>;
  onUpdate: (projectId: string, input: {
    name: string;
    description: string;
    status: PlanningProjectStatus;
    icon: string | null;
    color: string | null;
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
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setStatus(project?.status ?? "planned");
    setIcon(project?.icon ?? null);
    setColor(project?.color ?? null);
    setIsIconPickerOpen(false);
    setConfirmingDelete(false);
    setError(null);
  }, [open, project]);

  const canDelete = Boolean(
    project &&
      !project.isDefault &&
      onDelete &&
      hasOrganizationCapability(project.role, "issues:write"),
  );

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
          icon,
          color,
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

  const confirmDelete = async () => {
    if (!project || !onDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(project.id);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!submitting && !deleting) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="sm:max-w-lg"
        showClose={!deleting}
      >
        {confirmingDelete && project ? (
          <div className="grid gap-5">
            <DialogHeader>
              <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
                <Trash2 aria-hidden="true" size={20} strokeWidth={1.8} />
              </div>
              <DialogTitle>
                {t("planningProject.deleteTitle", { name: project.name })}
              </DialogTitle>
              <DialogDescription>
                {t("planningProject.deleteDescription")}
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={deleting}
                onClick={() => {
                  setConfirmingDelete(false);
                  setError(null);
                }}
                type="button"
                variant="outline"
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={deleting}
                onClick={() => void confirmDelete()}
                type="button"
                variant="destructive"
              >
                {deleting ? <Spinner className="size-[15px]" /> : <Trash2 aria-hidden="true" />}
                {deleting
                  ? t("planningProject.deleting")
                  : t("planningProject.delete")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
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
          {project ? (
            <div className="grid gap-2">
              <Label>{t("planningProject.icon")}</Label>
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40">
                  {icon ? (() => {
                    const Icon = teamIconComponent(icon);
                    return (
                      <Icon
                        aria-hidden="true"
                        size={20}
                        strokeWidth={1.7}
                        style={color ? { color } : undefined}
                      />
                    );
                  })() : (
                    <FolderKanban
                      aria-hidden="true"
                      className="text-muted-foreground"
                      size={20}
                      strokeWidth={1.7}
                      style={color ? { color } : undefined}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={submitting}
                    onClick={() => setIsIconPickerOpen(true)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Palette aria-hidden="true" size={15} strokeWidth={1.8} />
                    {t("planningProject.chooseIcon")}
                  </Button>
                  {icon ? (
                    <Button
                      disabled={submitting}
                      onClick={() => { setIcon(null); setColor(null); }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                      {t("planningProject.removeIcon")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          {project ? (
            <section className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle aria-hidden="true" size={17} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="text-sm text-foreground">
                  {t("planningProject.dangerTitle")}
                </strong>
                <small className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    project.isDefault
                      ? "planningProject.defaultDeleteDescription"
                      : "planningProject.dangerDescription",
                  )}
                </small>
              </span>
              {canDelete ? (
                <Button
                  onClick={() => {
                    setError(null);
                    setConfirmingDelete(true);
                  }}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" />
                  {t("planningProject.delete")}
                </Button>
              ) : null}
            </section>
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
        )}
      </DialogContent>
    </Dialog>
    <TeamIconPicker
      disabled={submitting}
      onOpenChange={setIsIconPickerOpen}
      onSelect={async ({ name: selectedName, color: selectedColor }) => {
        setIcon(selectedName);
        setColor(selectedColor);
      }}
      open={isIconPickerOpen}
      selectedColor={color}
      selectedName={icon}
    />
    </>
  );
}
