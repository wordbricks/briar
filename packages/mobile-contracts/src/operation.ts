import * as Schema from "effect/Schema";

export type MobileHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export type MobileOperationSecurity = "bearer" | "public";

export type MobileOperationRequest = {
  readonly path?: Schema.ConstraintDecoder<unknown>;
  readonly query?: Schema.ConstraintDecoder<unknown>;
  readonly body?: {
    readonly contentType: "application/json";
    readonly schema: Schema.ConstraintDecoder<unknown>;
  };
};

export type MobileOperationError = {
  readonly status: number;
  readonly responseComponent: string;
};

export type MobileOperationDefinition<
  Id extends string,
  Method extends MobileHttpMethod,
  Path extends string,
  ResponseSchema extends Schema.ConstraintDecoder<unknown>,
  ResponseComponent extends string,
  Security extends MobileOperationSecurity = MobileOperationSecurity,
> = {
  readonly id: Id;
  readonly method: Method;
  readonly path: Path;
  readonly security: Security;
  readonly request?: MobileOperationRequest;
  readonly errors: readonly MobileOperationError[];
  readonly response: {
    readonly status: number;
    readonly description: string;
    readonly contentType: "application/json";
    readonly component: ResponseComponent;
    /** Canonical response used by the Worker, clients, and generators. */
    readonly schema: ResponseSchema;
  };
};

export type AnyMobileOperation = MobileOperationDefinition<
  string,
  MobileHttpMethod,
  string,
  Schema.ConstraintDecoder<unknown>,
  string
>;

export const defineOperation = <
  const Id extends string,
  const Method extends MobileHttpMethod,
  const Path extends string,
  ResponseSchema extends Schema.ConstraintDecoder<unknown>,
  const ResponseComponent extends string,
  const Security extends MobileOperationSecurity,
>(
  definition: MobileOperationDefinition<
    Id,
    Method,
    Path,
    ResponseSchema,
    ResponseComponent,
    Security
  >,
) => definition;

/** Match an already-parsed URL pathname against an operation path template. */
export const matchesMobileOperation = (
  operation: Pick<AnyMobileOperation, "method" | "path">,
  method: string,
  pathname: string,
) => {
  if (method !== operation.method) return false;
  const expected = operation.path.split("/");
  const actual = pathname.split("/");
  return expected.length === actual.length && expected.every((segment, index) =>
    (/^\{[^{}]+\}$/u.test(segment) && actual[index]?.length !== 0) ||
    segment === actual[index]
  );
};

/**
 * Decode a response for a client. Server response helpers validate but
 * serialize their original value so response extensions are not stripped.
 */
export const decodeMobileOperationResponse = <
  Operation extends MobileOperationDefinition<
    string,
    MobileHttpMethod,
    string,
    Schema.ConstraintDecoder<unknown>,
    string
  >,
>(operation: Operation, input: unknown): Operation["response"]["schema"]["Type"] =>
  Schema.decodeUnknownSync(operation.response.schema, { errors: "all" })(input);

/** Validate a server response against the canonical operation schema. */
export const validateMobileOperationResponse = <
  Operation extends MobileOperationDefinition<
    string,
    MobileHttpMethod,
    string,
    Schema.ConstraintDecoder<unknown>,
    string
  >,
>(operation: Operation, input: unknown): void => {
  Schema.decodeUnknownSync(operation.response.schema, { errors: "all" })(input);
};
