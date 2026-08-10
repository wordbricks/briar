import { AgentProviderIcon } from "./AgentIcons";
import {
  agentProviderLabels,
  type AgentProvider,
} from "../lib/project-llm";

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
          aria-label={agentProviderLabels[provider]}
          className="inline-flex items-center justify-center"
          key={provider}
          role="img"
          title={agentProviderLabels[provider]}
        >
          <AgentProviderIcon provider={provider} size={size} />
        </span>
      ))}
    </span>
  );
}
