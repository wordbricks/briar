import { isInboxRunDetailTarget } from "./inbox-notifications";
import type { InboxNotificationTarget } from "../generated/tauri";
import type { HuntRun } from "../types";

/** The one field the label needs from an inbox message. */
type LabelledMessage = {
  readonly id: string;
  readonly title?: string | null;
};

export interface InboxDetailLabelInput {
  readonly target: InboxNotificationTarget;
  /** Runs of the team on screen, if it is the one the target belongs to. */
  readonly runs: readonly HuntRun[] | undefined;
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
  runs,
  target,
}: InboxDetailLabelInput): string {
  return (
    (isInboxRunDetailTarget(target)
      ? runs?.find((run) => run.id === target.targetId)?.title
      : null) ??
    messages.find((message) => message.id === target.messageId)?.title ??
    fallback
  );
}
