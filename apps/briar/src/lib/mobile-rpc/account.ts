import { createClient } from "@connectrpc/connect";
import { AccountService } from "@briar/mobile-contracts/gen/briar/mobile/v1/account_pb";
import type { SessionUser } from "../../types";
import {
  mobileCallOptions,
  mobileRpc,
  mobileTransport,
} from "./core";
import { organizationMemberFromProto } from "./mappers";

const accountClient = mobileTransport
  ? createClient(AccountService, mobileTransport)
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
  return mobileRpc(async () => {
    const response = await client.getCurrentUser(
      {},
      mobileCallOptions(token, signal),
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

export async function listOrganizationMembers(
  token: string,
  organizationId: string,
  signal?: AbortSignal,
) {
  const client = requireAccountClient();
  return mobileRpc(async () => {
    const response = await client.listOrganizationMembers(
      { organizationId },
      mobileCallOptions(token, signal),
    );
    return response.members.map(organizationMemberFromProto);
  });
}
