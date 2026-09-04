import * as Atom from "effect/unstable/reactivity/Atom";

import type { AtomRegistry } from "../registry";
import { channelConversationError } from "./model";

/*
  How a conversation request reports that it failed.

  Every failure the conversation surfaces is a toast, and a toast needs the
  provider's context, which registry-bound code does not have. The loader and
  the actions publish the message here instead and the view that mounted them
  turns it into a toast — the same shape `state/inbox` used for the system
  notifications it could not raise itself.

  The value is a numbered envelope rather than a bare string so that the same
  message twice in a row is still two toasts: the registry drops a write of an
  equal value, and "the send failed" a second time has to be visible.
*/

/** One reported failure, or `null` before anything has failed. */
export interface ChannelConversationFailure {
  readonly id: number;
  readonly message: string;
}

export const channelConversationFailureAtom =
  Atom.make<ChannelConversationFailure | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("channelConversation/failure"),
  );

let nextFailureId = 0;

/** Publishes `cause` for the mounted conversation view to toast. */
export function reportChannelConversationError(
  registry: AtomRegistry,
  cause: unknown,
): void {
  nextFailureId += 1;
  registry.set(channelConversationFailureAtom, {
    id: nextFailureId,
    message: channelConversationError(cause),
  });
}
