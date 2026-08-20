import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SessionUser } from "../../types";
import {
  requestDecodedEffect,
  requestVoidEffect,
  runApiPromise,
} from "./request";

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

export const loadSessionEffect = Effect.fn("loadSessionEffect")(
  function*(token: string) {
    const result = yield* requestDecodedEffect(
      SessionEnvelope,
      "/me",
      token,
    );
    return result.user;
  },
);

export const updateAccountProfileEffect = Effect.fn(
  "updateAccountProfileEffect",
)(function*(token: string, input: UpdateAccountProfileInput) {
  const result = yield* requestDecodedEffect(SessionEnvelope, "/me", token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.user;
});

export const deleteAccountEffect = Effect.fn("deleteAccountEffect")(
  function*(token: string, confirmation: string) {
    yield* requestVoidEffect("/me", token, {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    });
  },
);

export function loadSession(token: string): Promise<SessionUser> {
  return runApiPromise(loadSessionEffect(token));
}

export function updateAccountProfile(
  token: string,
  input: UpdateAccountProfileInput,
): Promise<SessionUser> {
  return runApiPromise(updateAccountProfileEffect(token, input));
}

export function deleteAccount(
  token: string,
  confirmation: string,
): Promise<void> {
  return runApiPromise(deleteAccountEffect(token, confirmation));
}
