/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { createReactTestRoot, flush } from "../test/react";
import type { Project, ProjectAgent } from "../types";
import { useIssueAgents, type IssueAgents } from "./useIssueAgents";

/*
  What the agent list has to survive: a team switch.

  A session started by another team's agent stays on screen in the inbox, so
  the entry that names it must not be dropped when the board moves on. The
  first case is that rule; the rest are the two writes. The busy set is
  `processingIssueIdsAtom` and is covered with the other agent session atoms.
*/

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const agentOf = (id: string, teamId: string, name = id): ProjectAgent => ({
  id,
  teamId,
  name,
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "",
  skill: "",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});


class AgentSource {
  readonly requests: string[] = [];
  readonly byTeam = new Map<string, ProjectAgent[]>();

  load = async (_token: string, teamId: string) => {
    this.requests.push(teamId);
    return this.byTeam.get(teamId) ?? [];
  };
}

/** Publishes the hook's return so a case can assert on it after a render. */
let latest: IssueAgents;

function Harness({
  activeTeam,
  load,
}: {
  readonly activeTeam: Project | undefined;
  readonly load: AgentSource["load"];
}) {
  latest = useIssueAgents({ activeTeam, deps: { loadTeamAgents: load } });
  return null;
}

const mount = async (
  registry: AtomRegistry,
  props: Parameters<typeof Harness>[0],
) => {
  const view = createReactTestRoot();
  const render = (next: Parameters<typeof Harness>[0]) =>
    view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <Harness {...next} />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
  await render(props);
  await flush();
  return { render, view };
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("useIssueAgents", () => {
  it("keeps another team's agents when the selection moves", async () => {
    const registry = createTestRegistry([[tokenAtom, "token-1"]]);
    const source = new AgentSource();
    source.byTeam.set(teamA.id, [agentOf("agent-a", teamA.id)]);
    source.byTeam.set(teamB.id, [agentOf("agent-b", teamB.id)]);

    const { render, view } = await mount(registry, {
      activeTeam: teamA,
      load: source.load,
    });
    expect(latest.agents.map((agent) => agent.id)).toEqual(["agent-a"]);
    expect(latest.activeTeamAgents.map((agent) => agent.id)).toEqual([
      "agent-a",
    ]);

    await render({ activeTeam: teamB, load: source.load });
    await flush();
    expect(latest.agents.map((agent) => agent.id).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);
    // Only the selected team's agents label the board.
    expect(latest.activeTeamAgents.map((agent) => agent.id)).toEqual([
      "agent-b",
    ]);
    expect(source.requests).toEqual([teamA.id, teamB.id]);
    await view.cleanup();
  });

  it("empties the list when no team is selected", async () => {
    const registry = createTestRegistry([[tokenAtom, "token-1"]]);
    const source = new AgentSource();
    source.byTeam.set(teamA.id, [agentOf("agent-a", teamA.id)]);

    const { render, view } = await mount(registry, {
      activeTeam: teamA,
      load: source.load,
    });
    expect(latest.agents).toHaveLength(1);

    await render({ activeTeam: undefined, load: source.load });
    await flush();
    expect(latest.agents).toEqual([]);
    await view.cleanup();
  });

  it("replaces an agent it already knows rather than appending it", async () => {
    const registry = createTestRegistry([[tokenAtom, "token-1"]]);
    const source = new AgentSource();
    source.byTeam.set(teamA.id, [agentOf("agent-a", teamA.id, "Before")]);

    const { view } = await mount(registry, {
      activeTeam: teamA,
      load: source.load,
    });

    await act(async () => {
      latest.rememberAgent(agentOf("agent-a", teamA.id, "After"));
    });
    expect(latest.agents).toHaveLength(1);
    expect(latest.agents[0]?.name).toBe("After");

    await act(async () => {
      latest.rememberAgent(agentOf("agent-c", teamA.id));
    });
    expect(latest.agents.map((agent) => agent.id)).toEqual([
      "agent-a",
      "agent-c",
    ]);
    await view.cleanup();
  });

});
