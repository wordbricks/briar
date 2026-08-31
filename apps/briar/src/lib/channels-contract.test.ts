import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  channelIncomingWebhookMessageSchema,
  channelMessageBlocksFallback,
  channelMessageInputSchema,
  channelProposalAcceptInputSchema,
  channelReplyContextMessageJson,
  channelReplyCompletionSchema,
  channelAgentSkillInputSchema,
  organizationAgentInputSchema,
  type ChannelMessage,
} from "./channels-contract";
import {
  agentResponsibilityMaxLength,
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";

const projectId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const clientMessageId = "33333333-3333-4333-8333-333333333333";
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
) => Schema.decodeUnknownSync(schema)(input);
const accepts = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
) => Option.isSome(Schema.decodeUnknownOption(schema)(input));

describe("Agent input limits", () => {
  const skill = (index: number) => ({
    name: `Skill ${index}`,
    description: "x".repeat(agentSkillDescriptionMaxLength),
    body: "x".repeat(agentSkillBodyMaxLength),
    provider: "codex" as const,
    model: null,
    effort: null,
    kind: "custom" as const,
    position: index,
  });

  it("accepts bounded responsibility and Skill document fields", () => {
    expect(accepts(channelAgentSkillInputSchema, skill(0))).toBe(true);
    expect(accepts(organizationAgentInputSchema, {
      name: "Builder",
      provider: "codex",
      responsibility: "x".repeat(agentResponsibilityMaxLength),
      skills: Array.from({ length: agentSkillsMaxCount }, (_, index) =>
        skill(index)
      ),
    })).toBe(true);
  });

  it("rejects responsibility, Skill fields, and rosters above their limits", () => {
    expect(accepts(channelAgentSkillInputSchema, {
      ...skill(0),
      body: "x".repeat(agentSkillBodyMaxLength + 1),
    })).toBe(false);
    expect(accepts(channelAgentSkillInputSchema, {
      ...skill(0),
      description: "x".repeat(agentSkillDescriptionMaxLength + 1),
    })).toBe(false);
    expect(accepts(organizationAgentInputSchema, {
      name: "Builder",
      provider: "codex",
      responsibility: "x".repeat(agentResponsibilityMaxLength + 1),
      skills: [],
    })).toBe(false);
    expect(accepts(organizationAgentInputSchema, {
      name: "Builder",
      provider: "codex",
      responsibility: "Build the project.",
      skills: Array.from({ length: agentSkillsMaxCount + 1 }, (_, index) =>
        skill(index)
      ),
    })).toBe(false);
  });

  it("derives a missing Skill description and defaults execution policy", () => {
    expect(decode(channelAgentSkillInputSchema, {
      name: "Release",
      body: "Publish and verify the release.",
      provider: "codex",
      model: null,
      effort: null,
      kind: "custom",
      position: 0,
    })).toMatchObject({
      name: "Release",
      description: "Publish and verify the release.",
      body: "Publish and verify the release.",
      executionMode: "task",
      approvalPolicy: "explicit",
    });
    expect(decode(channelAgentSkillInputSchema, {
      ...skill(0),
      executionMode: "conversation",
      approvalPolicy: "invoke_is_consent",
    })).toMatchObject({
      executionMode: "conversation",
      approvalPolicy: "invoke_is_consent",
    });
  });
});

