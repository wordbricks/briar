import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isNonEmpty());

export const InboxReadVersions = Schema.Record(
  Schema.String,
  Schema.mutableKey(NonEmptyString),
).check(
  Schema.makeFilter((versions) => {
    const emptyKey = Object.keys(versions).find((key) => key.length === 0);
    return emptyKey === undefined
      ? undefined
      : {
          path: [emptyKey],
          issue: "Inbox read-version keys must not be empty",
        };
  }),
);
export type InboxReadVersions = typeof InboxReadVersions.Type;

export const decodeInboxReadVersions = Schema.decodeUnknownSync(
  InboxReadVersions,
);
