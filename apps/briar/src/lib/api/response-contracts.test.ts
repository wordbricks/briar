import { describe, expect, it } from "vitest";
import { AutoHuntWorkflowValidationError } from "../auto-hunt-contract";
import { decodeInboxReadVersions } from "./inbox-contract";
import { decodeOrganizationResponse } from "./organization-contract";
import {
  decodeProjectAgentResponse,
  decodeProjectAgentScheduleRunResponse,
  decodeProjectAgentSessionResponse,
} from "./project-agent-contract";
import {
  decodeProjectResponse,
  decodeProjectsResponse,
} from "./project-contract";

const projectId = "22222222-2222-4222-8222-222222222222";
const agentId = "11111111-1111-4111-8111-111111111111";

describe("API response contracts", () => {
  it("uses the shared project defaults and strips response extensions", () => {
    const project = {
      id: projectId,
      name: "Briar",
      icon: null,
      organizationId: "33333333-3333-4333-8333-333333333333",
      organizationName: "Wordbricks",
      role: "owner",
      createdAt: "2026-08-20T00:00:00.000Z",
      futureField: true,
    } as const;

    expect(
      decodeProjectResponse(project),
    ).toEqual({
      id: projectId,
      name: "Briar",
      issueKeyPrefix: "AH",
      scheduleTabEnabled: true,
      icon: null,
      organizationId: "33333333-3333-4333-8333-333333333333",
      organizationName: "Wordbricks",
      role: "owner",
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    expect(
      decodeProjectsResponse({ projects: [project], futureEnvelopeField: true }),
    ).toEqual([decodeProjectResponse(project)]);
    expect(decodeProjectResponse({
      ...project,
      icon: "https://example.com/future-icon.png",
    }).icon).toBeNull();

    expect(() =>
      decodeProjectResponse({
        ...project,
        createdAt: "not-a-datetime",
      }),
    ).toThrow();
    const { icon: _icon, ...missingIcon } = project;
    expect(() => decodeProjectResponse(missingIcon)).toThrow();
  });

  it("keeps organization logo defaults and record key/value validation", () => {
    expect(
      decodeOrganizationResponse({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Wordbricks",
        handle: "wordbricks",
        role: "owner",
        createdAt: "2026-08-20T00:00:00.000Z",
        ignored: "server-extension",
      }),
    ).not.toHaveProperty("ignored");
    expect(decodeInboxReadVersions({ issue: "v2" })).toEqual({ issue: "v2" });
    expect(() => decodeInboxReadVersions({ "": "v2" })).toThrow();
    expect(() => decodeInboxReadVersions({ issue: "" })).toThrow();
  });

  it("creates fresh Agent defaults and strips legacy fields", () => {
    const input = {
      id: agentId,
      projectId,
      name: "Builder",
      provider: "codex",
      model: null,
      responsibility: "Build the project.",
      skill: "# Builder",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      kind: "legacy",
    } as const;
    const first = decodeProjectAgentResponse(input);
    const second = decodeProjectAgentResponse(input);

    expect(first).toMatchObject({
      avatar: null,
      codexPet: null,
      effort: null,
      description: "",
      skills: [],
    });
    expect(first).not.toHaveProperty("kind");
    first.skills.push({
      id: "skill-1",
      agentId,
      name: "Build",
      description: "Use for builds.",
      body: "Build.",
      provider: "codex",
      model: null,
      effort: null,
      kind: "custom",
      executionMode: "task",
      approvalPolicy: "explicit",
      position: 0,
      createdAt: "created",
      updatedAt: "updated",
    });
    expect(second.skills).toEqual([]);

    expect(decodeProjectAgentResponse({
      ...input,
      skills: [{
        id: "skill-legacy",
        agentId,
        name: "Legacy build",
        instructions: "Build with the legacy client.",
        provider: "codex",
        model: null,
        effort: null,
        kind: "custom",
        executionMode: "task",
        approvalPolicy: "explicit",
        position: 0,
        createdAt: "created",
        updatedAt: "updated",
      }],
    }).skills[0]).toMatchObject({
      description: "Build with the legacy client.",
      body: "Build with the legacy client.",
    });
  });

  it("keeps remote session defaults and empty local-only collections", () => {
    const input = {
      id: "session-1",
      projectId,
      dispatchGroupId: "session-1",
      agentId: null,
      sessionType: "task",
      trigger: null,
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: null,
      status: "completed",
      issues: [],
      startedAt: "started",
      completedAt: "completed",
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
      updatedAt: "updated",
    } as const;
    expect(decodeProjectAgentSessionResponse(input)).toMatchObject({
      followUps: [],
      archived: false,
      detailLoaded: true,
    });
    expect(() =>
      decodeProjectAgentSessionResponse({
        ...input,
        dispatchEvents: [{ type: "must-remain-local" }],
      }),
    ).toThrow();
  });

  it("normalizes schedule workflows and preserves normalization failures", () => {
    const run = {
      id: "44444444-4444-4444-8444-444444444444",
      projectId,
      scheduleId: "55555555-5555-4555-8555-555555555555",
      scheduleName: "Daily audit",
      agent: {
        id: agentId,
        name: "Builder",
        provider: "codex",
        model: null,
        responsibility: "Build the project.",
        skill: "# Builder",
      },
      workflow: {
        version: 2,
        stages: [{ id: "implementing", label: "Implement", required: true }],
        execution: { checkpoints: [] },
      },
      status: "running",
      scheduledFor: "scheduled",
      leaseExpiresAt: null,
      startedAt: "started",
      completedAt: null,
      resultSummary: null,
      structuredResult: null,
      error: null,
    } as const;

    expect(decodeProjectAgentScheduleRunResponse(run).workflow).toMatchObject({
      version: 2,
      requirements: [],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    expect(() =>
      decodeProjectAgentScheduleRunResponse({
        ...run,
        workflow: { version: 2, stages: [], execution: { checkpoints: [] } },
      }),
    ).toThrow(AutoHuntWorkflowValidationError);
  });
});
