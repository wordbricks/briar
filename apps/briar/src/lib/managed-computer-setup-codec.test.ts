import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
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
