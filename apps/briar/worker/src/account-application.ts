import { authEmailIdentifierHash } from "./auth-email";
import {
  decodeAccountDeletionInput,
  decodeAccountProfileInput,
} from "./account-organization-request-contract";
import { processArchiveCleanupQueue } from "./archive";
import {
  deleteAccountData,
  getProjectRunChildMismatch,
  planAccountDeletion,
} from "./db";
import { HttpError } from "./http-response";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import type { requireSession } from "./session-auth";
import { processSlackRevocationQueue } from "./slack-revocations";

const accountDeletionFreshAgeMs = 24 * 60 * 60 * 1_000;

type AccountSession = Awaited<ReturnType<typeof requireSession>>;

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Error && /unique constraint failed/iu.test(error.message);

export type AccountApplicationServices = {
  readonly deleteAccountData: typeof deleteAccountData;
  readonly getProjectRunChildMismatch: typeof getProjectRunChildMismatch;
  readonly planAccountDeletion: typeof planAccountDeletion;
  readonly authEmailIdentifierHash: typeof authEmailIdentifierHash;
  readonly processArchiveCleanupQueue: typeof processArchiveCleanupQueue;
  readonly processSlackRevocationQueue: typeof processSlackRevocationQueue;
  readonly now: () => Date;
};

export const accountApplicationServices: AccountApplicationServices = {
  deleteAccountData,
  getProjectRunChildMismatch,
  planAccountDeletion,
  authEmailIdentifierHash,
  processArchiveCleanupQueue,
  processSlackRevocationQueue,
  now: () => new Date(),
};

export async function updateAccountProfileApplication(
  input: {
    readonly db: D1Database;
    readonly session: AccountSession;
    readonly profile: {
      readonly username: string | null;
      readonly name: string;
      readonly image: string | null;
    };
  },
  services: AccountApplicationServices = accountApplicationServices,
) {
  const profile = decodeAccountProfileInput(input.profile);
  const updatedAt = services.now().toISOString();
  let result: D1Result;
  try {
    result = await input.db
      .prepare(
        `update "user"
         set "username" = ?, "name" = ?, "image" = ?, "updatedAt" = ?
         where "id" = ?`,
      )
      .bind(
        profile.username,
        profile.name,
        profile.image,
        updatedAt,
        input.session.user.id,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError(409, "Username is already taken");
    }
    throw error;
  }
  // User profile triggers may advance inbox state and inflate D1's aggregate
  // change count. Zero is the only not-found signal for this keyed update.
  if ((result.meta.changes ?? 0) < 1) {
    throw new HttpError(404, "Account not found");
  }
  return {
    ...input.session.user,
    username: profile.username,
    name: profile.name,
    image: profile.image,
  };
}

export async function deleteAccountApplication(
  input: {
    readonly db: D1Database;
    readonly env: Env;
    readonly attachmentsBucket: R2Bucket;
    readonly context?: ExecutionContext;
    readonly session: AccountSession;
    readonly confirmation: string;
  },
  services: AccountApplicationServices = accountApplicationServices,
) {
  const deletion = decodeAccountDeletionInput({
    confirmation: input.confirmation,
  });
  if (
    deletion.confirmation.toLowerCase() !==
      input.session.user.email.toLowerCase()
  ) {
    throw new HttpError(400, "Confirmation email does not match");
  }
  const now = services.now();
  const signedInAt = new Date(input.session.session.createdAt).getTime();
  if (
    !Number.isFinite(signedInAt) ||
    now.getTime() - signedInAt >= accountDeletionFreshAgeMs
  ) {
    throw new HttpError(403, "Recent sign-in required for account deletion");
  }

  const plan = await services.planAccountDeletion(
    input.db,
    input.session.user.id,
  );
  if (plan.blockedOrganizations.length > 0) {
    throw new HttpError(
      409,
      "Account deletion is blocked by shared organization resources",
    );
  }

  for (const projectId of plan.projectIds) {
    if (await services.getProjectRunChildMismatch(input.db, projectId)) {
      throw new HttpError(
        409,
        "Project transfer reconciliation is required before deletion",
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
    }
  }

  const observedAt = now.toISOString();
  let result: Awaited<ReturnType<typeof deleteAccountData>>;
  try {
    result = await services.deleteAccountData(input.db, {
      userId: input.session.user.id,
      email: input.session.user.email,
      emailRateLimitIdentifierHash: await services.authEmailIdentifierHash(
        input.session.user.email,
        input.env.BETTER_AUTH_SECRET,
      ),
      observedAt,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message.includes("project has stranded transferred issue data") ||
        error.message.includes("quarantined transcript")
      )
    ) {
      throw new HttpError(
        409,
        "Project transfer reconciliation is required before deletion",
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
    }
    throw error;
  }
  if (result === "blocked") {
    throw new HttpError(
      409,
      "Account deletion state changed; review organization ownership and try again",
      "ACCOUNT_DELETION_STATE_CHANGED",
    );
  }
  if (result === "not_found") {
    throw new HttpError(404, "Account not found");
  }

  void schedulePostCommitCleanup({
    context: input.context,
    operation: "account_delete",
    observedAt,
    tasks: [
      {
        queue: "archive",
        run: () => services.processArchiveCleanupQueue(
          input.db,
          input.env.ARCHIVES,
          input.attachmentsBucket,
          observedAt,
          1_000,
        ),
      },
      {
        queue: "slack",
        run: () => services.processSlackRevocationQueue(
          input.db,
          input.env,
          observedAt,
          100,
        ),
      },
    ],
  });
}
