import * as Schema from "effect/Schema";
import { isRepositoryWorkflowPending } from "../src/lib/auto-hunt-contract";
import {
  type Config,
  type ProjectConfig,
  WorkflowConfig,
} from "./config-contract";
import { request } from "./command-support";

const nullableString = Schema.NullOr(Schema.String);

const ProjectSettingsResponse = Schema.Struct({
  settings: Schema.Struct({
    velenOrg: nullableString,
    dataSource: nullableString,
    linear: Schema.Struct({
      enabled: Schema.Boolean,
      source: nullableString,
      teamKey: nullableString,
    }),
    githubRepository: nullableString,
    githubRepositoryId: Schema.optional(Schema.NullOr(
      Schema.Int.check(Schema.isGreaterThan(0)),
    )),
    workflow: WorkflowConfig,
  }).annotate({ parseOptions: { onExcessProperty: "preserve" } }),
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const decodeProjectSettingsResponse = Schema.decodeUnknownSync(
  ProjectSettingsResponse,
  { errors: "all" },
);

export type RemoteProjectSettings =
  typeof ProjectSettingsResponse.Type["settings"];

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
  const response = await request<unknown>(
    apiUrl,
    `/projects/${projectId}/settings`,
    userToken,
  );
  return decodeProjectSettingsResponse(response).settings;
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
