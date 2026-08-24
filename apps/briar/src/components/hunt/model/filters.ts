import { type CompanionStatusFilter } from "@/components/CompanionBottomNavigation";
import type { HuntRun, HuntSource } from "@/types";
export type SourceFilter = "all" | HuntSource;
export type StatusFilter = CompanionStatusFilter;
export type DashboardView = "kanban" | "list";
export type IssuePropertyFilterKey = "status" | "source" | "priority" | "assignee" | "agent" | "creator";
export type IssuePropertyFilters = Record<IssuePropertyFilterKey, string[]>;
export const unsetIssuePropertyFilterValue = "__unset__";
export function emptyIssuePropertyFilters(): IssuePropertyFilters {
  return {
    status: [],
    source: [],
    priority: [],
    assignee: [],
    agent: [],
    creator: []
  };
}
export function propertyFilterMatches(selected: readonly string[], value: string | null | undefined) {
  return selected.length === 0 || selected.includes(value ?? unsetIssuePropertyFilterValue);
}
export function runMatchesIssuePropertyFilters(run: HuntRun, filters: IssuePropertyFilters) {
  return propertyFilterMatches(filters.status, run.status) && propertyFilterMatches(filters.source, run.source) && propertyFilterMatches(filters.priority, run.priority === null ? null : String(run.priority)) && propertyFilterMatches(filters.assignee, run.assigneeUserId) && propertyFilterMatches(filters.agent, run.agentId) && propertyFilterMatches(filters.creator, run.createdByUserId);
}
export function selectedIssuePropertyFilterCount(filters: IssuePropertyFilters) {
  return Object.values(filters).reduce((count, selected) => count + selected.length, 0);
}
export function toggleIssuePropertyFilterValue(filters: IssuePropertyFilters, key: IssuePropertyFilterKey, value: string) {
  const selected = filters[key];
  return {
    ...filters,
    [key]: selected.includes(value) ? selected.filter(candidate => candidate !== value) : [...selected, value]
  };
}
