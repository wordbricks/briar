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
    expect(openCodeUpstreamProviders).toEqual(["openrouter"]);
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
      agentProviderExecutionEnvironment("openrouter", "sk-or-v1-key", {
        PATH: "/usr/bin",
      }),
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
    for (const credential of [null, undefined, "   "]) {
      expect(() =>
        agentProviderExecutionEnvironment("openrouter", credential, {})
      ).toThrowError("앱 설정에서 OpenRouter API 키를 먼저 저장하세요.");
    }
  });
});
