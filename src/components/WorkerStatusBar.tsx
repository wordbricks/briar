import { Monitor } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { AgentProvider } from "../lib/project-llm";
import type { ExecutionWorker } from "../types";
import { WorkerProviderIcons } from "./WorkerProviderIcons";

export function workerProviders(worker: ExecutionWorker): AgentProvider[] {
  const providers = worker.providers ?? [];
  return providers.length > 0
    ? [...new Set(providers)]
    : [worker.agentProvider];
}

export function activeWorkerCount(workers: ExecutionWorker[]): number {
  return workers.filter((worker) => worker.state === "online").length;
}

export function WorkerStatusBar({
  workers,
}: {
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const activeCount = activeWorkerCount(workers);

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
            <span>
              {t("worker.activeSummary", {
                active: activeCount,
                total: workers.length,
              })}
            </span>
          </header>
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
              return (
                <div
                  className="worker-status-item"
                  key={worker.id}
                  title={`${worker.label} · ${status} · ${slotUsage}`}
                >
                  <i
                    aria-label={status}
                    className={`worker-status-dot ${worker.readiness}`}
                    role="img"
                  />
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
                    </span>
                  </span>
                  <span className="worker-status-providers">
                    <WorkerProviderIcons providers={providers} size={13} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
