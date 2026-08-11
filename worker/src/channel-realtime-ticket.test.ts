import { describe, expect, it } from "vitest";
import {
  CHANNEL_REALTIME_TICKET_TTL_MS,
  createChannelRealtimeTicket,
  verifyChannelRealtimeTicket,
} from "./channel-realtime-ticket";

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
});
