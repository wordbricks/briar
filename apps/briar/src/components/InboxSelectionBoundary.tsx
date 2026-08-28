import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps, ReactNode } from "react";

import {
  inboxDetailTargetAtom,
  selectedInboxMessageIdAtom,
} from "../lib/inbox-selection";
import type { InboxNotificationTarget } from "../generated/tauri";
import { Inbox } from "./Inbox";

export function InboxWithSelection(
  props: Omit<ComponentProps<typeof Inbox>, "selectedMessageId">,
) {
  const selectedMessageId = useAtomValue(selectedInboxMessageIdAtom);
  return <Inbox {...props} selectedMessageId={selectedMessageId} />;
}

export function InboxDetailTargetBoundary({
  children,
}: {
  children: (target: InboxNotificationTarget | null) => ReactNode;
}) {
  const target = useAtomValue(inboxDetailTargetAtom);
  return children(target);
}
