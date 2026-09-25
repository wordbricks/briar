import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { searchWorkspaceChannelMessages } from "./channel-message-search";
import { executeD1Sql } from "./test-helpers/d1-sql";

const workspace = "c1111111-1111-4111-8111-111111111111";
const otherWorkspace = "c2222222-2222-4222-8222-222222222222";
const owner = "c3333333-3333-4333-8333-333333333333";
const reader = "c4444444-4444-4444-8444-444444444444";
const publicChannel = "c5555555-5555-4555-8555-555555555555";
const privateChannel = "c6666666-6666-4666-8666-666666666666";
const dm = "c7777777-7777-4777-8777-777777777777";
const alien = "c8888888-8888-4888-8888-888888888888";
const root = "c9999999-9999-4999-8999-999999999999";
const reply = "caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const timestamp = "2026-09-25T00:00:00.000Z";
const search = (userId: string, query: string, extra: {
  channelId?: string; cursor?: string; limit?: number; kind?: "channel" | "dm";
} = {}) => searchWorkspaceChannelMessages({
  db: env.DB, workspaceId: workspace, userId, query, ...extra,
});

beforeAll(async () => {
  await executeD1Sql(env.DB, `
    insert into "user" (id,name,email,emailVerified,createdAt,updatedAt) values
      ('${owner}','Owner','search-owner@example.com',1,'${timestamp}','${timestamp}'),
      ('${reader}','Reader','search-reader@example.com',1,'${timestamp}','${timestamp}');
    insert into briar_organizations (id,name,handle,created_at,updated_at) values
      ('${workspace}','Search','search-workspace','${timestamp}','${timestamp}'),
      ('${otherWorkspace}','Other','search-other','${timestamp}','${timestamp}');
    insert into briar_organization_members (organization_id,user_id,role,created_at,updated_at) values
      ('${workspace}','${owner}','owner','${timestamp}','${timestamp}'),
      ('${workspace}','${reader}','developer','${timestamp}','${timestamp}'),
      ('${otherWorkspace}','${owner}','owner','${timestamp}','${timestamp}');
    insert into briar_channels (id,organization_id,slug,name,visibility,kind,created_at,updated_at) values
      ('${publicChannel}','${workspace}','search-public','Public','public','channel','${timestamp}','${timestamp}'),
      ('${privateChannel}','${workspace}','search-private','Private','private','channel','${timestamp}','${timestamp}'),
      ('${dm}','${workspace}','search-dm','DM','private','dm','${timestamp}','${timestamp}'),
      ('${alien}','${otherWorkspace}','search-alien','Alien','public','channel','${timestamp}','${timestamp}');
    insert into briar_channel_members (channel_id,user_id,role,created_at) values
      ('${privateChannel}','${owner}','owner','${timestamp}'),
      ('${dm}','${owner}','owner','${timestamp}'),
      ('${dm}','${reader}','member','${timestamp}');
  `);
  const messages = [
    [root, publicChannel, null, "고양이 meeting root", "00"],
    [reply, publicChannel, root, "고양이 meeting reply", "01"],
    ["cb111111-1111-4111-8111-111111111111", privateChannel, null, "고양이 private", "02"],
    ["cb222222-2222-4222-8222-222222222222", dm, null, "고양이 dm", "03"],
    ["cb333333-3333-4333-8333-333333333333", alien, null, "고양이 alien", "04"],
    ["cb444444-4444-4444-8444-444444444444", publicChannel, null, "고양이 deleted", "05"],
  ] as const;
  for (const [id, channelId, parent, body, minute] of messages) {
    await env.DB.prepare(`insert into briar_channel_messages
      (id,channel_id,parent_message_id,author_user_id,body,created_at,updated_at)
      values (?,?,?,?,?,?,?)`).bind(id,channelId,parent,owner,body,
      `2026-09-25T00:${minute}:00.000Z`,timestamp).run();
  }
  await env.DB.prepare("update briar_channel_messages set body = '[deleted]', deleted_at = ? where id = ?")
    .bind(timestamp, "cb444444-4444-4444-8444-444444444444").run();
});

