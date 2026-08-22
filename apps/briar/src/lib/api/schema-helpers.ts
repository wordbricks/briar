import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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

export const UuidString = Schema.String.check(Schema.isUUID());

export const NonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);

export const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

export const DataImageString = Schema.String.check(
  Schema.isMaxLength(400_000),
  Schema.isPattern(/^data:image\/(?:jpeg|png|webp);base64,/u),
);
