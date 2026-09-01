import { describe, expect, it } from "vitest";
import {
  CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS,
  CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS,
  CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS,
  createChannelActivityPublishToken,
  createChannelActivitySocketTicket,
  createIssueActivityPublishToken,
  createIssueActivitySocketTicket,
  verifyChannelActivityPublishToken,
  verifyChannelActivitySocketTicket,
  verifyIssueActivityPublishToken,
  verifyIssueActivitySocketTicket,
} from "./channel-activity-ticket";

describe("channel activity credentials", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const identity = {
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channelId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    attempt: 2,
    workerId: "worker-a",
    deviceId: "device-a",
    claimTokenHash: "a".repeat(64),
  };

  it("authenticates a reply-scoped publish token", async () => {
    const issued = await createChannelActivityPublishToken("secret", {
      ...identity,
      expiresAt: now + 60_000,
    });
    await expect(
      verifyChannelActivityPublishToken(
        "secret",
        issued.token,
        identity.replyJobId,
        now + 1,
      ),
    ).resolves.toMatchObject(identity);
    await expect(
      verifyChannelActivityPublishToken(
        "secret",
        issued.token,
        "11111111-1111-4111-8111-111111111111",
        now + 1,
      ),
    ).resolves.toBeNull();
  });

  it("rejects tampered, expired, and excessively long publish credentials", async () => {
    const issued = await createChannelActivityPublishToken("secret", {
      ...identity,
      expiresAt: now + 60_000,
    });
    await expect(
      verifyChannelActivityPublishToken(
        "secret",
        `${issued.token}x`,
        identity.replyJobId,
        now + 1,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyChannelActivityPublishToken(
        "secret",
        issued.token,
        identity.replyJobId,
        now + 60_000,
      ),
    ).resolves.toBeNull();

    const excessive = await createChannelActivityPublishToken("secret", {
      ...identity,
      expiresAt: now + CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS + 1,
    });
    await expect(
      verifyChannelActivityPublishToken(
        "secret",
        excessive.token,
        identity.replyJobId,
        now,
      ),
    ).resolves.toBeNull();
  });

  it("scopes subscriber tickets to one channel and a bounded authorization", async () => {
    const issued = await createChannelActivitySocketTicket("secret", {
      organizationId: identity.organizationId,
      channelId: identity.channelId,
      userId: "user-a",
      now,
    });
    await expect(
      verifyChannelActivitySocketTicket(
        "secret",
        issued.ticket,
        identity.organizationId,
        identity.channelId,
        now + 1,
      ),
    ).resolves.toMatchObject({
      userId: "user-a",
      expiresAt: now + CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS,
      authorizationExpiresAt:
        now + CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS,
    });
    await expect(
      verifyChannelActivitySocketTicket(
        "secret",
        issued.ticket,
        identity.organizationId,
        "11111111-1111-4111-8111-111111111111",
        now + 1,
      ),
    ).resolves.toBeNull();
  });

  it("scopes issue activity credentials to one project run and reply", async () => {
    const issueIdentity = {
      organizationId: identity.organizationId,
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      replyJobId: identity.replyJobId,
      triggerMessageId: identity.triggerMessageId,
      parentMessageId: identity.parentMessageId,
      attempt: 3,
      workerId: identity.workerId,
      deviceId: identity.deviceId,
    };
    const publish = await createIssueActivityPublishToken("secret", {
      ...issueIdentity,
      expiresAt: now + 60_000,
    });
    await expect(
      verifyIssueActivityPublishToken(
        "secret",
        publish.token,
        issueIdentity.replyJobId,
        now + 1,
      ),
    ).resolves.toMatchObject(issueIdentity);

    const subscription = await createIssueActivitySocketTicket("secret", {
      organizationId: issueIdentity.organizationId,
      projectId: issueIdentity.projectId,
      runId: issueIdentity.runId,
      userId: "user-a",
      now,
    });
    await expect(
      verifyIssueActivitySocketTicket(
        "secret",
        subscription.ticket,
        issueIdentity.projectId,
        issueIdentity.runId,
        now + 1,
      ),
    ).resolves.toMatchObject({ organizationId: issueIdentity.organizationId });
    await expect(
      verifyIssueActivitySocketTicket(
        "secret",
        subscription.ticket,
        issueIdentity.projectId,
        identity.channelId,
        now + 1,
      ),
    ).resolves.toBeNull();
  });
});
