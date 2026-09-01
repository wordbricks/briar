import { Monitor } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import type { ExecutionWorker } from "../types";
import { WorkerIcon } from "./WorkerIcon";
import { WorkerProviderIcons } from "./WorkerProviderIcons";

function companionWorkerProviders(worker: ExecutionWorker) {
  if (
    worker.state !== "online" ||
    !worker.acceptingWork ||
    (worker.readiness !== "available" && worker.readiness !== "busy")
  ) {
    return [];
  }
  return [...new Set(worker.providers)];
}

export function companionActiveWorkerCount(workers: ExecutionWorker[]) {
  return workers.filter(
    (worker) =>
      worker.state === "online" &&
      worker.acceptingWork &&
      (worker.readiness === "available" || worker.readiness === "busy"),
  ).length;
}

export function CompanionHostStatusDialog({
  onOpenChange,
  open,
  workers,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  const activeCount = companionActiveWorkerCount(workers);
  const sortedWorkers = [...workers].sort((left, right) =>
    left.label.localeCompare(right.label),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-label={t("worker.executionEnvironment")}
        className="max-h-[82dvh] overflow-hidden p-0 sm:max-w-md"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="gap-1 border-b border-border px-5 py-5 pr-12 text-left">
          <DialogTitle>{t("worker.executionEnvironment")}</DialogTitle>
          <DialogDescription>
            {t("worker.activeSummary", {
              active: activeCount,
              total: workers.length,
            })}
          </DialogDescription>
        </DialogHeader>

        {sortedWorkers.length === 0 ? (
          <div className="grid min-h-48 place-items-center gap-2 px-6 py-10 text-center text-muted-foreground">
            <Monitor aria-hidden size={28} strokeWidth={1.7} />
            <p className="m-0 max-w-64 text-sm">{t("companion.hostEmpty")}</p>
          </div>
        ) : (
          <div className="scrollbar-subtle max-h-[calc(82dvh-92px)] overflow-y-auto px-4 pb-4">
            {sortedWorkers.map((worker) => {
              const maximumSlots = Math.max(1, worker.maxConcurrentSessions);
              const activeSlots = Math.min(
                maximumSlots,
                Math.max(0, worker.activeSessions),
              );
              const slotUsage = t("worker.slotUsage", {
                active: activeSlots,
                maximum: maximumSlots,
              });
              const status = t(`worker.readiness.${worker.readiness}`);

              return (
                <article
                  className="grid min-w-0 grid-cols-[8px_38px_minmax(0,1fr)] items-start gap-3 border-b border-border py-4 last:border-b-0"
                  data-companion-host-worker={worker.id}
                  key={worker.id}
                >
                  <i
                    aria-label={status}
                    className={cn(
                      "mt-3 size-2 rounded-full bg-muted-foreground",
                      worker.readiness === "available" && "bg-success",
                      worker.readiness === "busy" && "bg-primary",
                      worker.readiness === "needs_attention" && "bg-warning",
                    )}
                    role="img"
                  />
                  <WorkerIcon icon={worker.icon} size={38} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <strong className="truncate text-sm text-foreground">
                        {worker.label}
                      </strong>
                      <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                        {status}
                      </span>
                    </div>
                    {worker.readinessDetail ? (
                      <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
                        {worker.readinessDetail}
                      </p>
                    ) : null}
                    <div
                      aria-label={slotUsage}
                      aria-valuemax={maximumSlots}
                      aria-valuemin={0}
                      aria-valuenow={activeSlots}
                      className="mt-2 flex items-center gap-2"
                      role="progressbar"
                    >
                      <i className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                        <b
                          className="block h-full rounded-full bg-primary"
                          style={{
                            width: `${(activeSlots / maximumSlots) * 100}%`,
                          }}
                        />
                      </i>
                      <small className="font-mono text-xs text-muted-foreground">
                        {activeSlots}/{maximumSlots}
                      </small>
                    </div>
                    <div className="mt-2">
                      <WorkerProviderIcons
                        providers={companionWorkerProviders(worker)}
                        size={14}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
