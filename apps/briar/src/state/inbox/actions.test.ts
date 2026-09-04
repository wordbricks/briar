/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import { demoUser } from "../demo-fixtures";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { teamsAtom } from "../team/atoms";
import { seedInboxMessages } from "../../test/inbox";
import { inboxApiAtom, type InboxApi } from "./api";
import { createInboxActions } from "./actions";
import { inboxStateAtom, inboxStorageKeyAtom } from "./atoms";
import type { InboxMessage } from "./model";
import { readInboxStorage } from "./persistence";
import { startInboxReadSync } from "./read-sync";

/*
  What a click on a notification does.

  These were `useInbox`'s callbacks, and each of them is three writes: the
  account's `localStorage` record, the server queue, and the store. The cases
  below check all three, because a mark that only reached one of them is the
  bug the read-state sync exists to prevent.
*/

const team = { ...demoDashboard.team, id: "team-a" };

const issue = (id: string, version: string): InboxMessage => ({
  id,
  kind: "issue",
  projectId: team.id,
  projectName: team.name,
  targetId: id.replace("issue:", ""),
  title: "Fix it",
  occurredAt: "2026-09-01T00:00:00.000Z",
  version,
  runNumber: 1,
  status: "failed",
  workflowStage: null,
  priority: null,
  structuredResult: null,
});

const reply = (
  id: string,
  runId: string,
  createdAt: string,
): InboxMessage => ({
  id: `conversation:${id}`,
  kind: "conversation",
  projectId: team.id,
  projectName: team.name,
  targetId: runId,
  messageId: id,
  rootMessageId: "thread-root",
  title: "Grouped thread",
  occurredAt: createdAt,
  version: id,
  body: id,
  authorName: "Reviewer",
  reason: "thread_reply",
});

const api = {
  deleteReadState: vi.fn<InboxApi["deleteReadState"]>(),
  loadFeed: vi.fn<InboxApi["loadFeed"]>(),
  loadReadStates: vi.fn<InboxApi["loadReadStates"]>(),
  saveReadStates: vi.fn<InboxApi["saveReadStates"]>(),
  startPolling: vi.fn<InboxApi["startPolling"]>(),
} satisfies InboxApi;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** A signed-in registry with the read-state round trip already open. */
const harness = async (
  messages: readonly InboxMessage[],
): Promise<{ registry: AtomRegistry; stop: () => void }> => {
  const registry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeOrganizationIdAtom, team.organizationId],
  ]);
  registry.set(inboxApiAtom, api);
  const stop = startInboxReadSync(registry, {
    storageKey: registry.get(inboxStorageKeyAtom),
    token: "token-1",
    userId: demoUser.id,
  });
  await flush();
  seedInboxMessages(registry, messages);
  return { registry, stop };
};

describe("inbox actions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.deleteReadState.mockReset().mockResolvedValue({});
    api.loadFeed.mockReset();
    api.loadReadStates.mockReset().mockResolvedValue({});
    api.saveReadStates.mockReset().mockResolvedValue({});
    api.startPolling.mockReset().mockReturnValue(() => undefined);
  });

  it("records a read version, stores it and queues it for the account", async () => {
    const { registry, stop } = await harness([issue("issue:run-1", "v1")]);

    createInboxActions(registry).markRead("issue:run-1");

    expect(registry.get(inboxStateAtom).readVersions).toEqual({
      "issue:run-1": "v1",
    });
    expect(
      readInboxStorage(registry.get(inboxStorageKeyAtom)).readVersions,
    ).toEqual({ "issue:run-1": "v1" });
    expect(api.saveReadStates).toHaveBeenCalledWith("token-1", {
      "issue:run-1": "v1",
    });
    stop();
  });

  it("reads every reply a thread row stands for", async () => {
    const { registry, stop } = await harness([
      reply("thread-reply-1", "run-1", "2026-09-01T00:01:00.000Z"),
      reply("thread-reply-2", "run-1", "2026-09-01T00:02:00.000Z"),
    ]);

    // The row opens the oldest unread reply, so that is the id a click carries.
    createInboxActions(registry).markRead("conversation:thread-reply-1");

    expect(api.saveReadStates).toHaveBeenCalledWith("token-1", {
      "conversation:thread-reply-1": "thread-reply-1",
      "conversation:thread-reply-2": "thread-reply-2",
    });
    stop();
  });

  it("reads an issue and the replies that point at it together", async () => {
    const { registry, stop } = await harness([
      issue("issue:run-1", "v1"),
      issue("issue:run-2", "v1"),
      reply("thread-reply-1", "run-1", "2026-09-01T00:01:00.000Z"),
    ]);

    createInboxActions(registry).markIssueRead("run-1");

    expect(api.saveReadStates).toHaveBeenCalledWith("token-1", {
      "issue:run-1": "v1",
      "conversation:thread-reply-1": "thread-reply-1",
    });
    stop();
  });

  it("reads the whole organization at once", async () => {
    const { registry, stop } = await harness([
      issue("issue:run-1", "v1"),
      issue("issue:run-2", "v2"),
    ]);

    createInboxActions(registry).markAllRead();

    expect(api.saveReadStates).toHaveBeenCalledWith("token-1", {
      "issue:run-1": "v1",
      "issue:run-2": "v2",
    });
    stop();
  });

  it("drops the read version on the server and restores it on failure", async () => {
    const { registry, stop } = await harness([issue("issue:run-1", "v1")]);
    const actions = createInboxActions(registry);
    actions.markRead("issue:run-1");
    api.deleteReadState.mockRejectedValueOnce(new Error("offline"));

    actions.markUnread("issue:run-1");
    expect(registry.get(inboxStateAtom).readVersions).toEqual({});
    expect(api.deleteReadState).toHaveBeenCalledWith("token-1", "issue:run-1");

    await flush();
    expect(registry.get(inboxStateAtom).readVersions).toEqual({
      "issue:run-1": "v1",
    });
    stop();
  });

  it("writes nothing for a record that is not this account's", async () => {
    const { registry, stop } = await harness([issue("issue:run-1", "v1")]);
    registry.set(inboxStateAtom, {
      ...registry.get(inboxStateAtom),
      storageKey: "briar.inbox.v1:somebody-else",
    });

    createInboxActions(registry).markRead("issue:run-1");

    expect(registry.get(inboxStateAtom).readVersions).toEqual({});
    expect(api.saveReadStates).not.toHaveBeenCalled();
    stop();
  });
});
