import { describe, expect, it } from "vitest";
import {
  agentProviderCatalog,
  agentProviderEnvironmentKey,
  agentProviderExecutionEnvironment,
  agentProviders,
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
