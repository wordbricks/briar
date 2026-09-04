import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../i18n";
import { loadProjectAgents } from "../lib/api";
import { demoTeamAgents } from "../lib/demo-team-agents";
import { tokenAtom } from "../state/session/atoms";
import type { Project, ProjectAgent } from "../types";

/*
  The agents the issue surfaces label runs with.

  The runs an agent is busy with used to be derived here too, which is what made
  the app shell subscribe to the session list; it is `processingIssueIdsAtom`
  now and the board wrapper reads it.

  The list is loaded per team but kept across team switches: a session started
  by an agent of another team is still on screen in the inbox and in the agent
  session detail, and it has to be able to name the agent that started it. That
  is why the reducer below replaces only the entries of the team it just loaded
  instead of the whole list.
*/

/** The reads this hook performs, so tests can supply in-memory ones. */
export interface IssueAgentsDeps {
  readonly loadTeamAgents?: (
    token: string,
    teamId: string,
  ) => Promise<ProjectAgent[]>;
  readonly loadDemoTeamAgents?: (
    teamId: string,
    locale: string,
  ) => ProjectAgent[];
}

export interface IssueAgentsInput {
  /**
   * The selected team, as the shell resolved it. Passed rather than read from
   * the store because the reload is keyed on this object's identity: a team
   * list update is what re-reads the agents.
   */
  readonly activeTeam: Project | undefined;
  readonly deps?: IssueAgentsDeps;
}

export interface IssueAgents {
  /** Every agent loaded so far, across teams. */
  readonly agents: ProjectAgent[];
  /** Only the selected team's agents, which is what the board labels with. */
  readonly activeTeamAgents: ProjectAgent[];
  /** Records an agent the shell learned about outside the load, e.g. a start. */
  readonly rememberAgent: (agent: ProjectAgent) => void;
}

export function useIssueAgents({
  activeTeam,
  deps,
}: IssueAgentsInput): IssueAgents {
  const { locale } = useI18n();
  const token = useAtomValue(tokenAtom);
  const loadTeamAgents = deps?.loadTeamAgents ?? loadProjectAgents;
  const loadDemoTeamAgents = deps?.loadDemoTeamAgents ?? demoTeamAgents;
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const activeTeamAgents = useMemo(
    () => agents.filter((agent) => agent.teamId === activeTeam?.id),
    [activeTeam?.id, agents],
  );

  useEffect(() => {
    if (!activeTeam) {
      setAgents([]);
      return;
    }

    let cancelled = false;
    const loaded = token
      ? loadTeamAgents(token, activeTeam.id)
      : Promise.resolve(loadDemoTeamAgents(activeTeam.id, locale));
    void loaded
      .then((loadedAgents) => {
        if (!cancelled) {
          setAgents((current) => [
            ...current.filter((agent) => agent.teamId !== activeTeam.id),
            ...loadedAgents,
          ]);
        }
      })
      .catch(() => {
        // Keep previously loaded agents so their running sessions remain
        // identifiable while another project is active or temporarily offline.
      });
    return () => {
      cancelled = true;
    };
  }, [activeTeam, token, locale]);

  const rememberAgent = useCallback((agent: ProjectAgent) => {
    setAgents((current) => {
      const index = current.findIndex((candidate) => candidate.id === agent.id);
      if (index < 0) return [...current, agent];
      if (current[index] === agent) return current;
      return current.map((candidate) =>
        candidate.id === agent.id ? agent : candidate
      );
    });
  }, []);

  return { activeTeamAgents, agents, rememberAgent };
}
