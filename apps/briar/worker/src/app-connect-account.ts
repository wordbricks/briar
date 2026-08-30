import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  AccountService,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import { withConnectErrors } from "./app-connect-errors";
import {
  appOrganizationMember,
  appUser,
} from "./app-connect-mappers";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationRole,
  listOrganizationMembers,
  listOrganizationProjectMemberships,
} from "./organization-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectAccountInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const decodeOrganizationId = decodeRequestSync(Schema.Struct({
  organizationId: UuidString,
}));

export const createAppAccountService = (
  { request, auth, db }: AppConnectAccountInput,
): ServiceImpl<typeof AccountService> => ({
  getCurrentUser: async () => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    return { user: appUser(session.user) };
  }),

  listOrganizationMembers: async (rpcRequest) => withConnectErrors(async () => {
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
      members: members.map((member) => appOrganizationMember(
        member,
        projectIdsByUser.get(member.user_id) ?? [],
      )),
    };
  }),
});

export function registerAppAccountService(
  router: ConnectRouter,
  input: AppConnectAccountInput,
) {
  router.service(AccountService, createAppAccountService(input));
}
