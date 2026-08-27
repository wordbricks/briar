import { Activity, Bot, Check, ChevronDown, ChevronRight, ListFilter, Pencil, Signal, UserRound, Waypoints, X } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ReactElement } from "react";
import { autoHuntRunStatuses, autoHuntSources } from "@/lib/auto-hunt-contract";
import type { OrganizationMember, ProjectAgent } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { IssuePropertyFilterKey, IssuePropertyFilters, emptyIssuePropertyFilters, selectedIssuePropertyFilterCount, toggleIssuePropertyFilterValue, unsetIssuePropertyFilterValue } from "../model/filters";
import { cn } from "@/lib/utils";

const propertyFilterMenuClass = "issue-property-filter-menu z-[150] w-56 max-h-[min(430px,calc(100vh-20px))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl backdrop-blur-md";
const propertyFilterHeadingClass = "issue-property-filter-heading px-2 py-1.5 text-2xs font-semibold uppercase tracking-[.04em] text-muted-foreground";
const propertyFilterItemClass = "issue-property-filter-item grid min-h-[39px] grid-cols-[20px_minmax(0,1fr)_auto_14px] items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent [&>svg:first-child]:text-muted-foreground [&>span]:min-w-0 [&>span]:truncate [&>small]:grid [&>small]:size-[18px] [&>small]:place-items-center [&>small]:rounded-full [&>small]:bg-accent [&>small]:text-2xs";
const propertyFilterChoiceClass = "issue-property-filter-choice grid min-h-[38px] grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&>span]:min-w-0 [&>span]:truncate";
export function IssuePropertyFilterMenu({
  agents,
  filters,
  members,
  onChange
}: {
  agents: ProjectAgent[];
  filters: IssuePropertyFilters;
  members: OrganizationMember[];
  onChange: (filters: IssuePropertyFilters) => void;
}) {
  const {
    t
  } = useI18n();
  const selectedCount = selectedIssuePropertyFilterCount(filters);
  const groups: Array<{
    icon: ReactElement;
    key: IssuePropertyFilterKey;
    label: string;
    options: Array<{
      label: string;
      value: string;
    }>;
  }> = [{
    icon: <Activity aria-hidden="true" size={16} />,
    key: "status",
    label: t("dashboard.status"),
    options: autoHuntRunStatuses.map(value => ({
      label: t(`status.${value}` as MessageKey),
      value
    }))
  }, {
    icon: <Waypoints aria-hidden="true" size={16} />,
    key: "source",
    label: t("dashboard.type"),
    options: autoHuntSources.map(value => ({
      label: t(`source.${value}` as MessageKey),
      value
    }))
  }, {
    icon: <Signal aria-hidden="true" size={16} />,
    key: "priority",
    label: t("issue.priority"),
    options: [...([1, 2, 3, 4] as const).map(value => ({
      label: t(`issue.priority${value}` as MessageKey),
      value: String(value)
    })), {
      label: t("run.notSet"),
      value: unsetIssuePropertyFilterValue
    }]
  }, {
    icon: <UserRound aria-hidden="true" size={16} />,
    key: "assignee",
    label: t("run.assignee"),
    options: [...members.map(member => ({
      label: member.name,
      value: member.userId
    })), {
      label: t("run.unassigned"),
      value: unsetIssuePropertyFilterValue
    }]
  }, {
    icon: <Bot aria-hidden="true" size={16} />,
    key: "agent",
    label: t("run.agent"),
    options: [...agents.map(agent => ({
      label: agent.name,
      value: agent.id
    })), {
      label: t("run.notSet"),
      value: unsetIssuePropertyFilterValue
    }]
  }, {
    icon: <Pencil aria-hidden="true" size={16} />,
    key: "creator",
    label: t("run.creator"),
    options: [...members.map(member => ({
      label: member.name,
      value: member.userId
    })), {
      label: t("run.notSet"),
      value: unsetIssuePropertyFilterValue
    }]
  }];
  return <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label={t("dashboard.propertyFilters")} className={cn("issue-property-filter-trigger inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs text-muted-foreground shadow-sm outline-none hover:border-input hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:border-input data-[state=open]:bg-accent data-[state=open]:text-foreground", selectedCount > 0 && "active border-[#d7cff0] bg-[#f4f0ff] text-[#654bb8]")} type="button">
          <ListFilter aria-hidden="true" size={15} />
          <span>{t("dashboard.filter")}</span>
          {selectedCount > 0 ? <strong className="grid size-[18px] place-items-center rounded-full bg-[#7358c2] px-1 text-2xs leading-none text-white">{selectedCount}</strong> : null}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className={propertyFilterMenuClass} collisionPadding={10} sideOffset={6}>
          <DropdownMenu.Label className={propertyFilterHeadingClass}>
            {t("dashboard.propertyFilters")}
          </DropdownMenu.Label>
          {groups.map(group => <DropdownMenu.Sub key={group.key}>
              <DropdownMenu.SubTrigger className={propertyFilterItemClass}>
                {group.icon}
                <span>{group.label}</span>
                {filters[group.key].length > 0 ? <small>{filters[group.key].length}</small> : null}
                <ChevronRight aria-hidden="true" size={14} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className={cn(propertyFilterMenuClass, "issue-property-filter-submenu w-[246px] max-h-[min(390px,calc(100vh-20px))]")} collisionPadding={10} sideOffset={4}>
                  <DropdownMenu.Label className={propertyFilterHeadingClass}>
                    {group.label}
                  </DropdownMenu.Label>
                  {group.options.map(option => {
                const checked = filters[group.key].includes(option.value);
                return <DropdownMenu.CheckboxItem checked={checked} className={propertyFilterChoiceClass} key={option.value} onSelect={event => {
                  event.preventDefault();
                  onChange(toggleIssuePropertyFilterValue(filters, group.key, option.value));
                }}>
                        <DropdownMenu.ItemIndicator className="issue-property-filter-check grid size-[18px] place-items-center text-[#654bb8]">
                          <Check aria-hidden="true" size={13} />
                        </DropdownMenu.ItemIndicator>
                        <span>{option.label}</span>
                      </DropdownMenu.CheckboxItem>;
              })}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>)}
          <DropdownMenu.Separator className="issue-property-filter-separator my-1.5 -mx-1.5 h-px bg-border" />
          <DropdownMenu.Item className="issue-property-filter-clear flex min-h-[38px] items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45" disabled={selectedCount === 0} onSelect={() => onChange(emptyIssuePropertyFilters())}>
            <X aria-hidden="true" size={15} />
            <span>{t("dashboard.clearFilters")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
