import { DashboardService } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { isRepositoryWorkflowPending } from "../src/lib/auto-hunt-contract";
import { projectSettingsFromProto } from "../src/lib/app-rpc/project-configuration-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import type { ProjectSettings } from "../src/types";
import {
  type Config,
  type ProjectConfig,
} from "./config-contract";
import { createAuthenticatedConnectClient } from "./connect-client";

export type RemoteProjectSettings = Omit<ProjectSettings, "githubRepositoryId"> & {
  readonly githubRepositoryId?: number | null;
};

export type FetchRemoteProjectSettings = (
  apiUrl: string,
  projectId: string,
  userToken: string,
) => Promise<RemoteProjectSettings>;

export const fetchRemoteProjectSettings: FetchRemoteProjectSettings = async (
  apiUrl,
  projectId,
  userToken,
) => {
  const response = await createAuthenticatedConnectClient(
    DashboardService,
    apiUrl,
    userToken,
  ).getDashboard({ projectId });
  return projectSettingsFromProto(
    requiredMessage(response.settings, "dashboard.settings"),
  );
};

export function projectWithRemoteSettings(
  project: ProjectConfig,
  settings: RemoteProjectSettings,
): ProjectConfig {
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

export function configWithRemoteProjectSettings(
  config: Config,
  projectId: string,
  settings: RemoteProjectSettings,
): Config {
  return {
    ...config,
    projects: config.projects.map((project) =>
      project.id === projectId
        ? projectWithRemoteSettings(project, settings)
        : project
    ),
  };
}

export const remoteWorkflowState = (settings: RemoteProjectSettings) =>
  isRepositoryWorkflowPending(settings.workflow)
    ? "generation_pending" as const
    : "ready" as const;
