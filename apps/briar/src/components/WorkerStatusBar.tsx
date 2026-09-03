import {
  Download,
  Monitor,
  MonitorUp,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  loadManagedComputerProduct,
  loadManagedComputers,
  loadOrganizationExecutionWorkers,
  requestOrganizationExecutionWorkerUpdate,
} from "../lib/api";
import { supportsManagedComputerRemoteDesktop } from "../lib/platform";
import type { AgentProvider } from "../lib/team-llm";
import {
  compareSemanticVersions,
  isSemanticVersion,
} from "../lib/semantic-version";
import type {
  ExecutionWorker,
  ManagedComputer,
  OrganizationExecutionWorker,
} from "../types";
import { ManagedComputerRemoteDesktop } from "./ManagedComputerRemoteDesktop";
import { WorkerIcon } from "./WorkerIcon";
import { WorkerProviderIcons } from "./WorkerProviderIcons";
import { cn } from "../lib/utils";

export function workerProviders(worker: ExecutionWorker): AgentProvider[] {
  if (
    worker.state !== "online" ||
    !worker.acceptingWork ||
    (worker.readiness !== "available" && worker.readiness !== "busy")
  ) {
    return [];
  }
  const providers = worker.providers;
  return [...new Set(providers)];
}

export function activeWorkerCount(workers: ExecutionWorker[]): number {
  return workers.filter((worker) => worker.state === "online").length;
}

export function workerBriarVersion(worker: ExecutionWorker): string | null {
  const version = worker.versions?.briar;
  return typeof version === "string" && version.length > 0 ? version : null;
}

export function workerRemoteUpdateSupported(worker: ExecutionWorker): boolean {
  const capabilities = worker.capabilities as {
    remoteUpdates?: { supported?: unknown; protocol?: unknown };
  };
  return (
    capabilities.remoteUpdates?.supported === true &&
    capabilities.remoteUpdates.protocol === 1
  );
}

export function workerUpdateAvailable({
  currentVersion,
  latestVersion,
}: {
  currentVersion: string | null;
  latestVersion: string | null;
}): boolean {
  return Boolean(
    latestVersion &&
    currentVersion &&
    isSemanticVersion(currentVersion) &&
    isSemanticVersion(latestVersion) &&
    compareSemanticVersions(currentVersion, latestVersion) < 0,
  );
}

type DeviceUpdateState = {
  remoteUpdateSupported: boolean;
  updateRequest: OrganizationExecutionWorker["updateRequest"];
};

export function managedComputerShortcutTarget({
  managedComputersByDeviceId,
  organizationId,
  remoteDesktopEnabled,
  userId,
  worker,
}: {
  managedComputersByDeviceId: Record<string, ManagedComputer>;
  organizationId?: string | null;
  remoteDesktopEnabled: boolean;
  userId?: string | null;
  worker: ExecutionWorker;
}): ManagedComputer | null {
  if (!remoteDesktopEnabled || !userId) return null;
  const computer = managedComputersByDeviceId[worker.deviceId];
  if (
    !computer ||
    (computer.state !== "needs_setup" && computer.state !== "ready") ||
    computer.organizationId !== organizationId ||
    computer.requesterUserId !== userId ||
    worker.ownerUserId !== userId
  ) {
    return null;
  }
  return computer;
}