describe("channel message contract", () => {
  it("canonicalizes UUID request fields before database comparisons", () => {
    expect(
      decode(channelMessageInputSchema, {
        body: "@Honey reply in the thread",
        clientMessageId: clientMessageId.toUpperCase(),
        skillId: agentId.toUpperCase(),
        parentMessageId: projectId.toUpperCase(),
        mentionedAgentIds: [agentId.toUpperCase()],
        preferredDeviceId: agentId.toUpperCase(),
      }),
    ).toMatchObject({
      clientMessageId,
      skillId: agentId,
      parentMessageId: projectId,
      mentionedAgentIds: [agentId],
      preferredDeviceId: agentId,
    });
  });

  it("canonicalizes channel proposal accept project IDs", () => {
    expect(
      decode(channelProposalAcceptInputSchema, {
        projectId: projectId.toUpperCase(),
      }),
    ).toEqual({ projectId, execution: null });
    expect(decode(channelProposalAcceptInputSchema, {})).toEqual({
      projectId: null,
      execution: null,
    });
    expect(decode(channelProposalAcceptInputSchema, {
      projectId,
      execution: {
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: null,
      },
    })).toEqual({
      projectId,
      execution: {
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: null,
      },
    });
  });

  it("projects display messages onto bounded Agent reply context", () => {
    const message: ChannelMessage = {
      id: clientMessageId,
      channelId: projectId,
      parentMessageId: null,
      author: {
        type: "agent",
        id: agentId,
        name: "Developer",
        provider: "codex",
        image: "data:image/png;base64,large-avatar",
      },
      body: "Investigated the repository.",
      blocks: [{
        type: "section",
        text: { type: "mrkdwn", text: "Investigated the repository." },
      }],
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      attachments: [{
        id: agentId,
        filename: "screen.png",
        contentType: "image/png",
        byteSize: 42,
        url: "/private/display-only-url",
      }],
      reactions: [{ emoji: "👍", count: 1, userIds: [projectId] }],
      replyCount: 2,
      lastReplyAt: "2026-08-16T00:01:00.000Z",
      replyAuthors: [{
        type: "user",
        id: projectId,
        name: "Jay",
        email: "jay@example.com",
        image: "data:image/png;base64,another-avatar",
      }],
      subscribers: [],
      document: null,
      proposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: "2026-08-16T00:00:00.000Z",
    };

    expect(channelReplyContextMessageJson(message)).toEqual({
      id: clientMessageId,
      parentMessageId: null,
      author: { type: "agent", id: agentId, name: "Developer" },
      body: "Investigated the repository.",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      attachments: [{
        id: agentId,
        filename: "screen.png",
        contentType: "image/png",
        byteSize: 42,
      }],
      document: null,
      proposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: "2026-08-16T00:00:00.000Z",
    });
  });
});

describe("channel webhook contract", () => {
  it("trims bounded names and message fields without accepting extra input", () => {
    expect(decode(channelIncomingWebhookMessageSchema, {
      text: " Deployment complete ",
      eventId: " deploy-42 ",
    })).toEqual({ text: "Deployment complete", eventId: "deploy-42" });
    expect(accepts(channelIncomingWebhookMessageSchema, {
      text: "Deployment complete",
      channelId: projectId,
    })).toBe(false);
  });

  it("accepts core Slack-compatible blocks and derives a readable fallback", () => {
    const input = decode(channelIncomingWebhookMessageSchema, {
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Deployment complete" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Production* is now on `v42`." },
        },
        { type: "divider" },
        {
          type: "rich_text",
          elements: [{
            type: "rich_text_list",
            style: "bullet",
            elements: [{
              type: "rich_text_section",
              elements: [{ type: "text", text: "Health checks passed" }],
            }],
          }],
        },
      ],
    });

    expect(channelMessageBlocksFallback(input.blocks ?? [])).toBe(
      "Deployment complete\n*Production* is now on `v42`.\n• Health checks passed",
    );
  });

  it("requires visible content and rejects unsupported interactive blocks", () => {
    expect(accepts(channelIncomingWebhookMessageSchema, {
      blocks: [{ type: "divider" }],
    })).toBe(false);
    expect(accepts(channelIncomingWebhookMessageSchema, {
      blocks: [{ type: "actions", elements: [] }],
    })).toBe(false);
  });
});

