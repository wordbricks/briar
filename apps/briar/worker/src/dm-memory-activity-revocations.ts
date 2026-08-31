import { publishChannelActivity } from "./channel-activity-realtime";
import { channelActivityFrame } from "./realtime-scheduling";

type RevokedActivity = Parameters<typeof channelActivityFrame>[0];

/** Body-free outbox survives a failed DO publish and clears only the revoked attempt. */
export async function flushDmMemoryActivityRevocations(db: D1Database, env: Env,
  publish = publishChannelActivity,
) {
  const rows = await db.prepare(`select * from briar_dm_memory_activity_revocations
    order by id, attempts limit 50`).all<RevokedActivity>();
  let cleared = 0, failed = 0;
  for (const row of rows.results) {
    try {
      await publish(env, row.organization_id, channelActivityFrame(row, { sequence: Number.MAX_SAFE_INTEGER, activity: null }));
      await db.prepare("delete from briar_dm_memory_activity_revocations where id = ? and attempts = ?")
        .bind(row.id, row.attempts).run();
      cleared++;
    } catch { failed++; }
  }
  return { cleared, failed };
}

export function scheduleDmMemoryActivityRevocations(db: D1Database, env: Env, context?: ExecutionContext) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const flush = flushDmMemoryActivityRevocations(db, env).catch(() => {
    console.error(JSON.stringify({ code: "memory_activity_cleanup_failed" }));
  });
  if (context) context.waitUntil(flush);
  else void flush;
}
