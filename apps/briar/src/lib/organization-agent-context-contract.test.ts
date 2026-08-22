import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  decodeOrganizationAgentContextAgentsPage,
  decodeOrganizationAgentContextDescriptor,
  decodeOrganizationAgentContextLookupRequest,
  decodeOrganizationAgentContextLookupResult,
  decodeOrganizationAgentContextProjectsPage,
  decodeOrganizationAgentContextQuery,
  decodeOrganizationAgentContextSessionsPage,
  organizationAgentContextCapability,
  OrganizationAgentContextDescriptor,
} from "./organization-agent-context-contract";

const snapshotAt = "2026-08-11T00:00:00.000Z";

describe("organization Agent context contract", () => {
  it("parses the fixed protocol descriptor", () => {
    expect(organizationAgentContextCapability).toEqual({ protocol: 1 });
    expect(
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt,
      }),
    ).toEqual({
      schemaVersion: 1,
      snapshotAt,
    });

    expect(() =>
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 2,
        snapshotAt,
      }),
    ).toThrow();
    expect(
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt: "2026-08-11T09:00:00.000+09:00",
      }).snapshotAt,
    ).toBe("2026-08-11T09:00:00.000+09:00");
    expect(() =>
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt: "2026-08-11T00:00:00",
      }),
    ).toThrow();

    const decodeCanonical = Schema.decodeUnknownSync(
      OrganizationAgentContextDescriptor,
    );
    expect(() =>
      decodeCanonical({
        schemaVersion: 1,
        snapshotAt,
        claimToken: "must-not-leak",
      }),
    ).toThrow();
  });

  it("normalizes a bounded query limit", () => {
    expect(
      decodeOrganizationAgentContextQuery({ workerId: "worker-1" }),
    ).toEqual({ workerId: "worker-1", limit: 25 });
    expect(
      decodeOrganizationAgentContextQuery({
        workerId: "  worker-1  ",
        limit: null,
      }),
    ).toEqual({ workerId: "worker-1", limit: 25 });
    expect(
      decodeOrganizationAgentContextQuery({
        workerId: "worker-1",
        limit: undefined,
      }),
    ).toEqual({ workerId: "worker-1", limit: 25 });
    expect(
      decodeOrganizationAgentContextQuery({
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
      decodeOrganizationAgentContextQuery({
        workerId: "worker-1",
        limit: "51",
      }),
    ).toThrow();
    expect(() =>
      decodeOrganizationAgentContextQuery({
        workerId: "worker-1",
        limit: "1.5",
      }),
    ).toThrow();
    expect(() =>
      decodeOrganizationAgentContextQuery({
        workerId: "worker-1",
        limit: " ",
      }),
    ).toThrow();
  });

  it("applies lookup defaults while preserving unknown payload compatibility", () => {
    const request = decodeOrganizationAgentContextLookupRequest({
      resource: "issues",
      projectId: "project-1",
      detail: "summary",
    });
    expect(request).toEqual({
      resource: "issues",
      projectId: "project-1",
      detail: "summary",
      limit: 25,
      cursor: null,
    });
    expect(
      decodeOrganizationAgentContextLookupResult({
        request: {
          resource: "project-settings",
          projectId: "project-1",
        },
      }),
    ).toEqual({
      request: {
        resource: "project-settings",
        projectId: "project-1",
      },
    });
  });

  it("requires pagination completion and cursor state to agree", () => {
    expect(
      decodeOrganizationAgentContextProjectsPage({
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
      decodeOrganizationAgentContextProjectsPage({
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
      decodeOrganizationAgentContextSessionsPage(page),
    ).toMatchObject({ total: 1 });
    expect(() =>
      decodeOrganizationAgentContextSessionsPage({
        ...page,
        claimToken: "must-not-leak",
      }),
    ).toThrow();
    expect(() =>
      decodeOrganizationAgentContextSessionsPage({
        ...page,
        items: [{
          ...page.items[0],
          payload: { summary: "Done", secretToken: "must-not-leak" },
        }],
      }),
    ).toThrow();
    expect(() =>
      decodeOrganizationAgentContextSessionsPage({
        ...page,
        items: [{ ...page.items[0], projectId: "project-2" }],
      }),
    ).toThrow(/item projectId must match/u);
  });

  it("keeps Project Agents in their own project-scoped collection", () => {
    expect(
      decodeOrganizationAgentContextAgentsPage({
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