export function WorkerStatusBar({
  onOpenSettings,
  onRefresh,
  organizationId,
  token,
  userId,
  workers,
}: {
  onOpenSettings: () => void;
  onRefresh?: () => void | Promise<void>;
  organizationId?: string | null;
  token?: string | null;
  userId?: string | null;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [managedComputerRemoteEnabled, setManagedComputerRemoteEnabled] =
    useState(false);
  const [managedComputersByDeviceId, setManagedComputersByDeviceId] = useState<
    Record<string, ManagedComputer>
  >({});
  const [remoteComputer, setRemoteComputer] = useState<ManagedComputer | null>(
    null,
  );
  const [deviceUpdates, setDeviceUpdates] = useState<
    Record<string, DeviceUpdateState>
  >({});
  const [updatingDeviceIds, setUpdatingDeviceIds] = useState<
    Record<string, true>
  >({});
  const [updateError, setUpdateError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refreshRequestRef = useRef<Promise<void> | null>(null);
  const popoverId = useId();
  const activeCount = activeWorkerCount(workers);

  const refreshUpdateMetadata = useCallback(async () => {
    if (!token || !organizationId) return;
    try {
      const remote = await loadOrganizationExecutionWorkers(
        token,
        organizationId,
      );
      setLatestVersion(remote.latestVersion ?? null);
      setCanManage(Boolean(remote.canManage));
      const next: Record<string, DeviceUpdateState> = {};
      for (const device of remote.workers) {
        next[device.deviceId] = {
          remoteUpdateSupported: Boolean(device.remoteUpdateSupported),
          updateRequest: device.updateRequest ?? null,
        };
      }
      setDeviceUpdates(next);
    } catch {
      // Version display still works from dashboard workers; update controls stay hidden.
    }
  }, [organizationId, token]);

  const refreshManagedComputerMetadata = useCallback(async () => {
    if (!token || !organizationId || !supportsManagedComputerRemoteDesktop()) {
      setManagedComputerRemoteEnabled(false);
      setManagedComputersByDeviceId({});
      return;
    }
    try {
      const [product, response] = await Promise.all([
        loadManagedComputerProduct(token, organizationId),
        loadManagedComputers(token, organizationId),
      ]);
      const next: Record<string, ManagedComputer> = {};
      for (const computer of response.computers) {
        if (
          computer.deviceId &&
          (computer.state === "needs_setup" || computer.state === "ready")
        ) {
          next[computer.deviceId] = computer;
        }
      }
      setManagedComputerRemoteEnabled(product.remoteDesktopEnabled);
      setManagedComputersByDeviceId(next);
    } catch {
      // Hide shortcuts when managed-computer eligibility cannot be verified.
      setManagedComputerRemoteEnabled(false);
      setManagedComputersByDeviceId({});
    }
  }, [organizationId, token]);

  const refreshStatus = useCallback(() => {
    if (refreshRequestRef.current) return refreshRequestRef.current;
    setIsRefreshing(true);
    const request = Promise.all([
      onRefresh ? Promise.resolve(onRefresh()) : Promise.resolve(),
      refreshUpdateMetadata(),
      refreshManagedComputerMetadata(),
    ])
      .then(() => undefined)
      .finally(() => {
        setIsRefreshing(false);
        refreshRequestRef.current = null;
      });
    refreshRequestRef.current = request;
    return request;
  }, [onRefresh, refreshManagedComputerMetadata, refreshUpdateMetadata]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([
      refreshUpdateMetadata(),
      refreshManagedComputerMetadata(),
    ]);
  }, [isOpen, refreshManagedComputerMetadata, refreshUpdateMetadata]);

  const hasPendingUpdate = Object.values(deviceUpdates).some((device) =>
    Boolean(device.updateRequest),
  );

  useEffect(() => {
    if (!isOpen || !hasPendingUpdate) return;
    const timer = window.setInterval(() => {
      void refreshUpdateMetadata();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasPendingUpdate, isOpen, refreshUpdateMetadata]);

  const requestUpdate = async (worker: ExecutionWorker) => {
    if (!token || !organizationId || !worker.deviceId) return;
    setUpdateError(null);
    setUpdatingDeviceIds((current) => ({
      ...current,
      [worker.deviceId]: true,
    }));
    try {
      await requestOrganizationExecutionWorkerUpdate(
        token,
        organizationId,
        worker.deviceId,
      );
      await refreshUpdateMetadata();
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUpdatingDeviceIds((current) => {
        const next = { ...current };
        delete next[worker.deviceId];
        return next;
      });
    }
  };

  if (workers.length === 0) return null;

  return (
    <div
      aria-label={t("worker.executionEnvironment")}
      className="relative flex h-full shrink-0 items-stretch border-l border-border"
      ref={rootRef}
    >
      <button
        aria-controls={isOpen ? popoverId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("worker.activeCount", { count: activeCount })}
        className="flex h-full min-w-12 cursor-pointer items-center justify-center gap-1.5 border-0 bg-transparent px-2.5 py-0 text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-[.97] focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&>svg]:shrink-0"
        onClick={() => setIsOpen((open) => !open)}
        ref={triggerRef}
        title={t("worker.activeCount", { count: activeCount })}
        type="button"
      >
        <Monitor aria-hidden size={14} strokeWidth={1.8} />
        <strong className="min-w-[9px] text-center font-mono text-micro leading-none font-semibold">
          {activeCount}
        </strong>
      </button>
      {isOpen ? (
        <div
          aria-label={t("worker.executionEnvironment")}
          className="absolute right-1.5 bottom-[calc(100%+7px)] z-60 max-h-[min(420px,calc(100vh-74px))] w-[310px] origin-bottom-right animate-in overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl duration-150 fade-in slide-in-from-bottom-1 zoom-in-95 motion-reduce:animate-none"
          id={popoverId}
          role="dialog"
        >
          <header className="flex h-[42px] items-center justify-between gap-3 border-b border-border px-3.5 py-0">
            <strong className="text-sm font-bold">
              {t("worker.executionEnvironment")}
            </strong>
            <span className="flex items-center gap-1.5 text-micro text-muted-foreground [&>button]:grid [&>button]:size-6 [&>button]:cursor-pointer [&>button]:place-items-center [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:text-muted-foreground [&>button]:hover:bg-accent [&>button]:hover:text-accent-foreground [&>button]:disabled:cursor-default [&>button]:disabled:opacity-70">
              <span>
                {t("worker.activeSummary", {
                  active: activeCount,
                  total: workers.length,
                })}
              </span>
              <button
                aria-busy={isRefreshing}
                aria-label={t("worker.refresh")}
                disabled={isRefreshing}
                onClick={() => {
                  void refreshStatus();
                }}
                title={t("worker.refresh")}
                type="button"
              >
                <Spinner
                  aria-hidden
                  icon={RefreshCw}
                  size={14}
                  spinning={isRefreshing}
                  strokeWidth={1.8}
                />
              </button>
              <button
                aria-label={t("worker.openSettings")}
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                title={t("worker.openSettings")}
                type="button"
              >
                <Settings aria-hidden size={14} strokeWidth={1.8} />
              </button>
            </span>
          </header>
          {updateError ? (
            <p
              className="m-0 border-b border-border px-3 py-2 text-micro text-[var(--status-destructive-foreground)]"
              role="alert"
            >
              {updateError}
            </p>
          ) : null}
          <div className="scrollbar-subtle max-h-[376px] overflow-y-auto">
            {workers.map((worker) => {
              const providers = workerProviders(worker);
              const status = t(`worker.readiness.${worker.readiness}`);
              const maximumSlots = Math.max(1, worker.maxConcurrentSessions);
              const activeSlots = Math.min(
                maximumSlots,
                Math.max(0, worker.activeSessions),
              );
              const slotUsage = t("worker.slotUsage", {
                active: activeSlots,
                maximum: maximumSlots,
              });
              const currentVersion = workerBriarVersion(worker);
              const versionLabel = currentVersion
                ? t("organization.workerVersion", { version: currentVersion })
                : null;
              const deviceState = worker.deviceId
                ? deviceUpdates[worker.deviceId]
                : undefined;
              const remoteUpdateSupported =
                deviceState?.remoteUpdateSupported ??
                workerRemoteUpdateSupported(worker);
              const updateRequest = deviceState?.updateRequest ?? null;
              const updateFailed = updateRequest?.handoffState === "failed";
              const updateAvailable = workerUpdateAvailable({
                currentVersion,
                latestVersion,
              });
              const mayRequestUpdate =
                Boolean(token && organizationId && worker.deviceId) &&
                (canManage ||
                  userId == null ||
                  worker.ownerUserId == null ||
                  worker.ownerUserId === userId);
              const isUpdating = Boolean(
                worker.deviceId && updatingDeviceIds[worker.deviceId],
              );
              const isPending = Boolean(updateRequest) && !updateFailed;
              const showUpdateControl =
                mayRequestUpdate &&
                remoteUpdateSupported &&
                (updateAvailable || isPending || updateFailed || isUpdating);
              const managedComputer = managedComputerShortcutTarget({
                managedComputersByDeviceId,
                organizationId,
                remoteDesktopEnabled: managedComputerRemoteEnabled,
                userId,
                worker,
              });
              const titleParts = [
                worker.label,
                status,
                slotUsage,
                versionLabel,
                updateFailed ? updateRequest?.handoffError : null,
              ].filter(Boolean);

              return (
                <div
                  className="grid min-h-[52px] min-w-0 grid-cols-[7px_28px_minmax(0,1fr)_auto] items-center gap-2 border-t border-border bg-popover px-3 py-2 text-muted-foreground first:border-t-0"
                  key={worker.id}
                  title={titleParts.join(" · ")}
                >
                  <i
                    aria-label={status}
                    className={cn(
                      "size-[7px] shrink-0 rounded-full bg-muted-foreground",
                      worker.readiness === "available" &&
                        "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_12%,transparent)]",
                      worker.readiness === "busy" && "bg-accent-foreground",
                      worker.readiness === "needs_attention" && "bg-warning",
                    )}
                    role="img"
                  />
                  <WorkerIcon icon={worker.icon} size={28} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <strong className="truncate text-xs font-semibold text-foreground">
                      {worker.label}
                    </strong>
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <small className="min-w-0 truncate text-micro text-muted-foreground">
                        {status}
                      </small>
                      <span
                        aria-label={slotUsage}
                        aria-valuemax={maximumSlots}
                        aria-valuemin={0}
                        aria-valuenow={activeSlots}
                        className="inline-flex items-center gap-1 text-muted-foreground"
                        role="progressbar"
                      >
                        <i
                          aria-hidden
                          className="h-1 w-[34px] shrink-0 overflow-hidden rounded-full bg-secondary"
                        >
                          <b
                            className="block h-full rounded-[inherit] bg-accent-foreground transition-[width] duration-200 motion-reduce:transition-none"
                            style={{
                              width: `${(activeSlots / maximumSlots) * 100}%`,
                            }}
                          />
                        </i>
                        <small
                          aria-hidden
                          className="min-w-[23px] whitespace-nowrap font-mono text-micro leading-none font-semibold text-muted-foreground"
                        >
                          {activeSlots}/{maximumSlots}
                        </small>
                      </span>
                      {versionLabel ? (
                        <small className="whitespace-nowrap font-mono text-micro leading-none font-semibold text-muted-foreground">
                          {versionLabel}
                        </small>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="flex items-center gap-0.5 [&>span]:flex [&>span]:items-center [&>span]:gap-0.5 [&>span>span]:grid [&>span>span]:size-5 [&>span>span]:place-items-center [&>span>span]:rounded-md [&>span>span]:border [&>span>span]:border-border [&>span>span]:bg-card [&>span>span]:text-foreground [&_img]:block [&_svg]:block">
                      <WorkerProviderIcons providers={providers} size={13} />
                    </span>
                    {managedComputer ? (
                      <button
                        aria-label={`${t("managedComputer.remote.open")}: ${worker.label}`}
                        className="grid size-[22px] cursor-pointer place-items-center rounded-md border border-border bg-card p-0 text-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          setIsOpen(false);
                          setRemoteComputer(managedComputer);
                        }}
                        title={`${t("managedComputer.remote.open")}: ${worker.label}`}
                        type="button"
                      >
                        <MonitorUp aria-hidden size={13} strokeWidth={1.8} />
                      </button>
                    ) : null}
                    {showUpdateControl ? (
                      <button
                        aria-busy={isUpdating || isPending}
                        aria-label={
                          updateFailed
                            ? t("organization.workerUpdateDelayed", {
                                version:
                                  updateRequest?.targetVersion ??
                                  latestVersion ??
                                  "",
                              })
                            : isPending
                              ? t("organization.workerUpdatePending", {
                                  version:
                                    updateRequest?.targetVersion ??
                                    latestVersion ??
                                    "",
                                })
                              : t("organization.workerUpdate", {
                                  name: worker.label,
                                })
                        }
                        className="grid size-[22px] cursor-pointer place-items-center rounded-md border border-border bg-card p-0 text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-70"
                        disabled={
                          isUpdating ||
                          isPending ||
                          worker.state !== "online" ||
                          !updateAvailable
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void requestUpdate(worker);
                        }}
                        title={
                          updateFailed
                            ? t("organization.workerUpdateDelayedWithReason", {
                                version:
                                  updateRequest?.targetVersion ??
                                  latestVersion ??
                                  "",
                                reason:
                                  updateRequest?.handoffError ??
                                  t("organization.workerUpdateDelayed"),
                              })
                            : isPending
                              ? t("organization.workerUpdatePending", {
                                  version:
                                    updateRequest?.targetVersion ??
                                    latestVersion ??
                                    "",
                                })
                              : remoteUpdateSupported
                                ? t("organization.workerUpdate", {
                                    name: worker.label,
                                  })
                                : t("organization.workerUpdateUnsupported")
                        }
                        type="button"
                      >
                        {isUpdating || isPending ? (
                          <Spinner aria-hidden size={13} strokeWidth={1.8} />
                        ) : (
                          <Download aria-hidden size={13} strokeWidth={1.8} />
                        )}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {remoteComputer &&
      organizationId &&
      token &&
      remoteComputer.organizationId === organizationId &&
      remoteComputer.requesterUserId === userId ? (
        <ManagedComputerRemoteDesktop
          computer={remoteComputer}
          onClose={() => setRemoteComputer(null)}
          organizationId={organizationId}
          token={token}
        />
      ) : null}
    </div>
  );
}
