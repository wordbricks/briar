import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ApplicationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { describe, expect, it, vi } from "vitest";
import {
  enrollManagedComputerFromInstance,
  managedComputerEnrollmentErrorCode,
  managedComputerEnrollmentExitCode,
} from "./managed-computer-enrollment";
import { loadManagedComputerCredential } from "./managed-computer-credential";

const managedComputerId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

describe("managed computer enrollment", () => {
  it("persists a validated credential from the generated Connect client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-enrollment-"));
    try {
      const paths = {
        config: join(directory, "managed-enrollment.json"),
        identityDocument: join(directory, "identity.json"),
        identitySignature: join(directory, "identity-signature"),
        credential: join(directory, "worker-credential.json"),
      };
      await Promise.all([
        writeFile(paths.config, JSON.stringify({
          apiOrigin: "https://api.example.test",
          managedComputerId,
          nonce: "n".repeat(43),
        })),
        writeFile(paths.identityDocument, "{}"),
        writeFile(paths.identitySignature, "a".repeat(64)),
      ]);
      const enrollManagedComputer = vi.fn().mockResolvedValue({
        managedComputerId,
        credential: `briar_worker_${"c".repeat(43)}`,
        deviceId: `managed-${managedComputerId}`,
        organizationId,
      });
      const createEnrollmentClient = vi.fn(() => ({
        enrollManagedComputer,
      }));

      const credential = await enrollManagedComputerFromInstance(paths, {
        createEnrollmentClient,
        version: "1.2.173",
      });

      expect(createEnrollmentClient).toHaveBeenCalledWith(
        "https://api.example.test",
      );
      expect(enrollManagedComputer).toHaveBeenCalledWith({
        managedComputerId,
        nonce: "n".repeat(43),
        identityDocument: "{}",
        identitySignature: "a".repeat(64),
        briarVersion: "1.2.173",
      });
      expect(await loadManagedComputerCredential(paths.credential)).toEqual(
        credential,
      );
      expect(JSON.parse(await readFile(paths.credential, "utf8"))).toEqual(
        credential,
      );
      expect((await stat(paths.credential)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps application codes while classifying systemd retry exits", () => {
    const retryable = new ConnectError(
      "Managed computer is not ready",
      Code.FailedPrecondition,
      undefined,
      [{
        desc: ApplicationErrorDetailSchema,
        value: { code: "MANAGED_COMPUTER_SSM_NOT_READY" },
      }],
    );
    const permanent = new ConnectError(
      "Invalid identity proof",
      Code.PermissionDenied,
    );

    expect(managedComputerEnrollmentErrorCode(retryable)).toBe(
      "MANAGED_COMPUTER_SSM_NOT_READY",
    );
    expect(managedComputerEnrollmentExitCode(retryable)).toBe(75);
    expect(managedComputerEnrollmentExitCode(permanent)).toBe(2);
  });
});
