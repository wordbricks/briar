import { useEffect } from "react";

import { useRegistry, type AtomRegistry } from "../registry";
import { agentSessionsAtom } from "./atoms";
import {
  defaultAgentSessionStorage,
  writeStoredAgentSessions,
  type AgentSessionStorage,
} from "./persistence";

/*
  Keeping the stored session log up to date.

  Only the write side lives here: the read is the lazy body of the atoms, so a
  boot already renders yesterday's sessions before any effect has run. Writes
  are coalesced, because settling a session touches the list three times in as
  many ticks and each write serializes the whole log. Leaving the page flushes
  immediately, since there may be no next tick.
*/

/** How long changes are collected before one record is written. */
export const AGENT_SESSION_WRITE_DELAY_MS = 250;

export interface AgentSessionPersistenceOptions {
  /** How long a change waits for company. Tests shorten it. */
  readonly delayMs?: number | undefined;
  /** Where the sessions are written. Tests hand over a fake. */
  readonly storage?: AgentSessionStorage | null | undefined;
}

/**
 * Mirrors this registry's sessions into storage until the returned canceller is
 * called. Subscribing immediately records the boot's own restore pass, which is
 * where the sessions this device was running became `interrupted`.
 */
export function startAgentSessionPersistence(
  registry: AtomRegistry,
  options: AgentSessionPersistenceOptions = {},
): () => void {
  const delayMs = options.delayMs ?? AGENT_SESSION_WRITE_DELAY_MS;
  const storage =
    options.storage === undefined
      ? defaultAgentSessionStorage()
      : options.storage;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    pending = false;
    writeStoredAgentSessions(storage, registry.get(agentSessionsAtom));
  };
  const schedule = () => {
    pending = true;
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
  };

  const unsubscribe = registry.subscribe(agentSessionsAtom, schedule, {
    immediate: true,
  });
  const flushListener = () => flush();
  const hiddenListener = () => {
    if (document.visibilityState === "hidden") flush();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushListener);
    document.addEventListener("visibilitychange", hiddenListener);
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", flushListener);
      document.removeEventListener("visibilitychange", hiddenListener);
    }
    unsubscribe();
    flush();
  };
}

/** Mounts {@link startAgentSessionPersistence} for this registry. */
export function useAgentSessionPersistence(
  options: AgentSessionPersistenceOptions = {},
): void {
  const registry = useRegistry();
  const { delayMs, storage } = options;
  useEffect(
    () => startAgentSessionPersistence(registry, { delayMs, storage }),
    [delayMs, registry, storage],
  );
}
