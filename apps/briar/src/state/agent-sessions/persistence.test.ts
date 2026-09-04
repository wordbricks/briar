import { describe, expect, it } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import type { AutoHuntSession } from "../../types";
import {
  AGENT_SESSION_STORAGE_KEY,
  readStoredAgentSessions,
  writeStoredAgentSessions,
  type AgentSessionStorage,
} from "./persistence";

/** A `localStorage` stand-in that records what was written to it. */
const fakeStorage = (initial?: string): AgentSessionStorage & {
  readonly items: Map<string, string>;
} => {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(AGENT_SESSION_STORAGE_KEY, initial);
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

const brokenStorage: AgentSessionStorage = {
  getItem: () => {
    throw new Error("storage is unavailable");
  },
  setItem: () => {
    throw new Error("storage is full");
  },
};

describe("readStoredAgentSessions", () => {
  it("reads the sessions the hook wrote under the legacy key", () => {
    const stored = testAgentSession("remote-session-1", {
      status: "running",
      localOwner: false,
    });
    const storage = fakeStorage(JSON.stringify([stored]));
    expect(readStoredAgentSessions(storage)).toEqual([stored]);
  });

  it("closes out the sessions this device was running when it stopped", () => {
    const storage = fakeStorage(
      JSON.stringify([testAgentSession("task-1", { status: "running" })]),
    );
    const [restored] = readStoredAgentSessions(
      storage,
      "2026-07-28T02:00:00.000Z",
    );
    expect(restored).toMatchObject({
      status: "interrupted",
      completedAt: "2026-07-28T02:00:00.000Z",
      updatedAt: "2026-07-28T02:00:00.000Z",
      error: null,
    });
    expect(restored?.events.at(-1)?.type).toBe("interrupted");
  });

  it("fills in the fields records written by older versions predate", () => {
    const { workers: _workers, followUps: _followUps, ...legacy } =
      testAgentSession("legacy-1", { status: "completed" });
    const storage = fakeStorage(
      JSON.stringify([{ ...legacy, dispatchEvents: undefined }]),
    );
    expect(readStoredAgentSessions(storage)[0]).toMatchObject({
      workers: [],
      dispatchEvents: [],
      followUps: [],
      localOwner: true,
    });
  });

  it("reads nothing out of an absent, malformed or unreadable store", () => {
    expect(readStoredAgentSessions(null)).toEqual([]);
    expect(readStoredAgentSessions(fakeStorage())).toEqual([]);
    expect(readStoredAgentSessions(fakeStorage("{"))).toEqual([]);
    expect(readStoredAgentSessions(fakeStorage('{"id":"x"}'))).toEqual([]);
    expect(readStoredAgentSessions(brokenStorage)).toEqual([]);
  });

  it("skips entries that are not a session", () => {
    const session = testAgentSession("session-1", { status: "completed" });
    const storage = fakeStorage(
      JSON.stringify([null, { id: "no-dispatch-group" }, session]),
    );
    expect(readStoredAgentSessions(storage).map((s) => s.id)).toEqual([
      "session-1",
    ]);
  });
});

describe("writeStoredAgentSessions", () => {
  it("round-trips through the legacy key", () => {
    const storage = fakeStorage();
    const sessions: AutoHuntSession[] = [
      testAgentSession("session-1", { status: "completed" }),
    ];
    writeStoredAgentSessions(storage, sessions);
    expect(storage.items.get(AGENT_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify(sessions),
    );
    expect(readStoredAgentSessions(storage)).toEqual(sessions);
  });

  it("tolerates a storage that refuses the write", () => {
    expect(() => writeStoredAgentSessions(brokenStorage, [])).not.toThrow();
    expect(() => writeStoredAgentSessions(null, [])).not.toThrow();
  });
});
