import { describe, expect, it, vi } from "vitest";
import {
  reconcileDrainingManagedComputer,
  reconcileDrainingManagedComputers,
  type ManagedComputerRetirementDependencies,
} from "./managed-computer-reconciliation";
import type { ManagedComputerRow } from "./managed-computer-model";

const observedAt = "2026-08-25T07:30:00.000Z";
const drainingComputer: ManagedComputerRow = {
  id: "0094b3bd-7b10-47cf-a94f-bde9a46d2352",
  organization_id: "4fdee229-9de3-4e03-a1fd-380f46321533",
  requester_user_id: "owner",
  entitlement_id: "entitlement",
  state: "draining",
  aws_account_id: "496494569181",
  aws_region: "us-east-1",
  aws_instance_type: "m7i.large",
  aws_instance_id: "i-01b82449360dae220",
  aws_volume_id: "vol-0123456789abcdef0",
  aws_launch_template_id: "lt-0bf7a358da7b03e93",
  aws_launch_template_version: "6",
  bootstrap_api_origin: "https://briar-api.wbai.workers.dev",
  briar_device_id: "managed-0094b3bd-7b10-47cf-a94f-bde9a46d2352",
  provisioning_job_id: "provisioning-job",
  enrollment_nonce_hash: "a".repeat(64),
  enrollment_expires_at: "2026-08-24T00:30:00.000Z",
  enrollment_consumed_at: "2026-08-24T00:10:00.000Z",
  enrollment_identity_hash: "b".repeat(64),
  error_code: null,
  error_detail: null,
  retry_count: 0,
  created_at: "2026-08-24T00:00:00.000Z",
  state_updated_at: "2026-08-25T07:07:16.686Z",
  expires_at: "2026-09-24T00:00:00.000Z",
  last_retry_at: null,
  drained_at: "2026-08-25T07:07:16.686Z",
  stopped_at: null,
  terminated_at: null,
  updated_at: "2026-08-25T07:07:16.686Z",
};

const env = {
  MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY: "secret",
} as Env;
const db = {} as D1Database;

function dependencies(input?: {
  activeSessions?: number;
  stopManagedInstance?: ManagedComputerRetirementDependencies["stopManagedInstance"];
}) {
  const stoppedComputer: ManagedComputerRow = {
    ...drainingComputer,
    state: "stopped",
    state_updated_at: observedAt,
    stopped_at: observedAt,
    updated_at: observedAt,
  };
  return {
    managedComputerById: vi.fn(async () => drainingComputer),
    listDrainingManagedComputersForReconciliation: vi.fn(async () => [
      drainingComputer,
    ]),
    countExecutionWorkerDeviceSessions: vi.fn(async () =>
      input?.activeSessions ?? 0
    ),
    stopManagedInstance: input?.stopManagedInstance ?? vi.fn(async () => {}),
    markManagedComputerStopped: vi.fn(async () => stoppedComputer),
    endManagedComputerRemoteSessionsAndDisconnect: vi.fn(async () => []),
    recordManagedComputerAuditEvent: vi.fn(async () => {}),
  } satisfies ManagedComputerRetirementDependencies;
}

describe("managed computer retirement reconciliation", () => {
  it("stops a draining instance immediately when no execution lease remains", async () => {
    const retirement = dependencies();

    await expect(reconcileDrainingManagedComputer(
      db,
      env,
      drainingComputer.id,
      observedAt,
      retirement,
    )).resolves.toEqual({ outcome: "stopped", activeSessions: 0 });

    expect(retirement.stopManagedInstance).toHaveBeenCalledOnce();
    expect(retirement.stopManagedInstance).toHaveBeenCalledWith(
      expect.objectContaining({ awsAccessKeyId: "AKIAEXAMPLE" }),
      "us-east-1",
      "i-01b82449360dae220",
    );
    expect(retirement.markManagedComputerStopped).toHaveBeenCalledOnce();
    expect(
      retirement.endManagedComputerRemoteSessionsAndDisconnect,
    ).toHaveBeenCalledOnce();
    expect(retirement.recordManagedComputerAuditEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "stopped",
        managedComputerId: drainingComputer.id,
      }),
    );
  });

  it("waits without stopping while an execution lease is active", async () => {
    const retirement = dependencies({ activeSessions: 1 });

    await expect(reconcileDrainingManagedComputer(
      db,
      env,
      drainingComputer.id,
      observedAt,
      retirement,
    )).resolves.toEqual({ outcome: "waiting", activeSessions: 1 });

    expect(retirement.stopManagedInstance).not.toHaveBeenCalled();
    expect(retirement.markManagedComputerStopped).not.toHaveBeenCalled();
  });

  it("keeps a failed AWS stop retryable on the next minute sweep", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stopManagedInstance = vi.fn()
      .mockRejectedValueOnce(new Error("AWS temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    const retirement = dependencies({ stopManagedInstance });
    try {
      await expect(reconcileDrainingManagedComputers(
        db,
        env,
        observedAt,
        retirement,
      )).resolves.toMatchObject({ failed: 1, stopped: 0 });
      expect(retirement.markManagedComputerStopped).not.toHaveBeenCalled();

      await expect(reconcileDrainingManagedComputers(
        db,
        env,
        "2026-08-25T07:31:00.000Z",
        retirement,
      )).resolves.toMatchObject({ failed: 0, stopped: 1 });
      expect(stopManagedInstance).toHaveBeenCalledTimes(2);
      expect(retirement.markManagedComputerStopped).toHaveBeenCalledOnce();
      expect(String(consoleError.mock.calls[0]?.[0])).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });
});
