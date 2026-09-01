import * as Schema from "effect/Schema";

const strictParseOptions = {
  onExcessProperty: "error",
} as const;

/**
 * Runtime proof constraints that protobuf cannot encode. Protobuf owns the
 * request fields; this shared schema owns the security limits applied by both
 * the bootstrap client and Worker domain adapter.
 */
export const ManagedComputerEnrollmentProof = Schema.Struct({
  nonce: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u),
  ),
  identityDocument: Schema.String.check(
    Schema.isMinLength(2),
    Schema.isMaxLength(16_384),
  ),
  identitySignature: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9+/=\r\n]{64,8192}$/u),
  ),
  briarVersion: Schema.String.check(
    Schema.isLengthBetween(1, 64),
    Schema.isTrimmed(),
  ),
}).annotate({ parseOptions: strictParseOptions });

export type ManagedComputerEnrollmentProof =
  typeof ManagedComputerEnrollmentProof.Type;
