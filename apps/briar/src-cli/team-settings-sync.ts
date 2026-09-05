import { DashboardService } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { isRepositoryWorkflowPending } from "../src/lib/auto-hunt-contract";
import { teamSettingsFromProto } from "../src/lib/app-rpc/team-configuration-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import type { ProjectSettings } from "../src/types";
import {
  type Config,
  type TeamConfig,
} from "./config-contract";
import { createAuthenticatedConnectClient } from "./connect-client";

export type RemoteTeamSettings = Omit<ProjectSettings, "githubRepositoryId"> & {
  readonly githubRepositoryId?: number | null;
};

export type FetchRemoteTeamSettings = (
  apiUrl: string,
  projectId: string,
  userToken: string,
) => Promise<RemoteTeamSettings>;

export const fetchRemoteTeamSettings: FetchRemoteTeamSettings = async (
  apiUrl,
  projectId,
  userToken,
) => {
  const response = await createAuthenticatedConnectClient(
    DashboardService,
    apiUrl,
    userToken,
  ).getDashboard({ teamId: projectId });
  return teamSettingsFromProto(
    requiredMessage(response.settings, "dashboard.settings"),
  );
};

export function projectWithRemoteSettings(
  project: TeamConfig,
  settings: RemoteTeamSettings,
): TeamConfig {
  return {
    ...project,
    autoHunt: {
      ...project.autoHunt,
      velenOrg: settings.velenOrg ?? undefined,
      dataSource: settings.dataSource ?? undefined,
      linear: {
        enabled: settings.linear.enabled,
        source: settings.linear.source ?? undefined,
        teamKey: settings.linear.teamKey ?? undefined,
      },
      githubRepository: settings.githubRepository ?? undefined,
      githubRepositoryId: settings.githubRepositoryId ?? undefined,
      workflow: settings.workflow,
    },
  };
}

export function configWithRemoteTeamSettings(
  config: Config,
  projectId: string,
  settings: RemoteTeamSettings,
): Config {
  return {
    ...config,
    teams: config.teams.map((project) =>
      project.id === projectId
        ? projectWithRemoteSettings(project, settings)
        : project
    ),
  };
}

export const remoteWorkflowState = (settings: RemoteTeamSettings) =>
  isRepositoryWorkflowPending(settings.workflow)
    ? "generation_pending" as const
    : "ready" as const;
