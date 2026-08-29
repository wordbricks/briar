import {
  Cpu,
  Download,
  ImagePlus,
  MonitorCog,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SettingsAlert, SettingsPageHeader } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  deleteOrganizationExecutionWorker,
  loadOrganizationExecutionWorkers,
  requestOrganizationExecutionWorkerUpdate,
  updateOrganizationExecutionWorkerConcurrency,
  updateOrganizationExecutionWorkerIcon,
} from "../lib/api";
import { isDesktopTauri } from "../lib/platform";
import { configureLocalExecutionWorker } from "../lib/project-connection";
import {
  compareSemanticVersions,
  isSemanticVersion,
} from "../lib/semantic-version";
import {
  isWorkerEmoji,
  maxWorkerEmojiLength,
  workerLogoAccept,
  workerLogoFromFile,
} from "../lib/worker-icon";
import type {
  Organization,
  OrganizationExecutionWorker,
  Project,
  WorkerIcon as WorkerIconValue,
} from "../types";
import { Input } from "./ui/input";
import { SelectMenu } from "./SelectMenu";
import { WorkerIcon } from "./WorkerIcon";
import { WorkerProviderIcons } from "./WorkerProviderIcons";
import { ManagedComputersCard } from "./ManagedComputersCard";

type LocalWorkerStatus = {
  projectId: string;
  registered: boolean;
  workerId: string | null;
  deviceId: string | null;
  label: string | null;
  maxConcurrentSessions: number | null;
};

const readinessTone = (
  readiness: OrganizationExecutionWorker["bindings"][number]["readiness"],
) =>
  readiness === "available"
    ? "success"
    : readiness === "busy"
      ? "warning"
      : readiness === "needs_attention"
        ? "destructive"
        : "outline";

const workerStateTone = (state: OrganizationExecutionWorker["state"]) =>
  state === "online" ? "success" : state === "stale" ? "warning" : "outline";

