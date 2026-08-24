import { Copy, FolderInput, Link2, MoreHorizontal, Share2, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useI18n } from "@/i18n";
export function IssueActionsMenu({
  disabled,
  mutatingDisabled = false,
  onCancel,
  onCopyId,
  onCopyLink,
  onUnassign,
  onDelete,
  onTransfer,
  onShare
}: {
  disabled: boolean;
  mutatingDisabled?: boolean;
  onCancel?: () => void;
  onCopyId?: () => void;
  onCopyLink?: () => void;
  onUnassign?: () => void;
  onDelete?: () => void;
  onTransfer?: () => void;
  onShare?: () => void;
}) {
  const {
    t
  } = useI18n();
  return <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label={t("issue.actions")} className="run-page-tool-button run-page-actions-trigger" disabled={disabled} type="button">
          {disabled ? <Spinner size={15} /> : <MoreHorizontal size={16} />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="run-page-actions-menu" sideOffset={6}>
          {onCopyId ? <DropdownMenu.Item className="run-page-actions-item" onSelect={onCopyId}>
              <Copy size={14} />
              {t("issue.copyId")}
            </DropdownMenu.Item> : null}
          {onCopyLink ? <DropdownMenu.Item className="run-page-actions-item" onSelect={onCopyLink}>
              <Link2 size={14} />
              {t("issue.copyLink")}
            </DropdownMenu.Item> : null}
          {onShare ? <DropdownMenu.Item className="run-page-actions-item" disabled={mutatingDisabled} onSelect={onShare}>
              <Share2 size={14} />
              {t("issue.share")}
            </DropdownMenu.Item> : null}
          {onTransfer ? <DropdownMenu.Item className="run-page-actions-item" disabled={mutatingDisabled} onSelect={onTransfer}>
              <FolderInput size={14} />
              {t("issue.transfer")}
            </DropdownMenu.Item> : null}
          {onCancel ? <DropdownMenu.Item className="run-page-actions-item danger" disabled={mutatingDisabled} onSelect={onCancel}>
              <X size={14} />
              {t("run.cancel")}
            </DropdownMenu.Item> : null}
          {onUnassign ? <DropdownMenu.Item className="run-page-actions-item" disabled={mutatingDisabled} onSelect={onUnassign}>
              <X size={14} />
              {t("worker.unassign")}
            </DropdownMenu.Item> : null}
          {onDelete ? <DropdownMenu.Item className="run-page-actions-item danger" disabled={mutatingDisabled} onSelect={onDelete}>
              <Trash2 size={14} />
              {t("issue.delete")}
            </DropdownMenu.Item> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