describe("workspace message body search", () => {
  it("matches Korean and English in roots, replies and accessible DMs", async () => {
    const found = await search(reader, "고양이");
    expect(found.hits.map((hit) => hit.messageId)).toEqual([
      "cb222222-2222-4222-8222-222222222222", reply, root,
    ]);
    expect(found.hits.find((hit) => hit.messageId === reply)?.rootMessageId).toBe(root);
    expect((await search(reader, "고양")).hits.map((hit) => hit.messageId))
      .toEqual(["cb222222-2222-4222-8222-222222222222", reply, root]);
    expect((await search(reader, "meeting")).hits.map((hit) => hit.messageId))
      .toEqual([reply, root]);
  });
  it("enforces current membership, workspace and conversation scope", async () => {
    expect((await search(owner, "고양이")).hits).toHaveLength(4);
    await env.DB.prepare("delete from briar_channel_members where channel_id = ? and user_id = ?")
      .bind(dm, reader).run();
    expect((await search(reader, "고양이")).hits.map((hit) => hit.messageId)).toEqual([reply, root]);
    await expect(search(reader, "고양이", {channelId: dm})).rejects.toMatchObject({status: 404});
    expect((await search(owner, "고양이", {channelId: privateChannel})).hits).toHaveLength(1);
  });
  it("paginates without returning deleted bodies or accepting unrelated cursors", async () => {
    const first = await search(owner, "고양이", { limit: 2 });
    expect(first.hits).toHaveLength(2);
    expect(first.nextCursor).toBe("cb111111-1111-4111-8111-111111111111");
    const second = await search(owner, "고양이", { limit: 2, cursor: first.nextCursor! });
    expect(second.hits.map((hit) => hit.messageId)).toEqual([reply, root]);
    await expect(search(owner, "고양이", {cursor: alien})).rejects.toMatchObject({status: 400});
    await expect(search(owner, "고")).rejects.toMatchObject({status: 400});
  });
  it("ranks a prefix match above a newer substring and paginates across ranks", async () => {
    const prefixId = "cb555555-5555-4555-8555-555555555555";
    const innerId = "cb666666-6666-4666-8666-666666666666";
    for (const [id, body, minute] of [
      [prefixId, "ranking first", "06"],
      [innerId, "later ranking", "07"],
    ]) {
      await env.DB.prepare(`insert into briar_channel_messages
        (id,channel_id,author_user_id,body,created_at,updated_at)
        values (?,?,?,?,?,?)`).bind(id, publicChannel, owner, body,
        `2026-09-25T00:${minute}:00.000Z`, timestamp).run();
    }
    const page = await search(owner, "ranking", { limit: 1 });
    expect(page.hits[0]?.messageId).toBe(prefixId);
    const second = await search(owner, "ranking", { limit: 1, cursor: page.nextCursor! });
    expect(second.hits[0]?.messageId).toBe(innerId);
  });
  it("filters by channel/DM kind and identifies authors and replies", async () => {
    const channel = await search(owner, "고양", { kind: "channel" });
    expect(channel.hits.every((hit) => !hit.isDirectMessage)).toBe(true);
    expect(channel.hits.find((hit) => hit.messageId === reply)).toMatchObject({
      authorName: "Owner", isThreadReply: true,
    });
    const direct = await search(owner, "고양", { kind: "dm" });
    expect(direct.hits).toHaveLength(1);
    expect(direct.hits[0]?.isDirectMessage).toBe(true);
  });
  it("updates the index when a body changes and removes it on deletion", async () => {
    await env.DB.prepare("update briar_channel_messages set body = ? where id = ?")
      .bind("updated elephant", root).run();
    expect((await search(owner, "updated")).hits.map((hit) => hit.messageId)).toContain(root);
    expect((await search(owner, "meeting")).hits.map((hit) => hit.messageId)).not.toContain(root);
    await env.DB.prepare("delete from briar_channel_messages where id = ?").bind(root).run();
    expect((await search(owner, "updated")).hits).toHaveLength(0);
  });


});

describe("message search query validation", () => {
  it("rejects FTS control chars and oversized limits", async () => {
    await expect(search(owner, "abc\nxyz")).rejects.toMatchObject({ status: 400 });
    await expect(search(owner, "apple", { limit: 51 })).rejects.toMatchObject({ status: 400 });
  });
});
