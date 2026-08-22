import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

export class RequestDecodeError extends Data.TaggedError(
  "RequestDecodeError",
)<{
  readonly cause: Schema.SchemaError;
}> {
  override get message() {
    return this.cause.message;
  }
}

export const decodeRequestSync = <
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: S,
) => {
  const decode = Schema.decodeUnknownSync(schema, { errors: "all" });
  return (input: unknown): S["Type"] => {
    try {
      return decode(input);
    } catch (cause) {
      if (Schema.isSchemaError(cause)) {
        throw new RequestDecodeError({ cause });
      }
      throw cause;
    }
  };
};
