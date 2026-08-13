import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker, { inboxReadStatesInputSchema } from "./index";
import {
  mobileClientIds,
  mobileDashboardDeltaSchema,
  mobileDashboardSnapshotSchema,
  mobileAcceptChannelProposalResponseSchema,
  mobileAcceptIssueActionProposalResponseSchema,
  mobileChannelIssueProposalPayloadSchema,
  mobileChannelMessageSchema,
  mobileIssueExecutionApprovalRequestSchema,
  mobileIssueExecutionProposalSchema,
  mobileIssueMessagesResponseSchema,
  mobileOperationSchemas,
  mobileProjectAgentTaskRequestSchema,
} from "./mobile-contract";

type FixtureOperation = {
  method: string;
  path: string;
  status: number;
  request?: unknown;
  response: unknown;
  errorResponse?: unknown;
};

const fixture = JSON.parse(readFileSync(
  new URL("../../contracts/mobile/fixtures/companion-v1.json", import.meta.url),
  "utf8",
)) as {
  mobileClientIds: string[];
  operations: Record<string, FixtureOperation>;
};

const openapi = JSON.parse(readFileSync(
  new URL("../../contracts/mobile/companion.openapi.yaml", import.meta.url),
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
    for (const operationId of Object.keys(mobileOperationSchemas) as Array<
      keyof typeof mobileOperationSchemas
    >) {
      const schemas = mobileOperationSchemas[operationId] as {
        request?: { parse(value: unknown): unknown };
        response: { parse(value: unknown): unknown };
        errorResponse?: { parse(value: unknown): unknown };
      };
      const operation = fixture.operations[operationId];
      expect(() => schemas.response.parse(operation.response)).not.toThrow();
      if (schemas.request) {
        expect(() => schemas.request?.parse(operation.request)).not.toThrow();
      }
      if (schemas.errorResponse) {
        expect(() => schemas.errorResponse?.parse(operation.errorResponse))
          .not.toThrow();
      }
    }
  });

  it("carries the Agent name with session snapshots", () => {
    const listResponse = mobileOperationSchemas.listProjectAgentSessions.response
      .parse(fixture.operations.listProjectAgentSessions.response);
    const taskResponse = mobileOperationSchemas.runProjectAgentTask.response
      .parse(fixture.operations.runProjectAgentTask.response);

    expect(listResponse.sessions[0]?.agentName).toBe("Issue processing agent");
    expect(taskResponse.session.agentName).toBe("Issue processing agent");
  });

  it("accepts channel inbox ids in an all-read state update", () => {
    const request = fixture.operations.putInboxReadStates.request as {
      readVersions: Record<string, string>;
    };

    expect(
      inboxReadStatesInputSchema.parse(request).readVersions[
        "channel:55555555-5555-4555-8555-555555555555"
      ],
    ).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("preserves organization providers in full and delta dashboard payloads", () => {
    const organizationProviders = ["grok", "opencode", "codex"] as const;
    const snapshot = mobileDashboardSnapshotSchema.parse({
      ...(fixture.operations.getDashboardSnapshot.response as object),
      organizationProviders,
    });
    const delta = mobileDashboardDeltaSchema.parse({
      ...(fixture.operations.getDashboardDelta.response as object),
      organizationProviders,
    });

    expect(snapshot.organizationProviders).toEqual(organizationProviders);
    expect(delta.organizationProviders).toEqual(organizationProviders);
  });

  it("requires callers to choose an Agent Skill before running a task", () => {
    const request = fixture.operations.runProjectAgentTask.request as Record<
      string,
      unknown
    >;

    expect(mobileProjectAgentTaskRequestSchema.parse(request).skillId).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const requestWithoutSkill = { ...request };
    delete requestWithoutSkill.skillId;
    expect(
      mobileProjectAgentTaskRequestSchema.safeParse(requestWithoutSkill).success,
    ).toBe(false);
  });

  it("requires the canonical issue details on issue-create proposals", () => {
    const channel = mobileOperationSchemas.listChannelMessages.response.parse(
      fixture.operations.listChannelMessages.response,
    );
    const proposal = channel.messages.find((message) => message.proposal)
      ?.proposal;
    expect(proposal?.actionType).toBe("request_issue_create");
    if (proposal?.actionType === "request_issue_create") {
      expect(proposal.payload.issue).toMatchObject({
        title: "온보딩 개편",
        priority: 3,
        status: "backlog",
      });
    }
    expect(
      mobileChannelIssueProposalPayloadSchema.safeParse({ issue: {} }).success,
    ).toBe(false);
    expect(
      mobileChannelIssueProposalPayloadSchema.safeParse({
        issue: {
          title: "Legacy proposal",
          description: null,
          priority: null,
          status: "queued",
        },
      }).success,
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
    expect(mobileIssueExecutionProposalSchema.parse(executionProposal).status)
      .toBe("pending");

    const channelResponse = fixture.operations.listChannelMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const createMessage = channelResponse.messages.find((message) => message.proposal);
    expect(createMessage).toBeDefined();
    const channelMessage = mobileChannelMessageSchema.parse({
      ...createMessage,
      executionProposal,
    });
    expect(channelMessage.proposal?.actionType).toBe("request_issue_create");
    expect(channelMessage.executionProposal?.type).toBe("request_issue_execute");

    const issueMessages = fixture.operations.listIssueMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const issueMessage = issueMessages.messages[0];
    const parsedIssueMessages = mobileIssueMessagesResponseSchema.parse({
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
    });
    expect(parsedIssueMessages.messages[0]?.proposedAction?.type)
      .toBe("request_issue_create");
    expect(parsedIssueMessages.messages[0]?.executionProposal?.status)
      .toBe("pending");

    const acceptedChannel = mobileAcceptChannelProposalResponseSchema.parse(
      fixture.operations.acceptChannelProposal.response,
    );
    expect(acceptedChannel.executionProposal).toMatchObject({
      status: "pending",
      runId: executionProposal.runId,
    });
    const acceptedIssue = mobileAcceptIssueActionProposalResponseSchema.parse(
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

    const acceptedUpdate = mobileAcceptIssueActionProposalResponseSchema.parse({
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
    });
    expect(acceptedUpdate.proposal.type).toBe("request_issue_update");
    expect(acceptedUpdate.proposal).not.toHaveProperty("executeAfterCreate");
  });

  it("accepts webhook-authored channel messages as a distinct mobile author", () => {
    const channelResponse = fixture.operations.listChannelMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const parsed = mobileChannelMessageSchema.parse({
      ...channelResponse.messages[0],
      author: {
        type: "webhook",
        id: "77777777-7777-4777-8777-777777777777",
        name: "Deploy notifier",
      },
    });
    expect(parsed.author).toEqual({
      type: "webhook",
      id: "77777777-7777-4777-8777-777777777777",
      name: "Deploy notifier",
    });
  });

  it("carries the Agent's configured avatar on channel message authors", () => {
    const channelResponse = fixture.operations.listChannelMessages.response as {
      messages: Array<Record<string, unknown>>;
    };
    const avatar = "data:image/png;base64,cHJvamVjdC1hdmF0YXI=";
    const parsed = mobileChannelMessageSchema.parse({
      ...channelResponse.messages[0],
      author: {
        type: "agent",
        id: "66666666-6666-4666-8666-666666666666",
        name: "Honey",
        provider: "claude",
        image: avatar,
      },
    });
    expect(parsed.author).toEqual({
      type: "agent",
      id: "66666666-6666-4666-8666-666666666666",
      name: "Honey",
      provider: "claude",
      image: avatar,
    });
    expect(
      mobileChannelMessageSchema.safeParse({
        ...channelResponse.messages[0],
        author: {
          type: "agent",
          id: "66666666-6666-4666-8666-666666666666",
          name: "Honey",
          provider: "claude",
        },
      }).success,
    ).toBe(false);
  });

  it("requires explicit nullable execution choices and rejects hidden fields", () => {
    const request = {
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
    };
    expect(mobileIssueExecutionApprovalRequestSchema.parse(request)).toEqual(request);
    expect(
      mobileIssueExecutionApprovalRequestSchema.safeParse({
        provider: "codex",
        model: null,
        workerId: null,
      }).success,
    ).toBe(false);
    expect(
      mobileIssueExecutionApprovalRequestSchema.safeParse({
        ...request,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).success,
    ).toBe(false);
    expect(
      openapi.components.schemas.IssueExecutionApprovalRequest.required,
    ).toEqual(["provider", "model", "effort", "workerId"]);
  });

  it("serves the documented health fixture from the Worker", async () => {
    const response = await worker.fetch(
      new Request("https://briar-api.example/health"),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      fixture.operations.getHealth.response,
    );
  });

  it.each(["mobile", "android"])(
    "renders Companion authorization for the %s client route",
    async (client) => {
      const response = await worker.fetch(
        new Request(`https://briar-api.example/device?client=${client}`),
        {} as never,
      );
      const page = await response.text();

      expect(response.status).toBe(200);
      expect(page).toContain("Companion 로그인 승인");
      expect(page).toContain("briar-companion://auth-complete");
    },
  );
});
