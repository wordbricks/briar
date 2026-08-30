import type { BriarAuth } from "./auth";
import {
  decodeOrganizationHandle,
  decodeOrganizationInput,
  decodeOrganizationInvitationInput,
  decodeOrganizationLogoInput,
  decodeOrganizationMemberInput,
  decodeOrganizationMemberProjectsInput,
  decodeOrganizationMemberRoleInput,
  decodeOrganizationUpdateInput,
} from "./account-organization-request-contract";
import { sha256 } from "./crypto-digest";
import { HttpError, corsHeaders, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  createOrganizationAgent,
  deleteOrganizationAgent,
  listOrganizationAgents,
  organizationAgentJson,
  updateOrganizationAgent,
} from "./organization-agents";
import {
  acceptOrganizationInvitation,
  addOrganizationMember,
  createOrganization,
  createOrganizationInvitation,
  isOrganizationHandleAvailable,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberRole,
  updateOrganizationMemberProjects,
} from "./organization-command-repository";
import {
  loadOrganizationInboxConditionalSnapshot,
  organizationInboxSyncJson,
} from "./organization-inbox-sync";
import { loadOrganizationInboxFeed } from "./organization-inbox-feed";
import { getOrganizationInboxSyncVersion } from "./organization-inbox-outbox-repository";
import {
  organizationInvitationJson,
  organizationJson,
  organizationMemberJson,
  publicOrganizationInvitationJson,
} from "./organization-json";
import {
  getOrganizationInvitationByTokenHash,
  getOrganizationRole,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizationProjectMemberships,
  listOrganizations,
  type OrganizationRow,
} from "./organization-repository";
import { decodeOrganizationAgentWrite } from "./project-request-contract";
import { readJson } from "./request-readers";
import { decodeUsageRangeDays } from "./run-request-contract";
import { requireSession } from "./session-auth";
import {
  estimateOrganizationUsageCosts,
  loadAgentUsagePricing,
} from "./usage-pricing";
import {
  listOrganizationUsageCostRecords,
  listOrganizationUsageExecutionAttempts,
  listOrganizationUsageRecords,
  listOrganizationUsageRuns,
  type OrganizationCostRecordRow,
  type OrganizationUsageRecordRow,
  type RunExecutionAttemptRow,
} from "./usage-repository";
import {
  organizationUsageQuerySince,
  organizationUsageRunJson,
} from "./usage-json";

const organizationInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000;

export type OrganizationRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
};

async function organizationMembersJson(
  db: D1Database,
  organizationId: string,
) {
  const [members, projectMemberships] = await Promise.all([
    listOrganizationMembers(db, organizationId),
    listOrganizationProjectMemberships(db, organizationId),
  ]);
  const projectIdsByUser = new Map<string, string[]>();
  for (const membership of projectMemberships) {
    const projectIds = projectIdsByUser.get(membership.user_id) ?? [];
    projectIds.push(membership.project_id);
    projectIdsByUser.set(membership.user_id, projectIds);
  }
  return members.map((member) =>
    organizationMemberJson(member, projectIdsByUser.get(member.user_id) ?? [])
  );
}

