import { describe, expect, it } from "vitest";

import {
  AgentSkillConflictError,
  agentSkillConflictMessage,
  agentSkillJson,
  issueProcessingAgentSkillRow,
  listAgentSkills,
  normalizedAgentSkillRows,
  type AgentSkillRow,
} from "./agent-skills";
import {
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "../../src/lib/agent-limits";

const skill = (
  input: Partial<AgentSkillRow> & Pick<AgentSkillRow, "id" | "name">,
): AgentSkillRow => ({
  id: input.id,
  agent_id: input.agent_id ?? "agent-1",
  name: input.name,
  description: input.description ?? `Use for ${input.name} requests.`,
  body: input.body ?? `${input.name} body`,
  provider: input.provider ?? "codex",
  model: input.model ?? null,
  effort: input.effort ?? null,
  kind: input.kind ?? "custom",
  is_default: input.is_default ?? 0,
  position: input.position ?? 0,
  created_at: "2026-08-09T00:00:00.000Z",
  updated_at: "2026-08-09T00:00:00.000Z",
});

describe("Agent Skills", () => {
  const skills = [
    skill({ id: "default", name: "Issue processing", is_default: 1 }),
    skill({ id: "release", name: "Release" }),
    skill({ id: "ios-release", name: "iOS release" }),
  ];

  it("keeps the deprecated default marker for older Workers", () => {
    expect(agentSkillJson(skill({ id: "release", name: "Release" })))
      .toMatchObject({ isDefault: false });
  });

  it("prefers the issue-processing Skill for issue work", () => {
    const issueSkill = skill({
      id: "issues",
      name: "Triage",
      kind: "issue_processing",
    });
    expect(issueProcessingAgentSkillRow([...skills, issueSkill]))
      .toMatchObject({ id: "issues" });
  });

  it("chunks large Agent rosters within D1's bound-parameter limit", async () => {
    const boundChunks: string[][] = [];
    const db = {
      prepare: () => ({
        bind: (...agentIds: string[]) => ({
          all: async () => {
            boundChunks.push(agentIds);
            return {
              results: agentIds.map((agentId) =>
                skill({
                  id: `skill-${agentId}`,
                  agent_id: agentId,
                  name: agentId,
                  is_default: 1,
                })
              ),
            };
          },
        }),
      }),
    } as unknown as D1Database;
    const agentIds = Array.from(
      { length: 205 },
      (_, index) => `agent-${String(index).padStart(3, "0")}`,
    );

    const rows = await listAgentSkills(db, [...agentIds, agentIds[0]]);

    expect(boundChunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(rows).toHaveLength(205);
    expect(rows[0]?.agent_id).toBe("agent-000");
    expect(rows.at(-1)?.agent_id).toBe("agent-204");
  });
});

describe("Agent Skill normalization", () => {
  const fallback = {
    name: "Developer",
    description: "Use for project work.",
    body: "Handle project work.",
    provider: "codex" as const,
    model: null,
    effort: null,
    kind: "custom" as const,
  };

  it("can still normalize a legacy omitted roster with a compatibility Skill", () => {
    expect(
      normalizedAgentSkillRows(
        "agent-1",
        undefined,
        fallback,
        "2026-08-10T00:00:00.000Z",
      ),
    ).toEqual([
      expect.objectContaining({
        agent_id: "agent-1",
        name: "Developer",
        description: "Use for project work.",
        body: "Handle project work.",
        is_default: 0,
      }),
    ]);
  });

  it("keeps an explicitly empty roster empty", () => {
    expect(
      normalizedAgentSkillRows(
        "agent-1",
        [],
        fallback,
        "2026-08-10T00:00:00.000Z",
      ),
    ).toEqual([]);
  });

  it("accepts five Skills at the description/body limits", () => {
    const rows = normalizedAgentSkillRows(
      "agent-1",
      Array.from({ length: agentSkillsMaxCount }, (_, index) => ({
        name: `Skill ${index}`,
        description: "x".repeat(agentSkillDescriptionMaxLength),
        body: "x".repeat(agentSkillBodyMaxLength),
        provider: "codex" as const,
        model: null,
        effort: null,
        kind: "custom" as const,
        position: index,
      })),
      fallback,
      "2026-08-10T00:00:00.000Z",
    );

    expect(rows).toHaveLength(agentSkillsMaxCount);
    expect(rows[0]?.description).toHaveLength(agentSkillDescriptionMaxLength);
    expect(rows[0]?.body).toHaveLength(agentSkillBodyMaxLength);
  });

  it("rejects a sixth Skill and document fields above their limits", () => {
    const input = (index: number) => ({
      name: `Skill ${index}`,
      description: "Use for test requests.",
      body: "instructions",
      provider: "codex" as const,
      model: null,
      effort: null,
      kind: "custom" as const,
      position: index,
    });

    expect(() => normalizedAgentSkillRows(
      "agent-1",
      Array.from({ length: agentSkillsMaxCount + 1 }, (_, index) => input(index)),
      fallback,
      "2026-08-10T00:00:00.000Z",
    )).toThrow("at most 5 Skills");
    expect(() => normalizedAgentSkillRows(
      "agent-1",
      [{
        ...input(0),
        body: "x".repeat(agentSkillBodyMaxLength + 1),
      }],
      fallback,
      "2026-08-10T00:00:00.000Z",
    )).toThrow("must contain 1 to 20000 characters");
    expect(() => normalizedAgentSkillRows(
      "agent-1",
      [{
        ...input(0),
        description: "x".repeat(agentSkillDescriptionMaxLength + 1),
      }],
      fallback,
      "2026-08-10T00:00:00.000Z",
    )).toThrow("must contain 1 to 1000 characters");
  });
});

describe("Agent Skill conflicts", () => {
  it("preserves a friendly active-work conflict message", () => {
    expect(
      agentSkillConflictMessage(
        new AgentSkillConflictError(
          'Agent Skill "Release" cannot be deleted while queued or running work still references it',
        ),
      ),
    ).toBe(
      'Agent Skill "Release" cannot be deleted while queued or running work still references it',
    );
  });

  it("maps the atomic race guard constraint to a retryable conflict", () => {
    expect(
      agentSkillConflictMessage(
        new Error(
          "D1_ERROR: UNIQUE constraint failed: briar_agent_skills.id: SQLITE_CONSTRAINT",
        ),
      ),
    ).toBe(
      "Agent Skill roster changed or is referenced by queued or running work; refresh and try again",
    );
  });

  it("does not hide unrelated database errors", () => {
    expect(
      agentSkillConflictMessage(
        new Error(
          "D1_ERROR: UNIQUE constraint failed: briar_agent_skills.agent_id, briar_agent_skills.name",
        ),
      ),
    ).toBeNull();
  });
});
