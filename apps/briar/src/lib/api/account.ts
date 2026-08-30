import * as Schema from "effect/Schema";
import type { SessionUser } from "../../types";
import { ApiResponseDecodeError } from "./errors";
import {
  deleteCurrentUser,
  getCurrentUser,
  updateCurrentUserProfile,
  type AccountProfileInput,
} from "../app-rpc/account";

const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/u;

export const SessionUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  email: Schema.String.check(Schema.isPattern(emailPattern)),
  image: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateAccountProfileInput = AccountProfileInput;

async function decodeSessionUser(
  user: SessionUser,
  path: string,
): Promise<SessionUser> {
  try {
    return await Schema.decodePromise(SessionUserSchema)(user);
  } catch (cause) {
    if (Schema.isSchemaError(cause)) {
      throw new ApiResponseDecodeError(path, cause);
    }
    throw cause;
  }
}

export async function loadSession(token: string): Promise<SessionUser> {
  return decodeSessionUser(
    await getCurrentUser(token),
    "/briar.app.v1.AccountService/GetCurrentUser",
  );
}

export async function updateAccountProfile(
  token: string,
  input: UpdateAccountProfileInput,
): Promise<SessionUser> {
  return decodeSessionUser(
    await updateCurrentUserProfile(token, input),
    "/briar.app.v1.AccountService/UpdateAccountProfile",
  );
}

export async function deleteAccount(
  token: string,
  confirmation: string,
): Promise<void> {
  await deleteCurrentUser(token, confirmation);
}
