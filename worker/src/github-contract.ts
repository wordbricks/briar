import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { IsoDateTimeWithOffset } from "../../src/lib/date-time-schema";
import {
  PositiveSafeInteger,
  schemaDecodeOptions,
  trimmedText,
  UrlString,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const GitHubWebhookEvent = Schema.Literals([
  "pull_request",
  "issues",
  "ping",
  "installation",
  "installation_repositories",
  "github_app_authorization",
]);

const NullableGitHubTimestamp = Schema.NullOr(IsoDateTimeWithOffset);

const GitHubRepository = Schema.Struct({
  id: PositiveSafeInteger,
  full_name: trimmedText(3, 300),
});

const GitHubSender = Schema.Struct({
  login: trimmedText(1, 100),
});

const GitHubInstallation = Schema.Struct({
  id: PositiveSafeInteger,
});

export const GitHubInstallationWebhookPayload = Schema.Struct({
  action: trimmedText(1, 100),
  installation: GitHubInstallation,
});

export const GitHubWebhookRepositoryAccess = Schema.Struct({
  id: PositiveSafeInteger,
  name: trimmedText(1, 100),
  full_name: trimmedText(3, 300),
  owner: Schema.Struct({
    login: trimmedText(1, 100),
  }),
});

export type GitHubWebhookRepositoryAccess =
  typeof GitHubWebhookRepositoryAccess.Type;

export const GitHubInstallationRepositoriesWebhookPayload = Schema.Struct({
  action: trimmedText(1, 100),
  installation: GitHubInstallation,
  repositories_added: Schema.Array(GitHubWebhookRepositoryAccess),
  repositories_removed: Schema.Array(GitHubWebhookRepositoryAccess),
});

export const GitHubAppAuthorizationWebhookPayload = Schema.Struct({
  action: trimmedText(1, 100),
  sender: Schema.Struct({
    id: PositiveSafeInteger,
    login: trimmedText(1, 100),
  }),
});

export const GitHubPullRequestWebhookPayload = Schema.Struct({
  action: trimmedText(1, 100),
  installation: GitHubInstallation,
  repository: GitHubRepository,
  sender: GitHubSender,
  pull_request: Schema.Struct({
    id: PositiveSafeInteger,
    node_id: trimmedText(1, 200),
    number: PositiveSafeInteger,
    html_url: UrlString,
    state: Schema.Literals(["open", "closed"]),
    draft: Schema.Boolean,
    merged: Schema.Boolean,
    merge_commit_sha: Schema.NullOr(trimmedText(1, 128)),
    body: Schema.NullOr(Schema.String),
    head: Schema.Struct({ sha: trimmedText(1, 128) }),
    base: Schema.Struct({ sha: trimmedText(1, 128) }),
    merged_at: NullableGitHubTimestamp,
    closed_at: NullableGitHubTimestamp,
    created_at: IsoDateTimeWithOffset,
    updated_at: IsoDateTimeWithOffset,
  }),
});

export const GitHubIssuesWebhookPayload = Schema.Struct({
  action: trimmedText(1, 100),
  installation: GitHubInstallation,
  repository: GitHubRepository,
  sender: GitHubSender,
  issue: Schema.Struct({
    id: PositiveSafeInteger,
    node_id: trimmedText(1, 200),
    number: PositiveSafeInteger,
    html_url: UrlString,
    state: Schema.Literals(["open", "closed"]),
    title: Schema.String.check(Schema.isLengthBetween(1, 1_000)),
    body: Schema.NullOr(Schema.String),
    labels: Schema.Array(Schema.Struct({
      name: Schema.String.check(Schema.isLengthBetween(1, 200)),
    })),
    assignees: Schema.Array(Schema.Struct({
      login: trimmedText(1, 100),
    })),
    closed_at: NullableGitHubTimestamp,
    created_at: IsoDateTimeWithOffset,
    updated_at: IsoDateTimeWithOffset,
  }),
});

export const GitHubPingWebhookPayload = Schema.Struct({
  zen: trimmedText(1, 1_000),
  hook_id: Schema.optional(PositiveSafeInteger),
});

const LowercaseUuid = Schema.Trim.pipe(
  Schema.decodeTo(
    UuidString,
    SchemaTransformation.transform({
      decode: (value) => value.toLowerCase(),
      encode: (value) => value,
    }),
  ),
);

export const GitHubWebhookHeaders = Schema.Struct({
  event: Schema.Trim.pipe(Schema.decodeTo(GitHubWebhookEvent)),
  deliveryId: LowercaseUuid,
});

export type GitHubWebhookHeaders = typeof GitHubWebhookHeaders.Type;

export const GitHubOAuthToken = Schema.Struct({
  access_token: trimmedText(1, 1_000),
  token_type: trimmedText(1, 50),
  expires_in: Schema.optional(PositiveSafeInteger),
  refresh_token: Schema.optional(trimmedText(1, 1_000)),
  refresh_token_expires_in: Schema.optional(PositiveSafeInteger),
});

export const GitHubOAuthErrorResponse = Schema.Struct({
  error: trimmedText(1, 200),
  error_description: Schema.optional(trimmedText(1, 1_000)),
});

export const GitHubUser = Schema.Struct({
  id: PositiveSafeInteger,
  login: trimmedText(1, 100),
  avatar_url: UrlString,
});

const GitHubInstallationAccount = Schema.Struct({
  id: PositiveSafeInteger,
  login: trimmedText(1, 100),
  avatar_url: UrlString,
});

export const GitHubUserInstallation = Schema.Struct({
  id: PositiveSafeInteger,
  app_slug: trimmedText(1, 200),
  account: GitHubInstallationAccount,
});

export type GitHubUserInstallation = typeof GitHubUserInstallation.Type;

export const GitHubUserInstallations = Schema.Struct({
  installations: Schema.Array(GitHubUserInstallation),
});

export const GitHubRepositoryAccess = Schema.Struct({
  id: PositiveSafeInteger,
  name: trimmedText(1, 100),
  full_name: trimmedText(3, 300),
  owner: Schema.Struct({
    login: trimmedText(1, 100),
  }),
});

export type GitHubRepositoryAccess = typeof GitHubRepositoryAccess.Type;

export const GitHubUserRepositories = Schema.Struct({
  repositories: Schema.Array(GitHubRepositoryAccess),
});

export const decodeGitHubWebhookHeaders = decodeRequestSync(
  GitHubWebhookHeaders,
);
export const decodeGitHubPingWebhookPayload = decodeRequestSync(
  GitHubPingWebhookPayload,
);
export const decodeGitHubInstallationWebhookPayload = decodeRequestSync(
  GitHubInstallationWebhookPayload,
);
export const decodeGitHubInstallationRepositoriesWebhookPayload =
  decodeRequestSync(
    GitHubInstallationRepositoriesWebhookPayload,
  );
export const decodeGitHubAppAuthorizationWebhookPayload =
  decodeRequestSync(
    GitHubAppAuthorizationWebhookPayload,
  );
export const decodeGitHubPullRequestWebhookPayload = decodeRequestSync(
  GitHubPullRequestWebhookPayload,
);
export const decodeGitHubIssuesWebhookPayload = decodeRequestSync(
  GitHubIssuesWebhookPayload,
);
export const decodeGitHubOAuthTokenOption = Schema.decodeUnknownOption(
  GitHubOAuthToken,
  schemaDecodeOptions,
);
export const decodeGitHubOAuthErrorResponseOption = Schema.decodeUnknownOption(
  GitHubOAuthErrorResponse,
  schemaDecodeOptions,
);
export const decodeGitHubUser = decodeRequestSync(
  GitHubUser,
);
export const decodeGitHubUserInstallations = decodeRequestSync(
  GitHubUserInstallations,
);
export const decodeGitHubUserRepositories = decodeRequestSync(
  GitHubUserRepositories,
);
export const isGitHubUuid = Schema.is(UuidString);
