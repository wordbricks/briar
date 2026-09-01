import type { JsonObject } from "@bufbuild/protobuf";
import {
  ApprovalPolicy as ProtoApprovalPolicy,
  SandboxMode as ProtoSandboxMode,
  type RunRequest as ProtoRunRequest,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import * as Result from "effect/Result";
import type { AgentAttachment } from "./runner-attachments";

export type RunnerApprovalPolicy = "untrusted" | "on-request" | "never";
export type RunnerSandboxMode =
  | "readOnly"
  | "workspaceWrite"
  | "dangerFullAccess";

/**
 * Provider-facing projection of the generated sidecar request.
 *
 * Fields that already have useful protobuf representations stay derived from
 * RunRequest. Only enums, the JsonSchema oneof, and image attachments are
 * projected into the forms consumed by provider SDKs.
 */
export type RunnerRequest = Omit<
  ProtoRunRequest,
  | "$typeName"
  | "$unknown"
  | "approvalPolicy"
  | "sandboxMode"
  | "outputSchema"
  | "attachments"
  | "protocolFingerprint"
> & {
  approvalPolicy: RunnerApprovalPolicy;
  sandboxMode: RunnerSandboxMode;
  outputSchema?: JsonObject | boolean;
  attachments: AgentAttachment[];
};

const unsupportedEnum = (name: string, value: number) =>
  new Error(`Unsupported sidecar ${name}: ${value}`);

function approvalPolicy(
  value: ProtoApprovalPolicy,
): Result.Result<RunnerApprovalPolicy, Error> {
  switch (value) {
    case ProtoApprovalPolicy.UNTRUSTED:
      return Result.succeed("untrusted");
    case ProtoApprovalPolicy.ON_REQUEST:
      return Result.succeed("on-request");
    case ProtoApprovalPolicy.NEVER:
      return Result.succeed("never");
    default:
      return Result.fail(unsupportedEnum("approval policy", value));
  }
}

function sandboxMode(
  value: ProtoSandboxMode,
): Result.Result<RunnerSandboxMode, Error> {
  switch (value) {
    case ProtoSandboxMode.READ_ONLY:
      return Result.succeed("readOnly");
    case ProtoSandboxMode.WORKSPACE_WRITE:
      return Result.succeed("workspaceWrite");
    case ProtoSandboxMode.DANGER_FULL_ACCESS:
      return Result.succeed("dangerFullAccess");
    default:
      return Result.fail(unsupportedEnum("sandbox mode", value));
  }
}

/** Map the generated wire message once at the provider-domain boundary. */
export const decodeRunnerRequest = (request: ProtoRunRequest) =>
  Result.gen(function*() {
    const decodedApprovalPolicy = yield* approvalPolicy(request.approvalPolicy);
    const decodedSandboxMode = yield* sandboxMode(request.sandboxMode);
    const {
      $typeName: _,
      $unknown: _unknown,
      approvalPolicy: _approvalPolicy,
      sandboxMode: _sandboxMode,
      outputSchema,
      attachments,
      protocolFingerprint: _protocolFingerprint,
      ...shared
    } = request;
    return {
      ...shared,
      approvalPolicy: decodedApprovalPolicy,
      sandboxMode: decodedSandboxMode,
      outputSchema: outputSchema?.value.value,
      attachments: attachments.map((attachment) => ({
        type: "image" as const,
        path: attachment.path,
        name: attachment.name,
        mimeType: attachment.mimeType,
      })),
    } satisfies RunnerRequest;
  });
