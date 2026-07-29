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

export function WorkerStatusBar({
  workers,
}: {
  workers: ExecutionWorker[];
}) {
  const { t } = useI18n();
  if (workers.length === 0) return null;

  return (
    <div
      aria-label={t("worker.executionEnvironment")}
      className="worker-status-list"
    >
      {workers.map((worker) => {
        const providers = workerProviders(worker);
        const status = t(`worker.readiness.${worker.readiness}`);
        return (
          <div
            className="worker-status-item"
            key={worker.id}
            title={`${worker.label} · ${status}`}
          >
            <i
              aria-label={status}
              className={`worker-status-dot ${worker.readiness}`}
              role="img"
            />
            <strong>{worker.label}</strong>
            <span className="worker-status-providers">
              <WorkerProviderIcons providers={providers} size={12} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
