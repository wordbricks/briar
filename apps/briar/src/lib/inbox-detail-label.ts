import { isInboxRunDetailTarget } from "./inbox-notifications";
import type { InboxNotificationTarget } from "../generated/tauri";

/** The one field the label needs from an inbox message. */
type LabelledMessage = {
  readonly id: string;
  readonly title?: string | null;
};

export interface InboxDetailLabelInput {
  readonly target: InboxNotificationTarget;
  /**
   * Title of the run the target points at, when that run is on the board this
   * window has open. `null` for every other target and for a team that is not
   * on screen.
   */
  readonly runTitle: string | null;
  readonly messages: readonly LabelledMessage[];
  /** Shown when neither the run nor the message is on this device yet. */
  readonly fallback: string;
}

/**
 * Names the pane the inbox detail opens in. An issue-shaped target prefers the
 * run's own title, because it is the one that keeps up with an edit; anything
 * else falls back to the notification that opened the pane, and then to the
 * generic label while the run and the message are both still loading.
 */
export function inboxDetailLabel({
  fallback,
  messages,
  runTitle,
  target,
}: InboxDetailLabelInput): string {
  return (
    (isInboxRunDetailTarget(target) ? runTitle : null) ??
    messages.find((message) => message.id === target.messageId)?.title ??
    fallback
  );
}
