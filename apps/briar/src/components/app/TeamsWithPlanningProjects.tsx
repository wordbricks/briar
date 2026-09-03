import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { planningProjectsAtom } from "../../state/planning/atoms";
import { Teams } from "../Teams";

/**
 * `Teams` wired to the planning project atom, so creating or renaming a
 * project re-renders the list without going through the app shell.
 */
export function TeamsWithPlanningProjects(
  props: Omit<ComponentProps<typeof Teams>, "projects">,
) {
  const planningProjects = useAtomValue(planningProjectsAtom);
  return <Teams {...props} projects={planningProjects} />;
}
