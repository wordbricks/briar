import { agentProviderLabels } from "../../src/lib/agent-provider";
import { channelReplyAssignedWorkerUnavailableError } from "../../src/lib/channels-contract";
import type { BriarAuth } from "./auth";
import {
  codexPetSpriteSheetObjectKey,
  fetchCodexPet,
} from "./codex-pets";
import { corsHeaders, HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { projectAgentJson } from "./project-agent-json";
import type { ProjectAgentRow } from "./project-agent-model";
import {
  createProjectAgent,
  deleteProjectAgent,
  getProjectAgent,
  updateProjectAgent,
} from "./project-agent-repository";
import { getProject } from "./project-command-repository";
import { decodeProjectAgentInput } from "./project-request-contract";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import { getProjectDesignatedWorker } from "./workers";

export type ProjectAgentRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
};

async function resolveDesignatedWorker(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    workerId: string | null;
    provider: ProjectAgentRow["provider"];
    model: string | null;
    effort: ProjectAgentRow["effort"];
  },
) {
  if (!input.workerId) return null;
  const worker = await getProjectDesignatedWorker(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    workerId: input.workerId,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    observedAt: new Date().toISOString(),
  });
  if (!worker) {
    throw new HttpError(
      400,
      "Designated Worker must belong to the same organization and project",
    );
  }
  if (worker.availability !== "available") {
    throw new HttpError(
      409,
      channelReplyAssignedWorkerUnavailableError(worker.label),
    );
  }
  return worker;
}

export async function handleProjectAgentRoute(
  routeInput: ProjectAgentRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket } = routeInput;
  const { pathname } = url;

  const projectAgentsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents$/u,
  );
  if (projectAgentsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeProjectAgentInput(await readJson(request));
    if (input.codexPet !== undefined) {
      throw new HttpError(
        400,
        "Create the agent before selecting a Codex Pet avatar",
      );
    }
    const providerName = agentProviderLabels[input.provider];
    const designatedWorker = await resolveDesignatedWorker(db, {
      organizationId: project.organization_id,
      projectId: project.id,
      workerId: input.designatedWorkerId ?? null,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
    });
    const agent = await createProjectAgent(db, project.id, {
      name: input.name ?? `${providerName} Agent`,
      avatar: input.avatar ?? null,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
      designatedWorkerId: designatedWorker?.id ?? null,
      designatedWorkerLabel: designatedWorker?.label ?? null,
      description: input.description ?? "",
      responsibility: input.responsibility,
      skills: input.skills ?? [],
      calendarColor: input.calendarColor,
    });
    return json({ agent: projectAgentJson(agent) }, 201);
  }

  const projectAgentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (projectAgentMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectAgentMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeProjectAgentInput(await readJson(request));
    const existing = await getProjectAgent(
      db,
      project.id,
      projectAgentMatch[2],
    );
    if (!existing) throw new HttpError(404, "Agent not found");
    const designatedWorker = await resolveDesignatedWorker(db, {
      organizationId: project.organization_id,
      projectId: project.id,
      workerId: input.designatedWorkerId === undefined
        ? existing.designated_worker_id
        : input.designatedWorkerId,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
    });
    let nextCodexPet:
      | {
          json: string;
          objectKey: string;
        }
      | null
      | undefined;
    if (input.codexPet === null) {
      nextCodexPet = null;
    } else if (input.codexPet) {
      let fetched;
      try {
        fetched = await fetchCodexPet(input.codexPet.slug);
      } catch {
        throw new HttpError(
          502,
          "Could not download the Codex Pet sprite sheet",
        );
      }
      const objectKey = codexPetSpriteSheetObjectKey(
        project.id,
        existing.id,
        fetched.metadata.slug,
      );
      await attachmentsBucket.put(objectKey, fetched.spriteSheet, {
        customMetadata: {
          author: fetched.metadata.author,
          license: fetched.metadata.license,
          slug: fetched.metadata.slug,
          source: "https://codexpet.top",
          spriteVersion: String(fetched.metadata.spriteVersion),
        },
        httpMetadata: {
          contentType: "image/webp",
        },
      });
      nextCodexPet = {
        json: JSON.stringify(fetched.metadata),
        objectKey,
      };
    }
    const providerName = agentProviderLabels[input.provider];
    let agent: ProjectAgentRow | null;
    try {
      agent = await updateProjectAgent(
        db,
        project.id,
        projectAgentMatch[2],
        {
          name: input.name ?? `${providerName} Agent`,
          avatar: input.avatar,
          codexPet: nextCodexPet,
          provider: input.provider,
          model: input.model ?? null,
          effort: input.effort ?? null,
          designatedWorkerId: designatedWorker?.id ?? null,
          designatedWorkerLabel: designatedWorker?.label ?? null,
          description: input.description ?? existing.description,
          responsibility: input.responsibility,
          skills: input.skills,
          calendarColor: input.calendarColor,
        },
      );
    } catch (error) {
      if (nextCodexPet?.objectKey) {
        await attachmentsBucket
          .delete(nextCodexPet.objectKey)
          .catch(() => undefined);
      }
      throw error;
    }
    if (!agent) {
      if (nextCodexPet?.objectKey) {
        await attachmentsBucket.delete(nextCodexPet.objectKey);
      }
      throw new HttpError(404, "Agent not found");
    }
    if (
      input.codexPet !== undefined &&
      existing.avatar_spritesheet_object_key &&
      existing.avatar_spritesheet_object_key !==
        agent.avatar_spritesheet_object_key
    ) {
      await attachmentsBucket
        .delete(existing.avatar_spritesheet_object_key)
        .catch(() => undefined);
    }
    return json({ agent: projectAgentJson(agent) });
  }
  if (projectAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectAgentMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const agent = await deleteProjectAgent(
      db,
      project.id,
      projectAgentMatch[2],
    );
    if (!agent) throw new HttpError(404, "Agent not found");
    if (agent === "running") {
      throw new HttpError(409, "An agent schedule run is currently active");
    }
    if (agent.avatar_spritesheet_object_key) {
      await attachmentsBucket
        .delete(agent.avatar_spritesheet_object_key)
        .catch(() => undefined);
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const projectAgentSpriteSheetMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)\/spritesheet$/u,
  );
  if (projectAgentSpriteSheetMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSpriteSheetMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const agent = await getProjectAgent(
      db,
      project.id,
      projectAgentSpriteSheetMatch[2],
    );
    if (!agent?.avatar_spritesheet_object_key) {
      throw new HttpError(404, "Agent sprite sheet not found");
    }
    const object = await attachmentsBucket.get(
      agent.avatar_spritesheet_object_key,
    );
    if (!object) throw new HttpError(404, "Agent sprite sheet not found");
    const headers = new Headers(corsHeaders);
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("Content-Length", String(object.size));
    headers.set("Content-Type", "image/webp");
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  }
}
