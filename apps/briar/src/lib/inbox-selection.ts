import * as Atom from "effect/unstable/reactivity/Atom";

import type { InboxNotificationTarget } from "../generated/tauri";

export const inboxDetailTargetAtom =
  Atom.make<InboxNotificationTarget | null>(null);

export const selectedInboxMessageIdAtom = Atom.map(
  inboxDetailTargetAtom,
  (target) => target?.messageId ?? null,
);
