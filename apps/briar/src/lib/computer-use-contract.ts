import * as Schema from "effect/Schema";
import type { AgentProvider } from "./agent-provider";

export const computerUsePolicies = ["disabled", "unattended"] as const;

export const ComputerUsePolicySchema = Schema.Literals(computerUsePolicies);

export type ComputerUsePolicy = typeof ComputerUsePolicySchema.Type;

// A provider belongs here only when Briar can inject its private Computer Use
// MCP server into a single runner process without changing user-global config.
//
// Pi is absent on purpose: `pi-acp` accepts the `mcpServers` field of
// `session/new` and stores it, but never forwards it to pi, so the servers
// Briar hands it would silently do nothing. Vertex AI is absent because an
// OpenCode upstream has no runner process of its own to inject into.
export const computerUseProviderAdapters = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "openrouter",
] as const satisfies readonly AgentProvider[];

const computerUseProviderAdapterSet = new Set<AgentProvider>(
  computerUseProviderAdapters,
);

export const supportsComputerUseProvider = (
  provider: AgentProvider,
): boolean => computerUseProviderAdapterSet.has(provider);
