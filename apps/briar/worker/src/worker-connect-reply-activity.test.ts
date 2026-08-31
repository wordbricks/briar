import { create } from "@bufbuild/protobuf";
import {
  AgentActivitySchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  PublishReplyActivityRequestSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { type HandlerContext } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-response";
import {
  createChannelActivityPublishToken,
  createIssueActivityPublishToken,
} from "./channel-activity-ticket";
import {
  createReplyActivityService,
} from "./worker-connect-reply-activity";
import type {
  ReplyActivityApplicationServices,
} from "./worker-reply-activity-application";

const organizationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const replyJobId = "44444444-4444-4444-8444-444444444444";
const triggerMessageId = "55555555-5555-4555-8555-555555555555";
const parentMessageId = "66666666-6666-4666-8666-666666666666";
const projectId = "77777777-7777-4777-8777-777777777777";
const runId = "88888888-8888-4888-8888-888888888888";
const secret = "reply-activity-test-secret";
const context = {} as HandlerContext;
const env = { BETTER_AUTH_SECRET: secret } as Env;

const input = (token: string) => ({
  request: new Request("https://briar.example/reply-activity", {
    headers: { authorization: `Bearer ${token}` },
  }),
  env,
  db: {} as D1Database,
});

describe("ReplyActivityService capability boundary", () => {
  it("restores channel and issue scope from signed capabilities", async () => {
    const channelToken = await createChannelActivityPublishToken(secret, {
      organizationId,
      channelId,
      replyJobId,
      agentId,
      triggerMessageId,
      parentMessageId,
      attempt: 3,
      workerId: "worker-1",
      deviceId: "device-1",
      claimTokenHash: "a".repeat(64),
      expiresAt: Date.now() + 60_000,
    });
    const publishChannel = vi.fn<
      ReplyActivityApplicationServices["publishChannelActivity"]
    >().mockResolvedValue();
    const channelService = createReplyActivityService(input(channelToken.token), {
      publishChannelActivity: publishChannel,
      getClaimedChannelReply: vi.fn().mockResolvedValue({ id: replyJobId }),
    });

    await channelService.publishReplyActivity(create(
      PublishReplyActivityRequestSchema,
      {
        replyJobId,
        sequence: 12n,
        activity: create(AgentActivitySchema, {
          id: "tool-1",
          kind: AgentActivityKind.COMMAND,
          headline: " Running tests ",
        }),
      },
    ), context);
    expect(publishChannel).toHaveBeenCalledWith(
      env,
      organizationId,
      expect.objectContaining({
        replyJobId,
        attempt: 3,
        sequence: 12n,
        activity: expect.objectContaining({ headline: "Running tests" }),
        scope: {
          case: "channel",
          value: expect.objectContaining({ channelId, agentId }),
        },
      }),
    );

    const issueToken = await createIssueActivityPublishToken(secret, {
      organizationId,
      projectId,
      runId,
      replyJobId,
      triggerMessageId,
      parentMessageId,
      attempt: 4,
      workerId: "worker-1",
      deviceId: "device-1",
      expiresAt: Date.now() + 60_000,
    });
    const publishIssue = vi.fn<
      ReplyActivityApplicationServices["publishIssueActivity"]
    >().mockResolvedValue();
    const issueService = createReplyActivityService(input(issueToken.token), {
      publishIssueActivity: publishIssue,
    });
    await issueService.publishReplyActivity(create(
      PublishReplyActivityRequestSchema,
      { replyJobId, sequence: 13n },
    ), context);
    expect(publishIssue).toHaveBeenCalledWith(
      env,
      organizationId,
      expect.objectContaining({
        replyJobId,
        attempt: 4,
        sequence: 13n,
        scope: {
          case: "issue",
          value: expect.objectContaining({ projectId, runId }),
        },
      }),
    );

    const mismatch = await Promise.resolve(
      issueService.publishReplyActivity(create(
        PublishReplyActivityRequestSchema,
        {
          replyJobId: "99999999-9999-4999-8999-999999999999",
          sequence: 14n,
        },
      ), context),
    ).catch((cause: unknown) => cause);
    expect(mismatch).toBeInstanceOf(HttpError);
    expect((mismatch as HttpError).status).toBe(401);
    expect(publishIssue).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unspecified and unknown activity kinds", async () => {
    const publish = vi.fn<
      ReplyActivityApplicationServices["publishChannelActivity"]
    >().mockResolvedValue();
    const service = createReplyActivityService(input("unused"), {
      publishChannelActivity: publish,
    });

    for (const kind of [AgentActivityKind.UNSPECIFIED, 999 as AgentActivityKind]) {
      const error = await Promise.resolve(
        service.publishReplyActivity(create(
          PublishReplyActivityRequestSchema,
          {
            replyJobId,
            sequence: 1n,
            activity: create(AgentActivitySchema, {
              id: "activity-1",
              kind,
              headline: "Working",
            }),
          },
        ), context),
      ).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
    expect(publish).not.toHaveBeenCalled();
  });
});
