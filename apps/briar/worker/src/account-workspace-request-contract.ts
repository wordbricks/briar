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

export const AccountDeletionInput = strictSchema(Schema.Struct({
  confirmation: Email,
}));

export const WorkspaceHandle = Schema.Trim.check(
  Schema.isLengthBetween(1, 63),
  Schema.isPattern(/^[a-z0-9-]+$/u),
);

export const WorkspaceInput = Schema.Struct({
  name: trimmedText(1, 100),
  handle: WorkspaceHandle,
});

export const WorkspaceUpdateInput = Schema.Struct({
  name: trimmedText(1, 100),
});

export const WorkspaceLogoInput = strictSchema(Schema.Struct({
  logo: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(400_000),
      Schema.isPattern(
        /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu,
      ),
    ),
  ),
}));

export const WorkspaceInvitationToken = Schema.Trim.check(
  Schema.isPattern(/^briar_invite_[0-9a-f]{64}$/u),
);

export const WorkspaceInvitationInput = strictSchema(Schema.Struct({
  email: LowercaseEmail,
  role: Schema.Literals(["co-owner", "developer", "editor", "viewer"]),
  initialProjectId: UuidString,
}));

export const WorkspaceMemberRoleInput = strictSchema(Schema.Struct({
  role: Schema.Literals(["co-owner", "developer", "editor", "viewer"]),
}));

export const WorkspaceMemberProjectsInput = strictSchema(Schema.Struct({
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
export const decodeAccountDeletionInput = decodeRequestSync(
  AccountDeletionInput,
);
export const decodeWorkspaceHandle = decodeRequestSync(WorkspaceHandle);
export const decodeWorkspaceInput = decodeRequestSync(WorkspaceInput);
export const decodeWorkspaceUpdateInput = decodeRequestSync(
  WorkspaceUpdateInput,
);
export const decodeWorkspaceLogoInput = decodeRequestSync(
  WorkspaceLogoInput,
);
export const decodeWorkspaceInvitationToken = decodeRequestSync(
  WorkspaceInvitationToken,
);
export const decodeWorkspaceInvitationInput = decodeRequestSync(
  WorkspaceInvitationInput,
);
export const decodeWorkspaceMemberRoleInput = decodeRequestSync(
  WorkspaceMemberRoleInput,
);
export const decodeWorkspaceMemberProjectsInput = decodeRequestSync(
  WorkspaceMemberProjectsInput,
);
export const decodeSlackOAuthInput = decodeRequestSync(SlackOAuthInput);
