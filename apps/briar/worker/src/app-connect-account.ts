import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  AccountService,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import type { BriarAuth } from "./auth";
import { withConnectErrors } from "./app-connect-errors";
import { appUser } from "./app-connect-mappers";
import { requireSession } from "./session-auth";

export type AppConnectAccountInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

export const createAppAccountService = (
  { request, auth }: AppConnectAccountInput,
): ServiceImpl<typeof AccountService> => ({
  getCurrentUser: async () => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    return { user: appUser(session.user) };
  }),
});

export function registerAppAccountService(
  router: ConnectRouter,
  input: AppConnectAccountInput,
) {
  router.service(AccountService, createAppAccountService(input));
}
