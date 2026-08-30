import {
  authEmailSenderFromEnv,
  handleAuthRequest,
  type BriarAuth,
} from "./auth";
import { authEmailIdentifierHash } from "./auth-email";
import { processArchiveCleanupQueue } from "./archive";
import {
  decodeAccountDeletionInput,
  decodeAccountProfileInput,
  decodeCurrentUserResponse,
  decodeInboxReadStatesInput,
  decodeInboxUnreadStateInput,
} from "./account-organization-request-contract";
import {
  deleteAccountData,
  getProjectRunChildMismatch,
  planAccountDeletion,
} from "./db";
import {
  deleteInboxReadState,
  listInboxReadStates,
  upsertInboxReadStates,
} from "./inbox-read-state-repository";
import { corsHeaders, HttpError, json } from "./http-response";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import { processSlackRevocationQueue } from "./slack-revocations";

const accountDeletionFreshAgeMs = 24 * 60 * 60 * 1_000;

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Error && /unique constraint failed/iu.test(error.message);

export type AccountRouteInput = {
  request: Request;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
};

export async function handleAccountRoute(
  routeInput: AccountRouteInput,
): Promise<Response | undefined> {
  const { request, auth, db, attachmentsBucket, env, context } = routeInput;
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const response = await handleAuthRequest(
      request,
      auth,
      db,
      env.BETTER_AUTH_SECRET,
      Boolean(authEmailSenderFromEnv(env)),
    );
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  if (pathname === "/me" && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json(decodeCurrentUserResponse({ user: session.user }));
  }

  if (pathname === "/inbox/read-states" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const rows = await listInboxReadStates(db, session.user.id);
    return json({
      readVersions: Object.fromEntries(
        rows.map((row) => [row.message_id, row.version]),
      ),
    });
  }

  if (pathname === "/inbox/read-states" && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const input = decodeInboxReadStatesInput(await readJson(request));
    const entries = Object.entries(input.readVersions).map(
      ([messageId, version]) => ({ messageId, version }),
    );
    const rows = await upsertInboxReadStates(
      db,
      session.user.id,
      entries,
      new Date().toISOString(),
    );
    return json({
      readVersions: Object.fromEntries(
        rows.map((row) => [row.message_id, row.version]),
      ),
    });
  }
  if (pathname === "/inbox/read-states" && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const input = decodeInboxUnreadStateInput(await readJson(request));
    const rows = await deleteInboxReadState(
      db,
      session.user.id,
      input.messageId,
    );
    return json({
      readVersions: Object.fromEntries(
        rows.map((row) => [row.message_id, row.version]),
      ),
    });
  }

  if (pathname === "/me" && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const input = decodeAccountProfileInput(
      await readJson(request, 450_000),
    );
    const updatedAt = new Date().toISOString();
    let result: D1Result;
    try {
      result = await db
        .prepare(
          `update "user"
           set "username" = ?, "name" = ?, "image" = ?, "updatedAt" = ?
           where "id" = ?`,
        )
        .bind(
          input.username,
          input.name,
          input.image,
          updatedAt,
          session.user.id,
        )
        .run();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(409, "Username is already taken");
      }
      throw error;
    }
    if (result.meta.changes !== 1) {
      throw new HttpError(404, "Account not found");
    }
    return json({
      user: {
        ...session.user,
        username: input.username,
        name: input.name,
        image: input.image,
      },
    });
  }

  if (pathname === "/me" && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const input = decodeAccountDeletionInput(await readJson(request));
    if (input.confirmation.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new HttpError(400, "Confirmation email does not match");
    }
    const signedInAt = new Date(session.session.createdAt).getTime();
    if (
      !Number.isFinite(signedInAt) ||
      Date.now() - signedInAt >= accountDeletionFreshAgeMs
    ) {
      throw new HttpError(403, "Recent sign-in required for account deletion");
    }

    const plan = await planAccountDeletion(db, session.user.id);
    if (plan.blockedOrganizations.length > 0) {
      throw new HttpError(
        409,
        "Account deletion is blocked by shared organization resources",
      );
    }

    for (const projectId of plan.projectIds) {
      if (await getProjectRunChildMismatch(db, projectId)) {
        throw new HttpError(
          409,
          "Project transfer reconciliation is required before deletion",
          "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
        );
      }
    }

    const observedAt = new Date().toISOString();
    let deletion: Awaited<ReturnType<typeof deleteAccountData>>;
    try {
      deletion = await deleteAccountData(db, {
        userId: session.user.id,
        email: session.user.email,
        emailRateLimitIdentifierHash: await authEmailIdentifierHash(
          session.user.email,
          env.BETTER_AUTH_SECRET,
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
    if (deletion === "blocked") {
      throw new HttpError(
        409,
        "Account deletion state changed; review organization ownership and try again",
        "ACCOUNT_DELETION_STATE_CHANGED",
      );
    }
    if (deletion === "not_found") {
      throw new HttpError(404, "Account not found");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "account_delete",
        observedAt,
        tasks: [
          {
            queue: "archive",
            run: () => processArchiveCleanupQueue(
              db,
              env.ARCHIVES,
              attachmentsBucket,
              observedAt,
              1_000,
            ),
          },
          {
            queue: "slack",
            run: () => processSlackRevocationQueue(db, env, observedAt, 100),
          },
        ],
      },
    );
  }
}
