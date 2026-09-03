import { useMemo } from "react";

import { useRegistry, type AtomRegistry } from "../registry";

/*
  Marking inbox messages read.

  The writes still belong to `useInbox`, which owns the stored read versions and
  the queue that pushes them to the server. Its callbacks change identity every
  time the message list does, so handing them to the shells as props would
  re-render the whole tree on every inbox tick — exactly what this phase is
  removing. The bridge installs them per registry instead, and the object below
  delegates through that holder, so a view can hold one identity forever.
*/

export interface InboxCallbacks {
  readonly markAllRead: () => void;
  readonly markRead: (messageId: string) => void;
  readonly markUnread: (messageId: string) => void;
  readonly markIssueRead: (runId: string) => void;
}

export type InboxActions = InboxCallbacks;

const callbacks = new WeakMap<AtomRegistry, InboxCallbacks>();

/** Installs the live `useInbox` callbacks for this registry. */
export function setInboxCallbacks(
  registry: AtomRegistry,
  next: InboxCallbacks,
): void {
  callbacks.set(registry, next);
}

const actions = new WeakMap<AtomRegistry, InboxActions>();

export function getInboxActions(registry: AtomRegistry): InboxActions {
  let existing = actions.get(registry);
  if (!existing) {
    /*
      Before the bridge mounts — a gate screen, a test that renders a shell on
      its own — there is no inbox to write to, and every call is a no-op rather
      than an error: nothing on screen can have an unread message yet.
    */
    const live = () => callbacks.get(registry);
    existing = {
      markAllRead: () => live()?.markAllRead(),
      markRead: (messageId) => live()?.markRead(messageId),
      markUnread: (messageId) => live()?.markUnread(messageId),
      markIssueRead: (runId) => live()?.markIssueRead(runId),
    };
    actions.set(registry, existing);
  }
  return existing;
}

export function useInboxActions(): InboxActions {
  const registry = useRegistry();
  return useMemo(() => getInboxActions(registry), [registry]);
}
