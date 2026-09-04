import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { DashboardPayload, HuntRun } from "../../types";
import { createTestRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom } from "../team/atoms";
import { inboxSourceAtom } from "./atoms";

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
