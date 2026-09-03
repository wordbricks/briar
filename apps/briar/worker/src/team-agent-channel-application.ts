import {
  channelJson,
  getProjectAgentChannel,
  getProjectOrganizationChannel,
  isChannelRootMessage,
  listChannelMessagePage,
} from "./channels";

export type TeamAgentChannelApplicationErrorReason =
  | "channel_not_found"
  | "channel_forbidden"
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
  readonly getProjectAgentChannel: typeof getProjectAgentChannel;
  readonly getProjectOrganizationChannel: typeof getProjectOrganizationChannel;
  readonly isChannelRootMessage: typeof isChannelRootMessage;
  readonly listChannelMessagePage: typeof listChannelMessagePage;
};

const teamAgentChannelApplicationServices:
  TeamAgentChannelApplicationServices = {
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

  const page = await services.listChannelMessagePage(input.db, {
    channelId: channel.id,
    parentMessageId: input.parentMessageId,
    cursor: input.cursor,
    limit: input.limit,
    includeRepliesInTimeline: channel.kind === "dm",
  });
  if (!page) {
    return applicationError(
      "cursor_invalid",
      "Cursor does not belong to this message view",
    );
  }
  return { channel: channelJson(channel), ...page };
}