describe("channel reply completion contract", () => {
  const completion = (
    body: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    body,
    document: null,
    issueProposal: null,
    issueBatchProposal: null,
    executionProposal: null,
    skillExecutionProposal: null,
    delegation: null,
    ...overrides,
  });

  it("accepts only an isolated saved Skill execution marker", () => {
    expect(decode(channelReplyCompletionSchema, completion(
      "I matched the release Skill and prepared an approval.",
      {
        skillExecutionProposal: { type: "request_agent_skill_execute" },
      },
    ))).toMatchObject({
      skillExecutionProposal: { type: "request_agent_skill_execute" },
      executionProposal: null,
      delegation: null,
    });

    expect(accepts(channelReplyCompletionSchema, completion(
      "Unsafe combined proposal",
      {
        executionProposal: { projectId, runId: projectId },
        skillExecutionProposal: { type: "request_agent_skill_execute" },
      },
    ))).toBe(false);
  });

  it("accepts one bounded structured Project Agent delegation", () => {
    expect(decode(channelReplyCompletionSchema, completion(
      "I asked the project Agent to inspect the repository.",
      {
        delegation: {
          projectId,
          agentId,
          request: "  Which module owns authentication?  ",
        },
      },
    ))).toMatchObject({
      delegation: {
        projectId,
        agentId,
        request: "Which module owns authentication?",
      },
    });
  });

  it("does not combine a delegation with an artifact or accept extra authority", () => {
    const combined = accepts(channelReplyCompletionSchema, completion(
      "Delegating and proposing.",
      {
        document: {
          title: "Plan",
          markdown: "# Plan",
          projectId,
        },
        delegation: { projectId, agentId, request: "Inspect it." },
      },
    ));
    expect(combined).toBe(false);

    const expanded = accepts(channelReplyCompletionSchema, completion(
      "Delegating.",
      {
        delegation: {
          projectId,
          agentId,
          request: "Inspect it.",
          provider: "codex",
        },
      },
    ));
    expect(expanded).toBe(false);
  });

  it("only lets new issue proposals request backlog creation", () => {
    const issueProposal = {
      projectId,
      issue: {
        title: "Safe proposal",
        description: null,
        priority: null,
        status: "backlog",
      },
    };
    const proposal = completion("Create this after approval.", {
      issueProposal,
    });
    expect(accepts(channelReplyCompletionSchema, proposal)).toBe(true);
    expect(accepts(channelReplyCompletionSchema, {
      ...proposal,
      issueProposal: {
        ...issueProposal,
        issue: { ...issueProposal.issue, status: "queued" },
      },
    })).toBe(false);
  });

  it("accepts bounded acyclic issue batches and rejects invalid graphs", () => {
    const issue = (title: string) => ({
      title,
      description: null,
      priority: 2,
      status: "backlog" as const,
    });
    const batch = {
      items: [
        { key: "api", issue: issue("Build API") },
        { key: "ui", issue: issue("Build UI") },
      ],
      dependencies: [
        { prerequisiteKey: "api", dependentKey: "ui" },
      ],
    };
    const proposal = completion("Create the related backlog issues together.", {
      issueBatchProposal: {
        projectId,
        batch,
      },
    });
    expect(accepts(channelReplyCompletionSchema, proposal)).toBe(true);

    const invalidBatches = [
      {
        ...batch,
        items: [
          { key: "same", issue: issue("A") },
          { key: "same", issue: issue("B") },
        ],
      },
      {
        ...batch,
        dependencies: [{ prerequisiteKey: "missing", dependentKey: "ui" }],
      },
      {
        ...batch,
        dependencies: [{ prerequisiteKey: "api", dependentKey: "api" }],
      },
      {
        ...batch,
        dependencies: [
          { prerequisiteKey: "api", dependentKey: "ui" },
          { prerequisiteKey: "ui", dependentKey: "api" },
        ],
      },
      {
        items: Array.from({ length: 9 }, (_, index) => ({
          key: `issue-${index}`,
          issue: issue(`Issue ${index}`),
        })),
        dependencies: [],
      },
    ];
    for (const batch of invalidBatches) {
      expect(accepts(channelReplyCompletionSchema, {
        ...proposal,
        issueBatchProposal: { projectId, batch },
      })).toBe(false);
    }
  });
});
