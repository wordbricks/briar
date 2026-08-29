import { readFileSync } from "node:fs";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  mobileAcceptChannelProposalResponseSchema,
  mobileAcceptIssueActionProposalResponseSchema,
  mobileChannelIssueProposalPayloadSchema,
  mobileChannelMessageSchema,
  mobileClientIds,
  mobileIssueExecutionApprovalRequestSchema,
  mobileIssueExecutionProposalSchema,
  mobileIssueMessagesResponseSchema,
  mobileOperationSchemas,
  mobileProjectAgentTaskRequestSchema,
} from "./mobile-contract";
import {
  decodeMobileSchema,
  decodeMobileSchemaOption,
} from "./mobile-contract-schema";

type FixtureOperation = {
  method: string;
  path: string;
  status: number;
  request?: unknown;
  response: unknown;
  errorResponse?: unknown;
};

const fixture = JSON.parse(readFileSync(
  new URL(
    "../../../../packages/mobile-contracts/fixtures/companion-v1.json",
    import.meta.url,
  ),
  "utf8",
)) as {
  mobileClientIds: string[];
  operations: Record<string, FixtureOperation>;
};

const openapi = JSON.parse(readFileSync(
  new URL(
    "../../../../packages/mobile-contracts/companion.openapi.yaml",
    import.meta.url,
  ),
  "utf8",
)) as {
  openapi: string;
  paths: Record<string, Record<string, { operationId: string }>>;
  components: {
    schemas: {
      ChannelIssueProposalPayload: {
        properties: {
          issue: {
            properties: {
              status: { enum: string[] };
            };
          };
        };
      };
      IssueExecutionApprovalRequest: {
        required: string[];
      };
    };
  };
};

