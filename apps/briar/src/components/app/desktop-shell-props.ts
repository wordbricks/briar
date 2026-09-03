import type { InboxMessageWithReadState } from "../../hooks/useInbox";
import type { AccountProfileInput } from "../../state/session/actions";
import type { AutoHuntSession, ProjectAgent, SessionUser } from "../../types";

/*
  What the app still hands the desktop shell.

  Everything a page renders comes from the store; these five bundles are the
  remainder — the hooks `App.tsx` has not converted yet, and the session facade
  calls that have no store equivalent. They live in their own module because the
  shell and its page slot both take them, and neither should have to import the
  other for a type.
*/

/** The agent list, still `useIssueAgents`'s. */
export interface DesktopShellAgents {
  readonly all: ProjectAgent[];
  readonly activeTeamAgents: ProjectAgent[];
  readonly processingIssueIds: ReadonlySet<string>;
  readonly rememberAgent: (agent: ProjectAgent) => void;
}

/** The inbox, still `useInbox`'s. */
export interface DesktopShellInbox {
  /** What this window may show, which a team window narrows. */
  readonly messages: InboxMessageWithReadState[];
  /** Everything the inbox knows, for resolving a notification's own title. */
  readonly allMessages: InboxMessageWithReadState[];
  readonly unreadCount: number;
  readonly markAllRead: () => void;
  readonly markRead: (messageId: string) => void;
  readonly markUnread: (messageId: string) => void;
  readonly markIssueRead: (runId: string) => void;
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

/** The session facade calls the shell has no store equivalent for yet. */
export interface DesktopShellSession {
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly ensureTeamSelected: (teamId: string) => Promise<unknown>;
  readonly logout: () => Promise<unknown>;
  readonly refresh: (mode?: "delta" | "snapshot") => Promise<void>;
  readonly selectTeam: (teamId: string) => void;
  readonly updateAccountProfile: (
    input: AccountProfileInput,
  ) => Promise<SessionUser>;
}

/** Opening a team's repository, still `useRepositorySetup`'s. */
export interface DesktopShellRepositorySetup {
  readonly repositorySetupTeamId: string | null;
  readonly closeRepositorySetup: () => void;
  readonly beginTeamReconnect: (teamId: string) => void;
  readonly openTeamRepository: (teamId: string) => void;
}
