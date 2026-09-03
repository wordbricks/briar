import type { Project } from "../types";

export const defaultTeamScheduleTabEnabled = true;

export function isTeamScheduleTabEnabled(
  project: Pick<Project, "scheduleTabEnabled"> | null | undefined,
) {
  return project?.scheduleTabEnabled !== false;
}