describe("Companion mobile API contract", () => {
  it("keeps the OpenAPI subset and Worker fixture operation map aligned", () => {
    expect(openapi.openapi).toBe("3.1.0");
    expect(fixture.mobileClientIds).toEqual([...mobileClientIds]);
    expect(Object.keys(fixture.operations).sort()).toEqual(
      Object.keys(mobileOperationSchemas).sort(),
    );

    for (const [operationId, operation] of Object.entries(fixture.operations)) {
      const documentedPath = operation.path.replace(/\?.*$/u, "");
      const documentedOperation = openapi.paths[documentedPath]?.[
        operation.method.toLowerCase()
      ];
      expect(documentedOperation?.operationId).toBe(operationId);
      expect(operation.status).toBe(200);
    }
  });

  it("validates every shared request, response, and polling error fixture", () => {
    for (
      const operationId of Object.keys(mobileOperationSchemas) as Array<
        keyof typeof mobileOperationSchemas
      >
    ) {
      const schemas = mobileOperationSchemas[operationId];
      const operation = fixture.operations[operationId];
      expect(() => decodeMobileSchema(schemas.response, operation.response))
        .not.toThrow();
      if ("request" in schemas) {
        expect(() => decodeMobileSchema(schemas.request, operation.request))
          .not.toThrow();
      }
      if ("errorResponse" in schemas) {
        expect(() =>
          decodeMobileSchema(schemas.errorResponse, operation.errorResponse)
        )
          .not.toThrow();
      }
    }
  });

  it("carries related channel messages on dashboard runs", () => {
    const dashboard = decodeMobileSchema(
      mobileOperationSchemas.getDashboardSnapshot.response,
      fixture.operations.getDashboardSnapshot.response,
    );

    expect(dashboard.runs[0]?.relatedMessage).toEqual({
      organizationId: "22222222-2222-4222-8222-222222222222",
      channelId: "66666666-6666-4666-8666-666666666666",
      messageId: "77777777-7777-4777-8777-777777777777",
      rootMessageId: "88888888-8888-4888-8888-888888888888",
    });
  });

  it("requires callers to choose an Agent Skill before running a task", () => {
    const request = fixture.operations.runProjectAgentTask.request as Record<
      string,
      unknown
    >;

    expect(
      decodeMobileSchema(mobileProjectAgentTaskRequestSchema, request).skillId,
    ).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const requestWithoutSkill = { ...request };
    delete requestWithoutSkill.skillId;
    expect(
      Option.isSome(
        decodeMobileSchemaOption(
          mobileProjectAgentTaskRequestSchema,
          requestWithoutSkill,
        ),
      ),
    ).toBe(false);
  });

  it("requires the canonical issue details on issue-create proposals", () => {
    const channel = decodeMobileSchema(
      mobileOperationSchemas.listChannelMessages.response,
      fixture.operations.listChannelMessages.response,
    );
    const proposal = channel.messages.find((message) => message.proposal)
      ?.proposal;
    expect(proposal?.actionType).toBe("request_issue_create");
    if (
      proposal?.actionType === "request_issue_create" &&
      "issue" in proposal.payload
    ) {
      expect(proposal.payload.issue).toMatchObject({
        title: "온보딩 개편",
        priority: 3,
        status: "backlog",
      });
    }
    expect(
      Option.isSome(
        decodeMobileSchemaOption(
          mobileChannelIssueProposalPayloadSchema,
          { issue: {} },
        ),
      ),
    ).toBe(false);
    expect(
      Option.isSome(decodeMobileSchemaOption(
        mobileChannelIssueProposalPayloadSchema,
        {
          issue: {
            title: "Legacy proposal",
            description: null,
            priority: null,
            status: "queued",
          },
        },
      )),
    ).toBe(true);
    expect(
      openapi.components.schemas.ChannelIssueProposalPayload.properties.issue
        .properties.status.enum,
    ).toEqual(["backlog", "queued"]);
  });

  it("keeps create and execution proposals as two explicit approval boundaries", () => {
    const executionProposal = {
      id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      type: "request_issue_execute",
      status: "pending",
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "33333333-3333-4333-8333-333333333333",
      title: "온보딩 개편",
      createdAt: "2026-08-11T01:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: "66666666-6666-4666-8666-666666666666",
      delegatedByAgentName: "Bumble",
    } as const;
    expect(
      decodeMobileSchema(mobileIssueExecutionProposalSchema, executionProposal)
        .status,
    )
      .toBe("pending");

    const channelResponse = fixture.operations.listChannelMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const createMessage = channelResponse.messages.find((message) =>
      message.proposal
    );
    expect(createMessage).toBeDefined();
    const channelMessage = decodeMobileSchema(mobileChannelMessageSchema, {
      ...createMessage,
      executionProposal,
    });
    expect(channelMessage.proposal?.actionType).toBe("request_issue_create");
    expect(channelMessage.executionProposal?.type).toBe(
      "request_issue_execute",
    );

    const issueMessages = fixture.operations.listIssueMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const issueMessage = issueMessages.messages[0];
    const parsedIssueMessages = decodeMobileSchema(
      mobileIssueMessagesResponseSchema,
      {
        cursor: 41,
        messages: [{
          ...issueMessage,
          proposedAction: {
            id: "abababab-abab-4bab-8bab-abababababab",
            type: "request_issue_create",
            issue: {
              title: "온보딩 개편",
              description: null,
              priority: 2,
              status: "backlog",
            },
            executeAfterCreate: true,
            status: "accepted",
            acceptedAt: "2026-08-11T01:00:00.000Z",
            resultRunId: "33333333-3333-4333-8333-333333333333",
          },
          executionProposal,
        }],
      },
    );
    expect(parsedIssueMessages.messages[0]?.proposedAction?.type)
      .toBe("request_issue_create");
    expect(parsedIssueMessages.messages[0]?.executionProposal?.status)
      .toBe("pending");

    const acceptedChannel = decodeMobileSchema(
      mobileAcceptChannelProposalResponseSchema,
      fixture.operations.acceptChannelProposal.response,
    );
    expect(acceptedChannel.executionProposal).toMatchObject({
      status: "pending",
      runId: executionProposal.runId,
    });
    const acceptedIssue = decodeMobileSchema(
      mobileAcceptIssueActionProposalResponseSchema,
      fixture.operations.acceptIssueActionProposal.response,
    );
    expect(acceptedIssue.proposal).toMatchObject({
      type: "request_issue_create",
      executeAfterCreate: true,
    });
    expect(acceptedIssue.executionProposal).toMatchObject({
      id: executionProposal.id,
      status: "pending",
    });

    const acceptedUpdate = decodeMobileSchema(
      mobileAcceptIssueActionProposalResponseSchema,
      {
        proposal: {
          id: "abababab-abab-4bab-8bab-abababababab",
          type: "request_issue_update",
          changes: { description: "Updated acceptance criteria." },
          changedFields: ["description"],
          status: "accepted",
          acceptedAt: "2026-08-11T01:00:00.000Z",
          resultRunId: executionProposal.runId,
        },
        outcome: "accepted",
        resultRunId: executionProposal.runId,
        executionProposal: null,
      },
    );
    expect(acceptedUpdate.proposal.type).toBe("request_issue_update");
    expect(acceptedUpdate.proposal).not.toHaveProperty("executeAfterCreate");
  });

  it("requires explicit nullable execution choices and rejects hidden fields", () => {
    const request = {
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
    };
    expect(
      decodeMobileSchema(mobileIssueExecutionApprovalRequestSchema, request),
    ).toEqual(request);
    expect(
      Option.isSome(decodeMobileSchemaOption(
        mobileIssueExecutionApprovalRequestSchema,
        {
          provider: "codex",
          model: null,
          workerId: null,
        },
      )),
    ).toBe(false);
    expect(
      Option.isSome(decodeMobileSchemaOption(
        mobileIssueExecutionApprovalRequestSchema,
        {
          ...request,
          requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      )),
    ).toBe(false);
    expect(
      openapi.components.schemas.IssueExecutionApprovalRequest.required,
    ).toEqual(["provider", "model", "effort", "workerId"]);
  });

});
