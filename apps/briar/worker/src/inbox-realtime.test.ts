import { WorkspaceNotificationSchema as WorkspaceNotificationSchema} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { fromBinary } from "@bufbuild/protobuf";
import { env as cloudflareEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { flushWorkspaceInboxRealtimeOutbox } from "./realtime-scheduling";

describe("workspace Inbox realtime outbox", () => {
  it("preserves a newer revision that commits while an older publish is acknowledged", async () => {
    const db = cloudflareEnv.DB;
    const workspaceId = "22222222-2222-4222-8222-222222222222";
    await db
      .prepare(`delete from briar_organization_inbox_realtime_outbox`)
      .run();
    // Migration 0184 folded the realtime mirror into every trigger that bumps
    // briar_organization_inbox_sync_state, so an inbox writer now publishes the
    // outbox row itself. This test drives the flush loop, so it seeds the same
    // pair of rows those writers produce.
    await db.prepare(
      `insert into briar_organization_inbox_sync_state (
         organization_id, current_version
       ) values (?, 1)`,
    ).bind(workspaceId).run();
    await db.prepare(
      `insert into briar_organization_inbox_realtime_outbox (
         organization_id, version, updated_at
       ) values (?, 1, datetime('now'))`,
    ).bind(workspaceId).run();

    const published: unknown[] = [];
    let injectNewerRevision = true;
    const env = {
      CHANNEL_REALTIME: {
        getByName: () => ({
          fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!(init?.body instanceof Uint8Array)) {
              throw new Error("Expected a protobuf Inbox notification");
            }
            const notification = fromBinary(
              WorkspaceNotificationSchema,
              init.body,
            ).notification;
            if (notification.case !== "inboxChanged") {
              throw new Error("Expected an Inbox notification oneof");
            }
            published.push({
              topic: "inbox",
              version: Number(notification.value.version),
            });
            if (injectNewerRevision) {
              injectNewerRevision = false;
              await db.prepare(
                `update briar_organization_inbox_sync_state
                 set current_version = 2 where organization_id = ?`,
              ).bind(workspaceId).run();
              await db.prepare(
                `insert into briar_organization_inbox_realtime_outbox (
                   organization_id, version, updated_at
                 ) values (?, 2, datetime('now'))
                 on conflict (organization_id) do update set
                   version = max(
                     briar_organization_inbox_realtime_outbox.version,
                     excluded.version
                   ),
                   updated_at = excluded.updated_at`,
              ).bind(workspaceId).run();
            }
            return new Response(null, { status: 204 });
          },
        }),
      },
    } as unknown as Env;

    await flushWorkspaceInboxRealtimeOutbox(env, db);
    await expect(db.prepare(
      `select organization_id, version
       from briar_organization_inbox_realtime_outbox`,
    ).first()).resolves.toEqual({
      organization_id: workspaceId,
      version: 2,
    });

    await flushWorkspaceInboxRealtimeOutbox(env, db);
    expect(published).toEqual([
      { topic: "inbox", version: 1 },
      { topic: "inbox", version: 2 },
    ]);
    await expect(db.prepare(
      `select count(*) as count
       from briar_organization_inbox_realtime_outbox`,
    ).first()).resolves.toEqual({ count: 0 });
  }, 60_000);
});
