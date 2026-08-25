import { readFileSync } from "node:fs";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  mobileAgentSkillExecutionApprovalResponseSchema,
  mobileChannelIssueProposalPayloadSchema,
  mobileChannelMessageSchema,
  mobileCreateIssueRequestSchema,
  mobileDashboardSnapshotSchema,
  mobileDeviceCodeRequestSchema,
  mobileHealthResponseSchema,
  mobileInboxReadStatesSchema,
  mobileProjectsResponseSchema,
  mobileUpdateIssueRequestSchema,
} from "./mobile-contract";
import {
  decodeMobileSchema,
  decodeMobileSchemaOption,
} from "./mobile-contract-schema";

const fixture = JSON.parse(readFileSync(
  new URL(
    "../../../../packages/mobile-contracts/fixtures/companion-v1.json",
    import.meta.url,
  ),
  "utf8",
)) as {
  operations: Record<string, {
    request?: unknown;
    response: unknown;
    errorResponse?: unknown;
  }>;
};

describe("Effect mobile contract behavior", () => {
  it("preserves non-strict stripping and strict rejection boundaries", () => {
    expect(decodeMobileSchema(mobileHealthResponseSchema, {
      ok: true,
      service: "briar-api",
      database: "ok",
      updates: "ok",
      futureField: true,
    })).toEqual({
      ok: true,
      service: "briar-api",
      database: "ok",
      updates: "ok",
    });

    expect(Option.isNone(decodeMobileSchemaOption(
      mobileDeviceCodeRequestSchema,
      {
        client_id: "briar-mobile",
        scope: "openid profile email",
        futureField: true,
      },
    ))).toBe(true);
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileChannelIssueProposalPayloadSchema,
      {
        issue: {
          title: "Canonical title",
          description: null,
          priority: null,
          status: "backlog",
          futureField: true,
        },
      },
    ))).toBe(true);
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileInboxReadStatesSchema,
      { readVersions: { "": "version" } },
    ))).toBe(true);
  });

  it("preserves workflow passthrough data at both nested boundaries", () => {
    const response = structuredClone(
      fixture.operations.getDashboardSnapshot.response,
    ) as {
      runs: Array<{
        workflow: {
          stages: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
      }>;
    };
    response.runs[0]!.workflow.futureWorkflow = { enabled: true };
    response.runs[0]!.workflow.stages[0]!.futureStage = "preserved";

    const decoded = decodeMobileSchema(mobileDashboardSnapshotSchema, response);
    expect(decoded.runs[0]?.workflow?.futureWorkflow).toEqual({ enabled: true });
    expect(decoded.runs[0]?.workflow?.stages[0]?.futureStage).toBe("preserved");
    decoded.runs[0]!.workflow!.futureWorkflow = { enabled: false };
    expect(decoded.runs[0]?.workflow?.futureWorkflow).toEqual({
      enabled: false,
    });
  });

  it("creates fresh mutable defaults and retains mutable object types", () => {
    const message = structuredClone(
      (fixture.operations.listChannelMessages.response as {
        messages: Array<Record<string, unknown>>;
      }).messages[0],
    );
    delete message.mentionedUserIds;
    delete message.mentionedAgentIds;
    delete message.attachments;
    delete message.reactions;

    const first = decodeMobileSchema(mobileChannelMessageSchema, message);
    const second = decodeMobileSchema(mobileChannelMessageSchema, message);
    first.mentionedUserIds.push("fixture-user");
    first.body = "Mutated body";

    expect(second.mentionedUserIds).toEqual([]);
    expect(second.body).not.toBe(first.body);

    const projects = decodeMobileSchema(mobileProjectsResponseSchema, {
      projects: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Mutable project",
        icon: null,
        organizationId: "22222222-2222-4222-8222-222222222222",
        organizationName: "Briar",
        role: "owner",
        createdAt: "2026-08-20T00:00:00.000Z",
      }],
    });
    projects.projects[0]!.name = "Renamed";
    projects.projects.push({ ...projects.projects[0]!, name: "Second" });
    expect(projects.projects.map((project) => project.name)).toEqual([
      "Renamed",
      "Second",
    ]);
  });

  it("enforces cross-field preference and approval invariants", () => {
    const createIssueRequest = fixture.operations.createIssue.request as Record<
      string,
      unknown
    >;
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileCreateIssueRequestSchema,
      {
        ...createIssueRequest,
        preferredProvider: null,
        preferredModel: "gpt-5.6-sol",
      },
    ))).toBe(true);

    const approval = structuredClone(
      fixture.operations.acceptIssueSkillExecutionProposal.response,
    ) as {
      session: { workerId: string | null };
    };
    expect(() => decodeMobileSchema(
      mobileAgentSkillExecutionApprovalResponseSchema,
      approval,
    )).not.toThrow();
    approval.session.workerId = "different-worker";
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileAgentSkillExecutionApprovalResponseSchema,
      approval,
    ))).toBe(true);
  });

  it("defaults omitted issue difficulty and rejects unsupported values", () => {
    const request = fixture.operations.createIssue.request as Record<
      string,
      unknown
    >;
    const withoutDifficulty = { ...request };
    delete withoutDifficulty.difficulty;
    expect(
      decodeMobileSchema(mobileCreateIssueRequestSchema, withoutDifficulty)
        .difficulty,
    ).toBe("normal");
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileCreateIssueRequestSchema,
      { ...request, difficulty: "extreme" },
    ))).toBe(true);
    expect(Option.isNone(decodeMobileSchemaOption(
      mobileUpdateIssueRequestSchema,
      {
        title: "Updated issue",
        description: null,
        priority: null,
        difficulty: "extreme",
        assigneeUserId: null,
      },
    ))).toBe(true);
  });
});
