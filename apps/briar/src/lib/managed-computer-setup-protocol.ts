import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const managedComputerSetupProviders = [
  "codex",
  "claude",
  "grok",
  "opencode",
] as const;

export type ManagedComputerSetupProvider =
  (typeof managedComputerSetupProviders)[number];

const SetupProvider = Schema.Literals(managedComputerSetupProviders);
const SetupToken = Schema.String.check(
  Schema.isPattern(/^briar_setup_[A-Za-z0-9_-]{43}$/u),
);
const ChallengeId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
);

export const ManagedComputerSetupClientMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start"),
    setupToken: SetupToken,
    provider: SetupProvider,
  }),
  Schema.Struct({
    type: Schema.Literal("submit"),
    challengeId: ChallengeId,
    value: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8_192),
    ),
  }),
  Schema.Struct({ type: Schema.Literal("cancel") }),
]);

export const ManagedComputerSetupAgentMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("state"),
    phase: Schema.Literals([
      "github",
      "provider",
      "repository",
      "worker",
    ]),
    status: Schema.Literals(["working", "complete"]),
    provider: Schema.optional(SetupProvider),
  }),
  Schema.Struct({
    type: Schema.Literal("challenge"),
    challengeId: ChallengeId,
    service: Schema.Literals(["github", "provider"]),
    kind: Schema.Literals([
      "device_code",
      "authorization_code",
      "api_key",
    ]),
    verificationUri: Schema.String.check(
      Schema.isPattern(/^https:\/\//u),
      Schema.isMaxLength(4_096),
    ),
    userCode: Schema.optional(
      Schema.String.check(Schema.isLengthBetween(2, 100)),
    ),
    provider: Schema.optional(SetupProvider),
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    projectId: Schema.String.check(Schema.isUUID()),
    provider: SetupProvider,
    workerId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    code: Schema.String.check(
      Schema.isPattern(/^[A-Z][A-Z0-9_]{2,99}$/u),
    ),
    message: Schema.String.check(Schema.isLengthBetween(1, 1_000)),
    retryable: Schema.Boolean,
  }),
]);

export type ManagedComputerSetupClientMessage =
  typeof ManagedComputerSetupClientMessage.Type;
export type ManagedComputerSetupAgentMessage =
  typeof ManagedComputerSetupAgentMessage.Type;

const decodeClient = Schema.decodeUnknownOption(
  ManagedComputerSetupClientMessage,
);
const decodeAgent = Schema.decodeUnknownOption(
  ManagedComputerSetupAgentMessage,
);

function decodeJson<T>(
  value: unknown,
  decode: (input: unknown) => Option.Option<T>,
): T | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  return Option.getOrNull(decode(parsed));
}

export const decodeManagedComputerSetupClientMessage = (value: unknown) =>
  decodeJson(value, decodeClient);

export const decodeManagedComputerSetupAgentMessage = (value: unknown) =>
  decodeJson(value, decodeAgent);
