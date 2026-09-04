/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import { createTestRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  AGENT_SESSION_STORAGE_KEY,
  readStoredAgentSessions,
  type AgentSessionStorage,
} from "./persistence";
import {
  AGENT_SESSION_WRITE_DELAY_MS,
  startAgentSessionPersistence,
} from "./useAgentSessionPersistence";

const recordingStorage = (): AgentSessionStorage & {
  readonly writes: string[];
} => {
  const items = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
      writes.push(value);
    },
  };
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startAgentSessionPersistence", () => {
  it("coalesces a burst of changes into one write", () => {
    const registry = createTestRegistry();
    const storage = recordingStorage();
    const stop = startAgentSessionPersistence(registry, { storage });

    for (const id of ["a", "b", "c"]) {
      applySyncEvent(registry, {
        kind: "agent-sessions-changed",
        sessions: [testAgentSession(id)],
      });
    }
    expect(storage.writes).toEqual([]);

    vi.advanceTimersByTime(AGENT_SESSION_WRITE_DELAY_MS);
    expect(storage.writes).toHaveLength(1);
    expect(readStoredAgentSessions(storage).map((s) => s.id)).toEqual([
      "c",
      "b",
      "a",
    ]);

    stop();
  });

  it("records the boot's own restore pass", () => {
    window.localStorage.setItem(
      AGENT_SESSION_STORAGE_KEY,
      JSON.stringify([testAgentSession("task-1", { status: "running" })]),
    );
    const registry = createTestRegistry();
    const storage = recordingStorage();
    const stop = startAgentSessionPersistence(registry, { storage });

    vi.advanceTimersByTime(AGENT_SESSION_WRITE_DELAY_MS);
    expect(readStoredAgentSessions(storage)[0]).toMatchObject({
      id: "task-1",
      status: "interrupted",
    });

    stop();
  });

  it("flushes what is pending when it stops", () => {
    const registry = createTestRegistry();
    const storage = recordingStorage();
    const stop = startAgentSessionPersistence(registry, { storage });

    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("a")],
    });
    stop();

    expect(readStoredAgentSessions(storage).map((s) => s.id)).toEqual(["a"]);
  });

  it("stops writing once it is cancelled", () => {
    const registry = createTestRegistry();
    const storage = recordingStorage();
    startAgentSessionPersistence(registry, { storage })();
    const writesAfterStop = storage.writes.length;

    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("a")],
    });
    vi.advanceTimersByTime(AGENT_SESSION_WRITE_DELAY_MS * 4);

    expect(storage.writes).toHaveLength(writesAfterStop);
  });

  it("tolerates having no storage at all", () => {
    const registry = createTestRegistry();
    const stop = startAgentSessionPersistence(registry, { storage: null });
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("a")],
    });
    expect(() => vi.advanceTimersByTime(AGENT_SESSION_WRITE_DELAY_MS)).not
      .toThrow();
    stop();
  });
});
