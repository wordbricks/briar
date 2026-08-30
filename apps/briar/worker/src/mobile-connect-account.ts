import type { ConnectRouter } from "@connectrpc/connect";
import {
  AccountService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/account_pb";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import { withConnectErrors } from "./mobile-connect-errors";
import {
  mobileOrganizationMember,
  mobileUser,
} from "./mobile-connect-mappers";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationRole,
  listOrganizationMembers,
  listOrganizationProjectMemberships,
} from "./organization-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type MobileConnectAccountInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const decodeOrganizationId = decodeRequestSync(Schema.Struct({
  organizationId: UuidString,
}));

export const createMobileAccountService = (
  { request, auth, db }: MobileConnectAccountInput,
) => ({
  getCurrentUser: async () => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    return { user: mobileUser(session.user) };
  }),

  listOrganizationMembers: async (rpcRequest: {
    readonly organizationId: string;
  }) => withConnectErrors(async () => {
    const input = decodeOrganizationId({
      organizationId: rpcRequest.organizationId,
    });
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      input.organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const [members, projectMemberships] = await Promise.all([
      listOrganizationMembers(db, input.organizationId),
      listOrganizationProjectMemberships(db, input.organizationId),
    ]);
    const projectIdsByUser = new Map<string, string[]>();
    for (const membership of projectMemberships) {
      const projectIds = projectIdsByUser.get(membership.user_id) ?? [];
      projectIds.push(membership.project_id);
      projectIdsByUser.set(membership.user_id, projectIds);
    }
    return {
      members: members.map((member) => mobileOrganizationMember(
        member,
        projectIdsByUser.get(member.user_id) ?? [],
      )),
    };
  }),
});

export function registerMobileAccountService(
  router: ConnectRouter,
  input: MobileConnectAccountInput,
) {
  router.service(AccountService, createMobileAccountService(input));
}
