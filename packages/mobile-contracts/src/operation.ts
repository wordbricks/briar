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
  WireResponseSchema extends Schema.ConstraintDecoder<unknown>,
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
    /** Client decoder, including additive backwards-compatibility defaults. */
    readonly schema: ResponseSchema;
    /** Current server output shape used for response validation and OpenAPI. */
    readonly wireSchema: WireResponseSchema;
  };
  readonly swift: {
    readonly endpointName: string;
    readonly nestedResponseComponents: readonly string[];
  };
};

export type AnyMobileOperation = MobileOperationDefinition<
  string,
  MobileHttpMethod,
  string,
  Schema.ConstraintDecoder<unknown>,
  Schema.ConstraintDecoder<unknown>,
  string
>;

export const defineOperation = <
  const Id extends string,
  const Method extends MobileHttpMethod,
  const Path extends string,
  ResponseSchema extends Schema.ConstraintDecoder<unknown>,
  WireResponseSchema extends Schema.ConstraintDecoder<unknown>,
  const ResponseComponent extends string,
  const Security extends MobileOperationSecurity,
>(
  definition: MobileOperationDefinition<
    Id,
    Method,
    Path,
    ResponseSchema,
    WireResponseSchema,
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
 * Validate the wire value, returning the decoded value only for callers that
 * explicitly need defaults or transformations. Server response helpers should
 * serialize their original value so additive fields are not stripped.
 */
export const decodeMobileOperationResponse = <
  Operation extends MobileOperationDefinition<
    string,
    MobileHttpMethod,
    string,
    Schema.ConstraintDecoder<unknown>,
    Schema.ConstraintDecoder<unknown>,
    string
  >,
>(operation: Operation, input: unknown): Operation["response"]["schema"]["Type"] =>
  Schema.decodeUnknownSync(operation.response.schema, { errors: "all" })(input);

/** Validate the exact current server response without applying client defaults. */
export const validateMobileOperationResponse = <
  Operation extends MobileOperationDefinition<
    string,
    MobileHttpMethod,
    string,
    Schema.ConstraintDecoder<unknown>,
    Schema.ConstraintDecoder<unknown>,
    string
  >,
>(operation: Operation, input: unknown): void => {
  Schema.decodeUnknownSync(operation.response.wireSchema, { errors: "all" })(input);
};
