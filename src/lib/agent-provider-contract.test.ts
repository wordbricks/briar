import { describe, expect, it } from "vitest";
import {
  agentProviderAllowsEffort,
  agentProviderAllowsModel,
  agentProviderLabels,
  agentProviderPolicies,
  agentProviders,
  modelEfforts,
} from "./agent-provider-contract";

describe("agent provider contract", () => {
  it("defines every provider label and policy from the shared roster", () => {
    expect(agentProviders).toEqual(["codex", "claude", "grok", "opencode"]);
    expect(agentProviderLabels).toEqual({
      codex: "Codex",
      claude: "Claude",
      grok: "Grok",
      opencode: "OpenCode",
    });
    expect(Object.keys(agentProviderPolicies)).toEqual(agentProviders);
  });

  it("keeps catalog validation strict except for OpenCode models", () => {
    expect(agentProviderAllowsModel("codex", "gpt-5.6-sol")).toBe(true);
    expect(agentProviderAllowsModel("codex", "not-a-codex-model")).toBe(false);
    expect(agentProviderAllowsModel("claude", "sonnet")).toBe(true);
    expect(agentProviderAllowsModel("grok", "grok-4.5")).toBe(true);
    expect(agentProviderAllowsModel("opencode", "vendor/custom-model")).toBe(
      true,
    );
  });

  it("shares provider-specific effort limits", () => {
    expect(agentProviderPolicies.codex.efforts).toEqual(modelEfforts);
    expect(agentProviderAllowsEffort("codex", "ultra")).toBe(true);
    expect(agentProviderAllowsEffort("claude", "ultra")).toBe(false);
    expect(agentProviderAllowsEffort("grok", "xhigh")).toBe(false);
    expect(agentProviderAllowsEffort("opencode", "high")).toBe(true);
  });
});
