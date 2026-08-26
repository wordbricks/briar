import type { ReactNode } from "react";
import { EmbeddedMainContentBoundary } from "./layout";

export function InboxDetailPanel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label} className="inbox-detail-pane">
      <EmbeddedMainContentBoundary>{children}</EmbeddedMainContentBoundary>
    </section>
  );
}
