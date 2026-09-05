import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { ComputerUsePolicy } from "@briar/contracts/gen/briar/types/v1/computer_use_pb";
import type {
  ChannelAgentSummary,
  ChannelExecutionProposal,
  ChannelMessage,
} from "../../src/lib/channels-contract";
import {
  appChannelAgent,
  appChannelMessage,
} from "./app-connect-channel-response-mappers";

const baseMessage = (
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage => ({
  id: "33333333-3333-4333-8333-333333333333",
  channelId: "22222222-2222-4222-8222-222222222222",
  parentMessageId: null,
  author: {
    type: "agent",
    id: "55555555-5555-4555-8555-555555555555",
    name: "Builder",
    provider: "codex",
    image: null,
  },
  body: "Structured result",
  blocks: [],
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  replyAuthors: [{ type: "webhook", id: null, name: "Build hook" }],
  subscribers: [],
  document: null,
  proposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  createdAt: "2026-08-30T01:02:03.000Z",
  deletedAt: null,
  ...overrides,
});

const expectInternal = (operation: () => unknown) => {
  try {
    operation();
    throw new Error("Expected mapper to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
  }
};

describe("Channel domain to protobuf mapping", () => {
  it("exhaustively preserves nested block and proposal oneofs", () => {
    const mapped = appChannelMessage(baseMessage({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Header", emoji: true },
          block_id: "header",
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Section*", verbatim: true },
          block_id: "section",
          expand: true,
        },
        { type: "markdown", text: "Markdown", block_id: "markdown" },
        { type: "divider", block_id: "divider" },
        {
          type: "context",
          elements: [{ type: "plain_text", text: "Context" }],
          block_id: "context",
        },
        {
          type: "rich_text",
          block_id: "rich",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "Text", style: { bold: true } },
                { type: "link", url: "https://briar.local", text: "Link" },
                { type: "emoji", name: "sparkles" },
              ],
            },
            {
              type: "rich_text_list",
              style: "ordered",
              offset: 2,
              elements: [{
                type: "rich_text_section",
                elements: [{ type: "text", text: "List item" }],
              }],
            },
            {
              type: "rich_text_quote",
              elements: [{ type: "text", text: "Quote" }],
            },
            {
              type: "rich_text_preformatted",
              elements: [{ type: "text", text: "Code" }],
            },
          ],
        },
      ],
      proposal: {
        id: "66666666-6666-4666-8666-666666666666",
        status: "accepted",
        projectId: "77777777-7777-4777-8777-777777777777",
        payload: {
          batch: {
            items: [{
              key: "worker",
              issue: {
                title: "Map the Worker",
                description: null,
                priority: 1,
              },
            }],
            dependencies: [],
          },
          executeAfterCreate: false,
        },
        resultRunId: "run-worker",
        resultItems: [{ localKey: "worker", runId: "run-worker" }],
      },
    }));

    expect(mapped.author?.author.case).toBe("agent");
    expect(mapped.replyAuthors[0]?.author.case).toBe("webhook");
    expect(mapped.blocks.map((block) => block.value.case)).toEqual([
      "header",
      "section",
      "markdown",
      "divider",
      "context",
      "richText",
    ]);
    const richText = mapped.blocks[5]?.value;
    expect(richText?.case).toBe("richText");
    if (richText?.case !== "richText") throw new Error("missing rich text");
    expect(richText.value.elements.map((element) => element.value.case)).toEqual([
      "section",
      "list",
      "quote",
      "preformatted",
    ]);
    expect(mapped.proposal?.payload.case).toBe("batch");
  });

  it("fails malformed trusted timestamps and enums as Internal", () => {
    expectInternal(() => appChannelMessage(baseMessage({ createdAt: "invalid" })));

    const executionProposal: ChannelExecutionProposal = {
      id: "66666666-6666-4666-8666-666666666666",
      type: "request_issue_execute",
      status: "pending",
      projectId: "77777777-7777-4777-8777-777777777777",
      runId: "run-1",
      title: "Run",
      createdAt: "2026-08-30T01:02:03.000Z",
      acceptedAt: null,
      requestedProvider: "invalid" as NonNullable<
        ChannelExecutionProposal["requestedProvider"]
      >,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    expectInternal(() =>
      appChannelMessage(baseMessage({ executionProposal }))
    );

  });
});

describe("appChannelAgent", () => {
  const summary = (
    overrides: Partial<ChannelAgentSummary> = {},
  ): ChannelAgentSummary => ({
    agentId: "e652555e-616b-4049-a6be-bd727ed95f63",
    name: "Growth Hacker",
    provider: "codex",
    model: null,
    effort: null,
    projectId: "4947dcf7-694e-4a0e-b702-ac9ce562b018",
    projectName: "briar",
    description: "",
    responsibility: "Growth",
    skills: [],
    createdAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  } as ChannelAgentSummary);

  it("carries the Computer Use policy the DM computer panel depends on", () => {
    expect(appChannelAgent(summary({ computerUsePolicy: "unattended" })).computerUsePolicy)
      .toBe(ComputerUsePolicy.UNATTENDED);
    expect(appChannelAgent(summary({ computerUsePolicy: "disabled" })).computerUsePolicy)
      .toBe(ComputerUsePolicy.DISABLED);
    expect(appChannelAgent(summary()).computerUsePolicy)
      .toBe(ComputerUsePolicy.UNSPECIFIED);
  });
});
