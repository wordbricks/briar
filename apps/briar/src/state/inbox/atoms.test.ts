/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { DashboardPayload, HuntRun } from "../../types";
import { demoUser } from "../demo-fixtures";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  inboxFeedIdentityAtom,
  inboxMergeSourcesAtom,
  inboxMessageAtom,
  inboxMessagesAtom,
  inboxReadSyncIdentityAtom,
  inboxSourceAtom,
  inboxStorageKeyAtom,
  inboxUnreadCountAtom,
} from "./atoms";
import { mergeCurrentInboxMessages } from "./useInboxSync";

/*
  What the inbox is allowed to hear.

  `inboxSourceAtom` is the payload-shaped argument `useInbox` still takes, built
  out of the store. Its whole job is to change when — and only when — the inbox
  would print something different, so these cases are about which board edits
  reach it and which do not.
*/

const teamId = "team-a";
const team = { ...demoDashboard.team, id: teamId };

const runOf = (id: string, status: HuntRun["status"], title = id): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  runNumber: Number(id.replace(/\D/gu, "")) || 1,
  teamId,
  title,
  status,
  priority: 1,
  eventCount: 1,
  lastEventAt: "2026-09-01T00:00:00.000Z",
  subscribers: [
    { userId: demoUser.id, subscribedAt: "2026-01-01T00:00:00.000Z" },
  ],
});

const running = runOf("run-1", "running", "달리는 이슈");
const completed = runOf("run-2", "completed", "끝난 이슈");

const snapshot: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [running, completed],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const loaded = () => {
  const registry = createTestRegistry([[activeTeamIdAtom, teamId]]);
  applySyncEvent(registry, { kind: "team-snapshot", teamId, payload: snapshot });
  return registry;
};

describe("inboxSourceAtom", () => {
  it("is null until the selected team has a payload", () => {
    const registry = createTestRegistry([[activeTeamIdAtom, teamId]]);

    expect(registry.get(inboxSourceAtom)).toBeNull();
  });

  it("carries only the runs a message can be built from", () => {
    const registry = loaded();

    // The running run cannot notify and no conversation notification points at
    // it, so the inbox never sees it.
    expect(registry.get(inboxSourceAtom)?.runs).toEqual([completed]);
    expect(registry.get(inboxSourceAtom)?.team).toBe(team);
  });

  it("says nothing when a run the inbox cannot print changes", () => {
    const registry = loaded();
    const before = registry.get(inboxSourceAtom);
    const seen: unknown[] = [];
    registry.subscribe(inboxSourceAtom, (value) => seen.push(value), {
      immediate: true,
    });
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId,
      run: { ...running, title: "제목만 바뀐 이슈", progress: 71 },
    });

    expect(seen).toEqual([]);
    expect(registry.get(inboxSourceAtom)).toBe(before);
  });

  it("wakes for a run that just became notifying", () => {
    const registry = loaded();
    const seen: unknown[] = [];
    registry.subscribe(inboxSourceAtom, (value) => seen.push(value), {
      immediate: true,
    });
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId,
      run: { ...running, status: "blocked" },
    });

    expect(seen).toHaveLength(1);
    expect(registry.get(inboxSourceAtom)?.runs.map((run) => run.id)).toEqual([
      running.id,
      completed.id,
    ]);
  });

  it("keeps a run a conversation notification points at", () => {
    const registry = createTestRegistry([[activeTeamIdAtom, teamId]]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId,
      payload: {
        ...snapshot,
        conversationNotifications: [
          {
            id: "notification-1",
            runId: running.id,
            rootMessageId: null,
            runTitle: running.title,
            body: "봐 주세요",
            createdAt: "2026-09-01T00:00:00.000Z",
            reason: "mention",
            author: { id: "user-2", name: "Reviewer", image: null },
          },
        ] as never,
      },
    });

    // Not notifying by status, but the inbox has to resolve its issue key.
    expect(registry.get(inboxSourceAtom)?.runs.map((run) => run.id)).toEqual([
      running.id,
      completed.id,
    ]);
  });
});

