import { describe, expect, it } from "vitest";

import {
  agentSkillConflictMessage,
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
  execution_mode: input.execution_mode ?? "task",
  approval_policy: input.approval_policy ?? "explicit",
  is_default: input.is_default ?? 0,
  position: input.position ?? 0,
  created_at: "2026-08-09T00:00:00.000Z",
  updated_at: "2026-08-09T00:00:00.000Z",
});

describe("Agent Skills", () => {
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

  it("defaults existing Skills and preserves explicit execution settings", () => {
    expect(normalizedAgentSkillRows(
      "agent-1",
      [{
        ...fallback,
        kind: "custom",
        position: 0,
      }],
      fallback,
      "2026-08-10T00:00:00.000Z",
    )[0]).toMatchObject({
      execution_mode: "task",
      approval_policy: "explicit",
    });
    expect(normalizedAgentSkillRows(
      "agent-1",
      [{
        ...fallback,
        kind: "custom",
        executionMode: "conversation",
        approvalPolicy: "invoke_is_consent",
        position: 0,
      }],
      fallback,
      "2026-08-10T00:00:00.000Z",
    )[0]).toMatchObject({
      execution_mode: "conversation",
      approval_policy: "invoke_is_consent",
    });
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
