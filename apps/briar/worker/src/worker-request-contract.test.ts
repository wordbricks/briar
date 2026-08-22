import * as SchemaIssue from "effect/SchemaIssue";
import { describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import { RequestDecodeError } from "./request-schema";
import {
  decodeWorkerHeartbeat,
  decodeWorkerRegister,
} from "./worker-request-contract";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();

describe("Worker request contract", () => {
  it("rejects every overlong Worker version key without dropping it", () => {
    const firstKey = `first-${"a".repeat(64)}`;
    const secondKey = `second-${"b".repeat(64)}`;

    try {
      decodeWorkerHeartbeat({
        versions: {
          [firstKey]: "1.0.0",
          valid: "2.0.0",
          [secondKey]: "3.0.0",
        },
      });
      throw new Error("Expected Worker heartbeat decoding to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestDecodeError);
      if (!(error instanceof RequestDecodeError)) return;

      expect(formatSchemaIssue(error.cause.issue).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["versions", firstKey] }),
          expect.objectContaining({ path: ["versions", secondKey] }),
        ]),
      );
    }
  });

  it("requires exactly the supported provider health keys", () => {
    const providerHealth = Object.fromEntries(
      agentProviders.map((provider) => [provider, {
        installed: true,
        authenticated: true,
        healthy: true,
      }]),
    );
    const registration = {
      label: "worker",
      deviceIdentity: `briar_device_${"a".repeat(64)}`,
      agentProvider: "codex",
      providerHealth,
    };

    const { codex: _codex, ...missingProvider } = providerHealth;
    expect(() => decodeWorkerRegister({
      ...registration,
      providerHealth: missingProvider,
    })).toThrow(RequestDecodeError);
    expect(() => decodeWorkerRegister({
      ...registration,
      providerHealth: {
        ...providerHealth,
        unsupported: {
          installed: true,
          authenticated: true,
          healthy: true,
        },
      },
    })).toThrow(RequestDecodeError);
  });
});
