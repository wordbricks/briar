import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const schemaDecodeOptions = { errors: "all" } as const;
export const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

export const strictSchema = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });

export const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

export const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);

export const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);

export const trimmedText = (minimumLength: number, maximumLength: number) =>
  Schema.Trim.check(
    Schema.isLengthBetween(minimumLength, maximumLength),
  );

export const PositiveSafeInteger = Schema.Int.check(
  Schema.isGreaterThan(0),
);

export const NonNegativeSafeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);

export const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

export const UuidString = Schema.String.check(Schema.isUUID());

export const UrlString = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return "Expected a valid URL";
    }
  }),
);
