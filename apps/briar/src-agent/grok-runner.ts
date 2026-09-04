import {
  acpSessionMeta,
  buildAcpPromptParts,
  shouldAutoApprovePermission,
  shouldDenyPermission,
} from "./acp-runner-lib";
import { runAcpProvider, type AcpProviderProfile } from "./acp-runner";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";

/**
 * Grok CLI ACP profile.
 *
 * Mirrors t3code's Grok ACP surface (`grok agent stdio`). The lifecycle lives
 * in `acp-runner.ts`; only the values below are Grok-specific.
 */

export const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
export const BRIAR_OAUTH_REFERRER = "briar";
export const GROK_API_KEY_ENV = "XAI_API_KEY";
export const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
export const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";

export function grokAgentArgs(readOnly: boolean) {
  return readOnly
    ? [
        "--disable-web-search",
        "--no-memory",
        "--no-subagents",
        "agent",
        "--no-leader",
        "stdio",
      ]
    : ["agent", "stdio"];
}

export function grokAgentEnvironment(
  environment: NodeJS.ProcessEnv,
  readOnly: boolean,
) {
  return {
    ...environment,
    // macOS Seatbelt cannot be nested. The outer Briar profile is stricter
    // than Grok's broad built-in strict profile and covers every child tool.
    ...(readOnly ? { GROK_SANDBOX: "off" } : {}),
    [GROK_OAUTH2_REFERRER_ENV]: BRIAR_OAUTH_REFERRER,
  };
}

export function grokAgentSpawnSpec(input: {
  binary: string;
  arguments: string[];
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  readOnly: boolean;
  platform?: NodeJS.Platform;
}) {
  if (!input.readOnly) {
    return { command: input.binary, arguments: input.arguments };
  }
  const stateRoot = input.environment.GROK_HOME;
  if (!stateRoot) throw new Error("Grok read-only state is not isolated");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Grok",
    binary: input.binary,
    arguments: input.arguments,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/[.]grok(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

export const grokProfile: AcpProviderProfile = {
  providerName: "Grok Agent",
  displayName: "Grok",
  missingSessionIdMessage: "Grok agent did not return a session id.",
  spawn: (input) =>
    grokAgentSpawnSpec({
      binary: input.binary,
      arguments: grokAgentArgs(input.readOnly),
      workspaceRoot: input.workspaceRoot,
      environment: input.environment,
      readOnly: input.readOnly,
    }),
  environment: grokAgentEnvironment,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
  },
  authMethods: [
    {
      methodId: GROK_AUTH_METHOD_API_KEY,
      available: (environment) =>
        Boolean(environment[GROK_API_KEY_ENV]?.trim()),
    },
    { methodId: GROK_AUTH_METHOD_CACHED_TOKEN },
  ],
  sessionMeta: acpSessionMeta,
  promptParts: buildAcpPromptParts,
  configureSession: async ({ request, sessionId, call, emitRpc }) => {
    const modelId = request.model?.trim();
    if (modelId) {
      try {
        const setModelParams = { sessionId, modelId };
        const setModelResult = await call("session/set_model", setModelParams);
        emitRpc("session/set_model", setModelParams, setModelResult);
      } catch {
        // Older Grok builds may lack set_model; continue with session default.
      }
    }

    const effort = request.effort;
    if (effort) {
      try {
        await call("session/set_config_option", {
          sessionId,
          configId: "reasoning_effort",
          value: effort,
        });
      } catch {
        // Effort selection is best-effort across Grok versions.
      }
    }
  },
  permissionPolicy: {
    shouldDeny: shouldDenyPermission,
    shouldAutoApprove: shouldAutoApprovePermission,
  },
};

export async function runGrokRunner() {
  await runAcpProvider(grokProfile);
}

if (import.meta.main) {
  void runGrokRunner();
}
