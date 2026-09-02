import { describe, expect, it } from "vitest";
import { agentProviders } from "./agent-provider";
import {
  computerUseProviderAdapters,
  supportsComputerUseProvider,
} from "./computer-use-contract";

describe("Computer Use provider capability", () => {
  it("is adapter-driven rather than Grok-specific", () => {
    expect(computerUseProviderAdapters).toEqual([
      "codex",
      "claude",
      "cursor",
      "grok",
      "opencode",
      "openrouter",
    ]);
    expect(agentProviders.filter(supportsComputerUseProvider)).toEqual(
      computerUseProviderAdapters,
    );
    expect(supportsComputerUseProvider("agy")).toBe(false);
  });
});
