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

export const ManagedComputerSetupToken = Schema.String.check(
  Schema.isPattern(/^briar_setup_[A-Za-z0-9_-]{43}$/u),
);
const ChallengeId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
);
const SessionId = Schema.String.check(Schema.isUUID());
const ChallengeValue = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8_192),
);
const VerificationUri = Schema.String.check(
  Schema.isPattern(/^https:\/\//u),
  Schema.isMaxLength(4_096),
);
const UserCode = Schema.String.check(Schema.isLengthBetween(2, 100));
const WorkerId = Schema.String.check(Schema.isLengthBetween(1, 128));
const ErrorCode = Schema.String.check(
  Schema.isPattern(/^[A-Z][A-Z0-9_]{2,99}$/u),
);
const ErrorMessage = Schema.String.check(Schema.isLengthBetween(1, 1_000));

const decodeSetupToken = Schema.decodeUnknownOption(ManagedComputerSetupToken);
const decodeChallengeId = Schema.decodeUnknownOption(ChallengeId);
const decodeSessionId = Schema.decodeUnknownOption(SessionId);
const decodeChallengeValue = Schema.decodeUnknownOption(ChallengeValue);
const decodeVerificationUri = Schema.decodeUnknownOption(VerificationUri);
const decodeUserCode = Schema.decodeUnknownOption(UserCode);
const decodeWorkerId = Schema.decodeUnknownOption(WorkerId);
const decodeErrorCode = Schema.decodeUnknownOption(ErrorCode);
const decodeErrorMessage = Schema.decodeUnknownOption(ErrorMessage);

export const isManagedComputerSetupToken = (value: unknown): value is string =>
  Option.isSome(decodeSetupToken(value));

const isSetupProvider = (provider: AgentProvider) =>
  managedComputerSetupProviderFromProto(provider) !== null;

const isSetupPhase = (phase: ManagedComputerSetupPhase) => {
  switch (phase) {
    case ManagedComputerSetupPhase.GITHUB:
    case ManagedComputerSetupPhase.PROVIDER:
    case ManagedComputerSetupPhase.REPOSITORY:
    case ManagedComputerSetupPhase.WORKER:
      return true;
    case ManagedComputerSetupPhase.UNSPECIFIED:
    default:
      return false;
  }
};

const isSetupStateStatus = (status: ManagedComputerSetupStateStatus) => {
  switch (status) {
    case ManagedComputerSetupStateStatus.WORKING:
    case ManagedComputerSetupStateStatus.COMPLETE:
      return true;
    case ManagedComputerSetupStateStatus.UNSPECIFIED:
    default:
      return false;
  }
};

const isChallengeService = (service: ManagedComputerSetupChallengeService) => {
  switch (service) {
    case ManagedComputerSetupChallengeService.GITHUB:
    case ManagedComputerSetupChallengeService.PROVIDER:
      return true;
    case ManagedComputerSetupChallengeService.UNSPECIFIED:
    default:
      return false;
  }
};

const isChallengeKind = (kind: ManagedComputerSetupChallengeKind) => {
  switch (kind) {
    case ManagedComputerSetupChallengeKind.DEVICE_CODE:
    case ManagedComputerSetupChallengeKind.AUTHORIZATION_CODE:
    case ManagedComputerSetupChallengeKind.API_KEY:
      return true;
    case ManagedComputerSetupChallengeKind.UNSPECIFIED:
    default:
      return false;
  }
};

export const isManagedComputerSetupToAgent = (
  message: ManagedComputerSetupToAgent,
): boolean => {
  const payload = message.payload;
  switch (payload.case) {
    case "start":
      return isManagedComputerSetupToken(payload.value.setupToken) &&
        isSetupProvider(payload.value.provider);
    case "submit":
      return Option.isSome(decodeChallengeId(payload.value.challengeId)) &&
        Option.isSome(decodeChallengeValue(payload.value.value));
    case "cancel":
      return true;
    case "controllerReady":
    case "controllerEnded":
      return Option.isSome(decodeSessionId(payload.value.sessionId));
    case undefined:
      return false;
  }
  const exhaustive: never = payload;
  return exhaustive;
};

export const isManagedComputerSetupControllerCommand = (
  message: ManagedComputerSetupToAgent,
) => isManagedComputerSetupToAgent(message) && (
  message.payload.case === "start" ||
  message.payload.case === "submit" ||
  message.payload.case === "cancel"
);

export const isManagedComputerSetupToController = (
  message: ManagedComputerSetupToController,
): boolean => {
  const payload = message.payload;
  switch (payload.case) {
    case "state":
      return isSetupPhase(payload.value.phase) &&
        isSetupStateStatus(payload.value.status) &&
        (payload.value.provider === undefined ||
          isSetupProvider(payload.value.provider));
    case "challenge":
      return Option.isSome(decodeChallengeId(payload.value.challengeId)) &&
        isChallengeService(payload.value.service) &&
        isChallengeKind(payload.value.kind) &&
        Option.isSome(decodeVerificationUri(payload.value.verificationUri)) &&
        (payload.value.userCode === undefined ||
          Option.isSome(decodeUserCode(payload.value.userCode))) &&
        (payload.value.provider === undefined ||
          isSetupProvider(payload.value.provider));
    case "complete":
      return Option.isSome(decodeSessionId(payload.value.projectId)) &&
        isSetupProvider(payload.value.provider) &&
        Option.isSome(decodeWorkerId(payload.value.workerId));
    case "error":
      return Option.isSome(decodeErrorCode(payload.value.code)) &&
        Option.isSome(decodeErrorMessage(payload.value.message));
    case undefined:
      return false;
  }
  const exhaustive: never = payload;
  return exhaustive;
};
