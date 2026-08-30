import { describe, expect, it, vi } from "vitest";
import {
  createRealtimeTicketApplication,
  RealtimeTicketApplicationError,
  type RealtimeTicketApplicationServices,
} from "./realtime-ticket-application";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const channelId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

const services = (): {
  readonly value: RealtimeTicketApplicationServices;
  readonly createChannelActivityTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createChannelActivityTicket"]>
  >;
  readonly createIssueActivityTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createIssueActivityTicket"]>
  >;
  readonly createOrganizationTicket: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["createOrganizationTicket"]>
  >;
  readonly getChannel: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getChannel"]>
  >;
  readonly getOrganizationRole: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getOrganizationRole"]>
  >;
  readonly getProject: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getProject"]>
  >;
  readonly getRun: ReturnType<
    typeof vi.fn<RealtimeTicketApplicationServices["getRun"]>
  >;
} => {
  const createChannelActivityTicket = vi.fn<
    RealtimeTicketApplicationServices["createChannelActivityTicket"]
  >().mockResolvedValue({ ticket: "channel-ticket", expiresAt: 1 } as never);
  const createIssueActivityTicket = vi.fn<
    RealtimeTicketApplicationServices["createIssueActivityTicket"]
  >().mockResolvedValue({ ticket: "issue-ticket", expiresAt: 1 } as never);
  const createOrganizationTicket = vi.fn<
    RealtimeTicketApplicationServices["createOrganizationTicket"]
  >().mockResolvedValue({ ticket: "organization-ticket", expiresAt: 1 } as never);
  const getChannel = vi.fn<RealtimeTicketApplicationServices["getChannel"]>()
    .mockResolvedValue({ id: channelId } as never);
  const getOrganizationRole = vi.fn<
    RealtimeTicketApplicationServices["getOrganizationRole"]
  >().mockResolvedValue("viewer");
  const getProject = vi.fn<RealtimeTicketApplicationServices["getProject"]>()
    .mockResolvedValue({ organization_id: organizationId } as never);
  const getRun = vi.fn<RealtimeTicketApplicationServices["getRun"]>()
    .mockResolvedValue({ id: runId } as never);
  return {
    value: {
      createChannelActivityTicket,
      createIssueActivityTicket,
      createOrganizationTicket,
      getChannel,
      getOrganizationRole,
      getProject,
      getRun,
    },
    createChannelActivityTicket,
    createIssueActivityTicket,
    createOrganizationTicket,
    getChannel,
    getOrganizationRole,
    getProject,
    getRun,
  };
};

describe("realtime ticket application", () => {
  it("authorizes each scope and derives the issue organization from the project", async () => {
    const mocks = services();
    const common = {
      db: {} as D1Database,
      signingSecret: "signing-secret",
      userId,
    };

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: {
        type: "organizationNotifications",
        organizationId,
      },
    }, mocks.value)).resolves.toEqual({
      socketPath: `/organizations/${organizationId}/channel-events`,
      ticket: "organization-ticket",
    });
    expect(mocks.getOrganizationRole).toHaveBeenNthCalledWith(
      1,
      common.db,
      organizationId,
      userId,
    );

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: { type: "issueActivity", projectId, runId },
    }, mocks.value)).resolves.toEqual({
      socketPath: `/projects/${projectId}/runs/${runId}/agent-activity-events`,
      ticket: "issue-ticket",
    });
    expect(mocks.getProject).toHaveBeenCalledWith(common.db, projectId, userId);
    expect(mocks.getRun).toHaveBeenCalledWith(common.db, projectId, runId);
    expect(mocks.createIssueActivityTicket).toHaveBeenCalledWith(
      "signing-secret",
      { organizationId, projectId, runId, userId },
    );

    await expect(createRealtimeTicketApplication({
      ...common,
      scope: { type: "channelActivity", organizationId, channelId },
    }, mocks.value)).resolves.toEqual({
      socketPath:
        `/organizations/${organizationId}/channels/${channelId}/agent-activity-events`,
      ticket: "channel-ticket",
    });
    expect(mocks.getOrganizationRole).toHaveBeenNthCalledWith(
      2,
      common.db,
      organizationId,
      userId,
    );
    expect(mocks.getChannel).toHaveBeenCalledWith(
      common.db,
      organizationId,
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
