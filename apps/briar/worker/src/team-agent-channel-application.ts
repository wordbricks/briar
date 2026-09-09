import {
  channelJson,
  getClaimedChannelReplyChannel,
  getProjectAgentChannel,
  getProjectOrganizationChannel,
  isChannelRootMessage,
  listChannelMessagePage,
} from "./channels";

export type TeamAgentChannelApplicationErrorReason =
  | "channel_not_found"
  | "channel_forbidden"
  | "claim_not_active"
  | "thread_parent_not_found"
  | "cursor_invalid";

export class TeamAgentChannelApplicationError extends Error {
  readonly name = "TeamAgentChannelApplicationError";

  constructor(
    readonly reason: TeamAgentChannelApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type TeamAgentChannelApplicationServices = {
  readonly getClaimedChannelReplyChannel: typeof getClaimedChannelReplyChannel;
  readonly getProjectAgentChannel: typeof getProjectAgentChannel;
  readonly getProjectOrganizationChannel: typeof getProjectOrganizationChannel;
  readonly isChannelRootMessage: typeof isChannelRootMessage;
  readonly listChannelMessagePage: typeof listChannelMessagePage;
};

const teamAgentChannelApplicationServices:
  TeamAgentChannelApplicationServices = {
    getClaimedChannelReplyChannel,
    getProjectAgentChannel,
    getProjectOrganizationChannel,
    isChannelRootMessage,
    listChannelMessagePage,
  };

const applicationError = (
  reason: TeamAgentChannelApplicationErrorReason,
  message: string,
): never => {
  throw new TeamAgentChannelApplicationError(reason, message);
};

export async function listTeamAgentChannelMessagesApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly channelId: string;
    readonly parentMessageId: string | null;
    readonly cursor: string | null;
    readonly limit: number;
  },
  overrides: Partial<TeamAgentChannelApplicationServices> = {},
) {
  const services = {
    ...teamAgentChannelApplicationServices,
    ...overrides,
  };
  const channel = await services.getProjectAgentChannel(
    input.db,
    input.projectId,
    input.channelId,
  );
  if (!channel) {
    const organizationChannel = await services.getProjectOrganizationChannel(
      input.db,
      input.projectId,
      input.channelId,
    );
    if (!organizationChannel) {
      return applicationError("channel_not_found", "Channel not found");
    }
    return applicationError(
      "channel_forbidden",
      "No Project Agent for this project has access to the channel",
    );
  }

  if (
    input.parentMessageId &&
    !(await services.isChannelRootMessage(
      input.db,
      channel.id,
      input.parentMessageId,
    ))
  ) {
    return applicationError(
      "thread_parent_not_found",
      "Thread parent message not found",
    );
  }

  // An Agent reads the conversation as it works, so it still sees the answers
  // an older round trip copied back, which the person's own view leaves out.
  const page = await services.listChannelMessagePage(input.db, {
    channelId: channel.id,
    parentMessageId: input.parentMessageId,
    cursor: input.cursor,
    limit: input.limit,
    includeRepliesInTimeline: channel.kind === "dm",
    includeAgentAnswerCopies: true,
  });
  if (!page) {
    return applicationError(
      "cursor_invalid",
      "Cursor does not belong to this message view",
    );
  }
  return { channel: channelJson(channel), ...page };
}

/**
 * Channel history for the reply job an execution session is already serving.
 * The claim scope replaces the Project Agent token entirely: the caller names
 * a job, the job names the channel, and `getClaimedChannelReplyChannel`
 * refuses everything the running claim does not cover. Wording stays Korean
 * and avoids credential-expiry language, because a session reaching this path
 * holds a Worker credential that never expires.
 */
export async function listClaimedChannelReplyMessagesApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly deviceId: string;
    readonly jobId: string;
    readonly parentMessageId: string | null;
    readonly cursor: string | null;
    readonly limit: number;
    readonly observedAt: string;
  },
  overrides: Partial<TeamAgentChannelApplicationServices> = {},
) {
  const services = {
    ...teamAgentChannelApplicationServices,
    ...overrides,
  };
  const channel = await services.getClaimedChannelReplyChannel(input.db, {
    organizationId: input.organizationId,
    jobId: input.jobId,
    deviceId: input.deviceId,
    observedAt: input.observedAt,
  });
  if (!channel) {
    return applicationError(
      "claim_not_active",
      "이 실행 세션이 진행 중인 채널 답변 작업이 아닙니다. 자격 증명 문제가 " +
        "아니라 해당 답변 작업이 이미 끝났거나, 취소되었거나, 다른 기기가 " +
        "맡고 있습니다.",
    );
  }

  if (
    input.parentMessageId &&
    !(await services.isChannelRootMessage(
      input.db,
      channel.id,
      input.parentMessageId,
    ))
  ) {
    return applicationError(
      "thread_parent_not_found",
      "이 채널에서 해당 스레드 최상위 메시지를 찾을 수 없습니다.",
    );
  }

  // An Agent reads the conversation as it works, so it still sees the answers
  // an older round trip copied back, which the person's own view leaves out.
  const page = await services.listChannelMessagePage(input.db, {
    channelId: channel.id,
    parentMessageId: input.parentMessageId,
    cursor: input.cursor,
    limit: input.limit,
    includeRepliesInTimeline: channel.kind === "dm",
    includeAgentAnswerCopies: true,
  });
  if (!page) {
    return applicationError(
      "cursor_invalid",
      "커서가 이 메시지 목록에 속하지 않습니다.",
    );
  }
  return { channel: channelJson(channel), ...page };
}
