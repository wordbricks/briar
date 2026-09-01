import { describe, expect, it, vi } from "vitest";
import {
  type ProjectAgentApplicationServices,
  updateProjectAgentApplication,
} from "./project-agent-application";
import type { ProjectAgentRow } from "./project-agent-model";
import { decodeProjectAgentInput } from "./project-request-contract";

const project = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
};

const existing: ProjectAgentRow & {
  skills: NonNullable<ProjectAgentRow["skills"]>;
} = {
  id: "33333333-3333-4333-8333-333333333333",
  organization_id: project.organization_id,
  project_id: project.id,
  name: "Builder",
  avatar: null,
  avatar_pet_json: JSON.stringify({ slug: "old-pet" }),
  avatar_spritesheet_object_key: "project-agent-spritesheets/old.webp",
  provider: "codex",
  model: null,
  effort: null,
  designated_worker_id: null,
  designated_worker_label: null,
  description: "Build carefully.",
  responsibility: "Build.",
  skill_markdown: "# Builder",
  calendar_color: "#3b82f6",
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
  skills: [],
};

const write = decodeProjectAgentInput({
  name: "Builder",
  codexPet: { slug: "new-pet" },
  provider: "codex",
  model: null,
  effort: null,
  designatedWorkerId: null,
  description: "Build carefully.",
  responsibility: "Build.",
  skills: [],
  calendarColor: "#3b82f6",
});

const setup = () => {
  const put = vi.fn(async (_key: string) => undefined);
  const remove = vi.fn(async (_key: string) => undefined);
  const updateAgent = vi.fn<ProjectAgentApplicationServices["updateAgent"]>();
  const services: ProjectAgentApplicationServices = {
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    fetchCodexPet: vi.fn(async () => ({
      metadata: {
        slug: "new-pet",
        name: "New Pet",
        author: "Briar",
        license: "MIT",
        spriteVersion: 2 as const,
      },
      spriteSheet: new ArrayBuffer(4),
      etag: null,
    })),
    getAgent: vi.fn(async () => existing),
    getDesignatedWorker: vi.fn(),
    updateAgent,
  };
  const attachmentsBucket = {
    put,
    delete: remove,
  } as unknown as R2Bucket;
  return { attachmentsBucket, put, remove, services, updateAgent };
};

describe("project Agent application", () => {
  it("removes a newly uploaded Codex Pet when persistence fails", async () => {
    const { attachmentsBucket, put, remove, services, updateAgent } = setup();
    updateAgent.mockRejectedValue(new Error("database unavailable"));

    await expect(
      updateProjectAgentApplication(
        {
          db: {} as D1Database,
          attachmentsBucket,
          project,
          agentId: existing.id,
          write,
        },
        services,
      ),
    ).rejects.toThrow("database unavailable");

    expect(put).toHaveBeenCalledOnce();
    const uploadedKey = put.mock.calls[0]?.[0];
    expect(uploadedKey).toMatch(
      /^project-agent-spritesheets\/22222222-2222-4222-8222-222222222222\/33333333-3333-4333-8333-333333333333\//u,
    );
    expect(remove).toHaveBeenCalledWith(uploadedKey);
    expect(remove).not.toHaveBeenCalledWith(existing.avatar_spritesheet_object_key);
  });

  it("removes the replaced Codex Pet only after persistence succeeds", async () => {
    const { attachmentsBucket, remove, services, updateAgent } = setup();
    updateAgent.mockImplementation(async (_db, _projectId, _agentId, input) => ({
      ...existing,
      avatar_pet_json: input.codexPet?.json ?? null,
      avatar_spritesheet_object_key: input.codexPet?.objectKey ?? null,
    }));

    const updated = await updateProjectAgentApplication(
      {
        db: {} as D1Database,
        attachmentsBucket,
        project,
        agentId: existing.id,
        write,
      },
      services,
    );

    expect(updated.avatar_spritesheet_object_key).not.toBe(existing.avatar_spritesheet_object_key);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(existing.avatar_spritesheet_object_key);
  });
});