/*
  What the derived list guarantees.

  The messages are no longer published by a bridge: they are the stored record,
  scoped to the open organization, marked read and collapsed. The two rules that
  matter to a render count are here — a message that would render identically
  keeps its object, and a row atom therefore hears only about itself.
*/

const failed = runOf("run-3", "failed", "터진 이슈");

const withMessages: DashboardPayload = {
  ...snapshot,
  runs: [running, completed, failed],
};

/** A registry whose account responses have both arrived, board merged in. */
const settled = (): AtomRegistry => {
  const registry = createTestRegistry([
    [activeTeamIdAtom, teamId],
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeOrganizationIdAtom, team.organizationId],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId,
    payload: withMessages,
  });
  registry.set(inboxReadSyncIdentityAtom, {
    storageKey: registry.get(inboxStorageKeyAtom),
    token: "token-1",
    userId: demoUser.id,
  });
  registry.set(inboxFeedIdentityAtom, {
    scope: `${demoUser.id}:${team.organizationId}`,
    token: "token-1",
  });
  // The merge is a subscription in `useInboxSync`; mounting it here is what
  // makes the board reach the stored record without rendering anything.
  registry.subscribe(
    inboxMergeSourcesAtom,
    () => mergeCurrentInboxMessages(registry),
    { immediate: true },
  );
  return registry;
};

describe("inbox messages", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("derives one message per notifying run and counts the actionable ones", () => {
    const registry = settled();

    expect(registry.get(inboxMessagesAtom).map((message) => message.id))
      .toEqual(["issue:run-2", "issue:run-3"]);
    expect(
      registry.get(inboxMessagesAtom).every((message) => message.isUnread),
    ).toBe(true);
    expect(registry.get(inboxUnreadCountAtom)).toBe(2);
  });

  it("reads every message as read until both account responses arrive", () => {
    const registry = createTestRegistry([
      [activeTeamIdAtom, teamId],
      [userAtom, demoUser],
      [tokenAtom, "token-1"],
      [teamsAtom, [team]],
      [activeOrganizationIdAtom, team.organizationId],
    ]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId,
      payload: withMessages,
    });
    mergeCurrentInboxMessages(registry);

    expect(registry.get(inboxMessagesAtom)).toHaveLength(2);
    expect(registry.get(inboxUnreadCountAtom)).toBe(0);
  });

  it("keeps the object of a message the change did not touch", () => {
    const registry = settled();
    const before = registry.get(inboxMessagesAtom);

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId,
      run: { ...failed, eventCount: 2, lastEventAt: "2026-09-02T00:00:00.000Z" },
    });

    const after = registry.get(inboxMessagesAtom);
    expect(after).not.toBe(before);
    expect(after.find((message) => message.id === "issue:run-2"))
      .toBe(before.find((message) => message.id === "issue:run-2"));
    expect(after.find((message) => message.id === "issue:run-3"))
      .not.toBe(before.find((message) => message.id === "issue:run-3"));
  });

  it("wakes only the row atom of the message that changed", () => {
    const registry = settled();
    const quiet: unknown[] = [];
    const noisy: unknown[] = [];
    registry.subscribe(
      inboxMessageAtom("issue:run-2"),
      (value) => quiet.push(value),
      { immediate: true },
    );
    registry.subscribe(
      inboxMessageAtom("issue:run-3"),
      (value) => noisy.push(value),
      { immediate: true },
    );
    quiet.length = 0;
    noisy.length = 0;

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId,
      run: { ...failed, eventCount: 3, lastEventAt: "2026-09-03T00:00:00.000Z" },
    });

    expect(quiet).toEqual([]);
    expect(noisy).toHaveLength(1);
  });

  it("says nothing at all when a tick changed no message", () => {
    const registry = settled();
    const seen: unknown[] = [];
    registry.subscribe(inboxMessagesAtom, (value) => seen.push(value), {
      immediate: true,
    });
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId,
      run: { ...running, progress: 71 },
    });

    expect(seen).toEqual([]);
  });
});
