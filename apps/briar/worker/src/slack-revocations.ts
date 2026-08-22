import {
  completeSlackRevocation,
  deadLetterSlackRevocation,
  failSlackRevocation,
  listSlackRevocationQueue,
} from "./db";
import { callSlackApi, decryptSlackToken } from "./slack";

export const slackConfigAvailable = (env: Env) =>
  Boolean(
    env.SLACK_CLIENT_ID?.trim() &&
      env.SLACK_CLIENT_SECRET?.trim() &&
      env.SLACK_SIGNING_SECRET?.trim() &&
      env.SLACK_TOKEN_ENCRYPTION_KEY?.trim(),
  );

export async function processSlackRevocationQueue(
  db: D1Database,
  env: Pick<Env, "SLACK_TOKEN_ENCRYPTION_KEY">,
  observedAt: string,
  limit = 100,
) {
  const queued = await listSlackRevocationQueue(db, observedAt, limit);
  const encryptionKey = env.SLACK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    return {
      revoked: 0,
      failed: 0,
      deadLettered: 0,
      deferred: queued.length,
    };
  }
  let revoked = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const item of queued) {
    try {
      const token = await decryptSlackToken(
        item.encrypted_bot_token,
        item.token_iv,
        encryptionKey,
      );
      await callSlackApi("auth.revoke", token, { test: false });
      await completeSlackRevocation(db, item.id);
      revoked += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An already-invalid token has reached the desired terminal state. Slack
      // may report any of these when a previous revoke response was lost.
      if (
        message.includes("account_inactive") ||
        message.includes("invalid_auth") ||
        message.includes("token_revoked")
      ) {
        await completeSlackRevocation(db, item.id);
        revoked += 1;
        continue;
      }
      const nextAttempt = item.attempts + 1;
      if (nextAttempt >= 8) {
        const transitioned = await deadLetterSlackRevocation(
          db,
          item.id,
          observedAt,
          message,
        );
        if (transitioned) {
          deadLettered += 1;
          console.error(JSON.stringify({
            message: "Slack token revocation dead-lettered",
            queueId: item.id,
            teamId: item.team_id,
            attempts: nextAttempt,
            deadLetteredAt: observedAt,
            error: message,
          }));
        }
        continue;
      }
      const retryDelayMs = Math.min(
        24 * 60 * 60_000,
        5 * 60_000 * 2 ** Math.max(0, nextAttempt - 1),
      );
      const nextAttemptAt = new Date(
        Date.parse(observedAt) + retryDelayMs,
      ).toISOString();
      if (
        await failSlackRevocation(
          db,
          item.id,
          observedAt,
          nextAttemptAt,
          message,
        )
      ) {
        failed += 1;
      }
    }
  }
  return { revoked, failed, deadLettered, deferred: 0 };
}

