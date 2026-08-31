import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AgentProviderCapabilityCatalog,
  agentProviderSupportsSelection,
  decodeAgentProviderCapabilityCatalog,
  emptyAgentProviderCapabilityCatalog,
  mergeAgentProviderCapabilityAdvertisements,
  mergeAgentProviderCapabilityCatalogs,
  ModelEffort,
} from "./agent-provider-contract";

describe("agent provider contract", () => {
  it("accepts provider-owned model and effort identifiers structurally", () => {
    const catalog = emptyAgentProviderCapabilityCatalog();
    catalog.grok.models = [{
      id: "grok-4.6",
      label: "Grok 4.6",
      efforts: [{ id: "xhigh", label: "Extra high" }],
    }];
    expect(decodeAgentProviderCapabilityCatalog(catalog)).toEqual(catalog);
    expect(Schema.decodeSync(ModelEffort)("future-effort")).toBe(
      "future-effort",
    );
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

  it("deduplicates and sorts advertised provider-owned IDs independently of Worker order", () => {
    const first = emptyAgentProviderCapabilityCatalog();
    const second = emptyAgentProviderCapabilityCatalog();
    first.codex.models = [
      { id: "model-z", label: "Zeta" },
      {
        id: "model-shared",
        label: "Shared Zeta",
        efforts: [{ id: "max", label: "Maximum" }],
      },
    ];
    second.codex.models = [
      {
        id: "model-shared",
        label: "Shared Alpha",
        efforts: [{ id: "high", label: "High" }],
      },
      { id: "model-a", label: "Alpha" },
    ];
    const advertisements = [first, second].map((providerCapabilities) => ({
      providers: ["codex"] as const,
      providerCapabilities,
    }));

    const forward = mergeAgentProviderCapabilityAdvertisements(advertisements);
    const reverse = mergeAgentProviderCapabilityAdvertisements(
      [...advertisements].reverse(),
    );

    expect(reverse).toEqual(forward);
    expect(forward.codex.models.map((model) => model.id)).toEqual([
      "model-a",
      "model-shared",
      "model-z",
    ]);
    expect(forward.codex.models[1]).toMatchObject({
      id: "model-shared",
      label: "Shared Alpha",
      efforts: [{ id: "high" }, { id: "max" }],
    });
    expect(forward.claude.models).toEqual([]);
  });
});
