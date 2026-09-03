import type { AutoHuntSession, ProjectAgent } from "../../types";

/*
  What the app still hands the desktop shell.

  Everything a page renders comes from the store, and every write goes through a
  `state/` action. These three bundles are the remainder: the two hooks that are
  not atom state yet, and the repository setup flow, whose focus handling is a
  property of the window rather than of the domain. They live in their own
  module because the shell and its page slot both take them, and neither should
  have to import the other for a type.
*/

/** The agent list, still `useIssueAgents`'s. */
export interface DesktopShellAgents {
  readonly all: ProjectAgent[];
  readonly activeTeamAgents: ProjectAgent[];
  readonly processingIssueIds: ReadonlySet<string>;
  readonly rememberAgent: (agent: ProjectAgent) => void;
}

/** Auto hunt sessions, still `useAutoHuntSessions`'s. */
export interface DesktopShellAutoHunt {
  readonly sessions: AutoHuntSession[];
  readonly adoptRemoteSession: (session: AutoHuntSession) => string;
  readonly removeProjectSessions: (teamId: string) => void;
  readonly settleTaskSession: (
    sessionId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => void;
  readonly startTaskSession: (
    teamId: string,
    agentId: string,
    session: {
      sessionId?: string;
      request: string;
      agentName?: string | null;
      startedAt: string;
    },
  ) => string;
  readonly stopSession: (sessionId: string) => Promise<boolean>;
}

/** Opening a team's repository, still `useRepositorySetup`'s. */
export interface DesktopShellRepositorySetup {
  readonly repositorySetupTeamId: string | null;
  readonly closeRepositorySetup: () => void;
  readonly beginTeamReconnect: (teamId: string) => void;
  readonly openTeamRepository: (teamId: string) => void;
}
