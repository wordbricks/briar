import { MoreHorizontal } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useI18n } from "@/i18n";
export function KanbanColumnMenu({
  hidden = false,
  label,
  onHide,
  onShow
}: {
  hidden?: boolean;
  label: string;
  onHide?: () => void;
  onShow?: () => void;
}) {
  const {
    t
  } = useI18n();
  return <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label={hidden ? t("dashboard.hiddenColumnMenu", {
        label
      }) : t("dashboard.columnMenu", {
        label
      })} className="kanban-column-menu" type="button">
          <MoreHorizontal aria-hidden="true" size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="run-page-actions-menu" sideOffset={6}>
          {hidden ? <DropdownMenu.Item className="run-page-actions-item" onSelect={onShow}>
              {t("dashboard.showColumn")}
            </DropdownMenu.Item> : <DropdownMenu.Item className="run-page-actions-item" onSelect={onHide}>
              {t("dashboard.hideColumn")}
            </DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
