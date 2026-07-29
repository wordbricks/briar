import { Cpu, LoaderCircle, MonitorCog, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SettingsAlert, SettingsPageHeader } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  disableOrganizationExecutionWorker,
  loadOrganizationExecutionWorkers,
  updateOrganizationExecutionWorkerConcurrency,
} from "../lib/api";
import { isDesktopTauri } from "../lib/platform";
import type {
  Organization,
  OrganizationExecutionWorker,
  Project,
} from "../types";
import { SelectMenu } from "./SelectMenu";

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
    ? "default"
    : readiness === "busy"
      ? "secondary"
      : "outline";

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
  const [loading, setLoading] = useState(true);
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
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
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("configure_execution_worker", {
        projectId,
        userToken: token,
        enabled,
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingProjectId(null);
    }
  };

  const disableDevice = async (device: OrganizationExecutionWorker) => {
    if (
      !window.confirm(
        t("organization.workersDisableConfirm", { name: device.label }),
      )
    ) {
      return;
    }
    setSavingDeviceId(device.deviceId);
    setError(null);
    try {
      if (desktop && device.deviceId === currentDeviceId) {
        const { invoke } = await import("@tauri-apps/api/core");
        for (const status of localStatuses.filter(
          (candidate) => candidate.registered,
        )) {
          await invoke("configure_execution_worker", {
            projectId: status.projectId,
            userToken: token,
            enabled: false,
          });
        }
      }
      await disableOrganizationExecutionWorker(
        token,
        organization.id,
        device.deviceId,
      );
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
            <RefreshCw
              className={loading ? "animate-spin" : undefined}
              size={16}
            />
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
            <LoaderCircle className="animate-spin" size={20} />
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
          <div className="grid gap-3">
            {workers.map((worker) => {
              const mayManage = canManage || worker.ownerUserId === userId;
              return (
                <article
                  className="rounded-xl border border-border bg-card p-5 shadow-xs"
                  key={worker.deviceId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Typography as="h3" variant="bodyLg">
                          {worker.label}
                        </Typography>
                        {worker.deviceId === currentDeviceId ? (
                          <Badge variant="secondary">
                            {t("organization.thisComputerBadge")}
                          </Badge>
                        ) : null}
                        <Badge
                          variant={
                            worker.state === "online" ? "default" : "outline"
                          }
                        >
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
                      </Typography>
                    </div>
                    {mayManage ? (
                      <div className="flex items-center gap-2">
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
                          aria-label={t("organization.workersDisable", {
                            name: worker.label,
                          })}
                          disabled={savingDeviceId === worker.deviceId}
                          onClick={() => void disableDevice(worker)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {worker.bindings.length === 0 ? (
                      <Typography tone="muted" variant="caption">
                        {t("organization.workerNoBindings")}
                      </Typography>
                    ) : (
                      worker.bindings.map((binding) => (
                        <Badge
                          key={binding.id}
                          variant={readinessTone(binding.readiness)}
                        >
                          {binding.projectName} · {binding.agentProvider} ·{" "}
                          {t(`worker.readiness.${binding.readiness}`)}
                        </Badge>
                      ))
                    )}
                  </div>
                  <Typography className="mt-3" tone="muted" variant="micro">
                    {t("organization.workerCapacity", {
                      active: worker.activeSessions,
                      maximum: worker.maxConcurrentSessions,
                    })}
                  </Typography>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
