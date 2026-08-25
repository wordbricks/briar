import * as Schema from "effect/Schema";
import type { SessionUser } from "../../types";
import { ApiResponseDecodeError } from "./errors";
import { request } from "./request";

const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/u;

export const SessionUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  email: Schema.String.check(Schema.isPattern(emailPattern)),
  image: Schema.optional(Schema.NullOr(Schema.String)),
});

const SessionEnvelope = Schema.Struct({
  user: SessionUserSchema,
});

export type UpdateAccountProfileInput = {
  username: string;
  name: string;
  image: string | null;
};

async function requestDecoded<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<S["Type"]> {
  const body = await request<unknown>(path, token, init);
  try {
    return await Schema.decodeUnknownPromise(schema)(body);
  } catch (cause) {
    if (Schema.isSchemaError(cause)) {
      throw new ApiResponseDecodeError(path, cause);
    }
    throw cause;
  }
}

export async function loadSession(token: string): Promise<SessionUser> {
  const result = await requestDecoded(SessionEnvelope, "/me", token);
  return result.user;
}

export async function updateAccountProfile(
  token: string,
  input: UpdateAccountProfileInput,
): Promise<SessionUser> {
  const result = await requestDecoded(SessionEnvelope, "/me", token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.user;
}

export async function deleteAccount(
  token: string,
  confirmation: string,
): Promise<void> {
  await request<void>("/me", token, {
    method: "DELETE",
    body: JSON.stringify({ confirmation }),
  });
}
