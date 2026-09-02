import * as Schema from "effect/Schema";
import type { AgentProvider } from "./agent-provider";

export const computerUsePolicies = ["disabled", "unattended"] as const;

export const ComputerUsePolicySchema = Schema.Literals(computerUsePolicies);

export type ComputerUsePolicy = typeof ComputerUsePolicySchema.Type;

// A provider belongs here only when Briar can inject its private Computer Use
// MCP server into a single runner process without changing user-global config.
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
