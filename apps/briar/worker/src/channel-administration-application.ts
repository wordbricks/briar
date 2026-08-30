import type {
  ChannelVisibility,
} from "../../src/lib/channels-contract";
import { channelSlugFromName } from "../../src/lib/channels-contract";
import { hydrateAgentSkills } from "./agent-skills";
import {
  requireChannelDeletionAccess,
  requireChannelWriteAccess,
} from "./channel-route-access";
import {
  addChannelAgent,
  addChannelMember,
  createChannel,
  deleteChannel,
  listChannelAgents,
  listChannelMembers,
  removeChannelAgent,
  removeChannelMember,
  updateChannel,
} from "./channels";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationAgent,
} from "./organization-agents";
import {
  getOrganizationRole,
} from "./organization-repository";
import { getProject } from "./project-command-repository";

type ChannelApplicationInput = {
  readonly db: D1Database;
  readonly organizationId: string;
  readonly userId: string;
};

export type CreateChannelCommand = {
  readonly name: string;
  readonly slug?: string;
  readonly topic: string | null;
  readonly visibility: ChannelVisibility;
  readonly defaultProjectId: string | null;
};

export type UpdateChannelCommand = {
  readonly name?: string;
  readonly topic?: string | null;
  readonly visibility?: ChannelVisibility;
  readonly defaultProjectId?: string | null;
  readonly archived?: boolean;
};

export type ChannelAgentMembershipChange =
  | { readonly case: "add" }
  | { readonly case: "remove" };

export type ChannelMemberMembershipChange =
  | { readonly case: "add" }
  | { readonly case: "remove" };

export async function createChannelApplication(
  input: ChannelApplicationInput & { readonly command: CreateChannelCommand },
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  if (!hasOrganizationCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }

  const channelId = crypto.randomUUID();
  const slug = input.command.slug ?? channelSlugFromName(
    input.command.name,
    channelId,
  );
  if (input.command.defaultProjectId) {
    const project = await getProject(
      input.db,
      input.command.defaultProjectId,
      input.userId,
    );
    if (!project) throw new HttpError(404, "Project not found");
  }

  let channel;
  try {
    channel = await createChannel(input.db, {
      id: channelId,
      organizationId: input.organizationId,
      slug,
      name: input.command.name,
      topic: input.command.topic,
      visibility: input.command.visibility,
      defaultProjectId: input.command.defaultProjectId,
      createdByUserId: input.userId,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique")) {
      throw new HttpError(409, "Channel slug already exists");
    }
    throw error;
  }
  if (!channel) throw new HttpError(500, "Channel was not created");
  return channel;
}

export async function updateChannelApplication(
  input: ChannelApplicationInput & {
    readonly channelId: string;
    readonly command: UpdateChannelCommand;
  },
) {
  const currentChannel = await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (
    currentChannel.kind === "dm" &&
    (input.command.visibility === "public" || input.command.defaultProjectId)
  ) {
    throw new HttpError(
      400,
      "Direct messages must remain private and organization-scoped",
    );
  }
  if (input.command.defaultProjectId) {
    const project = await getProject(
      input.db,
      input.command.defaultProjectId,
      input.userId,
    );
    if (!project) throw new HttpError(404, "Project not found");
  }
  const channel = await updateChannel(input.db, {
    organizationId: input.organizationId,
    channelId: input.channelId,
    userId: input.userId,
    ...input.command,
    updatedAt: new Date().toISOString(),
  });
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

export async function deleteChannelApplication(
  input: ChannelApplicationInput & { readonly channelId: string },
) {
  await requireChannelDeletionAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const observedAt = new Date().toISOString();
  const deleted = await deleteChannel(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
    observedAt,
  );
  if (!deleted) throw new HttpError(404, "Channel not found");
  return { channelId: input.channelId, observedAt };
}

export async function setChannelMemberApplication(
  input: ChannelApplicationInput & {
    readonly channelId: string;
    readonly targetUserId: string;
    readonly change: ChannelMemberMembershipChange;
  },
) {
  const channel = await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (input.change.case === "add") {
    const targetRole = await getOrganizationRole(
      input.db,
      input.organizationId,
      input.targetUserId,
    );
    if (!targetRole) throw new HttpError(404, "Organization member not found");
    await addChannelMember(input.db, {
      channelId: channel.id,
      userId: input.targetUserId,
      role: "member",
      createdAt: new Date().toISOString(),
    });
  } else {
    await removeChannelMember(input.db, channel.id, input.targetUserId);
  }
  return listChannelMembers(input.db, channel.id);
}

export async function setChannelAgentApplication(
  input: ChannelApplicationInput & {
    readonly channelId: string;
    readonly agentId: string;
    readonly change: ChannelAgentMembershipChange;
  },
) {
  const channel = await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (input.change.case === "add") {
    const agent = await getOrganizationAgent(
      input.db,
      input.organizationId,
      input.agentId,
    );
    if (!agent) throw new HttpError(404, "Agent not found");
    // Adding a project Agent exposes that project's context to the channel, so
    // the member doing it must be able to reach the project themselves.
    if (agent.project_id) {
      const project = await getProject(input.db, agent.project_id, input.userId);
      if (!project) throw new HttpError(403, "Project access required");
    }
    await addChannelAgent(input.db, {
      channelId: channel.id,
      agentId: agent.id,
      addedByUserId: input.userId,
      createdAt: new Date().toISOString(),
    });
  } else {
    await removeChannelAgent(input.db, channel.id, input.agentId);
  }
  const agents = await hydrateAgentSkills(
    input.db,
    await listChannelAgents(input.db, channel.id),
  );
  return agents;
}
