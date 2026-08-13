import type { ReactNode } from "react";

export function InboxDetailPanel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label} className="inbox-detail-pane">
      {children}
    </section>
  );
}
