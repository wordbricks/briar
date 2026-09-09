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
      "gemini-3.8-flash-high",
      [],
    );

    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "agy",
      model: "gemini-3.8-flash-high",
      effort: null,
    });
  });

  it("falls through when a designated model lacks the configured effort", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-sol", ["low"]),
      "claude",
      "opus",
      ["medium"],
    );

    expect(recommendIssueExecution("normal", current)).toEqual({
      provider: "claude",
      model: "opus",
      effort: "medium",
    });
  });

  it("accepts provider prefixes and separator differences for designated models", () => {
    const current = withModel(
      catalog(),
      "openrouter",
      "openrouter/deepseek/deepseek-v4-flash-0731",
      [],
    );

    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "openrouter",
      model: "openrouter/deepseek/deepseek-v4-flash-0731",
      effort: null,
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

  // The claude catalog only exposes alias ids ("opus[1m]"), so the resolved
  // wire model that parseClaudeInitializeModels folds into the label is what
  // makes this match. If that label ever stops carrying "claude-opus-5[1m]",
  // difficulty-based model selection silently stops picking Opus for claude.
  it("matches the real claude catalog row through its folded label", () => {
    const current = catalog();
    current.claude = {
      models: [{
        id: "opus[1m]",
        label: "Opus (1M context) · claude-opus-5[1m]",
        isDefault: true,
        defaultEffortId: null,
        efforts: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
          id: effort,
          label: effort,
        })),
      }],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };

    expect(recommendIssueExecution("normal", current)).toEqual({
      provider: "claude",
      model: "opus[1m]",
      effort: "medium",
    });
    expect(recommendIssueExecution("hard", current)).toEqual({
      provider: "claude",
      model: "opus[1m]",
      effort: "high",
    });
  });

  it("skips a merged capability that no individual Worker can run", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-sol", ["high"]),
      "claude",
      "opus",
      ["medium"],
    );

    expect(recommendIssueExecution(
      "normal",
      current,
      null,
      (selection) => selection.provider === "claude",
    )).toEqual({
      provider: "claude",
      model: "opus",
      effort: "medium",
    });
  });

  // `expert` is the only difficulty that reaches for Fable 5's long-context
  // row, and a Worker advertises it under two shapes depending on its Briar
  // version. Both have to match, or an expert issue silently drops to Astra
  // on half the fleet.
  it("picks the claude long-context row for expert issues from its id", () => {
    const current = catalog();
    current.claude = {
      models: [{
        id: "claude-fable-5-1[1m]",
        label: "claude-fable-5-1[1m]",
        isDefault: true,
        defaultEffortId: null,
        efforts: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
          id: effort,
          label: effort,
        })),
      }],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };

    expect(recommendIssueExecution("expert", current)).toEqual({
      provider: "claude",
      model: "claude-fable-5-1[1m]",
      effort: "max",
    });
  });

  it("picks the claude long-context row for expert issues from its folded label", () => {
    const current = catalog();
    current.claude = {
      models: [{
        id: "fable-1[1m]",
        label: "Fable · claude-fable-5-1",
        isDefault: true,
        defaultEffortId: null,
        efforts: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
          id: effort,
          label: effort,
        })),
      }],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };

    expect(recommendIssueExecution("expert", current)).toEqual({
      provider: "claude",
      model: "fable-1[1m]",
      effort: "max",
    });
  });

  // Plain Fable 5 scores below the Opus 5 that `hard` already picks, so it is
  // not an expert model: the selection has to walk past it to Astra rather
  // than trade down.
  it("falls through to codex Astra when claude only has plain Fable 5", () => {
    const current = withModel(
      withModel(catalog(), "claude", "claude-fable-5", ["high", "max"]),
      "codex",
      "gpt-6-astra",
      ["high", "xhigh", "max", "ultra"],
    );

    expect(recommendIssueExecution("expert", current)).toEqual({
      provider: "codex",
      model: "gpt-6-astra",
      effort: "ultra",
    });
  });

  it("selects codex Astra for expert issues when no claude model is present", () => {
    const current = withModel(
      catalog(),
      "codex",
      "gpt-6-astra",
      ["low", "medium", "high", "xhigh", "max", "ultra"],
    );

    expect(recommendIssueExecution("expert", current)).toEqual({
      provider: "codex",
      model: "gpt-6-astra",
      effort: "ultra",
    });
  });
});

describe("recommendIssueExecution tier bands", () => {
  const opencode = (
    current: AgentProviderCapabilityCatalog,
    ...ids: string[]
  ) => {
    current.opencode = {
      models: ids.map((id) => ({ id, label: id, efforts: [] })),
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };
    return current;
  };

  // OpenCode reports no efforts, per model or as provider defaults, so an
  // entry that named one could never be selected.
  it("selects an OpenCode model even though it advertises no efforts", () => {
    const current = opencode(catalog(), "opencode-go/glm-5.3-flash");

    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "opencode",
      model: "opencode-go/glm-5.3-flash",
      effort: null,
    });
  });

  // `["glm", "5", "3"]` is a prefix of `glm-5.3-flash`, so normal matches the
  // full model by alias instead, and a flash-first catalog cannot divert it.
  it("does not let the flash build stand in for GLM 5.3 on normal", () => {
    const current = opencode(
      catalog(),
      "opencode-go/glm-5.3-flash",
      "opencode-go/glm-5.3",
    );

    expect(recommendIssueExecution("normal", current)).toEqual({
      provider: "opencode",
      model: "opencode-go/glm-5.3",
      effort: null,
    });
    expect(recommendIssueExecution("easy", current)).toEqual({
      provider: "opencode",
      model: "opencode-go/glm-5.3-flash",
      effort: null,
    });
  });

  // The undated build scores far below the dated one; only the latter is
  // designated, so a catalog holding just the undated model matches nothing.
  it("designates only the dated DeepSeek build", () => {
    const bare = catalog();
    bare.openrouter = {
      models: [{ id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", efforts: [] }],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };
    expect(recommendIssueExecution("easy", bare)).toBeNull();

    const dated = catalog();
    dated.openrouter = {
      models: [{
        id: "deepseek/deepseek-v4-flash-0731",
        label: "DeepSeek V4 Flash 0731",
        efforts: [],
      }],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    };
    expect(recommendIssueExecution("easy", dated)).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash-0731",
      effort: null,
    });
  });

  // Claude has no model in normal's band, so the two tiers share Opus 5 and
  // are separated by effort alone.
  it("separates normal from hard on Claude by effort", () => {
    const current = withModel(
      catalog(),
      "claude",
      "opus[1m]",
      ["low", "medium", "high", "xhigh", "max"],
    );
    current.claude.models[0]!.label = "Opus (1M context) · claude-opus-5[1m]";

    expect(recommendIssueExecution("normal", current)?.effort).toBe("medium");
    expect(recommendIssueExecution("hard", current)?.effort).toBe("high");
  });

  // Every tier's first choice must outrank every candidate below it; hard used
  // to lead with a weaker model than its own runner-up.
  it("leads hard with Opus rather than the weaker Codex build", () => {
    const current = withModel(
      withModel(catalog(), "codex", "gpt-5.6-sol", ["high", "xhigh"]),
      "claude",
      "opus[1m]",
      ["medium", "high"],
    );
    current.claude.models[0]!.label = "Opus (1M context) · claude-opus-5[1m]";

    expect(recommendIssueExecution("hard", current)).toEqual({
      provider: "claude",
      model: "opus[1m]",
      effort: "high",
    });
  });
});
