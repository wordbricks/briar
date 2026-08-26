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
import type { AgentProvider } from "../lib/project-llm";
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

export function workerProviders(worker: ExecutionWorker): AgentProvider[] {
  if (
    worker.state !== "online" ||
    !worker.acceptingWork ||
    (worker.readiness !== "available" && worker.readiness !== "busy")
  ) {
    return [];
  }
  const providers = worker.providers ?? [];
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
  const [remoteComputer, setRemoteComputer] =
    useState<ManagedComputer | null>(null);
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

  const hasPendingUpdate = Object.values(deviceUpdates).some(
    (device) => Boolean(device.updateRequest),
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
      className="worker-status-menu"
      ref={rootRef}
    >
      <button
        aria-controls={isOpen ? popoverId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("worker.activeCount", { count: activeCount })}
        className="worker-status-trigger"
        onClick={() => setIsOpen((open) => !open)}
        ref={triggerRef}
        title={t("worker.activeCount", { count: activeCount })}
        type="button"
      >
        <Monitor aria-hidden size={14} strokeWidth={1.8} />
        <strong>{activeCount}</strong>
      </button>
      {isOpen ? (
        <div
          aria-label={t("worker.executionEnvironment")}
          className="worker-status-popover"
          id={popoverId}
          role="dialog"
        >
          <header>
            <strong>{t("worker.executionEnvironment")}</strong>
            <span className="worker-status-header-actions">
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
            <p className="worker-status-error" role="alert">
              {updateError}
            </p>
          ) : null}
          <div className="worker-status-list">
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
                  className="worker-status-item"
                  key={worker.id}
                  title={titleParts.join(" · ")}
                >
                  <i
                    aria-label={status}
                    className={`worker-status-dot ${worker.readiness}`}
                    role="img"
                  />
                  <WorkerIcon icon={worker.icon} size={28} />
                  <span className="worker-status-copy">
                    <strong>{worker.label}</strong>
                    <span className="worker-status-meta">
                      <small>{status}</small>
                      <span
                        aria-label={slotUsage}
                        aria-valuemax={maximumSlots}
                        aria-valuemin={0}
                        aria-valuenow={activeSlots}
                        className="worker-slot-usage"
                        role="progressbar"
                      >
                        <i aria-hidden>
                          <b
                            style={{
                              width: `${(activeSlots / maximumSlots) * 100}%`,
                            }}
                          />
                        </i>
                        <small aria-hidden>
                          {activeSlots}/{maximumSlots}
                        </small>
                      </span>
                      {versionLabel ? (
                        <small className="worker-status-version">
                          {versionLabel}
                        </small>
                      ) : null}
                    </span>
                  </span>
                  <span className="worker-status-actions">
                    <span className="worker-status-providers">
                      <WorkerProviderIcons providers={providers} size={13} />
                    </span>
                    {managedComputer ? (
                      <button
                        aria-label={`${t("managedComputer.remote.open")}: ${worker.label}`}
                        className="worker-status-remote"
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
                        className="worker-status-update"
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
                          <Spinner
                            aria-hidden
                            size={13}
                            strokeWidth={1.8}
                          />
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
