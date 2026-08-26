import type { ComponentProps } from "react";

import { AppKeyboardCommandBoundary } from "../hooks/appKeyboardCommands";
import { HuntDashboard as HuntDashboardContent } from "./hunt/HuntDashboard";

export {
  CreateIssueDialog,
  EditIssueDialog,
  IssueAgentActivityPanel,
  RunPage,
  runMatchesIssuePropertyFilters,
} from "./hunt";
export type { IssuePropertyFilterKey, IssuePropertyFilters } from "./hunt";

export function HuntDashboard(
  props: ComponentProps<typeof HuntDashboardContent>,
) {
  return (
    <AppKeyboardCommandBoundary>
      <HuntDashboardContent {...props} />
    </AppKeyboardCommandBoundary>
  );
}
