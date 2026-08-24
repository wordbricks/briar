import { describe, expect, it } from "vitest";
import {
  managedComputerConfig,
  managedComputerJson,
  type ManagedComputerRow,
} from "./managed-computer-model";

describe("managed computer remote desktop configuration", () => {
  it("deduplicates approved origins and rejects unsafe duration limits", () => {
    const config = managedComputerConfig({
      MANAGED_COMPUTER_API_ORIGIN: "https://briar.example/path",
      MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED: "true",
      MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS:
        "https://briar.example,https://staging.example,https://staging.example",
      MANAGED_COMPUTER_REMOTE_DESKTOP_TOKEN_TTL_SECONDS: "301",
      MANAGED_COMPUTER_REMOTE_DESKTOP_MAX_SESSION_MINUTES: "481",
    } as Env);
    expect(config.remoteDesktopEnabled).toBe(true);
    expect(config.remoteDesktopAllowedOrigins.filter(
      (origin) => origin === "https://briar.example",
    )).toHaveLength(1);
    expect(config.remoteDesktopAllowedOrigins).toContain(
      "https://staging.example",
    );
    expect(config.remoteDesktopTokenTtlSeconds).toBe(60);
    expect(config.remoteDesktopMaxSessionMinutes).toBe(60);
  });
});

describe("managed computer retry presentation", () => {
  const failedComputer: ManagedComputerRow = {
    id: "managed-computer",
    organization_id: "organization",
    requester_user_id: "owner",
    entitlement_id: "entitlement",
    state: "failed",
    aws_account_id: "123456789012",
    aws_region: "us-east-1",
    aws_instance_type: "m7i.large",
    aws_instance_id: "i-0123456789abcdef0",
    aws_volume_id: "vol-0123456789abcdef0",
    aws_launch_template_id: "lt-0123456789abcdef0",
    aws_launch_template_version: "3",
    bootstrap_api_origin: "https://briar.example",
    briar_device_id: null,
    provisioning_job_id: "provisioning-job",
    enrollment_nonce_hash: "a".repeat(64),
    enrollment_expires_at: "2026-08-24T00:30:00.000Z",
    enrollment_consumed_at: null,
    enrollment_identity_hash: null,
    error_code: "BOOTSTRAP_TIMEOUT",
    error_detail: "Enrollment timed out",
    retry_count: 99,
    created_at: "2026-08-24T00:00:00.000Z",
    state_updated_at: "2026-08-24T00:20:00.000Z",
    expires_at: "2026-09-24T00:00:00.000Z",
    last_retry_at: "2026-08-24T00:10:00.000Z",
    drained_at: null,
    stopped_at: null,
    terminated_at: null,
    updated_at: "2026-08-24T00:20:00.000Z",
  };

  it("offers a manual retry after any number of failures", () => {
    expect(managedComputerJson(failedComputer)).toMatchObject({
      retryCount: 99,
      retryAvailable: true,
    });
    expect(managedComputerJson({
      ...failedComputer,
      state: "requested",
    }).retryAvailable).toBe(false);
  });
});
