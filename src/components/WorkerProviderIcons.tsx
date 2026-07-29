import { AgentProviderIcon } from "./AgentIcons";
import type { AgentProvider } from "../lib/project-llm";

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
};

export function WorkerProviderIcons({
  providers,
  size = 15,
}: {
  providers: AgentProvider[];
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {providers.map((provider) => (
        <span
          aria-label={providerLabels[provider]}
          className="inline-flex items-center justify-center"
          key={provider}
          role="img"
          title={providerLabels[provider]}
        >
          <AgentProviderIcon provider={provider} size={size} />
        </span>
      ))}
    </span>
  );
}
