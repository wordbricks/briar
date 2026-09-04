import { useMemo } from "react";

import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { resolveInboxApi, type InboxApi } from "./api";
import {
  inboxMessagesAtom,
  inboxStateAtom,
  inboxStorageKeyAtom,
  inboxUserIdAtom,
  type InboxReadSyncIdentity,
} from "./atoms";
import {
  inboxMessageReadVersions,
  type InboxMessageWithReadState,
} from "./model";
import { writeInboxStorage, type InboxState } from "./persistence";
import { currentInboxReadSync, queueInboxReadStatePush } from "./read-sync";

/*
  Marking inbox messages read.

  These were `useInbox`'s callbacks, which changed identity every time the
  message list did — which is why they reached the shells through a registry
  holder instead of props. They read the list through the registry at call time
  now, so one object per registry lasts the window's lifetime and nothing has to
  be installed before a view may call them.

  Each write does the same three things the hook did, in the same order: write
  the account's `localStorage` record, queue the versions for the server, then
  publish the new state.
*/

export interface InboxActions {
  readonly markAllRead: () => void;
  /**
   * Records a read receipt for one notification. Reports whether the account's
   * record now says it is read, so a caller that may be asked twice for the
   * same message — a notification transition that routes in two passes — can
   * stop after the pass that landed. `false` means the message is not this
   * window's to read: it is not in the account's inbox, or the record on screen
   * belongs to somebody else.
   */
  readonly markRead: (messageId: string) => boolean;
  readonly markUnread: (messageId: string) => void;
  readonly markIssueRead: (runId: string) => void;
}

export interface InboxActionDeps {
  readonly api?: Partial<InboxApi> | undefined;
}

/** The message a click on `messageId` reads: itself, or the thread holding it. */
function displayedMessage(
  messages: readonly InboxMessageWithReadState[],
  messageId: string,
): InboxMessageWithReadState | undefined {
  return messages.find(
    (message) =>
      message.id === messageId ||
      Object.prototype.hasOwnProperty.call(
        message.groupedReadVersions ?? {},
        messageId,
      ),
  );
}

/** The record the writes below belong to, or `null` when it is not on screen. */
function writableInboxState(registry: AtomRegistry): InboxState | null {
  const current = registry.get(inboxStateAtom);
  return current.storageKey === registry.get(inboxStorageKeyAtom)
    ? current
    : null;
}

/** Who a queued read belongs to, or `null` while signed out. */
function readSyncIdentity(
  registry: AtomRegistry,
): InboxReadSyncIdentity | null {
  const token = registry.get(tokenAtom);
  const userId = registry.get(inboxUserIdAtom);
  return token && userId
    ? { storageKey: registry.get(inboxStorageKeyAtom), token, userId }
    : null;
}

function commitReadVersions(
  registry: AtomRegistry,
  api: InboxApi,
  current: InboxState,
  readVersions: Record<string, string>,
) {
  const next = {
    messages: current.messages,
    readVersions: { ...current.readVersions, ...readVersions },
  };
  writeInboxStorage(current.storageKey, next);
  const identity = readSyncIdentity(registry);
  if (identity) {
    queueInboxReadStatePush(registry, api, identity, readVersions);
  }
  registry.set(inboxStateAtom, { storageKey: current.storageKey, ...next });
}

export function createInboxActions(
  registry: AtomRegistry,
  deps: InboxActionDeps = {},
): InboxActions {
  const api = () => resolveInboxApi(registry, deps.api);

  const markRead = (messageId: string): boolean => {
    const message = displayedMessage(
      registry.get(inboxMessagesAtom),
      messageId,
    );
    if (!message) return false;
    const versions = inboxMessageReadVersions(message);
    const current = writableInboxState(registry);
    if (!current) return false;
    /*
      Already at these versions, so there is nothing to write — which is what
      makes a second call for the same message free. The caller is told `true`
      all the same: the question it asks is "is this read", not "did I write".
    */
    if (
      Object.entries(versions).every(
        ([id, version]) => current.readVersions[id] === version,
      )
    ) {
      return true;
    }
    commitReadVersions(registry, api(), current, versions);
    return true;
  };

  const markIssueRead = (runId: string) => {
    const current = writableInboxState(registry);
    if (!current) return;
    const issueReadVersions = Object.fromEntries(
      registry.get(inboxMessagesAtom)
        .filter(
          (message) =>
            message.targetId === runId &&
            (message.kind === "issue" || message.kind === "conversation"),
        )
        .flatMap((message) =>
          Object.entries(inboxMessageReadVersions(message)),
        )
        .filter(([id, version]) => current.readVersions[id] !== version),
    );
    if (Object.keys(issueReadVersions).length === 0) return;
    commitReadVersions(registry, api(), current, issueReadVersions);
  };

  const markAllRead = () => {
    const current = writableInboxState(registry);
    if (!current) return;
    const organizationReadVersions = Object.fromEntries(
      registry.get(inboxMessagesAtom).flatMap((message) =>
        Object.entries(inboxMessageReadVersions(message)),
      ),
    );
    commitReadVersions(registry, api(), current, organizationReadVersions);
  };

  const markUnread = (messageId: string) => {
    const token = registry.get(tokenAtom);
    if (!token) return;
    const message = displayedMessage(
      registry.get(inboxMessagesAtom),
      messageId,
    );
    if (!message) return;
    const messageIds = Object.keys(inboxMessageReadVersions(message));
    const current = writableInboxState(registry);
    if (
      !current ||
      !messageIds.some((id) =>
        Object.prototype.hasOwnProperty.call(current.readVersions, id)
      )
    ) {
      return;
    }
    const previousVersions = Object.fromEntries(
      messageIds.flatMap((id) => {
        const version = current.readVersions[id];
        return version === undefined ? [] : [[id, version]];
      }),
    );
    const readVersions = { ...current.readVersions };
    for (const id of messageIds) delete readVersions[id];
    const next = { messages: current.messages, readVersions };
    writeInboxStorage(current.storageKey, next);
    const generation = currentInboxReadSync(registry);
    if (generation) {
      generation.remoteMutationGeneration += 1;
      for (const id of messageIds) delete generation.remoteReadVersions[id];
    }
    const storageKey = current.storageKey;
    void Promise.all(
      messageIds.map((id) => api().deleteReadState(token, id)),
    ).catch(() => {
      const latest = registry.get(inboxStateAtom);
      if (latest.storageKey !== storageKey) return;
      const restored = {
        messages: latest.messages,
        readVersions: { ...latest.readVersions, ...previousVersions },
      };
      writeInboxStorage(storageKey, restored);
      registry.set(inboxStateAtom, { storageKey, ...restored });
    });
    registry.set(inboxStateAtom, { storageKey, ...next });
  };

  return { markAllRead, markIssueRead, markRead, markUnread };
}

const actions = new WeakMap<AtomRegistry, InboxActions>();

/** The inbox actions of this registry, created once and kept forever. */
export function getInboxActions(registry: AtomRegistry): InboxActions {
  let existing = actions.get(registry);
  if (!existing) {
    existing = createInboxActions(registry);
    actions.set(registry, existing);
  }
  return existing;
}

export function useInboxActions(): InboxActions {
  const registry = useRegistry();
  return useMemo(() => getInboxActions(registry), [registry]);
}
