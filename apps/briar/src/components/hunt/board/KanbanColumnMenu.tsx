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
      })} className="kanban-column-menu inline-grid size-[22px] place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-[state=open]:bg-accent data-[state=open]:text-foreground" type="button">
          <MoreHorizontal aria-hidden="true" size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="run-page-actions-menu z-[150] min-w-44 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl" sideOffset={6}>
          {hidden ? <DropdownMenu.Item className="run-page-actions-item flex min-h-9 items-center rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground" onSelect={onShow}>
              {t("dashboard.showColumn")}
            </DropdownMenu.Item> : <DropdownMenu.Item className="run-page-actions-item flex min-h-9 items-center rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground" onSelect={onHide}>
              {t("dashboard.hideColumn")}
            </DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
