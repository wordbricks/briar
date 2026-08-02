import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function InboxDetailPanel({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="inbox-detail-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          aria-modal="true"
          className="inbox-detail-drawer"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
