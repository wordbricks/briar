import { OrganizationNotificationSchema } from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { fromBinary } from "@bufbuild/protobuf";
import { env as cloudflareEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { flushOrganizationInboxRealtimeOutbox } from "./realtime-scheduling";

describe("organization Inbox realtime outbox", () => {
  it("preserves a newer revision that commits while an older publish is acknowledged", async () => {
    const db = cloudflareEnv.DB;
    const organizationId = "22222222-2222-4222-8222-222222222222";
    await db
      .prepare(`delete from briar_organization_inbox_realtime_outbox`)
      .run();
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
            if (!(init?.body instanceof Uint8Array)) {
              throw new Error("Expected a protobuf Inbox notification");
            }
            const notification = fromBinary(
              OrganizationNotificationSchema,
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
  }, 60_000);
});
