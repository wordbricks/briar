import { agentProviderLabels } from "../../src/lib/agent-provider";
import { channelReplyAssignedWorkerUnavailableError } from "../../src/lib/channels-contract";
import { codexPetSpriteSheetObjectKey, fetchCodexPet } from "./codex-pets";
import type { ProjectAgentRow } from "./project-agent-model";
import {
  createProjectAgent,
  deleteProjectAgent,
  getProjectAgent,
  updateProjectAgent,
} from "./project-agent-repository";
import { decodeProjectAgentInput } from "./project-request-contract";
import { getProjectDesignatedWorker } from "./workers";

type ProjectAgentWrite = ReturnType<typeof decodeProjectAgentInput>;

type ProjectAccess = {
  readonly id: string;
  readonly organization_id: string;
};

export type ProjectAgentApplicationErrorReason =
  | "agent_not_found"
  | "agent_run_active"
  | "codex_pet_download_failed"
  | "designated_worker_invalid"
  | "designated_worker_unavailable";

export class ProjectAgentApplicationError extends Error {
  readonly name = "ProjectAgentApplicationError";

  constructor(
    readonly reason: ProjectAgentApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type ProjectAgentApplicationServices = {
  readonly createAgent: typeof createProjectAgent;
  readonly deleteAgent: typeof deleteProjectAgent;
  readonly fetchCodexPet: typeof fetchCodexPet;
  readonly getAgent: typeof getProjectAgent;
  readonly getDesignatedWorker: typeof getProjectDesignatedWorker;
  readonly updateAgent: typeof updateProjectAgent;
};

const projectAgentApplicationServices: ProjectAgentApplicationServices = {
  createAgent: createProjectAgent,
  deleteAgent: deleteProjectAgent,
  fetchCodexPet,
  getAgent: getProjectAgent,
  getDesignatedWorker: getProjectDesignatedWorker,
  updateAgent: updateProjectAgent,
};

async function resolveDesignatedWorker(
  db: D1Database,
  input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly workerId: string | null;
    readonly provider: ProjectAgentRow["provider"];
    readonly model: string | null;
    readonly effort: ProjectAgentRow["effort"];
  },
  services: ProjectAgentApplicationServices,
) {
  if (!input.workerId) return null;
  const worker = await services.getDesignatedWorker(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    workerId: input.workerId,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    observedAt: new Date().toISOString(),
  });
  if (!worker) {
    throw new ProjectAgentApplicationError(
      "designated_worker_invalid",
      "Designated Worker must belong to the same organization and project",
    );
  }
  if (worker.availability !== "available") {
    throw new ProjectAgentApplicationError(
      "designated_worker_unavailable",
      channelReplyAssignedWorkerUnavailableError(worker.label),
    );
  }
  return worker;
}

export async function createProjectAgentApplication(
  input: {
    readonly db: D1Database;
    readonly project: ProjectAccess;
    readonly write: ProjectAgentWrite;
  },
  services: ProjectAgentApplicationServices = projectAgentApplicationServices,
) {
  const { db, project, write } = input;
  const designatedWorker = await resolveDesignatedWorker(
    db,
    {
      organizationId: project.organization_id,
      projectId: project.id,
      workerId: write.designatedWorkerId ?? null,
      provider: write.provider,
      model: write.model ?? null,
      effort: write.effort ?? null,
    },
    services,
  );
  return services.createAgent(db, project.id, {
    name: write.name ?? `${agentProviderLabels[write.provider]} Agent`,
    avatar: write.avatar ?? null,
    provider: write.provider,
    model: write.model ?? null,
    effort: write.effort ?? null,
    designatedWorkerId: designatedWorker?.id ?? null,
    designatedWorkerLabel: designatedWorker?.label ?? null,
    description: write.description ?? "",
    responsibility: write.responsibility,
    skills: write.skills ?? [],
    calendarColor: write.calendarColor,
  });
}

