import * as Atom from "effect/unstable/reactivity/Atom";

import type { AtomRegistry } from "../registry";

/*
  Deleting a channel message asks "are you sure?", and the action that asks
  is registry-bound: it cannot render, and the blocking `window.confirm` it
  used instead froze the whole tab — and crashed the renderer outright in
  automation and embedded webviews that never answer native dialogs
  (BR-7181 / BR-6762). The action publishes its question here instead, and
  the dialog mounted once in AppDialogs answers it.
*/

/** One pending "delete this message?" question, or `null` when none is. */
export interface ChannelMessageDeleteConfirmation {
  /** Distinguishes two questions in a row so the view treats each as new. */
  readonly id: number;
  /** The prompt shown inside the dialog. */
  readonly prompt: string;
  /** Answers the pending question exactly once. */
  readonly resolve: (confirmed: boolean) => void;
}

/** The question currently waiting for the dialog's answer. */
export const channelMessageDeleteConfirmationAtom =
  Atom.make<ChannelMessageDeleteConfirmation | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("channelConversation/deleteConfirmation"),
  );

let nextConfirmationId = 0;

/**
 * Publishes the question and waits for the dialog's answer. A second request
 * dismisses the first as unanswered, so a dialog left open can never delete
 * the wrong message.
 */
export function confirmChannelMessageDeletion(
  registry: AtomRegistry,
  prompt: string,
): Promise<boolean> {
  const pending = registry.get(channelMessageDeleteConfirmationAtom);
  if (pending) pending.resolve(false);
  nextConfirmationId += 1;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    registry.set(channelMessageDeleteConfirmationAtom, {
      id: nextConfirmationId,
      prompt,
      resolve: (confirmed) => {
        if (settled) return;
        settled = true;
        registry.set(channelMessageDeleteConfirmationAtom, null);
        resolve(confirmed);
      },
    });
  });
}
