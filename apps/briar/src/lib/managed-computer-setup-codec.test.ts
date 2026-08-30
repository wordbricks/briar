import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeSchema,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupStartSchema,
  ManagedComputerSetupToAgentSchema,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { describe, expect, it } from "vitest";
import {
  isManagedComputerSetupToAgent,
  isManagedComputerSetupToController,
} from "./managed-computer-setup-codec";

describe("managed computer setup protobuf frames", () => {
  it("roundtrips a validated controller-to-agent start frame", () => {
    const encoded = toBinary(
      ManagedComputerSetupToAgentSchema,
      create(ManagedComputerSetupToAgentSchema, {
        payload: {
          case: "start",
          value: create(ManagedComputerSetupStartSchema, {
            setupToken: `briar_setup_${"a".repeat(43)}`,
            provider: AgentProvider.CODEX,
          }),
        },
      }),
    );
    const decoded = fromBinary(ManagedComputerSetupToAgentSchema, encoded);

    expect(isManagedComputerSetupToAgent(decoded)).toBe(true);
    expect(decoded.payload.case).toBe("start");
  });

  it("roundtrips a validated agent-to-controller challenge frame", () => {
    const encoded = toBinary(
      ManagedComputerSetupToControllerSchema,
      create(ManagedComputerSetupToControllerSchema, {
        payload: {
          case: "challenge",
          value: create(ManagedComputerSetupChallengeSchema, {
            challengeId: "codex-auth",
            service: ManagedComputerSetupChallengeService.PROVIDER,
            kind: ManagedComputerSetupChallengeKind.DEVICE_CODE,
            verificationUri: "https://auth.openai.com/activate",
            userCode: "ABCD-EFGH",
            provider: AgentProvider.CODEX,
          }),
        },
      }),
    );
    const decoded = fromBinary(
      ManagedComputerSetupToControllerSchema,
      encoded,
    );

    expect(isManagedComputerSetupToController(decoded)).toBe(true);
    expect(decoded.payload.case).toBe("challenge");
  });

  it("rejects a cross-direction frame and unsupported provider", () => {
    const encoded = toBinary(
      ManagedComputerSetupToAgentSchema,
      create(ManagedComputerSetupToAgentSchema, {
        payload: {
          case: "start",
          value: create(ManagedComputerSetupStartSchema, {
            setupToken: `briar_setup_${"a".repeat(43)}`,
            provider: AgentProvider.CODEX,
          }),
        },
      }),
    );
    const wrongDirection = fromBinary(
      ManagedComputerSetupToControllerSchema,
      encoded,
    );
    const unsupportedProvider = create(ManagedComputerSetupToAgentSchema, {
      payload: {
        case: "start",
        value: create(ManagedComputerSetupStartSchema, {
          setupToken: `briar_setup_${"a".repeat(43)}`,
          provider: AgentProvider.CURSOR,
        }),
      },
    });

    expect(wrongDirection.payload.case).toBeUndefined();
    expect(isManagedComputerSetupToController(wrongDirection)).toBe(false);
    expect(isManagedComputerSetupToAgent(unsupportedProvider)).toBe(false);
  });
});
