import { Activity, Bot, Check, ChevronDown, ChevronRight, ListFilter, Pencil, Signal, UserRound, Waypoints, X } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ReactElement } from "react";
import { autoHuntRunStatuses, autoHuntSources } from "@/lib/auto-hunt-contract";
import type { OrganizationMember, ProjectAgent } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { IssuePropertyFilterKey, IssuePropertyFilters, emptyIssuePropertyFilters, selectedIssuePropertyFilterCount, toggleIssuePropertyFilterValue, unsetIssuePropertyFilterValue } from "../model/filters";
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
        <button aria-label={t("dashboard.propertyFilters")} className={`issue-property-filter-trigger${selectedCount > 0 ? " active" : ""}`} type="button">
          <ListFilter aria-hidden="true" size={15} />
          <span>{t("dashboard.filter")}</span>
          {selectedCount > 0 ? <strong>{selectedCount}</strong> : null}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className="issue-property-filter-menu" collisionPadding={10} sideOffset={6}>
          <DropdownMenu.Label className="issue-property-filter-heading">
            {t("dashboard.propertyFilters")}
          </DropdownMenu.Label>
          {groups.map(group => <DropdownMenu.Sub key={group.key}>
              <DropdownMenu.SubTrigger className="issue-property-filter-item">
                {group.icon}
                <span>{group.label}</span>
                {filters[group.key].length > 0 ? <small>{filters[group.key].length}</small> : null}
                <ChevronRight aria-hidden="true" size={14} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className="issue-property-filter-menu issue-property-filter-submenu" collisionPadding={10} sideOffset={4}>
                  <DropdownMenu.Label className="issue-property-filter-heading">
                    {group.label}
                  </DropdownMenu.Label>
                  {group.options.map(option => {
                const checked = filters[group.key].includes(option.value);
                return <DropdownMenu.CheckboxItem checked={checked} className="issue-property-filter-choice" key={option.value} onSelect={event => {
                  event.preventDefault();
                  onChange(toggleIssuePropertyFilterValue(filters, group.key, option.value));
                }}>
                        <DropdownMenu.ItemIndicator className="issue-property-filter-check">
                          <Check aria-hidden="true" size={13} />
                        </DropdownMenu.ItemIndicator>
                        <span className="issue-property-filter-choice-label">{option.label}</span>
                      </DropdownMenu.CheckboxItem>;
              })}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>)}
          <DropdownMenu.Separator className="issue-property-filter-separator" />
          <DropdownMenu.Item className="issue-property-filter-clear" disabled={selectedCount === 0} onSelect={() => onChange(emptyIssuePropertyFilters())}>
            <X aria-hidden="true" size={15} />
            <span>{t("dashboard.clearFilters")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
