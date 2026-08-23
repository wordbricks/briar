import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class SignedJsonTokenError extends Schema.TaggedError<SignedJsonTokenError>()(
  "SignedJsonTokenError",
  { cause: Schema.Defect() },
) {}

const base64UrlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const base64UrlDecode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const hmacKeyEffect = Effect.fnUntraced(function*(
  domain: string,
  secret: string,
  usages: KeyUsage[],
) {
  return yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(`${domain}:${secret}`),
        { name: "HMAC", hash: "SHA-256" },
        false,
        usages,
      ),
    catch: (cause) => new SignedJsonTokenError({ cause }),
  });
});

export const signJsonTokenEffect = Effect.fn("signJsonTokenEffect")(
  function*(domain: string, secret: string, payload: object) {
    const encodedPayload = yield* Effect.try({
      try: () => base64UrlEncode(encoder.encode(JSON.stringify(payload))),
      catch: (cause) => new SignedJsonTokenError({ cause }),
    });
    const key = yield* hmacKeyEffect(domain, secret, ["sign"]);
    const signature = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(encodedPayload),
        ),
      catch: (cause) => new SignedJsonTokenError({ cause }),
    });
    return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
  },
);

export const verifyJsonTokenEffect = Effect.fn("verifyJsonTokenEffect")(
  function*(domain: string, secret: string, token: string) {
    const verified = yield* Effect.gen(function*() {
      const parts = token.split(".");
      if (parts.length !== 2) {
        return yield* new SignedJsonTokenError({
          cause: new Error("Signed token must contain two segments"),
        });
      }
      const [encodedPayload, encodedSignature] = parts;
      const signature = yield* Effect.try({
        try: () => base64UrlDecode(encodedSignature),
        catch: (cause) => new SignedJsonTokenError({ cause }),
      });
      const key = yield* hmacKeyEffect(domain, secret, ["verify"]);
      const valid = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.verify(
            "HMAC",
            key,
            signature,
            encoder.encode(encodedPayload),
          ),
        catch: (cause) => new SignedJsonTokenError({ cause }),
      });
      if (!valid) {
        return yield* new SignedJsonTokenError({
          cause: new Error("Signed token signature is invalid"),
        });
      }
      return yield* Effect.try({
        try: () => decoder.decode(base64UrlDecode(encodedPayload)),
        catch: (cause) => new SignedJsonTokenError({ cause }),
      });
    }).pipe(
      Effect.map(Option.some),
      Effect.catch(() => Effect.succeed(Option.none())),
    );
    return verified;
  },
);

export async function signJsonToken(
  domain: string,
  secret: string,
  payload: object,
): Promise<string> {
  try {
    return await Effect.runPromise(signJsonTokenEffect(domain, secret, payload));
  } catch (error) {
    if (error instanceof SignedJsonTokenError) throw error.cause;
    throw error;
  }
}

export const verifyJsonToken = (
  domain: string,
  secret: string,
  token: string,
): Promise<Option.Option<string>> =>
  Effect.runPromise(verifyJsonTokenEffect(domain, secret, token));