export async function updateProjectAgentApplication(
  input: {
    readonly db: D1Database;
    readonly attachmentsBucket: R2Bucket;
    readonly project: ProjectAccess;
    readonly agentId: string;
    readonly write: ProjectAgentWrite;
  },
  services: ProjectAgentApplicationServices = projectAgentApplicationServices,
) {
  const { db, attachmentsBucket, project, agentId, write } = input;
  const existing = await services.getAgent(db, project.id, agentId);
  if (!existing) {
    throw new ProjectAgentApplicationError("agent_not_found", "Agent not found");
  }
  const nextEffort = write.effort === undefined ? existing.effort : write.effort;
  const designatedWorker = await resolveDesignatedWorker(
    db,
    {
      organizationId: project.organization_id,
      projectId: project.id,
      workerId:
        write.designatedWorkerId === undefined
          ? existing.designated_worker_id
          : write.designatedWorkerId,
      provider: write.provider,
      model: write.model ?? null,
      effort: nextEffort,
    },
    services,
  );
  let nextCodexPet: { readonly json: string; readonly objectKey: string } | null | undefined;
  if (write.codexPet === null) {
    nextCodexPet = null;
  } else if (write.codexPet) {
    let fetched: Awaited<ReturnType<typeof fetchCodexPet>>;
    try {
      fetched = await services.fetchCodexPet(write.codexPet.slug);
    } catch {
      throw new ProjectAgentApplicationError(
        "codex_pet_download_failed",
        "Could not download the Codex Pet sprite sheet",
      );
    }
    const objectKey = codexPetSpriteSheetObjectKey(project.id, existing.id, fetched.metadata.slug);
    await attachmentsBucket.put(objectKey, fetched.spriteSheet, {
      customMetadata: {
        author: fetched.metadata.author,
        license: fetched.metadata.license,
        slug: fetched.metadata.slug,
        source: "https://codexpet.top",
        spriteVersion: String(fetched.metadata.spriteVersion),
      },
      httpMetadata: { contentType: "image/webp" },
    });
    nextCodexPet = {
      json: JSON.stringify(fetched.metadata),
      objectKey,
    };
  }

  let agent: ProjectAgentRow | null;
  try {
    agent = await services.updateAgent(db, project.id, agentId, {
      name: write.name ?? `${agentProviderLabels[write.provider]} Agent`,
      avatar: write.avatar,
      codexPet: nextCodexPet,
      provider: write.provider,
      model: write.model ?? null,
      effort: nextEffort,
      designatedWorkerId: designatedWorker?.id ?? null,
      designatedWorkerLabel: designatedWorker?.label ?? null,
      description: write.description ?? existing.description,
      responsibility: write.responsibility,
      skills: write.skills ?? [],
      calendarColor: write.calendarColor,
    });
  } catch (error) {
    if (nextCodexPet?.objectKey) {
      await attachmentsBucket.delete(nextCodexPet.objectKey).catch(() => undefined);
    }
    throw error;
  }
  if (!agent) {
    if (nextCodexPet?.objectKey) {
      await attachmentsBucket.delete(nextCodexPet.objectKey).catch(() => undefined);
    }
    throw new ProjectAgentApplicationError("agent_not_found", "Agent not found");
  }
  if (
    write.codexPet !== undefined &&
    existing.avatar_spritesheet_object_key &&
    existing.avatar_spritesheet_object_key !== agent.avatar_spritesheet_object_key
  ) {
    await attachmentsBucket.delete(existing.avatar_spritesheet_object_key).catch(() => undefined);
  }
  return agent;
}

export async function deleteProjectAgentApplication(
  input: {
    readonly db: D1Database;
    readonly attachmentsBucket: R2Bucket;
    readonly projectId: string;
    readonly agentId: string;
  },
  services: ProjectAgentApplicationServices = projectAgentApplicationServices,
) {
  const agent = await services.deleteAgent(input.db, input.projectId, input.agentId);
  if (!agent) {
    throw new ProjectAgentApplicationError("agent_not_found", "Agent not found");
  }
  if (agent === "running") {
    throw new ProjectAgentApplicationError(
      "agent_run_active",
      "An agent schedule run is currently active",
    );
  }
  if (agent.avatar_spritesheet_object_key) {
    await input.attachmentsBucket
      .delete(agent.avatar_spritesheet_object_key)
      .catch(() => undefined);
  }
  return agent;
}
