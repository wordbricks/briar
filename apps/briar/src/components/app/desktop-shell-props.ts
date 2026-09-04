import type { ProjectAgent } from "../../types";

/*
  What the app still hands the desktop shell.

  Everything a page renders comes from the store, and every write goes through a
  `state/` action. These two bundles are the remainder: the agent list, which is
  still a hook's, and the repository setup flow, whose focus handling is a
  property of the window rather than of the domain. They live in their own
  module because the shell and its page slot both take them, and neither should
  have to import the other for a type.
*/

/** The agent list, still `useIssueAgents`'s. */
export interface DesktopShellAgents {
  readonly all: ProjectAgent[];
  readonly activeTeamAgents: ProjectAgent[];
  readonly rememberAgent: (agent: ProjectAgent) => void;
}

/** Opening a team's repository, still `useRepositorySetup`'s. */
export interface DesktopShellRepositorySetup {
  readonly repositorySetupTeamId: string | null;
  readonly closeRepositorySetup: () => void;
  readonly beginTeamReconnect: (teamId: string) => void;
  readonly openTeamRepository: (teamId: string) => void;
}
