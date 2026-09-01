import { HttpError } from "./http-response";

const canonicalProjectId = (value: string | null | undefined) =>
  value ? value.toLowerCase() : null;

export function resolveChannelProposalTargetProjectId(input: {
  requestedProjectId: string | null | undefined;
  proposedProjectId: string | null | undefined;
  defaultProjectId: string | null | undefined;
}) {
  const proposedProjectId = canonicalProjectId(input.proposedProjectId);
  const requestedProjectId = canonicalProjectId(input.requestedProjectId);
  const defaultProjectId = canonicalProjectId(input.defaultProjectId);
  // UUIDs are case-insensitive. Native iOS encodes UUID request fields in
  // uppercase, while stored proposal project IDs are lowercase. Compare the
  // canonical form so the same project is not rejected as a mismatch.
  if (
    proposedProjectId &&
    requestedProjectId &&
    proposedProjectId !== requestedProjectId
  ) {
    throw new HttpError(
      400,
      "The approved project must match the Agent proposal",
    );
  }
  return proposedProjectId ??
    requestedProjectId ??
    defaultProjectId ??
    null;
}

export function assertChannelProposalAuthorScope(input: {
  channelOrganizationId: string;
  proposedProjectId: string | null;
  replyAuthorAgentId: string | null;
  replyAuthorAgentOrganizationId: string | null;
  replyAuthorAgentProjectId: string | null;
}) {
  if (
    !input.replyAuthorAgentId ||
    !input.replyAuthorAgentOrganizationId ||
    input.replyAuthorAgentOrganizationId !== input.channelOrganizationId
  ) {
    throw new HttpError(
      409,
      "The Agent proposal scope can no longer be verified; request a new proposal",
    );
  }
  if (
    input.replyAuthorAgentProjectId !== null &&
    input.replyAuthorAgentProjectId !== input.proposedProjectId
  ) {
    // Older workers could persist a null or cross-project target for a
    // Project Agent. Never reinterpret what the member saw and approved.
    throw new HttpError(
      409,
      "The Project Agent proposal scope is invalid; request a new proposal",
    );
  }
}

export function approvedIssueCreation<T extends Record<string, unknown>>(
  issue: T,
) {
  return {
    ...issue,
    // Creating and executing are separate approvals. A creation proposal
    // always starts in the backlog and never enters the worker queue.
    status: "backlog" as const,
    checkpoints: [] as never[],
  };
}

export function channelRelatedMessageReference(input: {
  organizationId: string;
  channelId: string;
  messageId: string;
  rootMessageId: string | null;
}) {
  return {
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.messageId,
    // A root message is required by the in-app deep-link handler. A proposal
    // reply without a parent is still a valid message target, so use itself.
    rootMessageId: input.rootMessageId?.trim() || input.messageId,
  };
}

/**
 * Read the change cursor before the channel catalog. If a channel mutation
 * lands between the two reads, the catalog already contains it and the older
 * cursor safely replays the same mutation. Reading in the opposite order can
 * return an old catalog with a new cursor and permanently skip that change.
 */
export async function loadChannelCatalogSnapshot<T>(
  readCursor: () => Promise<number>,
  readChannels: () => Promise<T[]>,
) {
  const cursor = await readCursor();
  const channels = await readChannels();
  return { channels, cursor };
}
