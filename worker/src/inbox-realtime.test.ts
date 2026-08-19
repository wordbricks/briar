import { describe, expect, it } from "vitest";
import { flushOrganizationInboxRealtimeOutbox } from "./index";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("organization Inbox realtime outbox", () => {
  it("preserves a newer revision that commits while an older publish is acknowledged", async () => {
    const database = await createIsolatedTestDatabase({
      suite: "inbox-realtime-outbox",
    });
    const { miniflare, db } = database;
    try {
      const organizationId = "22222222-2222-4222-8222-222222222222";
      await db.prepare(
        `insert into briar_organization_inbox_sync_state (
           organization_id, current_version
         ) values (?, 1)`,
      ).bind(organizationId).run();

      const published: unknown[] = [];
      let injectNewerRevision = true;
      const env = {
        CHANNEL_REALTIME: {
          getByName: () => ({
            fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
              published.push(JSON.parse(String(init?.body)));
              if (injectNewerRevision) {
                injectNewerRevision = false;
                await db.prepare(
                  `update briar_organization_inbox_sync_state
                   set current_version = 2 where organization_id = ?`,
                ).bind(organizationId).run();
              }
              return new Response(null, { status: 204 });
            },
          }),
        },
      } as unknown as Env;

      await flushOrganizationInboxRealtimeOutbox(env, db);
      await expect(db.prepare(
        `select organization_id, version
         from briar_organization_inbox_realtime_outbox`,
      ).first()).resolves.toEqual({
        organization_id: organizationId,
        version: 2,
      });

      await flushOrganizationInboxRealtimeOutbox(env, db);
      expect(published).toEqual([
        { topic: "inbox", version: 1 },
        { topic: "inbox", version: 2 },
      ]);
      await expect(db.prepare(
        `select count(*) as count
         from briar_organization_inbox_realtime_outbox`,
      ).first()).resolves.toEqual({ count: 0 });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);
});
