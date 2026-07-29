import { useI18n } from "../i18n";
import type { AgentProvider } from "../lib/project-llm";
import type { ExecutionWorker } from "../types";
import { AgentProviderIcon } from "./AgentIcons";

const agentProviders = new Set<AgentProvider>(["claude", "codex", "grok"]);

function providerName(provider: AgentProvider) {
  if (provider === "claude") return "Claude";
  if (provider === "grok") return "Grok";
  return "Codex";
}

export function workerProviders(worker: ExecutionWorker): AgentProvider[] {
  const configured = worker.capabilities.providers;
  if (!Array.isArray(configured)) return [worker.agentProvider];

  const providers = configured.filter(
    (provider): provider is AgentProvider =>
      typeof provider === "string" &&
      agentProviders.has(provider as AgentProvider),
  );
  return providers.length > 0 ? [...new Set(providers)] : [worker.agentProvider];
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
            <span
              aria-label={providers.map(providerName).join(", ")}
              className="worker-status-providers"
            >
              {providers.map((provider) => (
                <span key={provider} title={providerName(provider)}>
                  <AgentProviderIcon provider={provider} size={12} />
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
