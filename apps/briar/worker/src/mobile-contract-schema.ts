import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const mobileSchemaDecodeOptions = { errors: "all" } as const;

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

type MutableFields<Fields extends Schema.Struct.Fields> = {
  readonly [Key in keyof Fields]: Schema.mutableKey<Fields[Key]>;
};

/** Preserve mutable object types at mobile protocol boundaries. */
export const mutableStruct = <const Fields extends Schema.Struct.Fields>(
  fields: Fields,
): Schema.Struct<MutableFields<Fields>> => {
  const mutableFields = {} as {
    -readonly [Key in keyof Fields]: Schema.mutableKey<Fields[Key]>;
  };
  for (const key of Reflect.ownKeys(fields) as Array<keyof Fields>) {
    mutableFields[key] = Schema.mutableKey(fields[key]);
  }
  return Schema.Struct(mutableFields);
};

export const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

/** Reject excess properties at this exact object boundary. */
export const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });

/** Preserve arbitrary properties at this exact object boundary. */
export const passthrough = <
  S extends Schema.Struct<Schema.Struct.Fields>,
>(schema: S) =>
  Schema.StructWithRest(
    schema,
    [
      Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
    ] as const,
  );

export const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);

/** Use for mutable defaults so each decode receives a fresh value. */
export const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);

export const nonEmptyString = Schema.NonEmptyString;
export const emailString = Schema.String.check(Schema.isPattern(
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/u,
  { expected: "an email address" },
));
export const uuidString = Schema.String.check(Schema.isUUID());
export const urlString = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return "Expected a valid URL";
    }
  }),
);
export const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
export const nonNegativeInteger = Schema.Natural;
export const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );
export const numberBetween = (minimum: number, maximum: number) =>
  Schema.Finite.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

export const decodeMobileSchema = <
  S extends Schema.ConstraintDecoder<unknown>,
>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema, mobileSchemaDecodeOptions)(input);

export const decodeMobileSchemaOption = <
  S extends Schema.ConstraintDecoder<unknown>,
>(schema: S, input: unknown): Option.Option<S["Type"]> =>
  Schema.decodeUnknownOption(schema, mobileSchemaDecodeOptions)(input);
