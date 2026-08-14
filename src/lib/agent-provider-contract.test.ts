import { describe, expect, it } from "vitest";
import {
  agentProviderCapabilityCatalogSchema,
  agentProviderLabels,
  agentProviderSupportsSelection,
  agentProviders,
  emptyAgentProviderCapabilityCatalog,
  mergeAgentProviderCapabilityCatalogs,
  modelEffortSchema,
} from "./agent-provider-contract";

describe("agent provider contract", () => {
  it("keeps only the provider roster and labels static", () => {
    expect(agentProviders).toEqual(["codex", "claude", "grok", "opencode"]);
    expect(agentProviderLabels).toEqual({
      codex: "Codex",
      claude: "Claude",
      grok: "Grok",
      opencode: "OpenCode",
    });
    expect(emptyAgentProviderCapabilityCatalog().grok.models).toEqual([]);
  });

  it("accepts provider-owned model and effort identifiers structurally", () => {
    const catalog = emptyAgentProviderCapabilityCatalog();
    catalog.grok.models = [{
      id: "grok-4.6",
      label: "Grok 4.6",
      efforts: [{ id: "xhigh", label: "Extra high" }],
    }];
    expect(agentProviderCapabilityCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(modelEffortSchema.parse("future-effort")).toBe("future-effort");
  });

  it("checks an explicit selection against the reporting worker", () => {
    const capability = {
      models: [{
        id: "grok-4.6",
        label: "Grok 4.6",
        efforts: [{ id: "xhigh", label: "xhigh" }],
      }],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    };
    expect(agentProviderSupportsSelection(capability, "grok-4.6", "xhigh")).toBe(true);
    expect(agentProviderSupportsSelection(capability, "grok-4.5", "high")).toBe(false);
  });

  it("checks an effort for the provider default against the reported default model", () => {
    const capability = {
      models: [{
        id: "grok-4.6",
        label: "Grok 4.6",
        isDefault: true,
        efforts: [{ id: "xhigh", label: "xhigh" }],
      }],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    };
    expect(agentProviderSupportsSelection(capability, null, "xhigh")).toBe(true);
    expect(agentProviderSupportsSelection(capability, null, "high")).toBe(false);
  });

  it("merges model-specific efforts reported by multiple workers", () => {
    const first = emptyAgentProviderCapabilityCatalog();
    const second = emptyAgentProviderCapabilityCatalog();
    first.codex.models = [{ id: "gpt-next", label: "GPT Next", efforts: [{ id: "high", label: "high" }] }];
    second.codex.models = [{ id: "gpt-next", label: "GPT Next", efforts: [{ id: "max", label: "max" }] }];
    expect(mergeAgentProviderCapabilityCatalogs([first, second]).codex.models[0]?.efforts?.map((item) => item.id)).toEqual(["high", "max"]);
  });
});
