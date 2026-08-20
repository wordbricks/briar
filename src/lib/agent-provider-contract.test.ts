import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AgentProviderCapabilityCatalog,
  agentProviderSupportsSelection,
  decodeAgentProviderCapabilityCatalog,
  emptyAgentProviderCapabilityCatalog,
  mergeAgentProviderCapabilityCatalogs,
  ModelEffort,
} from "./agent-provider-contract";
import { agentProviderLabels, agentProviders } from "./agent-provider";

describe("agent provider contract", () => {
  it("keeps only the provider roster and labels static", () => {
    expect(agentProviders).toEqual([
      "codex",
      "claude",
      "cursor",
      "grok",
      "agy",
      "opencode",
      "openrouter",
    ]);
    expect(agentProviderLabels).toEqual({
      codex: "Codex",
      claude: "Claude",
      cursor: "Cursor",
      grok: "Grok",
      agy: "Antigravity",
      opencode: "OpenCode",
      openrouter: "OpenRouter",
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
    expect(decodeAgentProviderCapabilityCatalog(catalog)).toEqual(catalog);
    expect(Schema.decodeUnknownSync(ModelEffort)("future-effort")).toBe(
      "future-effort",
    );
  });

  it("fills newly added providers for capability catalogs from older workers", () => {
    const legacy = emptyAgentProviderCapabilityCatalog();
    delete (legacy as Partial<typeof legacy>).agy;
    const parsed = decodeAgentProviderCapabilityCatalog(legacy);
    expect(parsed.agy).toEqual({
      models: [],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    });
    expect(parsed.codex).toEqual(legacy.codex);
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
