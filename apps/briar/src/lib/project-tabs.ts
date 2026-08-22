import type { Project } from "../types";

export const defaultProjectScheduleTabEnabled = true;

export function isProjectScheduleTabEnabled(
  project: Pick<Project, "scheduleTabEnabled"> | null | undefined,
) {
  return project?.scheduleTabEnabled !== false;
}
