import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupPhase,
  ManagedComputerSetupStateStatus,
  type ManagedComputerSetupToAgent,
  type ManagedComputerSetupToController,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ManagedComputerSetupProvider } from "./agent-provider";

const setupProviderByName = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  grok: AgentProvider.GROK,
  opencode: AgentProvider.OPENCODE,
} satisfies Record<ManagedComputerSetupProvider, AgentProvider>;

export const managedComputerSetupProviderToProto = (
  provider: ManagedComputerSetupProvider,
) => setupProviderByName[provider];

export const managedComputerSetupProviderFromProto = (
  provider: AgentProvider,
): ManagedComputerSetupProvider | null => {
  switch (provider) {
    case AgentProvider.CODEX:
      return "codex";
    case AgentProvider.CLAUDE:
      return "claude";
    case AgentProvider.GROK:
      return "grok";
    case AgentProvider.OPENCODE:
      return "opencode";
    default:
      return null;
  }
};

const SetupProvider = Schema.Literals([
  AgentProvider.CODEX,
  AgentProvider.CLAUDE,
  AgentProvider.GROK,
  AgentProvider.OPENCODE,
]);
const SetupToken = Schema.String.check(
  Schema.isPattern(/^briar_setup_[A-Za-z0-9_-]{43}$/u),
);
const ChallengeId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
);
const SessionId = Schema.String.check(Schema.isUUID());

const ToAgentPayload = Schema.Union([
  Schema.Struct({
    case: Schema.Literal("start"),
    value: Schema.Struct({
      setupToken: SetupToken,
      provider: SetupProvider,
    }),
  }),
  Schema.Struct({
    case: Schema.Literal("submit"),
    value: Schema.Struct({
      challengeId: ChallengeId,
      value: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(8_192),
      ),
    }),
  }),
  Schema.Struct({
    case: Schema.Literal("cancel"),
    value: Schema.Struct({}),
  }),
  Schema.Struct({
    case: Schema.Literal("controllerReady"),
    value: Schema.Struct({ sessionId: SessionId }),
  }),
  Schema.Struct({
    case: Schema.Literal("controllerEnded"),
    value: Schema.Struct({ sessionId: SessionId }),
  }),
]);

const ToControllerPayload = Schema.Union([
  Schema.Struct({
    case: Schema.Literal("state"),
    value: Schema.Struct({
      phase: Schema.Literals([
        ManagedComputerSetupPhase.GITHUB,
        ManagedComputerSetupPhase.PROVIDER,
        ManagedComputerSetupPhase.REPOSITORY,
        ManagedComputerSetupPhase.WORKER,
      ]),
      status: Schema.Literals([
        ManagedComputerSetupStateStatus.WORKING,
        ManagedComputerSetupStateStatus.COMPLETE,
      ]),
      provider: Schema.optional(SetupProvider),
    }),
  }),
  Schema.Struct({
    case: Schema.Literal("challenge"),
    value: Schema.Struct({
      challengeId: ChallengeId,
      service: Schema.Literals([
        ManagedComputerSetupChallengeService.GITHUB,
        ManagedComputerSetupChallengeService.PROVIDER,
      ]),
      kind: Schema.Literals([
        ManagedComputerSetupChallengeKind.DEVICE_CODE,
        ManagedComputerSetupChallengeKind.AUTHORIZATION_CODE,
        ManagedComputerSetupChallengeKind.API_KEY,
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
  }),
  Schema.Struct({
    case: Schema.Literal("complete"),
    value: Schema.Struct({
      projectId: Schema.String.check(Schema.isUUID()),
      provider: SetupProvider,
      workerId: Schema.String.check(Schema.isLengthBetween(1, 128)),
    }),
  }),
  Schema.Struct({
    case: Schema.Literal("error"),
    value: Schema.Struct({
      code: Schema.String.check(
        Schema.isPattern(/^[A-Z][A-Z0-9_]{2,99}$/u),
      ),
      message: Schema.String.check(Schema.isLengthBetween(1, 1_000)),
      retryable: Schema.Boolean,
    }),
  }),
]);

const decodeToAgent = Schema.decodeUnknownOption(
  Schema.Struct({ payload: ToAgentPayload }),
);
const decodeToController = Schema.decodeUnknownOption(
  Schema.Struct({ payload: ToControllerPayload }),
);

export const isManagedComputerSetupToAgent = (
  message: ManagedComputerSetupToAgent,
) => Option.isSome(decodeToAgent(message));

export const isManagedComputerSetupControllerCommand = (
  message: ManagedComputerSetupToAgent,
) => isManagedComputerSetupToAgent(message) && (
  message.payload.case === "start" ||
  message.payload.case === "submit" ||
  message.payload.case === "cancel"
);

export const isManagedComputerSetupToController = (
  message: ManagedComputerSetupToController,
) => Option.isSome(decodeToController(message));