export async function handleOrganizationRoute(
  routeInput: OrganizationRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db } = routeInput;
  const { pathname } = url;

  const organizationInboxMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/inbox$/u,
  );
  if (organizationInboxMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInboxMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const result = await loadOrganizationInboxConditionalSnapshot({
      organizationId,
      ifNoneMatch: request.headers.get("if-none-match"),
      readVersion: () => getOrganizationInboxSyncVersion(db, organizationId),
      loadSnapshot: () => loadOrganizationInboxFeed(
        db,
        organizationId,
        session.user.id,
      ),
    });
    if (result.snapshot === null) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": "private, no-cache",
          ETag: result.etag,
        },
      });
    }
    return organizationInboxSyncJson(result.snapshot, result.etag);
  }

  const publicInvitationMatch = pathname.match(
    /^\/invitations\/(briar_invite_[0-9a-f]{64})$/u,
  );
  if (publicInvitationMatch && request.method === "GET") {
    const observedAt = new Date().toISOString();
    const invitation = await getOrganizationInvitationByTokenHash(
      db,
      await sha256(publicInvitationMatch[1]),
    );
    if (!invitation) throw new HttpError(404, "Invitation not found");
    return json({
      invitation: publicOrganizationInvitationJson(invitation, observedAt),
    });
  }
  if (publicInvitationMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const acceptedAt = new Date().toISOString();
    const result = await acceptOrganizationInvitation(db, {
      tokenHash: await sha256(publicInvitationMatch[1]),
      userId: session.user.id,
      emailNormalized: session.user.email.trim().toLowerCase(),
      acceptedAt,
    });
    if (result.outcome === "email_mismatch") {
      return json(
        {
          code: "INVITATION_EMAIL_MISMATCH",
          message:
            "Sign in with the email address that matches this invitation",
          signedInEmail: session.user.email,
        },
        409,
      );
    }
    if (result.outcome === "expired") {
      return json(
        { code: "INVITATION_EXPIRED", message: "Invitation expired" },
        410,
      );
    }
    if (result.outcome === "revoked") {
      return json(
        { code: "INVITATION_REVOKED", message: "Invitation revoked" },
        410,
      );
    }
    if (result.outcome === "invalid") {
      throw new HttpError(404, "Invitation not found");
    }
    return json({
      invitation: publicOrganizationInvitationJson(
        result.invitation,
        acceptedAt,
      ),
      alreadyAccepted: result.outcome === "already_accepted",
    });
  }

  if (pathname === "/organizations" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizations = await listOrganizations(db, session.user.id);
    return json({ organizations: organizations.map(organizationJson) });
  }

  const organizationUsageRunsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/usage\/runs$/u,
  );
  if (organizationUsageRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationUsageRunsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const days = decodeUsageRangeDays(url.searchParams.get("days") ?? "90");
    const generatedAt = Date.now();
    const since = organizationUsageQuerySince(days, generatedAt);
    const [runs, attempts, usageRecords, costRecords, loadedPricing] =
      await Promise.all([
        listOrganizationUsageRuns(db, organizationId, since),
        listOrganizationUsageExecutionAttempts(db, organizationId, since),
        listOrganizationUsageRecords(db, organizationId, since),
        listOrganizationUsageCostRecords(db, organizationId, since),
        loadAgentUsagePricing(),
      ]);
    const attemptsByRun = new Map<string, RunExecutionAttemptRow[]>();
    for (const attempt of attempts) {
      attemptsByRun.set(attempt.run_id, [
        ...(attemptsByRun.get(attempt.run_id) ?? []),
        attempt,
      ]);
    }
    const usageRecordsByRun = new Map<string, OrganizationUsageRecordRow[]>();
    for (const record of usageRecords) {
      usageRecordsByRun.set(record.run_id, [
        ...(usageRecordsByRun.get(record.run_id) ?? []),
        record,
      ]);
    }
    const costRecordsByRun = new Map<string, OrganizationCostRecordRow[]>();
    for (const record of costRecords) {
      costRecordsByRun.set(record.run_id, [
        ...(costRecordsByRun.get(record.run_id) ?? []),
        record,
      ]);
    }
    return json({
      runs: runs.map((run) =>
        organizationUsageRunJson(run, {
          attempts: attemptsByRun.get(run.id),
          records: usageRecordsByRun.get(run.id),
          costRecords: costRecordsByRun.get(run.id),
          estimatedCostRecords: estimateOrganizationUsageCosts({
            usageRecords: usageRecordsByRun.get(run.id) ?? [],
            costRecords: costRecordsByRun.get(run.id) ?? [],
            table: loadedPricing.table,
          }),
        })
      ),
      generatedAt: new Date(generatedAt).toISOString(),
      pricing: loadedPricing.pricing,
    });
  }

  if (
    pathname === "/organizations/handle-availability" &&
    request.method === "GET"
  ) {
    await requireSession(auth, request);
    const handle = decodeOrganizationHandle(url.searchParams.get("handle"));
    return json({
      available: await isOrganizationHandleAvailable(db, handle),
    });
  }

  if (pathname === "/organizations" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = decodeOrganizationInput(await readJson(request));
    if (!(await isOrganizationHandleAvailable(db, input.handle))) {
      throw new HttpError(409, "Organization handle already exists");
    }
    let organization: OrganizationRow;
    try {
      organization = await createOrganization(db, {
        name: input.name,
        handle: input.handle,
        ownerUserId: session.user.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique") && message.includes("handle")) {
        throw new HttpError(409, "Organization handle already exists");
      }
      throw error;
    }
    return json({ organization: organizationJson(organization) }, 201);
  }

  const organizationMatch = pathname.match(/^\/organizations\/([0-9a-f-]+)$/u);
  if (organizationMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMatch[1],
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:update")) {
      throw new HttpError(403, "Organization management permission required");
    }
    const input = decodeOrganizationUpdateInput(await readJson(request));
    const organization = await updateOrganization(
      db,
      organizationMatch[1],
      input.name,
      role!,
    );
    if (!organization) throw new HttpError(404, "Organization not found");
    return json({ organization: organizationJson(organization) });
  }

  const organizationLogoMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/logo$/u,
  );
  if (organizationLogoMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationLogoMatch[1],
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:update")) {
      throw new HttpError(403, "Organization management permission required");
    }
    const input = decodeOrganizationLogoInput(await readJson(request));
    const organization = await updateOrganizationLogo(
      db,
      organizationLogoMatch[1],
      input.logo,
      role!,
    );
    if (!organization) throw new HttpError(404, "Organization not found");
    return json({ organization: organizationJson(organization) });
  }

  const organizationInvitationsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/invitations$/u,
  );
  if (organizationInvitationsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "invitations:manage")) {
      throw new HttpError(403, "Invitation management permission required");
    }
    const invitations = await listOrganizationInvitations(db, organizationId);
    const observedAt = new Date().toISOString();
    return json({
      invitations: invitations.map((invitation) =>
        organizationInvitationJson(invitation, observedAt)
      ),
    });
  }
  if (organizationInvitationsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "invitations:manage")) {
      throw new HttpError(403, "Invitation management permission required");
    }
    const input = decodeOrganizationInvitationInput(await readJson(request));
    const token = `briar_invite_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const createdAt = new Date().toISOString();
    const result = await createOrganizationInvitation(db, {
      id: crypto.randomUUID(),
      organizationId,
      initialProjectId: input.initialProjectId,
      emailNormalized: input.email,
      role: input.role,
      tokenHash: await sha256(token),
      invitedByUserId: session.user.id,
      expiresAt: new Date(
        Date.now() + organizationInvitationTtlMs,
      ).toISOString(),
      createdAt,
    });
    if (result.outcome === "project_not_found") {
      throw new HttpError(404, "Invitation project not found");
    }
    if (result.outcome === "already_member") {
      throw new HttpError(
        409,
        "A member with that email already belongs to this organization",
      );
    }
    return json(
      {
        invitation: organizationInvitationJson(result.invitation, createdAt),
        invitePath: `/app/invitations/${token}`,
      },
      201,
    );
  }

  const organizationInvitationMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/invitations\/([0-9a-f-]+)$/u,
  );
  if (organizationInvitationMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "invitations:manage")) {
      throw new HttpError(403, "Invitation management permission required");
    }
    const revoked = await revokeOrganizationInvitation(
      db,
      organizationId,
      organizationInvitationMatch[2],
      new Date().toISOString(),
    );
    if (!revoked) throw new HttpError(404, "Pending invitation not found");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationMembersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members$/u,
  );
  if (organizationMembersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    return json({
      members: await organizationMembersJson(
        db,
        organizationMembersMatch[1],
      ),
    });
  }
  if (organizationMembersMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "members:manage")) {
      throw new HttpError(403, "Member management permission required");
    }
    const input = decodeOrganizationMemberInput(await readJson(request));
    const userId = await addOrganizationMember(
      db,
      organizationMembersMatch[1],
      input.email,
      input.role,
    );
    if (!userId) {
      throw new HttpError(404, "A Briar user with that email was not found");
    }
    return json({
      members: await organizationMembersJson(
        db,
        organizationMembersMatch[1],
      ),
    });
  }

  const organizationMemberProjectsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members\/([^/]+)\/projects$/u,
  );
  if (organizationMemberProjectsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const organizationId = organizationMemberProjectsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "members:manage")) {
      throw new HttpError(403, "Member management permission required");
    }
    const input = decodeOrganizationMemberProjectsInput(
      await readJson(request),
    );
    const outcome = await updateOrganizationMemberProjects(
      db,
      organizationId,
      decodeURIComponent(organizationMemberProjectsMatch[2]),
      input.projectIds,
    );
    if (outcome === "member_not_found") {
      throw new HttpError(404, "Member not found");
    }
    if (outcome === "role_has_full_access") {
      throw new HttpError(
        409,
        "Organization owners and co-owners always have access to every project",
      );
    }
    if (outcome === "project_not_found") {
      throw new HttpError(400, "Every project must belong to the organization");
    }
    return json({ members: await organizationMembersJson(db, organizationId) });
  }

  const organizationMemberMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members\/([^/]+)$/u,
  );
  if (organizationMemberMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationMemberMatch[1];
    const memberId = decodeURIComponent(organizationMemberMatch[2]);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "members:manage")) {
      throw new HttpError(403, "Member management permission required");
    }
    if (memberId === session.user.id) {
      throw new HttpError(400, "You cannot change your own organization role");
    }
    const memberRole = await getOrganizationRole(db, organizationId, memberId);
    if (!memberRole) throw new HttpError(404, "Member not found");
    if (memberRole === "owner") {
      throw new HttpError(403, "Organization owner role cannot be changed");
    }
    const input = decodeOrganizationMemberRoleInput(await readJson(request));
    const updated = await updateOrganizationMemberRole(
      db,
      organizationId,
      memberId,
      input.role,
    );
    if (!updated) throw new HttpError(404, "Member not found");
    return json({ members: await organizationMembersJson(db, organizationId) });
  }
  if (organizationMemberMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMemberMatch[1],
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "members:manage")) {
      throw new HttpError(403, "Member management permission required");
    }
    const removed = await removeOrganizationMember(
      db,
      organizationMemberMatch[1],
      decodeURIComponent(organizationMemberMatch[2]),
    );
    if (!removed) throw new HttpError(404, "Member not found");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationAgentsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/agents$/u,
  );
  if (organizationAgentsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const agents = await listOrganizationAgents(db, organizationId);
    return json({
      agents: agents.map(organizationAgentJson),
      canManage: hasOrganizationCapability(role, "development:manage"),
    });
  }
  if (organizationAgentsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeOrganizationAgentWrite(await readJson(request));
    const agent = await createOrganizationAgent(db, {
      id: crypto.randomUUID(),
      organizationId,
      name: input.name,
      provider: input.provider,
      model: input.model,
      description: input.description ?? "",
      responsibility: input.responsibility,
      effort: input.effort,
      skills: input.skills ?? [],
      createdAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(500, "Agent was not created");
    return json({ agent: organizationAgentJson(agent) }, 201);
  }

  const organizationAgentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (organizationAgentMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeOrganizationAgentWrite(await readJson(request));
    const agent = await updateOrganizationAgent(db, {
      organizationId,
      agentId: organizationAgentMatch[2],
      name: input.name,
      provider: input.provider,
      model: input.model,
      description: input.description,
      responsibility: input.responsibility,
      effort: input.effort,
      skills: input.skills,
      updatedAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(404, "Organization agent not found");
    return json({ agent: organizationAgentJson(agent) });
  }
  if (organizationAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const deleted = await deleteOrganizationAgent(
      db,
      organizationId,
      organizationAgentMatch[2],
    );
    if (!deleted) throw new HttpError(404, "Organization agent not found");
    return json({ deleted: true });
  }
}
