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
import type { RunnerRequest } from "./runner-request";

/**
 * Pi ACP profile.
 *
 * Pi ships no ACP server of its own. `pi-acp` is a third-party adapter that
 * speaks ACP to Briar and drives `pi --mode rpc --no-themes` underneath, so
 * the binary Briar spawns is the adapter and the CLI it needs on `PATH` is
 * `pi`. The lifecycle lives in `acp-runner.ts`; only the values below are
 * Pi-specific.
 *
 * Two adapter limits shape this profile:
 *  - MCP servers handed to `session/new` are accepted and stored but never
 *    forwarded to pi, so Briar's Computer Use is unsupported for Pi (see
 *    `computer-use-contract.ts`).
 *  - The adapter's `modes` are pi's thinking levels, not permission modes.
 *    There is no read-only mode to select, so a read-only turn is confined by
 *    the seatbelt profile and the isolated `HOME` alone.
 */

/** `pi-acp` advertises exactly one auth method, a terminal `pi` login. */
export const PI_AUTH_METHOD = "pi_terminal_login";

/** Config option ids `pi-acp` builds for every session. */
export const PI_MODEL_CONFIG_ID = "model";
export const PI_THOUGHT_LEVEL_CONFIG_ID = "thought_level";

/** Names the `pi` executable the adapter spawns; pi-acp reads this itself. */
export const PI_COMMAND_ENV = "PI_ACP_PI_COMMAND";

type PiConfigOption = {
  id?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
};

type PiSessionSetup = {
  sessionId?: string;
  configOptions?: Array<PiConfigOption>;
  models?: {
    availableModels?: Array<{ modelId?: string; name?: string }>;
    currentModelId?: string;
  };
};

export function piAgentArgs() {
  // The adapter takes no arguments; every knob is a session config option.
  return [] as string[];
}

export function piAgentEnvironment(
  environment: NodeJS.ProcessEnv,
  _readOnly: boolean,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    // Opt out of pi's install/update ping and provider attribution headers.
    PI_TELEMETRY: "0",
  };
}

export function piAgentSpawnSpec(input: {
  binary: string;
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  readOnly: boolean;
  platform?: NodeJS.Platform;
}) {
  const arguments_ = piAgentArgs();
  if (!input.readOnly) {
    return { command: input.binary, arguments: arguments_ };
  }
  // Pi resolves every piece of its state under `$HOME/.pi/agent` and offers no
  // environment override for that root, so the isolated state root *is* HOME.
  const stateRoot = input.environment.HOME;
  if (!stateRoot) throw new Error("Pi read-only state is not isolated");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Pi",
    binary: input.binary,
    arguments: arguments_,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/[.]pi(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

function piConfigOption(
  setup: PiSessionSetup | undefined,
  configId: string,
): PiConfigOption | undefined {
  return (setup?.configOptions ?? []).find((option) => option.id === configId);
}

/**
 * Pi model ids are `${provider}/${id}`. A model the user typed by bare id is
 * matched against the advertised catalog so a custom entry still selects the
 * right upstream; anything else is passed through, because Pi accepts model
 * ids it never advertised.
 */
export function resolvePiModelId(
  setup: PiSessionSetup | undefined,
  requestedModel: string | undefined,
): string | undefined {
  const requested = requestedModel?.trim();
  if (!requested) return undefined;
  const advertised = (setup?.models?.availableModels ?? [])
    .map((model) => model.modelId?.trim())
    .filter((modelId): modelId is string => Boolean(modelId));
  if (advertised.includes(requested)) return requested;
  const suffixMatches = advertised.filter(
    (modelId) => modelId.slice(modelId.indexOf("/") + 1) === requested,
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : requested;
}

/**
 * Briar efforts and pi's thinking levels share their vocabulary apart from
 * the "extra high" spelling, which pi calls `xhigh`.
 */
export function mapEffortToPi(
  effort: RunnerRequest["effort"],
): string | undefined {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
}

/**
 * The thinking level to send, or `undefined` when pi did not advertise the
 * requested one. Pi rejects an unknown value outright, so an effort Briar
 * cannot map keeps the session default instead.
 */
export function piThoughtLevelConfigUpdate(
  setup: PiSessionSetup | undefined,
  requestedEffort: string,
) {
  const config = piConfigOption(setup, PI_THOUGHT_LEVEL_CONFIG_ID);
  if (!config) return undefined;
  const available = (config.options ?? [])
    .map((option) => option.value)
    .filter((value): value is string => Boolean(value));
  return available.includes(requestedEffort)
    ? { configId: PI_THOUGHT_LEVEL_CONFIG_ID, value: requestedEffort }
    : undefined;
}

export const piProfile: AcpProviderProfile = {
  providerId: "pi",
  providerName: "Pi Agent",
  displayName: "Pi",
  missingSessionIdMessage: "Pi agent did not return a session id.",
  spawn: (input) =>
    piAgentSpawnSpec({
      binary: input.binary,
      workspaceRoot: input.workspaceRoot,
      environment: input.environment,
      readOnly: input.readOnly,
    }),
  environment: piAgentEnvironment,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
  },
  authMethods: [{ methodId: PI_AUTH_METHOD }],
  sessionMeta: acpSessionMeta,
  promptParts: buildAcpPromptParts,
  configureSession: async ({ request, sessionId, setup, call, emitRpc }) => {
    const sessionSetup = setup as PiSessionSetup | undefined;

    const modelId = resolvePiModelId(sessionSetup, request.model);
    if (modelId) {
      const modelParams = {
        sessionId,
        configId: PI_MODEL_CONFIG_ID,
        value: modelId,
      };
      try {
        const modelResult = await call(
          "session/set_config_option",
          modelParams,
        );
        emitRpc("session/set_config_option", modelParams, modelResult);
      } catch {
        // A model pi will not accept keeps the session default rather than
        // failing the turn before the prompt is sent.
      }
    }

    const effort = mapEffortToPi(request.effort);
    const effortUpdate = effort
      ? piThoughtLevelConfigUpdate(sessionSetup, effort)
      : undefined;
    if (effortUpdate) {
      try {
        await call("session/set_config_option", {
          sessionId,
          ...effortUpdate,
        });
      } catch {
        // Thinking levels vary by model; keep the session default.
      }
    }
  },
  permissionPolicy: {
    shouldDeny: shouldDenyPermission,
    shouldAutoApprove: shouldAutoApprovePermission,
  },
};

export async function runPiRunner() {
  await runAcpProvider(piProfile);
}

if (import.meta.main) {
  void runPiRunner();
}
