import { describe, expect, it } from "vitest";

import type {
  AgentProviderAvailability,
  AgentProviderKind,
} from "../generated/tauri";
import {
  isProviderUsageExhausted,
  preferredProvider,
  providerChoiceNote,
  selectableProviders,
} from "./team-provider-choice";

function availability(
  provider: AgentProviderKind,
  overrides: Partial<AgentProviderAvailability> = {},
): AgentProviderAvailability {
  return {
    provider,
    enabled: true,
    installed: true,
    authenticated: true,
    selectable: true,
    usageExhausted: false,
    maxUsedPercent: null,
    usageResetsAt: null,
    reason: null,
    ...overrides,
  };
}

describe("team provider choice", () => {
  it("explains why each provider is or is not the obvious choice", () => {
    expect(
      providerChoiceNote(availability("codex", { enabled: false })),
    ).toEqual({ kind: "disabled" });
    expect(
      providerChoiceNote(availability("grok", { installed: false })),
    ).toEqual({ kind: "notInstalled" });
    expect(
      providerChoiceNote(availability("claude", { authenticated: false })),
    ).toEqual({ kind: "notAuthenticated" });
    expect(
      providerChoiceNote(
        availability("codex", {
          usageExhausted: true,
          usageResetsAt: 1_800_052_800_000,
        }),
      ),
    ).toEqual({ kind: "usageExhausted", resetsAt: 1_800_052_800_000 });
    expect(
      providerChoiceNote(availability("claude", { maxUsedPercent: 41 })),
    ).toEqual({ kind: "usage", usedPercent: 41 });
    expect(providerChoiceNote(availability("claude"))).toBeNull();
  });

  it("offers every connected provider, including one out of quota", () => {
    const providers = [
      availability("codex", { usageExhausted: true }),
      availability("claude"),
      availability("grok", { installed: false, selectable: false }),
    ];

    expect(selectableProviders(providers)).toEqual(["codex", "claude"]);
    expect(isProviderUsageExhausted(providers, "codex")).toBe(true);
    expect(isProviderUsageExhausted(providers, "claude")).toBe(false);
  });

  it("keeps an explicit choice until that provider stops being usable", () => {
    const providers = [
      availability("codex"),
      availability("claude"),
      availability("grok", { authenticated: false, selectable: false }),
    ];

    expect(preferredProvider(providers, "claude", "codex")).toBe("claude");
    expect(preferredProvider(providers, null, "codex")).toBe("codex");
    expect(preferredProvider(providers, "grok", "codex")).toBe("codex");
  });
});
