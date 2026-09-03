import { createTeamGithubCredentialApplication } from "./team-github-application";
import {
  bindManagedComputerSetup,
  managedComputerSetupContext,
} from "./managed-computer-service";
import type { AuthenticatedWorkerPrincipal } from "./worker-route-auth";
import type { WorkerRuntimeMetadata } from "./worker-runtime-mappers";

export async function getManagedComputerSetupContextApplication(input: {
  readonly db: D1Database;
  readonly env: Env;
  readonly principal: AuthenticatedWorkerPrincipal;
  readonly managedComputerId: string;
  readonly setupToken: string;
  readonly observedAt: string;
}) {
  const context = await managedComputerSetupContext(input.db, {
    managedComputerId: input.managedComputerId,
    organizationId: input.principal.organizationId,
    deviceId: input.principal.deviceId,
    setupToken: input.setupToken,
    observedAt: input.observedAt,
  });
  const repositoryCredential = context.settings.githubRepository
    ? await createTeamGithubCredentialApplication({
        db: input.db,
        env: input.env,
        project: {
          id: context.project.id,
          organization_id: input.principal.organizationId,
        },
      })
    : undefined;
  return { ...context, repositoryCredential };
}

export async function bindManagedComputerSetupApplication(input: {
  readonly db: D1Database;
  readonly principal: AuthenticatedWorkerPrincipal;
  readonly managedComputerId: string;
  readonly setupToken: string;
  readonly runtime: WorkerRuntimeMetadata;
  readonly observedAt: string;
}) {
  return bindManagedComputerSetup(input.db, {
    managedComputerId: input.managedComputerId,
    organizationId: input.principal.organizationId,
    deviceId: input.principal.deviceId,
    setupToken: input.setupToken,
    worker: input.runtime,
    observedAt: input.observedAt,
  });
}
