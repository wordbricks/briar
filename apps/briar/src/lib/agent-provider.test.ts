import { describe, expect, it } from "vitest";
import {
  addableProviders,
  agentProviderCatalog,
  agentProviderEnvironmentKey,
  agentProviderExecutionEnvironment,
  agentProviders,
  backfilledAddedProviders,
  builtInProviders,
  effectiveEnabledProviders,
  isProviderActive,
  normalizeAddedProviders,
  openCodeUpstreamConfigJson,
  openCodeUpstreamModelPrefix,
  openCodeUpstreamOf,
  openCodeUpstreamProviders,
} from "./agent-provider";

/** The string Briar generated for OpenRouter before the descriptor existed. */
const legacyOpenRouterOpenCodeConfig =
  '{"provider":{"openrouter":{"options":{"apiKey":"{env:OPENROUTER_API_KEY}"}}}}';

describe("agent provider catalog", () => {
  it("declares a runtime kind for every provider", () => {
    for (const provider of agentProviders) {
      expect(["sidecarCli", "acpAgent", "openCodeUpstream"]).toContain(
        agentProviderCatalog[provider].kind,
      );
    }
  });

  it("gives every OpenCode upstream a descriptor and no one else one", () => {
    expect(openCodeUpstreamProviders).toEqual(["openrouter", "vertex"]);
    for (const provider of agentProviders) {
      const upstream = openCodeUpstreamOf(provider);
      expect(upstream === null).toBe(
        agentProviderCatalog[provider].kind !== "openCodeUpstream",
      );
      if (!upstream) continue;
      // An upstream is not its own CLI: it runs the OpenCode binary.
      expect(agentProviderCatalog[provider].binaryName).toBe(
        agentProviderCatalog.opencode.binaryName,
      );
      expect(upstream.environmentPrefixes.length).toBeGreaterThan(0);
    }
  });
});

describe("built-in and added providers", () => {
  const allEnabled = Object.fromEntries(
    agentProviders.map((provider) => [provider, true] as const),
  ) as Record<(typeof agentProviders)[number], boolean>;

  it("splits every provider into exactly one of the two lists", () => {
    expect(builtInProviders).toEqual(["codex", "claude", "agy", "opencode"]);
    expect(addableProviders).toEqual([
      "cursor",
      "grok",
      "openrouter",
      "vertex",
    ]);
    expect([...builtInProviders, ...addableProviders].sort()).toEqual(
      [...agentProviders].sort(),
    );
  });

  it("treats a provider this machine has not added as disabled", () => {
    expect(isProviderActive("vertex", allEnabled, [])).toBe(false);
    expect(isProviderActive("vertex", allEnabled, ["vertex"])).toBe(true);
    // A built-in provider needs no add step, only its switch.
    expect(isProviderActive("codex", allEnabled, [])).toBe(true);
    expect(
      isProviderActive("codex", { ...allEnabled, codex: false }, []),
    ).toBe(false);
    // Adding a provider does not switch it on by itself.
    expect(
      isProviderActive("grok", { ...allEnabled, grok: false }, ["grok"]),
    ).toBe(false);
  });

  it("reports the effective record every consumer decides from", () => {
    expect(effectiveEnabledProviders(allEnabled, ["grok"])).toEqual({
      codex: true,
      claude: true,
      cursor: false,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: false,
      vertex: false,
    });
  });

  it("backfills a machine that was already using a provider", () => {
    const settings = { ...allEnabled, cursor: false, grok: false };
    expect(
      backfilledAddedProviders(settings, () => false),
    ).toEqual(["openrouter", "vertex"]);
    // A saved credential counts even when the switch is off.
    expect(
      backfilledAddedProviders(
        Object.fromEntries(
          agentProviders.map((provider) => [provider, false] as const),
        ) as typeof allEnabled,
        (provider) => provider === "openrouter",
      ),
    ).toEqual(["openrouter"]);
  });

  it("normalizes a stored list to menu order without built-ins", () => {
    expect(
      normalizeAddedProviders(["vertex", "codex", "grok", "vertex"]),
    ).toEqual(["grok", "vertex"]);
  });
});

describe("OpenCode upstream descriptors", () => {
  const { upstream } = agentProviderCatalog.openrouter;

  it("generates the OpenCode config Briar has always written", () => {
    expect(openCodeUpstreamConfigJson(upstream)).toBe(
      legacyOpenRouterOpenCodeConfig,
    );
  });

  it("prefixes upstream model ids with the OpenCode provider id", () => {
    expect(openCodeUpstreamModelPrefix(upstream)).toBe("openrouter/");
  });

  it("adds the credential, config and provider marker to the environment", () => {
    expect(
      agentProviderExecutionEnvironment(
        "openrouter",
        { type: "apiKey", apiKey: "sk-or-v1-key" },
        { PATH: "/usr/bin" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      [agentProviderEnvironmentKey]: "openrouter",
      OPENROUTER_API_KEY: "sk-or-v1-key",
      OPENCODE_CONFIG_CONTENT: legacyOpenRouterOpenCodeConfig,
    });
  });

  it("marks providers that run their own CLI without touching credentials", () => {
    expect(
      agentProviderExecutionEnvironment("opencode", null, { PATH: "/usr/bin" }),
    ).toEqual({
      PATH: "/usr/bin",
      [agentProviderEnvironmentKey]: "opencode",
    });
  });

  it("refuses to run an upstream before its credential is saved", () => {
    for (
      const credential of [
        null,
        undefined,
        { type: "apiKey", apiKey: "   " } as const,
      ]
    ) {
      expect(() =>
        agentProviderExecutionEnvironment("openrouter", credential, {})
      ).toThrowError("앱 설정에서 OpenRouter API 키를 먼저 저장하세요.");
    }
  });
});

describe("Vertex AI upstream descriptor", () => {
  const { upstream } = agentProviderCatalog.vertex;
  const saved = {
    type: "googleAdc",
    projectId: "briar-dummy",
    location: "us-central1",
  } as const;

  it("generates an OpenCode config naming the project and region variables", () => {
    expect(openCodeUpstreamConfigJson(upstream)).toBe(
      '{"provider":{"google-vertex":{"options":{"project":"{env:GOOGLE_VERTEX_PROJECT}","location":"{env:GOOGLE_VERTEX_LOCATION}"}}}}',
    );
  });

  it("prefixes upstream model ids with OpenCode's google-vertex id", () => {
    expect(openCodeUpstreamModelPrefix(upstream)).toBe("google-vertex/");
  });

  it("adds the project, region, config and provider marker", () => {
    expect(
      agentProviderExecutionEnvironment("vertex", saved, { PATH: "/usr/bin" }),
    ).toEqual({
      PATH: "/usr/bin",
      [agentProviderEnvironmentKey]: "vertex",
      GOOGLE_VERTEX_PROJECT: "briar-dummy",
      GOOGLE_VERTEX_LOCATION: "us-central1",
      OPENCODE_CONFIG_CONTENT: openCodeUpstreamConfigJson(upstream),
    });
  });

  it("carries no credential: authentication is the machine's own ADC", () => {
    const environment = agentProviderExecutionEnvironment("vertex", saved, {});
    expect(environment.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });

  it("refuses to run before both the project and the region are saved", () => {
    for (
      const credential of [
        null,
        undefined,
        { ...saved, projectId: "" },
        { ...saved, location: "  " },
      ]
    ) {
      expect(() => agentProviderExecutionEnvironment("vertex", credential, {}))
        .toThrowError("앱 설정에서 Vertex AI 프로젝트 ID와 리전을 먼저 저장하세요.");
    }
  });
});
