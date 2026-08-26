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
    <section
      aria-label={label}
      className="inbox-detail-pane h-full min-h-0 min-w-0 overflow-hidden border-l border-border bg-card [&>.main-content]:h-full [&>.main-content]:min-h-0 [&>.main-content]:min-w-0 [&>.main-content]:w-full [&>.main-content]:!bg-card [&>.main-content]:overflow-hidden [&_.run-page-shell>.topbar]:!px-[18px]"
    >
      <EmbeddedMainContentBoundary>{children}</EmbeddedMainContentBoundary>
    </section>
  );
}
