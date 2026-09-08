import { publishChannelRealtime } from "./channel-realtime";
import type {
  ChannelAgentActivityPublishInput,
} from "../../src/lib/channel-agent-activity";
import {
  publishChannelActivity,
  publishIssueActivity,
} from "./channel-activity-realtime";
import {
  verifyChannelActivityPublishToken,
  verifyIssueActivityPublishToken,
} from "./channel-activity-ticket";
import {
  channelActivityFrame,
  issueActivityFrame,
} from "./realtime-scheduling";
import { getChannelSyncCursor, getClaimedChannelReply, publishChannelAcknowledgementReaction } from "./channels";

export type ReplyActivityApplicationServices = {
  readonly verifyChannelActivityPublishToken:
    typeof verifyChannelActivityPublishToken;
  readonly verifyIssueActivityPublishToken:
    typeof verifyIssueActivityPublishToken;
  readonly channelActivityFrame: typeof channelActivityFrame;
  readonly issueActivityFrame: typeof issueActivityFrame;
  readonly publishChannelActivity: typeof publishChannelActivity;
  readonly publishIssueActivity: typeof publishIssueActivity;
  readonly publishChannelAcknowledgementReaction: typeof publishChannelAcknowledgementReaction;
  readonly publishChannelRealtime: typeof publishChannelRealtime;
  readonly getChannelSyncCursor: typeof getChannelSyncCursor;
  readonly getClaimedChannelReply: typeof getClaimedChannelReply;
};

const replyActivityApplicationServices: ReplyActivityApplicationServices = {
  verifyChannelActivityPublishToken,
  verifyIssueActivityPublishToken,
  channelActivityFrame,
  issueActivityFrame,
  publishChannelActivity,
  publishIssueActivity,
  getClaimedChannelReply,
  publishChannelAcknowledgementReaction,
  publishChannelRealtime,
  getChannelSyncCursor,
};

export class ReplyActivityApplicationError extends Error {
  constructor(
    readonly reason: "invalid_capability",
    message: string,
  ) {
    super(message);
    this.name = "ReplyActivityApplicationError";
  }
}

export async function publishReplyActivityApplication(
  input: {
    env: Env;
    db: D1Database;
    token: string;
    replyJobId: string;
    activity: ChannelAgentActivityPublishInput;
    acknowledgementReaction?: string;
  },
  overrides: Partial<ReplyActivityApplicationServices> = {},
) {
  const services = { ...replyActivityApplicationServices, ...overrides };
  const channel = await services.verifyChannelActivityPublishToken(
    input.env.BETTER_AUTH_SECRET,
    input.token,
    input.replyJobId,
  );
  if (channel !== null) {
    if (!await services.getClaimedChannelReply(input.db, {
      jobId: channel.replyJobId,
      deviceId: channel.deviceId,
      workerId: channel.workerId,
      claimTokenHash: channel.claimTokenHash,
      observedAt: new Date().toISOString(),
    })) {
      throw new ReplyActivityApplicationError(
        "invalid_capability",
        "Reply activity claim is no longer active",
      );
    }
    if (input.acknowledgementReaction !== undefined) {
      await services.publishChannelAcknowledgementReaction(input.db, {
        jobId: channel.replyJobId,
        deviceId: channel.deviceId,
        workerId: channel.workerId,
        claimTokenHash: channel.claimTokenHash,
        observedAt: new Date().toISOString(),
        emoji: input.acknowledgementReaction,
      });
      await services.publishChannelRealtime(input.env, channel.organizationId,
        await services.getChannelSyncCursor(input.db, channel.organizationId));
      return;
    }
    const frame = services.channelActivityFrame({
      id: channel.replyJobId,
      organization_id: channel.organizationId,
      channel_id: channel.channelId,
      agent_id: channel.agentId,
      trigger_message_id: channel.triggerMessageId,
      parent_message_id: channel.parentMessageId,
      attempts: channel.attempt,
    }, input.activity);
    await services.publishChannelActivity(
      input.env,
      channel.organizationId,
      frame,
    );
    return;
  }

  const issue = await services.verifyIssueActivityPublishToken(
    input.env.BETTER_AUTH_SECRET,
    input.token,
    input.replyJobId,
  );
  if (issue !== null && input.acknowledgementReaction === undefined) {
    const frame = services.issueActivityFrame({
      id: issue.replyJobId,
      project_id: issue.projectId,
      run_id: issue.runId,
      trigger_message_id: issue.triggerMessageId,
      parent_message_id: issue.parentMessageId,
      attempts: issue.attempt,
    }, input.activity);
    await services.publishIssueActivity(
      input.env,
      issue.organizationId,
      frame,
    );
    return;
  }

  throw new ReplyActivityApplicationError(
    "invalid_capability",
    "Reply activity capability is invalid or expired",
  );
}
