import { describe, expect, it, vi } from "vitest";
import {
  channelReplyClaimValidationError,
  decodeChannelReplyClaimOrFail,
} from "./channel-reply-claim";

const organizationId = "22222222-2222-4222-8222-222222222222";
const workId = "11111111-1111-4111-8111-111111111111";
const claimedAt = "2026-08-31T08:00:00+00:00";
const claim = {
  workType: "channelReply",
  workId,
  organizationId,
  channelId: "33333333-3333-4333-8333-333333333333",
  projectId: null,
  runId: "44444444-4444-4444-8444-444444444444",
  sourceKey: "channel:reply",
  title: "Reply",
  triggerMessageId: "55555555-5555-4555-8555-555555555555",
  parentMessageId: "66666666-6666-4666-8666-666666666666",
  provider: "codex",
  model: null,
  claimToken: "briar_channel_claim_test",
  claimedAt,
  leaseExpiresAt: "2026-08-31T08:15:00+00:00",
  organizationContext: { schemaVersion: 1, snapshotAt: claimedAt },
  session: {
    id: "77777777-7777-4777-8777-777777777777",
    threadId: "66666666-6666-4666-8666-666666666666",
    conversationId: null,
    retainedUntil: "2026-09-01T08:00:00+00:00",
    claimReason: "designated_worker_claimed",
  },
  snapshot: {},
};
const invalidClaim = {
  ...claim,
  session: { ...claim.session, claimReason: "unsupported_future_reason" },
};

describe("channel reply claim validation recovery", () => {
  it("accepts the first claim by a designated Worker without reporting failure", async () => {
    const failClaim = vi.fn();
    await expect(decodeChannelReplyClaimOrFail(claim, {
      organizationId,
      failClaim,
    })).resolves.toMatchObject({
      workId,
      session: { claimReason: "designated_worker_claimed" },
    });
    expect(failClaim).not.toHaveBeenCalled();
  });

  it("awaits the failure report before rejecting an unsupported claim", async () => {
    let finishReport!: () => void;
    const report = new Promise<void>((resolve) => { finishReport = resolve; });
    const failClaim = vi.fn(() => report);
    const pending = decodeChannelReplyClaimOrFail(invalidClaim, {
      organizationId,
      failClaim,
    });
    const rejected = vi.fn();
    const result = pending.catch(rejected);
    await Promise.resolve();
    expect(rejected).not.toHaveBeenCalled();
    expect(failClaim).toHaveBeenCalledExactlyOnceWith(
      {
        workType: "channelReply",
        workId,
        organizationId,
        claimToken: claim.claimToken,
      },
      expect.objectContaining({ message: channelReplyClaimValidationError }),
      expect.any(AbortSignal),
    );
    finishReport();
    await result;
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`Reported failure for reply ${workId}`),
      }),
    );
  });

  it.each([
    { workId: "../../another-job" },
    { organizationId: "invalid" },
    { claimToken: undefined },
    { claimToken: "briar_channel_claim_" },
    { claimToken: `briar_channel_claim_${"x".repeat(200)}` },
    { workType: "issueReply" },
  ])("does not report failure with invalid claim credentials: %j", async (invalid) => {
    const failClaim = vi.fn();
    await expect(decodeChannelReplyClaimOrFail({ ...invalidClaim, ...invalid }, {
      organizationId,
      failClaim,
    })).rejects.toThrow("claim credentials are invalid");
    expect(failClaim).not.toHaveBeenCalled();
  });

  it("does not report a claim from another organization", async () => {
    const failClaim = vi.fn();
    await expect(decodeChannelReplyClaimOrFail(invalidClaim, {
      organizationId: "99999999-9999-4999-8999-999999999999",
      failClaim,
    })).rejects.toThrow("organization does not match this Worker");
    expect(failClaim).not.toHaveBeenCalled();
  });

  it("keeps a failed report visible without leaking response or transport secrets", async () => {
    const failClaim = vi.fn(() => Promise.reject(new Error("transport-secret")));
    const error = await decodeChannelReplyClaimOrFail({
      ...invalidClaim,
      title: { secret: "response-secret" },
    }, { organizationId, failClaim }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Could not confirm failure reporting");
    expect((error as Error).message).not.toMatch(/secret|briar_channel_claim_test/u);
    expect(failClaim.mock.calls[0]).toBeDefined();
  });

  it("bounds failure reporting to ten seconds and rejects if the report times out", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      const pending = decodeChannelReplyClaimOrFail(invalidClaim, {
        organizationId,
        failClaim: (_claim, _error, signal) => new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      });
      const rejection = expect(pending).rejects.toThrow("Could not confirm failure reporting");
      controller.abort(new Error("timed out"));
      await rejection;
      expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