export function OrganizationWorkersSettings({
  connectedProjectIds,
  organization,
  projects,
  token,
  userId,
}: {
  connectedProjectIds: string[] | null;
  organization: Organization;
  projects: Project[];
  token: string;
  userId: string;
}) {
  const { t } = useI18n();
  const desktop = isDesktopTauri();
  const organizationProjects = useMemo(
    () =>
      projects.filter((project) => project.organizationId === organization.id),
    [organization.id, projects],
  );
  const connectedOrganizationProjects = useMemo(
    () =>
      organizationProjects.filter((project) =>
        connectedProjectIds?.includes(project.id),
      ),
    [connectedProjectIds, organizationProjects],
  );
  const [workers, setWorkers] = useState<OrganizationExecutionWorker[]>([]);
  const [localStatuses, setLocalStatuses] = useState<LocalWorkerStatus[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] =
    useState<OrganizationExecutionWorker | null>(null);
  const [editingIconDeviceId, setEditingIconDeviceId] = useState<string | null>(
    null,
  );
  const [iconDraft, setIconDraft] = useState<WorkerIconValue | null>(null);
  const [processingIcon, setProcessingIcon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("sync_execution_worker_labels");
      }
      const [remote, local] = await Promise.all([
        loadOrganizationExecutionWorkers(token, organization.id),
        desktop
          ? import("@tauri-apps/api/core").then(({ invoke }) =>
              invoke<LocalWorkerStatus[]>("inspect_execution_workers", {
                projectIds: connectedOrganizationProjects.map(
                  (project) => project.id,
                ),
              }),
            )
          : Promise.resolve([]),
      ]);
      setWorkers(remote.workers);
      setLatestVersion(remote.latestVersion ?? null);
      setCanManage(remote.canManage);
      setLocalStatuses(local);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [connectedOrganizationProjects, desktop, organization.id, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentDeviceId =
    localStatuses.find((status) => status.registered && status.deviceId)
      ?.deviceId ?? null;
  const currentDevice = workers.find(
    (worker) => worker.deviceId === currentDeviceId,
  );
  const statusByProjectId = new Map(
    localStatuses.map((status) => [status.projectId, status]),
  );

  const toggleProject = async (projectId: string, enabled: boolean) => {
    if (!desktop) return;
    setSavingProjectId(projectId);
    setError(null);
    try {
      await configureLocalExecutionWorker(projectId, token, enabled);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingProjectId(null);
    }
  };

  const deleteDevice = async () => {
    const device = deleteCandidate;
    if (!device) return;
    setSavingDeviceId(device.deviceId);
    setError(null);
    try {
      if (desktop && device.deviceId === currentDeviceId) {
        for (const status of localStatuses.filter(
          (candidate) => candidate.registered,
        )) {
          await configureLocalExecutionWorker(status.projectId, token, false);
        }
      }
      await deleteOrganizationExecutionWorker(
        token,
        organization.id,
        device.deviceId,
      );
      setDeleteCandidate(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingDeviceId(null);
    }
  };

  const updateConcurrency = async (
    device: OrganizationExecutionWorker,
    value: string,
  ) => {
    setSavingDeviceId(device.deviceId);
    setError(null);
    try {
      await updateOrganizationExecutionWorkerConcurrency(
        token,
        organization.id,
        device.deviceId,
        Number(value),
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingDeviceId(null);
    }
  };

  const requestUpdate = async (worker: OrganizationExecutionWorker) => {
    setSavingDeviceId(worker.deviceId);
    setError(null);
    try {
      await requestOrganizationExecutionWorkerUpdate(
        token,
        organization.id,
        worker.deviceId,
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingDeviceId(null);
    }
  };

  const editIcon = (worker: OrganizationExecutionWorker) => {
    setEditingIconDeviceId(worker.deviceId);
    setIconDraft(worker.icon ?? null);
    setError(null);
  };

  const saveIcon = async (worker: OrganizationExecutionWorker) => {
    if (iconDraft?.type === "emoji" && !isWorkerEmoji(iconDraft.value)) {
      setError(t("organization.workerIconEmojiInvalid"));
      return;
    }
    setSavingDeviceId(worker.deviceId);
    setError(null);
    try {
      await updateOrganizationExecutionWorkerIcon(
        token,
        organization.id,
        worker.deviceId,
        iconDraft,
      );
      setEditingIconDeviceId(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingDeviceId(null);
    }
  };

  const selectLogo = async (file: File | undefined) => {
    if (!file) return;
    setProcessingIcon(true);
    setError(null);
    try {
      setIconDraft({ type: "image", value: await workerLogoFromFile(file) });
    } catch {
      setError(t("organization.workerIconUploadFailed"));
    } finally {
      setProcessingIcon(false);
    }
  };

  return (
    <>
      <SettingsPageHeader
        className="mb-8 max-w-none"
        description={t("organization.workersDescription")}
        title={t("organization.workers")}
      />

      {error ? (
        <SettingsAlert className="mb-4 mt-0">{error}</SettingsAlert>
      ) : null}

      <ManagedComputersCard
        organizationId={organization.id}
        projects={organizationProjects}
        token={token}
      />

      <section className="mb-8 w-full max-w-[820px] overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <MonitorCog aria-hidden="true" size={18} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <Typography as="h2" variant="bodyLg">
                {t("organization.thisComputer")}
              </Typography>
              <Typography tone="muted" variant="caption">
                {desktop
                  ? (currentDevice?.label ??
                    t("organization.thisComputerNotRegistered"))
                  : t("organization.workersDesktopOnly")}
              </Typography>
            </div>
          </div>
          <Button
            aria-label={t("common.refresh")}
            disabled={loading}
            onClick={() => void refresh()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Spinner icon={RefreshCw} size={16} spinning={loading} />
          </Button>
        </header>
        <div className="divide-y divide-border">
          {organizationProjects.length === 0 ? (
            <Typography className="p-5" tone="muted" variant="bodySm">
              {t("organization.workersNoProjects")}
            </Typography>
          ) : (
            organizationProjects.map((project) => {
              const connected = Boolean(
                connectedProjectIds?.includes(project.id),
              );
              const status = statusByProjectId.get(project.id);
              const enabled = status?.registered === true;
              return (
                <div
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                  key={project.id}
                >
                  <div className="min-w-0">
                    <Typography as="strong" className="block" variant="bodySm">
                      {project.name}
                    </Typography>
                    <Typography tone="muted" variant="micro">
                      {connected
                        ? enabled
                          ? t("organization.workerProjectEnabled")
                          : t("organization.workerProjectAvailable")
                        : t("organization.workerProjectRepositoryRequired")}
                    </Typography>
                  </div>
                  <Switch
                    aria-label={t("organization.workerProjectToggle", {
                      name: project.name,
                    })}
                    checked={enabled}
                    disabled={
                      !desktop || !connected || savingProjectId === project.id
                    }
                    onCheckedChange={(checked) => {
                      void toggleProject(project.id, checked);
                    }}
                  />
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="w-full max-w-[820px]">
        <div className="mb-3 flex items-center justify-between">
          <Typography as="h2" variant="bodyLg">
            {t("organization.registeredWorkers")}
          </Typography>
          <Badge variant="secondary">{workers.length}</Badge>
        </div>
        {loading && workers.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-xl border border-border bg-card">
            <Spinner size={20} />
          </div>
        ) : workers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Cpu
              aria-hidden="true"
              className="mx-auto mb-3 text-muted-foreground"
              size={24}
            />
            <Typography tone="muted" variant="bodySm">
              {t("organization.workersEmpty")}
            </Typography>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {workers.map((worker) => {
              const mayManage = canManage || worker.ownerUserId === userId;
              const currentVersion = worker.versions?.briar ?? null;
              const updateAvailable = Boolean(
                latestVersion &&
                  currentVersion &&
                  isSemanticVersion(currentVersion) &&
                  compareSemanticVersions(currentVersion, latestVersion) < 0,
              );
              const maximumSlots = Math.max(1, worker.maxConcurrentSessions);
              const activeSlots = Math.min(
                maximumSlots,
                Math.max(0, worker.activeSessions),
              );
              const capacityLabel = t("organization.workerCapacity", {
                active: activeSlots,
                maximum: maximumSlots,
              });
              return (
                <article
                  className="border-b border-border/80 p-4 transition-colors last:border-b-0 hover:bg-muted/20 sm:p-5"
                  key={worker.deviceId}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <WorkerIcon icon={worker.icon} size={44} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Typography
                            as="h3"
                            className="truncate font-medium"
                            variant="bodyLg"
                          >
                            {worker.label}
                          </Typography>
                          {worker.deviceId === currentDeviceId ? (
                            <Badge variant="secondary">
                              {t("organization.thisComputerBadge")}
                            </Badge>
                          ) : null}
                          <Badge
                            className="gap-1.5"
                            variant={workerStateTone(worker.state)}
                          >
                            <span
                              aria-hidden="true"
                              className="size-1.5 rounded-full bg-current"
                            />
                            {t(`worker.state.${worker.state}`)}
                          </Badge>
                        </div>
                        <Typography
                          className="mt-1"
                          tone="muted"
                          variant="caption"
                        >
                          {t("organization.workerOwnedBy", {
                            name: worker.ownerName,
                          })}
                          {currentVersion
                            ? ` · ${t("organization.workerVersion", { version: currentVersion })}`
                            : ""}
                        </Typography>
                      </div>
                    </div>
                    {mayManage ? (
                      <div className="ml-auto flex items-center gap-1.5">
                        {worker.updateRequest ? (
                          <Badge
                            title={
                              worker.updateRequest.handoffState === "failed"
                                ? t("organization.workerUpdateDelayedWithReason", {
                                    version: worker.updateRequest.targetVersion,
                                    reason:
                                      worker.updateRequest.handoffError ??
                                      t("organization.workerUpdateDelayed"),
                                  })
                                : undefined
                            }
                            variant={
                              worker.updateRequest.handoffState === "failed"
                                ? "destructive"
                                : "warning"
                            }
                          >
                            {worker.updateRequest.handoffState === "failed"
                              ? t("organization.workerUpdateDelayed", {
                                  version: worker.updateRequest.targetVersion,
                                })
                              : t("organization.workerUpdatePending", {
                                  version: worker.updateRequest.targetVersion,
                                })}
                          </Badge>
                        ) : null}
                        <Button
                          aria-label={t("organization.workerUpdate", {
                            name: worker.label,
                          })}
                          disabled={
                            savingDeviceId === worker.deviceId ||
                            worker.state !== "online" ||
                            !worker.remoteUpdateSupported ||
                            !updateAvailable ||
                            (Boolean(worker.updateRequest) &&
                              worker.updateRequest?.handoffState !== "failed")
                          }
                          onClick={() => void requestUpdate(worker)}
                          size="icon-sm"
                          title={
                            worker.remoteUpdateSupported
                              ? t("organization.workerUpdate", {
                                  name: worker.label,
                                })
                              : t("organization.workerUpdateUnsupported")
                          }
                          type="button"
                          variant="outline"
                        >
                          <Download size={14} />
                        </Button>
                        <Button
                          aria-label={t("organization.workerIconEdit", {
                            name: worker.label,
                          })}
                          disabled={savingDeviceId === worker.deviceId}
                          onClick={() => editIcon(worker)}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                        >
                          <Pencil size={14} />
                        </Button>
                        <SelectMenu
                          disabled={savingDeviceId === worker.deviceId}
                          label={t("organization.workerConcurrency")}
                          onValueChange={(value) =>
                            void updateConcurrency(worker, value)
                          }
                          options={Array.from({ length: 16 }, (_, index) => ({
                            label: t("organization.workerConcurrencyValue", {
                              count: index + 1,
                            }),
                            value: String(index + 1),
                          }))}
                          size="small"
                          value={String(worker.maxConcurrentSessions)}
                        />
                        <Button
                          aria-label={t("organization.workersDelete", {
                            name: worker.label,
                          })}
                          className="text-muted-foreground hover:text-destructive"
                          disabled={savingDeviceId === worker.deviceId}
                          onClick={() => {
                            setError(null);
                            setDeleteCandidate(worker);
                          }}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {editingIconDeviceId === worker.deviceId ? (
                    <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:ml-14">
                      <div className="flex items-center gap-3">
                        <WorkerIcon icon={iconDraft} size={48} />
                        <div className="min-w-0 flex-1">
                          <label
                            className="mb-1.5 block text-xs font-medium"
                            htmlFor={`worker-emoji-${worker.deviceId}`}
                          >
                            {t("organization.workerIconEmoji")}
                          </label>
                          <Input
                            id={`worker-emoji-${worker.deviceId}`}
                            maxLength={maxWorkerEmojiLength}
                            onChange={(event) =>
                              setIconDraft(
                                event.target.value
                                  ? {
                                      type: "emoji",
                                      value: event.target.value,
                                    }
                                  : null,
                              )
                            }
                            placeholder={t(
                              "organization.workerIconEmojiPlaceholder",
                            )}
                            value={
                              iconDraft?.type === "emoji"
                                ? iconDraft.value
                                : ""
                            }
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent">
                          <ImagePlus size={14} />
                          {t(
                            iconDraft?.type === "image"
                              ? "organization.workerIconReplaceLogo"
                              : "organization.workerIconUploadLogo",
                          )}
                          <input
                            accept={workerLogoAccept}
                            className="sr-only"
                            disabled={processingIcon}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              void selectLogo(file);
                            }}
                            type="file"
                          />
                        </label>
                        <Button
                          disabled={!iconDraft}
                          onClick={() => setIconDraft(null)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {t("organization.workerIconRemove")}
                        </Button>
                        <span className="flex-1" />
                        <Button
                          onClick={() => setEditingIconDeviceId(null)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          disabled={
                            processingIcon ||
                            savingDeviceId === worker.deviceId
                          }
                          onClick={() => void saveIcon(worker)}
                          size="sm"
                          type="button"
                        >
                          {savingDeviceId === worker.deviceId
                            ? t("common.saving")
                            : t("common.save")}
                        </Button>
                      </div>
                      <Typography tone="muted" variant="micro">
                        {t("organization.workerIconHint")}
                      </Typography>
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 sm:ml-14 lg:grid-cols-[minmax(0,1fr)_180px] lg:gap-5">
                    <div className="grid gap-2">
                      {worker.bindings.length === 0 ? (
                        <div className="rounded-lg bg-muted/45 px-3 py-2.5">
                          <Typography tone="muted" variant="caption">
                            {t("organization.workerNoBindings")}
                          </Typography>
                        </div>
                      ) : (
                        worker.bindings.map((binding) => (
                          <div
                            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5"
                            key={binding.id}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Typography
                                as="strong"
                                className="truncate"
                                variant="bodySm"
                              >
                                {binding.projectName}
                              </Typography>
                              <span
                                aria-hidden="true"
                                className="h-3.5 w-px shrink-0 bg-border"
                              />
                              <WorkerProviderIcons
                                providers={
                                  binding.providers ?? [binding.agentProvider]
                                }
                                size={14}
                              />
                            </div>
                            <Badge
                              className="shrink-0"
                              variant={readinessTone(binding.readiness)}
                            >
                              {t(`worker.readiness.${binding.readiness}`)}
                            </Badge>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2.5">
                      <Typography
                        className="mb-2 block"
                        tone="muted"
                        variant="micro"
                      >
                        {capacityLabel}
                      </Typography>
                      <div
                        aria-label={capacityLabel}
                        aria-valuemax={maximumSlots}
                        aria-valuemin={0}
                        aria-valuenow={activeSlots}
                        className="h-1.5 overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        title={capacityLabel}
                      >
                        <div
                          aria-hidden="true"
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{
                            width: `${(activeSlots / maximumSlots) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !savingDeviceId) setDeleteCandidate(null);
        }}
        open={deleteCandidate !== null}
      >
        <DialogContent className="sm:max-w-md" showClose={!savingDeviceId}>
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 aria-hidden="true" size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {deleteCandidate
                ? t("organization.workersDelete", {
                    name: deleteCandidate.label,
                  })
                : null}
            </DialogTitle>
            <DialogDescription>
              {deleteCandidate
                ? t("organization.workersDeleteConfirm", {
                    name: deleteCandidate.label,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={Boolean(savingDeviceId)}
              onClick={() => setDeleteCandidate(null)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={Boolean(savingDeviceId)}
              onClick={() => void deleteDevice()}
              type="button"
              variant="destructive"
            >
              {savingDeviceId ? <Spinner size={15} /> : <Trash2 size={15} />}
              {t("organization.workersDeleteAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
