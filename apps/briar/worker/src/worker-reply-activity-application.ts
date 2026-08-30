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

export type ReplyActivityApplicationServices = {
  readonly verifyChannelActivityPublishToken:
    typeof verifyChannelActivityPublishToken;
  readonly verifyIssueActivityPublishToken:
    typeof verifyIssueActivityPublishToken;
  readonly channelActivityFrame: typeof channelActivityFrame;
  readonly issueActivityFrame: typeof issueActivityFrame;
  readonly publishChannelActivity: typeof publishChannelActivity;
  readonly publishIssueActivity: typeof publishIssueActivity;
};

const replyActivityApplicationServices: ReplyActivityApplicationServices = {
  verifyChannelActivityPublishToken,
  verifyIssueActivityPublishToken,
  channelActivityFrame,
  issueActivityFrame,
  publishChannelActivity,
  publishIssueActivity,
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
    token: string;
    replyJobId: string;
    activity: ChannelAgentActivityPublishInput;
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
  if (issue !== null) {
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
