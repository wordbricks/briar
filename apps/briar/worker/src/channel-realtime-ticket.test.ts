import { describe, expect, it } from "vitest";
import {
  CHANNEL_REALTIME_TICKET_TTL_MS,
  createChannelRealtimeTicket,
  verifyChannelRealtimeTicket,
} from "./channel-realtime-ticket";
import { signJsonToken } from "./signed-json-token";

describe("channel realtime tickets", () => {
  const now = Date.UTC(2026, 7, 12, 0, 0, 0);

  it("authenticates a short-lived organization-scoped socket URL", async () => {
    const issued = await createChannelRealtimeTicket("test-secret", {
      organizationId: "organization-a",
      userId: "user-a",
      now,
    });

    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        issued.ticket,
        "organization-a",
        now + 1,
      ),
    ).resolves.toMatchObject({
      organizationId: "organization-a",
      userId: "user-a",
      expiresAt: now + CHANNEL_REALTIME_TICKET_TTL_MS,
    });
  });

  it("rejects tampered, cross-organization, and expired tickets", async () => {
    const issued = await createChannelRealtimeTicket("test-secret", {
      organizationId: "organization-a",
      userId: "user-a",
      now,
    });

    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        `${issued.ticket}x`,
        "organization-a",
        now + 1,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        issued.ticket,
        "organization-b",
        now + 1,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        issued.ticket,
        "organization-a",
        now + CHANNEL_REALTIME_TICKET_TTL_MS,
      ),
    ).resolves.toBeNull();
  });

  it("preserves signed extension claims after schema validation", async () => {
    const ticket = await signJsonToken(
      "briar-channel-realtime",
      "test-secret",
      {
        organizationId: "organization-a",
        userId: "user-a",
        expiresAt: now + CHANNEL_REALTIME_TICKET_TTL_MS,
        nonce: "nonce-a",
        futureClaim: "supported",
      },
    );

    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        ticket,
        "organization-a",
        now + 1,
      ),
    ).resolves.toMatchObject({
      userId: "user-a",
      futureClaim: "supported",
    });
  });

  it("rejects a validly signed payload with an invalid field type", async () => {
    const ticket = await signJsonToken(
      "briar-channel-realtime",
      "test-secret",
      {
        organizationId: "organization-a",
        userId: 42,
        expiresAt: now + CHANNEL_REALTIME_TICKET_TTL_MS,
        nonce: "nonce-a",
      },
    );

    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        ticket,
        "organization-a",
        now + 1,
      ),
    ).resolves.toBeNull();
  });

  it("keeps realtime and activity signing domains isolated", async () => {
    const ticket = await signJsonToken(
      "briar-channel-activity",
      "test-secret",
      {
        organizationId: "organization-a",
        userId: "user-a",
        expiresAt: now + CHANNEL_REALTIME_TICKET_TTL_MS,
        nonce: "nonce-a",
      },
    );

    await expect(
      verifyChannelRealtimeTicket(
        "test-secret",
        ticket,
        "organization-a",
        now + 1,
      ),
    ).resolves.toBeNull();
  });
});
