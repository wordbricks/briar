/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  agentModelPreferencesStorageKey,
  readAgentProviderModelPreferences,
  writeAgentProviderModelPreference,
} from "./agent-model-preferences";

describe("agent model preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores provider defaults and unique favorite model ids", () => {
    writeAgentProviderModelPreference("codex", {
      defaultModel: "  gpt-default  ",
      favoriteModels: ["gpt-fast", " gpt-fast ", "", "gpt-deep"],
    });

    expect(readAgentProviderModelPreferences().codex).toEqual({
      defaultModel: "gpt-default",
      favoriteModels: ["gpt-fast", "gpt-deep"],
    });
  });

  it("falls back safely when stored preferences are malformed", () => {
    window.localStorage.setItem(agentModelPreferencesStorageKey, "not-json");

    expect(readAgentProviderModelPreferences().claude).toEqual({
      defaultModel: null,
      favoriteModels: [],
    });
  });
});
