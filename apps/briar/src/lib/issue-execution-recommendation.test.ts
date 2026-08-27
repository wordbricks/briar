import { describe, expect, it } from "vitest";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentProviderCapabilityCatalog,
} from "./agent-provider-contract";
import { recommendIssueExecution } from "./issue-execution-recommendation";

const catalog = () => emptyAgentProviderCapabilityCatalog();

const withModel = (
  current: AgentProviderCapabilityCatalog,
  provider: keyof AgentProviderCapabilityCatalog,
  model: string,
  efforts: string[],
) => {
  current[provider] = {
    models: [{
      id: model,
      label: model,
      efforts: efforts.map((effort) => ({ id: effort, label: effort })),
    }],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  };
  return current;
};

describe("recommendIssueExecution", () => {
  it("uses the configured provider order for easy issues", () => {
    const current = withModel(
      withModel(
        catalog(),
        "codex",
        "gpt-5.6-luna",
        ["max"],
      ),
      "agy",
      "gemini-3.7-flash-high",
      [],
    );

    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "agy",
      model: "gemini-3.7-flash-high",
      effort: null,
    });
  });

  it("falls through when a designated model lacks the configured effort", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-luna", ["high"]),
      "claude",
      "opus",
      ["high"],
    );

    expect(recommendIssueExecution("normal", current)).toEqual({
      provider: "claude",
      model: "opus",
      effort: "high",
    });
  });

  it("accepts provider prefixes and separator differences for designated models", () => {
    const current = withModel(
      catalog(),
      "opencode",
      "opencode-go/deepseek-v4-flash-0731",
      ["high"],
    );

    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "opencode",
      model: "opencode-go/deepseek-v4-flash-0731",
      effort: "high",
    });
  });

  it("does not choose unlisted models or a different model generation", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-sol", ["max"]),
      "claude",
      "claude-sonnet-4-5",
      ["high"],
    );

    expect(recommendIssueExecution("easy", current)).toBeNull();
  });

  it("keeps an explicit provider constraint", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-sol", ["xhigh"]),
      "claude",
      "opus",
      ["high"],
    );

    expect(recommendIssueExecution("hard", current, "claude")).toEqual({
      provider: "claude",
      model: "opus",
      effort: "high",
    });
  });

  it("skips a merged capability that no individual Worker can run", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-luna", ["max"]),
      "claude",
      "opus",
      ["high"],
    );

    expect(recommendIssueExecution(
      "normal",
      current,
      null,
      (selection) => selection.provider === "claude",
    )).toEqual({
      provider: "claude",
      model: "opus",
      effort: "high",
    });
  });
});
