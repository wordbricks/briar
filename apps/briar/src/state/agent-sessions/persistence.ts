import type { AutoHuntSession } from "../../types";
import { agentSessionEvent } from "./model";

/*
  Where agent sessions have always lived: one JSON array in `localStorage`.

  The key and the shape are the ones the hook wrote, so an app that upgrades
  into this module finds the sessions it recorded yesterday. Nothing about them
  is stored in the IndexedDB `ClientSnapshot`: that record is the server's data
  for one organization and is discarded when the account or the schema changes,
  while these are this device's own log of what it ran.

  `Atom.kvs` was the other candidate. It wants an Effect runtime with a
  `KeyValueStore` layer and a `Schema` for the value, and it would still not
  express the one thing the read has to do — rewrite the sessions this device
  was running when it was killed as `interrupted`. A plain codec plus the lazy
  atom read in `atoms.ts` is less machinery for the same result.
*/

/** The key the sessions have been written under since the feature shipped. */
export const AGENT_SESSION_STORAGE_KEY = "briar.auto-hunt-sessions.v1";

/** The part of `Storage` this module uses, so a test can hand over a fake. */
export interface AgentSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** This device's storage, or `null` where there is none (SSR, a test run). */
export function defaultAgentSessionStorage(): AgentSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage the browser refuses to hand out at all.
    return null;
  }
}

/** Whether a parsed entry has enough of a session to be one. */
function isStoredSession(session: unknown): session is AutoHuntSession {
  const candidate = session as Partial<AutoHuntSession> | null;
  return Boolean(
    candidate &&
      typeof candidate === "object" &&
      typeof candidate.id === "string" &&
      typeof candidate.dispatchGroupId === "string" &&
      candidate.dispatchGroupId.length > 0 &&
      (candidate.sessionType === "task" ||
        candidate.sessionType === "dispatch") &&
      typeof candidate.updatedAt === "string",
  );
}

/**
 * Reads the stored sessions, filling in the fields older records predate and
 * closing out the ones this device was running when it stopped: a local session
 * that says "running" cannot be, because the process that ran it is gone.
 *
 * Anything unreadable — absent, malformed, a storage that throws — reads as no
 * sessions rather than as an error. Session tracking is a log, and losing it is
 * never a reason to fail a boot.
 */
export function readStoredAgentSessions(
  storage: AgentSessionStorage | null = defaultAgentSessionStorage(),
  now: string = new Date().toISOString(),
): AutoHuntSession[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(
      storage.getItem(AGENT_SESSION_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(isStoredSession).map((storedSession) => {
      const session = {
        ...storedSession,
        workers: storedSession.workers ?? [],
        dispatchEvents: storedSession.dispatchEvents ?? [],
        localOwner: storedSession.localOwner ?? true,
        followUps: storedSession.followUps ?? [],
      };
      return session.status === "running" && session.localOwner
        ? {
            ...session,
            status: "interrupted" as const,
            completedAt: now,
            updatedAt: now,
            error: null,
            events: [...session.events, agentSessionEvent("interrupted", now)],
          }
        : session;
    });
  } catch {
    return [];
  }
}

/** Writes the session list back, tolerating a storage that refuses. */
export function writeStoredAgentSessions(
  storage: AgentSessionStorage | null,
  sessions: readonly AutoHuntSession[],
): void {
  if (!storage) return;
  try {
    storage.setItem(AGENT_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Session tracking remains available in memory when storage is full or
    // unavailable.
  }
}
