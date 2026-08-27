import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import {
  defaulted,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/u;

const Email = Schema.Trim.check(
  Schema.isPattern(emailPattern),
  Schema.isMaxLength(320),
);

const LowercaseEmail = Email.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.toLowerCase()),
    encode: SchemaGetter.transform((value) => value.toLowerCase()),
  }),
);

const LowercaseUsername = Schema.Trim.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.toLowerCase()),
    encode: SchemaGetter.transform((value) => value.toLowerCase()),
  }),
).check(
  Schema.isLengthBetween(3, 30),
  Schema.isPattern(/^[a-z0-9_]+$/u),
);

const AccountImage = Schema.Union([
  Schema.String.check(
    Schema.isMaxLength(400_000),
    Schema.isPattern(/^data:image\/(?:jpeg|png|webp);base64,/u),
  ),
  Schema.String.check(
    Schema.isMaxLength(400_000),
    Schema.makeFilter((value) => {
      try {
        return new URL(value).protocol === "https:"
          ? undefined
          : "HTTPS URL required";
      } catch {
        return "Expected a valid URL";
      }
    }),
  ),
]);

export const AccountProfileInput = Schema.Struct({
  username: Schema.NullOr(LowercaseUsername),
  name: trimmedText(1, 100),
  image: Schema.NullOr(AccountImage),
});

const inboxReadStateMaxEntries = 2_000;
const InboxReadStateMessageId = Schema.Trim.check(
  Schema.isLengthBetween(1, 200),
  Schema.isPattern(/^(?:issue|session|conversation|channel):.+$/u),
);
const InboxReadStateVersion = trimmedText(1, 500);

export const InboxReadStatesInput = strictSchema(Schema.Struct({
  readVersions: defaulted(
    Schema.Record(InboxReadStateMessageId, InboxReadStateVersion),
    {},
  ),
}).check(
  Schema.makeFilter((input) =>
    Object.keys(input.readVersions).length <= inboxReadStateMaxEntries
      ? undefined
      : {
          path: ["readVersions"],
          issue:
            `At most ${inboxReadStateMaxEntries} inbox read states are allowed`,
        }
  ),
));

export const InboxUnreadStateInput = strictSchema(Schema.Struct({
  messageId: InboxReadStateMessageId,
}));

export const ProjectAgentScheduleBatchClaim = strictSchema(Schema.Struct({
  projectIds: Schema.mutable(Schema.Array(UuidString)).check(
    Schema.isLengthBetween(1, 100),
  ),
}));

export const AccountDeletionInput = strictSchema(Schema.Struct({
  confirmation: Email,
}));

export const OrganizationHandle = Schema.Trim.check(
  Schema.isLengthBetween(1, 63),
  Schema.isPattern(/^[a-z0-9-]+$/u),
);

export const OrganizationInput = Schema.Struct({
  name: trimmedText(1, 100),
  handle: OrganizationHandle,
});

export const OrganizationUpdateInput = Schema.Struct({
  name: trimmedText(1, 100),
});

export const OrganizationLogoInput = strictSchema(Schema.Struct({
  logo: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(400_000),
      Schema.isPattern(
        /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu,
      ),
    ),
  ),
}));

export const OrganizationMemberInput = Schema.Struct({
  email: Email,
  role: defaulted(Schema.Literals(["admin", "member"]), "member"),
});

export const OrganizationInvitationInput = strictSchema(Schema.Struct({
  email: LowercaseEmail,
  role: defaulted(Schema.Literals(["admin", "member"]), "member"),
  initialProjectId: UuidString,
}));

export const OrganizationMemberRoleInput = strictSchema(Schema.Struct({
  role: Schema.Literals(["admin", "member"]),
}));

export const OrganizationMemberProjectsInput = strictSchema(Schema.Struct({
  projectIds: Schema.mutable(Schema.Array(UuidString)).check(
    Schema.isMaxLength(500),
  ),
}));

export const SlackOAuthInput = strictSchema(Schema.Struct({
  defaultProjectId: UuidString,
}));

export const decodeAccountProfileInput = decodeRequestSync(AccountProfileInput);
export const decodeInboxReadStatesInput = decodeRequestSync(
  InboxReadStatesInput,
);
export const decodeInboxUnreadStateInput = decodeRequestSync(
  InboxUnreadStateInput,
);
export const decodeProjectAgentScheduleBatchClaim = decodeRequestSync(
  ProjectAgentScheduleBatchClaim,
);
export const decodeAccountDeletionInput = decodeRequestSync(
  AccountDeletionInput,
);
export const decodeOrganizationHandle = decodeRequestSync(OrganizationHandle);
export const decodeOrganizationInput = decodeRequestSync(OrganizationInput);
export const decodeOrganizationUpdateInput = decodeRequestSync(
  OrganizationUpdateInput,
);
export const decodeOrganizationLogoInput = decodeRequestSync(
  OrganizationLogoInput,
);
export const decodeOrganizationMemberInput = decodeRequestSync(
  OrganizationMemberInput,
);
export const decodeOrganizationInvitationInput = decodeRequestSync(
  OrganizationInvitationInput,
);
export const decodeOrganizationMemberRoleInput = decodeRequestSync(
  OrganizationMemberRoleInput,
);
export const decodeOrganizationMemberProjectsInput = decodeRequestSync(
  OrganizationMemberProjectsInput,
);
export const decodeSlackOAuthInput = decodeRequestSync(SlackOAuthInput);
