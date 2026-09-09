import { describe, expect, it, vi } from "vitest";
import {
  createRealtimeTicketApplication,
  RealtimeTicketApplicationError,
  type RealtimeTicketApplicationServices,
} from "./realtime-ticket-application";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const channelId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

type RealtimeTicketServiceMocks = {
  readonly value: RealtimeTicketApplicationServices;
  readonly createChannelActivityTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createChannelActivityTicket"]>
  >;
  readonly createIssueActivityTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createIssueActivityTicket"]>
  >;
  readonly createWorkspaceTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createWorkspaceTicket"]>
  >;
  readonly getChannel: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getChannel"]>
  >;
  readonly getWorkspaceRole: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getWorkspaceRole"]>
  >;
  readonly getTeam: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getTeam"]>
  >;
  readonly getRun: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getRun"]>
  >;
};

const services = (): RealtimeTicketServiceMocks => {
  const createChannelActivityTicket = vi.fn<
    RealtimeTicketApplicationServices["createChannelActivityTicket"]
  >().mockResolvedValue({ ticket: "channel-ticket", expiresAt: 1 } as never);
  const createIssueActivityTicket = vi.fn<
    RealtimeTicketApplicationServices["createIssueActivityTicket"]
  >().mockResolvedValue({ ticket: "issue-ticket", expiresAt: 1 } as never);
  const createWorkspaceTicket = vi.fn<
    RealtimeTicketApplicationServices["createWorkspaceTicket"]
  >().mockResolvedValue({ ticket: "workspace-ticket", expiresAt: 1 } as never);
  const getChannel = vi.fn<RealtimeTicketApplicationServices["getChannel"]>()
    .mockResolvedValue({ id: channelId } as never);
  const getWorkspaceRole = vi.fn<
    RealtimeTicketApplicationServices["getWorkspaceRole"]
  >().mockResolvedValue("viewer");
  const getTeam = vi.fn<RealtimeTicketApplicationServices["getTeam"]>()
    .mockResolvedValue({ organization_id: workspaceId } as never);
  const getRun = vi.fn<RealtimeTicketApplicationServices["getRun"]>()
    .mockResolvedValue({ id: runId } as never);
  return {
    value: {
      createChannelActivityTicket,
      createIssueActivityTicket,
      createWorkspaceTicket,
      getChannel,
      getWorkspaceRole,
      getTeam,
      getRun,
    },
    createChannelActivityTicket,
    createIssueActivityTicket,
    createWorkspaceTicket,
    getChannel,
    getWorkspaceRole,
    getTeam,
    getRun,
  };
};

describe("realtime ticket application", () => {
  it("authorizes each scope and derives the issue workspace from the project", async () => {
    const mocks = services();
    const common = {
      db: {} as D1Database,
      signingSecret: "signing-secret",
      userId,
    };

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: {
        type: "workspaceNotifications",
        workspaceId,
      },
    }, mocks.value)).resolves.toEqual({
      socketPath: `/workspaces/${workspaceId}/channel-events`,
      ticket: "workspace-ticket",
    });
    expect(mocks.getWorkspaceRole).toHaveBeenNthCalledWith(
      1,
      common.db,
      workspaceId,
      userId,
    );

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: { type: "issueActivity", projectId, runId },
    }, mocks.value)).resolves.toEqual({
      socketPath: `/projects/${projectId}/runs/${runId}/agent-activity-events`,
      ticket: "issue-ticket",
    });
    expect(mocks.getTeam).toHaveBeenCalledWith(common.db, projectId, userId);
    expect(mocks.getRun).toHaveBeenCalledWith(common.db, projectId, runId);
    expect(mocks.createIssueActivityTicket).toHaveBeenCalledWith(
      "signing-secret",
      { workspaceId, projectId, runId, userId },
    );

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: { type: "channelActivity", workspaceId, channelId },
    }, mocks.value)).resolves.toEqual({
      socketPath:
        `/workspaces/${workspaceId}/channels/${channelId}/agent-activity-events`,
      ticket: "channel-ticket",
    });
    expect(mocks.getWorkspaceRole).toHaveBeenNthCalledWith(
      2,
      common.db,
      workspaceId,
      userId,
    );
    expect(mocks.getChannel).toHaveBeenCalledWith(
      common.db,
      workspaceId,
      channelId,
      userId,
    );
  });

  it("does not mint a ticket for an inaccessible issue scope", async () => {
    const mocks = services();
    mocks.getRun.mockResolvedValueOnce(null);

    await expect(createRealtimeTicketApplication({
      db: {} as D1Database,
      signingSecret: "signing-secret",
      userId,
      scope: { type: "issueActivity", projectId, runId },
    }, mocks.value)).rejects.toEqual(expect.objectContaining({
      name: "RealtimeTicketApplicationError",
      reason: "run_not_found",
    } satisfies Partial<RealtimeTicketApplicationError>));
    expect(mocks.createIssueActivityTicket).not.toHaveBeenCalled();
  });
});
