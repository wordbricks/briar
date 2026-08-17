import { describe, expect, it } from "vitest";
import {
  organizationAgentContextAgentsPageSchema,
  organizationAgentContextCapability,
  organizationAgentContextDescriptorSchema,
  organizationAgentContextProjectsPageSchema,
  organizationAgentContextQuerySchema,
  organizationAgentContextSessionsPageSchema,
} from "./organization-agent-context-contract";

const snapshotAt = "2026-08-11T00:00:00.000Z";

describe("organization Agent context contract", () => {
  it("parses the fixed protocol descriptor", () => {
    expect(organizationAgentContextCapability).toEqual({ protocol: 1 });
    expect(
      organizationAgentContextDescriptorSchema.parse({
        schemaVersion: 1,
        snapshotAt,
      }),
    ).toEqual({
      schemaVersion: 1,
      snapshotAt,
    });

    expect(() =>
      organizationAgentContextDescriptorSchema.parse({
        schemaVersion: 2,
        snapshotAt,
      }),
    ).toThrow();
  });

  it("normalizes a bounded query limit", () => {
    expect(
      organizationAgentContextQuerySchema.parse({ workerId: "worker-1" }),
    ).toEqual({ workerId: "worker-1", limit: 25 });
    expect(
      organizationAgentContextQuerySchema.parse({
        workerId: "worker-1",
        limit: "50",
        cursor: "opaque-cursor",
      }),
    ).toEqual({
      workerId: "worker-1",
      limit: 50,
      cursor: "opaque-cursor",
    });
    expect(() =>
      organizationAgentContextQuerySchema.parse({
        workerId: "worker-1",
        limit: "51",
      }),
    ).toThrow();
    expect(() =>
      organizationAgentContextQuerySchema.parse({
        workerId: "worker-1",
        limit: "1.5",
      }),
    ).toThrow();
  });

  it("requires pagination completion and cursor state to agree", () => {
    expect(
      organizationAgentContextProjectsPageSchema.parse({
        schemaVersion: 1,
        resource: "projects",
        organizationId: "organization-1",
        workId: "work-1",
        projectId: null,
        snapshotAt,
        total: 0,
        items: [],
        nextCursor: null,
        complete: true,
      }),
    ).toMatchObject({ resource: "projects", complete: true });

    expect(() =>
      organizationAgentContextProjectsPageSchema.parse({
        schemaVersion: 1,
        resource: "projects",
        organizationId: "organization-1",
        workId: "work-1",
        projectId: null,
        snapshotAt,
        total: 0,
        items: [],
        nextCursor: null,
        complete: false,
      }),
    ).toThrow(/complete must be true/u);
  });

  it("keeps session payloads explicit while rejecting envelope extras", () => {
    const page = {
      schemaVersion: 1,
      resource: "agent-sessions",
      organizationId: "organization-1",
      workId: "work-1",
      projectId: "project-1",
      snapshotAt,
      total: 1,
      items: [{
        id: "session-1",
        projectId: "project-1",
        agentId: null,
        status: "completed",
        sessionType: "task",
        payload: { summary: "Done" },
        startedAt: snapshotAt,
        completedAt: snapshotAt,
        updatedAt: snapshotAt,
      }],
      nextCursor: null,
      complete: true,
    } as const;

    expect(
      organizationAgentContextSessionsPageSchema.parse(page),
    ).toMatchObject({ total: 1 });
    expect(() =>
      organizationAgentContextSessionsPageSchema.parse({
        ...page,
        claimToken: "must-not-leak",
      }),
    ).toThrow();
    expect(() =>
      organizationAgentContextSessionsPageSchema.parse({
        ...page,
        items: [{
          ...page.items[0],
          payload: { summary: "Done", secretToken: "must-not-leak" },
        }],
      }),
    ).toThrow();
    expect(() =>
      organizationAgentContextSessionsPageSchema.parse({
        ...page,
        items: [{ ...page.items[0], projectId: "project-2" }],
      }),
    ).toThrow(/item projectId must match/u);
  });

  it("keeps Project Agents in their own project-scoped collection", () => {
    expect(
      organizationAgentContextAgentsPageSchema.parse({
        schemaVersion: 1,
        resource: "agents",
        organizationId: "organization-1",
        workId: "work-1",
        projectId: "project-1",
        snapshotAt,
        total: 1,
        items: [{
          id: "agent-1",
          name: "Builder",
          description: "Builds and maintains this project.",
          provider: "codex",
          model: null,
          effort: null,
          responsibility: "Own this project.",
          skills: [],
          createdAt: snapshotAt,
          updatedAt: snapshotAt,
        }],
        nextCursor: null,
        complete: true,
      }),
    ).toMatchObject({ resource: "agents", projectId: "project-1" });
  });
});
