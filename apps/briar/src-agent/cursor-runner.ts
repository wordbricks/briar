import {
  acpSessionMeta,
  buildAcpPromptParts,
  shouldAutoApprovePermission,
  shouldDenyPermission,
  type AcpPromptPart,
} from "./acp-runner-lib";
import { runAcpProvider, type AcpProviderProfile } from "./acp-runner";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";
import type { RunnerRequest } from "./runner-request";

/**
 * Cursor Agent ACP profile.
 *
 * `cursor-agent acp` speaks the standard ACP session contract, so the
 * lifecycle lives in `acp-runner.ts`. Cursor differs in its login method, its
 * parameterized model picker (model and effort are `session/set_config_option`
 * ids discovered from the session setup), and in prepending trusted Briar
 * instructions to the user prompt.
 */

export const CURSOR_AUTH_METHOD = "cursor_login";

type CursorSessionSetup = {
  sessionId?: string;
  configOptions?: Array<{
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    options?: Array<{
      value?: string;
      name?: string;
      options?: Array<{ value?: string; name?: string }>;
    }>;
  }>;
};

export function cursorAgentArgs() {
  return ["acp"];
}

export function cursorAgentSpawnSpec(input: {
  binary: string;
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  readOnly: boolean;
  platform?: NodeJS.Platform;
}) {
  const arguments_ = cursorAgentArgs();
  if (!input.readOnly) {
    return { command: input.binary, arguments: arguments_ };
  }
  const stateRoot = input.environment.HOME;
  if (!stateRoot) throw new Error("Cursor read-only state is not isolated");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Cursor",
    binary: input.binary,
    arguments: arguments_,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/[.]cursor(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

function normalizedCursorEffort(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
}

export function mapEffortToCursor(
  effort: RunnerRequest["effort"],
): string | undefined {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
}

export function cursorEffortConfigUpdate(
  setup: CursorSessionSetup | undefined,
  requestedEffort: string,
) {
  const options = setup?.configOptions ?? [];
  const candidates = options.filter((option) => {
    const id = option.id?.toLowerCase() ?? "";
    const name = option.name?.toLowerCase() ?? "";
    return id.includes("effort") || id.includes("reasoning") ||
      name.includes("effort") || name.includes("reasoning");
  });
  const config =
    candidates.find((option) => option.category?.toLowerCase() === "model_option") ??
    candidates.find((option) => option.id?.toLowerCase() === "effort") ??
    candidates[0];
  if (!config?.id) return undefined;
  const requested = normalizedCursorEffort(requestedEffort);
  const selections = (config.options ?? []).flatMap((option) =>
    option.options ?? [option]
  );
  const selected = selections.find((option) =>
    normalizedCursorEffort(option.value) === requested ||
    normalizedCursorEffort(option.name) === requested
  );
  return selected?.value
    ? { configId: config.id, value: selected.value }
    : undefined;
}

export function cursorModelConfigId(setup: CursorSessionSetup | undefined) {
  const options = setup?.configOptions ?? [];
  return options.find((option) =>
    option.category?.trim().toLowerCase() === "model" && option.id?.trim()
  )?.id ?? options.find((option) =>
    option.id?.trim().toLowerCase() === "model"
  )?.id ?? "model";
}

export function resolveCursorModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed ? trimmed : "default";
  return base.includes("[") ? base.slice(0, base.indexOf("[")) : base;
}

export function buildCursorPromptParts(
  request: RunnerRequest,
): Promise<AcpPromptPart[]> {
  const instructions = request.instructions?.trim();
  const message = instructions
    ? [
        "Follow these trusted Briar instructions:",
        instructions,
        "User request:",
        request.message,
      ].join("\n\n")
    : request.message;
  return buildAcpPromptParts({ ...request, message });
}

export const cursorProfile: AcpProviderProfile = {
  providerId: "cursor",
  providerName: "Cursor Agent",
  displayName: "Cursor",
  missingSessionIdMessage: "Cursor Agent did not return a session id.",
  spawn: cursorAgentSpawnSpec,
  // Cursor reads its own credentials from the inherited environment.
  environment: (environment) => environment,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    _meta: { parameterizedModelPicker: true },
  },
  authMethods: [{ methodId: CURSOR_AUTH_METHOD }],
  sessionMeta: acpSessionMeta,
  promptParts: buildCursorPromptParts,
  configureSession: async ({ request, sessionId, setup, call, emitRpc }) => {
    let sessionSetup = setup as CursorSessionSetup | undefined;
    const modelParams = {
      sessionId,
      configId: cursorModelConfigId(sessionSetup),
      value: resolveCursorModelId(request.model),
    };
    const modelResult = await call(
      "session/set_config_option",
      modelParams,
    ) as CursorSessionSetup | undefined;
    if (modelResult?.configOptions) {
      sessionSetup = { ...sessionSetup, configOptions: modelResult.configOptions };
    }
    emitRpc("session/set_config_option", modelParams, modelResult);

    const effort = mapEffortToCursor(request.effort);
    const effortUpdate = effort
      ? cursorEffortConfigUpdate(sessionSetup, effort)
      : undefined;
    if (effortUpdate) {
      try {
        await call("session/set_config_option", {
          sessionId,
          ...effortUpdate,
        });
      } catch {
        // Cursor versions expose different reasoning controls; keep the
        // session's default when the selected option is unavailable.
      }
    }
  },
  permissionPolicy: {
    shouldDeny: shouldDenyPermission,
    shouldAutoApprove: shouldAutoApprovePermission,
  },
  serverRequestResponses: {
    "cursor/create_plan": { accepted: true },
    "cursor/ask_question": { answers: {} },
  },
};

export async function runCursorRunner() {
  await runAcpProvider(cursorProfile);
}

if (import.meta.main) void runCursorRunner();
