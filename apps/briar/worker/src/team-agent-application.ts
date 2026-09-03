import { agentProviderLabels } from "../../src/lib/agent-provider";
import { channelReplyAssignedWorkerUnavailableError } from "../../src/lib/channels-contract";
import { codexPetSpriteSheetObjectKey, fetchCodexPet } from "./codex-pets";
import type { TeamAgentRow } from "./team-agent-model";
import {
  createTeamAgent,
  deleteTeamAgent,
  getTeamAgent,
  updateTeamAgent,
} from "./team-agent-repository";
import { decodeTeamAgentInput } from "./team-request-contract";
import { getProjectDesignatedWorker } from "./workers";

type TeamAgentWrite = ReturnType<typeof decodeTeamAgentInput>;

type TeamAccess = {
  readonly id: string;
  readonly organization_id: string;
};

export type TeamAgentApplicationErrorReason =
  | "agent_not_found"
  | "agent_run_active"
  | "codex_pet_download_failed"
  | "designated_worker_invalid"
  | "designated_worker_unavailable";

export class TeamAgentApplicationError extends Error {
  readonly name = "TeamAgentApplicationError";

  constructor(
    readonly reason: TeamAgentApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type TeamAgentApplicationServices = {
  readonly createAgent: typeof createTeamAgent;
  readonly deleteAgent: typeof deleteTeamAgent;
  readonly fetchCodexPet: typeof fetchCodexPet;
  readonly getAgent: typeof getTeamAgent;
  readonly getDesignatedWorker: typeof getProjectDesignatedWorker;
  readonly updateAgent: typeof updateTeamAgent;
};

const teamAgentApplicationServices: TeamAgentApplicationServices = {
  createAgent: createTeamAgent,
  deleteAgent: deleteTeamAgent,
  fetchCodexPet,
  getAgent: getTeamAgent,
  getDesignatedWorker: getProjectDesignatedWorker,
  updateAgent: updateTeamAgent,
};

async function resolveDesignatedWorker(
  db: D1Database,
  input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly workerId: string | null;
    readonly provider: TeamAgentRow["provider"];
    readonly model: string | null;
    readonly effort: TeamAgentRow["effort"];
    readonly computerUsePolicy: TeamAgentRow["computer_use_policy"];
  },
  services: TeamAgentApplicationServices,
) {
  if (!input.workerId) return null;
  const worker = await services.getDesignatedWorker(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    workerId: input.workerId,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    computerUsePolicy: input.computerUsePolicy,
    observedAt: new Date().toISOString(),
  });
  if (!worker) {
    throw new TeamAgentApplicationError(
      "designated_worker_invalid",
      "Designated Worker must belong to the same organization and project",
    );
  }
  if (worker.availability !== "available") {
    throw new TeamAgentApplicationError(
      "designated_worker_unavailable",
      channelReplyAssignedWorkerUnavailableError(worker.label),
    );
  }
  return worker;
}

export async function createTeamAgentApplication(
  input: {
    readonly db: D1Database;
    readonly project: TeamAccess;
    readonly write: TeamAgentWrite;
  },
  services: TeamAgentApplicationServices = teamAgentApplicationServices,
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
      computerUsePolicy: write.computerUsePolicy ?? "disabled",
    },
    services,
  );
  return services.createAgent(db, project.id, {
    name: write.name ?? `${agentProviderLabels[write.provider]} Agent`,
    avatar: write.avatar ?? null,
    provider: write.provider,
    model: write.model ?? null,
    effort: write.effort ?? null,
    computerUsePolicy: write.computerUsePolicy ?? "disabled",
    designatedWorkerId: designatedWorker?.id ?? null,
    designatedWorkerLabel: designatedWorker?.label ?? null,
    description: write.description ?? "",
    responsibility: write.responsibility,
    skills: write.skills ?? [],
    calendarColor: write.calendarColor,
  });
}

export async function updateTeamAgentApplication(
  input: {
    readonly db: D1Database;
    readonly attachmentsBucket: R2Bucket;
    readonly project: TeamAccess;
    readonly agentId: string;
    readonly write: TeamAgentWrite;
  },
  services: TeamAgentApplicationServices = teamAgentApplicationServices,
) {
  const { db, attachmentsBucket, project, agentId, write } = input;
  const existing = await services.getAgent(db, project.id, agentId);
  if (!existing) {
    throw new TeamAgentApplicationError("agent_not_found", "Agent not found");
  }
  const nextEffort = write.effort === undefined ? existing.effort : write.effort;
  const nextComputerUsePolicy = write.computerUsePolicy ??
    existing.computer_use_policy;
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
      computerUsePolicy: nextComputerUsePolicy,
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
      throw new TeamAgentApplicationError(
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

  let agent: TeamAgentRow | null;
  try {
    agent = await services.updateAgent(db, project.id, agentId, {
      name: write.name ?? `${agentProviderLabels[write.provider]} Agent`,
      avatar: write.avatar,
      codexPet: nextCodexPet,
      provider: write.provider,
      model: write.model ?? null,
      effort: nextEffort,
      computerUsePolicy: write.computerUsePolicy,
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
    throw new TeamAgentApplicationError("agent_not_found", "Agent not found");
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

export async function deleteTeamAgentApplication(
  input: {
    readonly db: D1Database;
    readonly attachmentsBucket: R2Bucket;
    readonly projectId: string;
    readonly agentId: string;
  },
  services: TeamAgentApplicationServices = teamAgentApplicationServices,
) {
  const agent = await services.deleteAgent(input.db, input.projectId, input.agentId);
  if (!agent) {
    throw new TeamAgentApplicationError("agent_not_found", "Agent not found");
  }
  if (agent === "running") {
    throw new TeamAgentApplicationError(
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
