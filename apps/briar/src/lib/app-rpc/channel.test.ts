import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillExecutionProposalSchema,
  AgentSkillExecutionStatus,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import {
  ChannelMessageAuthor_Kind,
  ChannelMessageSchema,
  ChannelProposalSchema,
  SyncChannelsResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  MessageBlockSchema,
  ProposalStatus,
  RichTextElement_List_Style,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  IssueExecutionProposalSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  AgentProvider,
} from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { describe, expect, it } from "vitest";
import {
  channelDeltaFromMessage,
  channelMessageFromMessage,
} from "./channel";

const instant = (value: string) => timestampFromDate(new Date(value));

describe("Channel Connect DTO mapping", () => {
  it("maps nested oneofs and optional evidence without dropping fields", () => {
    const createdAt = instant("2026-08-30T01:02:03.000Z");
    const message = create(ChannelMessageSchema, {
      id: "message-1",
      channelId: "channel-1",
      body: "Deployment ready",
      author: {
        kind: ChannelMessageAuthor_Kind.AGENT,
        id: "agent-1",
        name: "Release Agent",
        provider: AgentProvider.CODEX,
        image: "https://example.com/agent.png",
      },
      blocks: [create(MessageBlockSchema, {
        value: {
          case: "richText",
          value: {
            blockId: "release-notes",
            elements: [{
              value: {
                case: "list",
                value: {
                  style: RichTextElement_List_Style.ORDERED,
                  offset: 2,
                  elements: [{
                    elements: [{
                      value: {
                        case: "link",
                        value: {
                          url: "https://example.com/build",
                          text: "Build 42",
                          style: { bold: true },
                        },
                      },
                    }],
                  }],
                },
              },
            }],
          },
        },
      })],
      attachments: [{
        id: "attachment-1",
        filename: "report.pdf",
        contentType: "application/pdf",
        byteSize: 4_294_967_296n,
        url: "/attachments/attachment-1",
      }],
      reactions: [{
        emoji: "🎉",
        count: 1,
        userIds: ["user-1"],
        people: [{ userId: "user-1", name: "Ada" }],
      }],
      proposal: create(ChannelProposalSchema, {
        id: "proposal-1",
        status: ProposalStatus.PENDING,
        projectId: "project-1",
        payload: {
          case: "batch",
          value: {
            items: [{
              key: "API",
              issue: {
                title: "Ship API",
                priority: 1,
                status: RunStatus.BACKLOG,
              },
            }],
            dependencies: [{
              prerequisiteKey: "API",
              dependentKey: "CLIENT",
            }],
          },
        },
        resultItems: [{ localKey: "API", runId: "run-1" }],
      }),
      executionProposal: create(IssueExecutionProposalSchema, {
        id: "execution-1",
        status: ProposalStatus.ACCEPTED,
        projectId: "project-1",
        runId: "run-1",
        title: "Ship API",
        createdAt,
        acceptedAt: createdAt,
        requestedProvider: AgentProvider.CODEX,
        requestedWorkerId: "worker-1",
      }),
      skillExecutionProposal: create(AgentSkillExecutionProposalSchema, {
        id: "skill-proposal-1",
        status: ProposalStatus.PENDING,
        projectId: "project-1",
        agentId: "agent-1",
        agentName: "Release Agent",
        skillId: "skill-1",
        skillName: "Release",
        request: "Ship it",
        provider: AgentProvider.CODEX,
        executionMode: AgentSkillExecutionMode.TASK,
        approvalPolicy: AgentSkillApprovalPolicy.EXPLICIT,
        executionStatus: AgentSkillExecutionStatus.WAITING,
        createdAt,
        delegatedByAgentId: "agent-parent",
        delegatedByAgentName: "Lead",
      }),
      subscribers: [{ userId: "user-1", subscribedAt: createdAt }],
      createdAt,
    });

    expect(channelMessageFromMessage(message)).toMatchObject({
      id: "message-1",
      author: {
        type: "agent",
        provider: "codex",
        image: "https://example.com/agent.png",
      },
      blocks: [{
        type: "rich_text",
        block_id: "release-notes",
        elements: [{
          type: "rich_text_list",
          style: "ordered",
          offset: 2,
          elements: [{
            type: "rich_text_section",
            elements: [{
              type: "link",
              text: "Build 42",
              style: { bold: true },
            }],
          }],
        }],
      }],
      attachments: [{ byteSize: 4_294_967_296 }],
      reactions: [{ people: [{ image: null }] }],
      proposal: {
        actionType: "request_issue_create",
        payload: {
          batch: {
            items: [{
              key: "API",
              issue: {
                description: null,
                priority: 1,
                status: "backlog",
              },
            }],
            dependencies: [{
              prerequisiteKey: "API",
              dependentKey: "CLIENT",
            }],
          },
          executeAfterCreate: false,
        },
        resultItems: [{ localKey: "API", runId: "run-1" }],
      },
      executionProposal: {
        type: "request_issue_execute",
        status: "accepted",
        requestedProvider: "codex",
        requestedWorkerId: "worker-1",
      },
      skillExecutionProposal: {
        type: "request_agent_skill_execute",
        executionMode: "task",
        approvalPolicy: "explicit",
        executionStatus: "waiting",
        delegatedByAgentId: "agent-parent",
      },
      subscribers: [{
        userId: "user-1",
        subscribedAt: "2026-08-30T01:02:03.000Z",
      }],
    });
  });

  it("preserves reset and rejects a cursor that JavaScript cannot represent", () => {
    expect(channelDeltaFromMessage(create(SyncChannelsResponseSchema, {
      cursor: 42n,
      hasMore: true,
      reset: true,
      removedChannelIds: ["channel-old"],
    }))).toEqual({
      cursor: 42,
      hasMore: true,
      reset: true,
      channels: [],
      removedChannelIds: ["channel-old"],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });

    expect(() => channelDeltaFromMessage(create(SyncChannelsResponseSchema, {
      cursor: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    }))).toThrow("channels.cursor is outside JavaScript's safe integer range");
  });
});
