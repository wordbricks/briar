import {
  createChannelActivitySocketTicket,
  createIssueActivitySocketTicket,
} from "./channel-activity-ticket";
import { createChannelRealtimeTicket } from "./channel-realtime-ticket";
import { getChannel } from "./channels";
import { getHuntRunForProject } from "./hunt-run-repository";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { getTeam } from "./team-command-repository";

export type RealtimeTicketScope =
  | {
    readonly type: "organizationNotifications";
    readonly organizationId: string;
  }
  | {
    readonly type: "issueActivity";
    readonly projectId: string;
    readonly runId: string;
  }
  | {
    readonly type: "channelActivity";
    readonly organizationId: string;
    readonly channelId: string;
  };

export type IssuedRealtimeTicket = {
  readonly socketPath: string;
  readonly ticket: string;
};

export type RealtimeTicketApplicationErrorReason =
  | "organization_not_found"
  | "project_not_found"
  | "run_not_found"
  | "channel_not_found";

export class RealtimeTicketApplicationError extends Error {
  readonly name = "RealtimeTicketApplicationError";

  constructor(
    readonly reason: RealtimeTicketApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type RealtimeTicketApplicationServices = {
  readonly createChannelActivityTicket: typeof createChannelActivitySocketTicket;
  readonly createIssueActivityTicket: typeof createIssueActivitySocketTicket;
  readonly createOrganizationTicket: typeof createChannelRealtimeTicket;
  readonly getChannel: typeof getChannel;
  readonly getOrganizationRole: typeof getOrganizationRole;
  readonly getTeam: typeof getTeam;
  readonly getRun: typeof getHuntRunForProject;
};

const realtimeTicketApplicationServices: RealtimeTicketApplicationServices = {
  createChannelActivityTicket: createChannelActivitySocketTicket,
  createIssueActivityTicket: createIssueActivitySocketTicket,
  createOrganizationTicket: createChannelRealtimeTicket,
  getChannel,
  getOrganizationRole,
  getTeam,
  getRun: getHuntRunForProject,
};

const inaccessible = (
  reason: RealtimeTicketApplicationErrorReason,
  message: string,
): never => {
  throw new RealtimeTicketApplicationError(reason, message);
};

export async function createRealtimeTicketApplication(
  input: {
    readonly db: D1Database;
    readonly signingSecret: string;
    readonly userId: string;
    readonly scope: RealtimeTicketScope;
  },
  services: RealtimeTicketApplicationServices = realtimeTicketApplicationServices,
): Promise<IssuedRealtimeTicket> {
  const { db, scope, signingSecret, userId } = input;
  switch (scope.type) {
    case "organizationNotifications": {
      const role = await services.getOrganizationRole(
        db,
        scope.organizationId,
        userId,
      );
      if (!hasOrganizationCapability(role, "organization:read")) {
        return inaccessible("organization_not_found", "Organization not found");
      }
      const issued = await services.createOrganizationTicket(signingSecret, {
        organizationId: scope.organizationId,
        userId,
      });
      return {
        socketPath: `/organizations/${scope.organizationId}/channel-events`,
        ticket: issued.ticket,
      };
    }

    case "issueActivity": {
      const project = await services.getTeam(db, scope.projectId, userId);
      if (!project) return inaccessible("project_not_found", "Project not found");
      const run = await services.getRun(db, scope.projectId, scope.runId);
      if (!run) return inaccessible("run_not_found", "Run not found");
      const issued = await services.createIssueActivityTicket(signingSecret, {
        organizationId: project.organization_id,
        projectId: scope.projectId,
        runId: scope.runId,
        userId,
      });
      return {
        socketPath:
          `/projects/${scope.projectId}/runs/${scope.runId}/agent-activity-events`,
        ticket: issued.ticket,
      };
    }

    case "channelActivity": {
      const role = await services.getOrganizationRole(
        db,
        scope.organizationId,
        userId,
      );
      if (!hasOrganizationCapability(role, "organization:read")) {
        return inaccessible("organization_not_found", "Organization not found");
      }
      const channel = await services.getChannel(
        db,
        scope.organizationId,
        scope.channelId,
        userId,
      );
      if (!channel) return inaccessible("channel_not_found", "Channel not found");
      const issued = await services.createChannelActivityTicket(signingSecret, {
        organizationId: scope.organizationId,
        channelId: scope.channelId,
        userId,
      });
      return {
        socketPath:
          `/organizations/${scope.organizationId}/channels/${scope.channelId}/agent-activity-events`,
        ticket: issued.ticket,
      };
    }
  }
}
