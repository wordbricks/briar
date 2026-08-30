import { createClient } from "@connectrpc/connect";
import { AccountService } from "@briar/contracts/gen/briar/app/v1/account_pb";
import type { SessionUser } from "../../types";
import { appCallOptions, appRpc, appTransport } from "./core";

const accountClient = appTransport
  ? createClient(AccountService, appTransport)
  : undefined;

const requireAccountClient = () => {
  if (!accountClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return accountClient;
};

export async function getCurrentUser(
  token: string,
  signal?: AbortSignal,
): Promise<SessionUser> {
  const client = requireAccountClient();
  return appRpc(async () => {
    const response = await client.getCurrentUser(
      {},
      appCallOptions(token, signal),
    );
    if (response.user === undefined) throw new Error("Current user is missing");
    return {
      id: response.user.id,
      username: response.user.username ?? null,
      name: response.user.name,
      email: response.user.email,
      image: response.user.image ?? null,
    };
  });
}
