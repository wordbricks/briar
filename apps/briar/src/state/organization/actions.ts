import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  createOrganization as createRemoteOrganization,
  isOrganizationHandleAvailable as checkRemoteOrganizationHandle,
  updateOrganization as updateRemoteOrganization,
  updateOrganizationLogo as updateRemoteOrganizationLogo,
} from "../../lib/api";
import { demoDashboard } from "../../lib/demo-data";
import type { Organization } from "../../types";
import { emptyDashboard } from "../demo-fixtures";
import { teamsByIdAtom } from "../entities/teams";
import { upsertManyBy } from "../entities/upsert";
import { demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent, markTeamStale } from "../sync/apply";
import { loadedDashboardTeamIdAtom } from "../sync/view";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { activeOrganizationIdAtom, organizationsAtom } from "./atoms";

/** Remote writes and reads the organization actions perform. */
export interface OrganizationActionApi {
  readonly createOrganization: typeof createRemoteOrganization;
  readonly isOrganizationHandleAvailable: typeof checkRemoteOrganizationHandle;
  readonly updateOrganization: typeof updateRemoteOrganization;
  readonly updateOrganizationLogo: typeof updateRemoteOrganizationLogo;
}

export const liveOrganizationActionApi: OrganizationActionApi = {
  createOrganization: createRemoteOrganization,
  isOrganizationHandleAvailable: checkRemoteOrganizationHandle,
  updateOrganization: updateRemoteOrganization,
  updateOrganizationLogo: updateRemoteOrganizationLogo,
};

/**
 * The health probe is the only piece of an organization switch these actions do
 * not own: it still lives in `useBriar` until Phase 3 moves it. The dashboard
 * half is read and written here, through the entity store.
 */
export interface OrganizationActionDeps {
  readonly api?: Partial<OrganizationActionApi> | undefined;
  /** Invalidates in-flight reconnect attempts. */
  readonly bumpReconnectRequest: () => void;
  /** Blanks the health probe when the switch lands on a different team. */
  readonly resetTeamHealth: () => void;
  /**
   * The team a project window is pinned to, if any. Such a window may only ever
   * select that team's organization.
   */
  readonly lockedTeamId: string | null;
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly handle: string;
}

export interface OrganizationActions {
  readonly addOrganization: (
    input: CreateOrganizationInput,
  ) => Promise<Organization>;
  readonly changeOrganizationLogo: (
    organizationId: string,
    logo: string | null,
  ) => Promise<Organization>;
  readonly checkOrganizationHandle: (handle: string) => Promise<boolean>;
  readonly renameOrganization: (
    organizationId: string,
    name: string,
  ) => Promise<Organization>;
  readonly selectOrganization: (organizationId: string) => void;
}

export function createOrganizationActions(
  registry: AtomRegistry,
  deps: OrganizationActionDeps,
): OrganizationActions {
  const api: OrganizationActionApi = {
    ...liveOrganizationActionApi,
    ...deps.api,
  };

  const replaceOrganization = (organization: Organization) => {
    registry.update(organizationsAtom, (current) =>
      current.map((candidate) =>
        candidate.id === organization.id ? organization : candidate,
      ),
    );
  };

  return {
    async addOrganization(input) {
      deps.bumpReconnectRequest();
      let organization: Organization;
      if (demoMode) {
        if (
          registry
            .get(organizationsAtom)
            .some((candidate) => candidate.handle === input.handle)
        ) {
          throw new Error("Organization handle already exists");
        }
        organization = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          handle: input.handle,
          logo: null,
          role: "owner",
          createdAt: new Date().toISOString(),
        };
      } else {
        const token = registry.get(tokenAtom);
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await api.createOrganization(token, input);
        organization = result.organization;
      }
      Atom.batch(() => {
        registry.update(organizationsAtom, (current) => [
          ...current,
          organization,
        ]);
        registry.set(activeOrganizationIdAtom, organization.id);
        // No team is selected in a brand new organization, so the dashboard
        // view resolves to `null` without anything having to blank it.
        registry.set(activeTeamIdAtom, null);
        registry.set(sessionErrorAtom, null);
      });
      deps.resetTeamHealth();
      return organization;
    },

    async changeOrganizationLogo(organizationId, logo) {
      const currentOrganization = registry
        .get(organizationsAtom)
        .find((organization) => organization.id === organizationId);
      if (!currentOrganization) {
        throw new Error("변경할 조직을 찾을 수 없습니다.");
      }
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const organization =
        demoMode || !token
          ? { ...currentOrganization, logo }
          : (await api.updateOrganizationLogo(token, organizationId, logo))
              .organization;
      replaceOrganization(organization);
      return organization;
    },

    async checkOrganizationHandle(handle) {
      if (demoMode) {
        return !registry
          .get(organizationsAtom)
          .some((organization) => organization.handle === handle);
      }
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      return api.isOrganizationHandleAvailable(token, handle);
    },

    async renameOrganization(organizationId, name) {
      const currentOrganization = registry
        .get(organizationsAtom)
        .find((organization) => organization.id === organizationId);
      if (!currentOrganization) {
        throw new Error("변경할 조직을 찾을 수 없습니다.");
      }
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const organization =
        demoMode || !token
          ? { ...currentOrganization, name }
          : (await api.updateOrganization(token, organizationId, name))
              .organization;
      Atom.batch(() => {
        replaceOrganization(organization);
        registry.update(teamsAtom, (current) =>
          current.map((team) =>
            team.organizationId === organizationId
              ? { ...team, organizationName: organization.name }
              : team,
          ),
        );
        // The stored team entities carry their own copy of the organization
        // name, so the rendered dashboard has to be renamed with them.
        registry.update(teamsByIdAtom, (teams) => {
          let next = teams;
          for (const [teamId, team] of teams) {
            if (team.organizationId !== organizationId) continue;
            next = upsertManyBy(
              next,
              [{ ...team, organizationName: organization.name }],
              () => teamId,
            );
          }
          return next;
        });
      });
      return organization;
    },

    selectOrganization(organizationId) {
      const teams = registry.get(teamsAtom);
      if (deps.lockedTeamId) {
        const lockedTeam = teams.find((team) => team.id === deps.lockedTeamId);
        if (lockedTeam?.organizationId !== organizationId) return;
        deps.bumpReconnectRequest();
        Atom.batch(() => {
          registry.set(activeOrganizationIdAtom, organizationId);
          registry.set(activeTeamIdAtom, lockedTeam.id);
          registry.set(sessionErrorAtom, null);
        });
        return;
      }
      if (
        !registry
          .get(organizationsAtom)
          .some((organization) => organization.id === organizationId)
      ) {
        return;
      }
      const team =
        teams.find((candidate) => candidate.organizationId === organizationId) ??
        null;
      const teamId = team?.id ?? null;
      const dashboardMatchesTeam =
        registry.get(loadedDashboardTeamIdAtom) === teamId;
      if (
        registry.get(activeOrganizationIdAtom) === organizationId &&
        registry.get(activeTeamIdAtom) === teamId &&
        dashboardMatchesTeam
      ) {
        registry.set(sessionErrorAtom, null);
        return;
      }
      deps.bumpReconnectRequest();
      Atom.batch(() => {
        registry.set(activeOrganizationIdAtom, organizationId);
        registry.set(activeTeamIdAtom, teamId);
        registry.set(sessionErrorAtom, null);
      });
      if (demoMode && team) {
        applySyncEvent(registry, {
          kind: "team-snapshot",
          teamId: team.id,
          payload:
            team.id === demoDashboard.team.id
              ? demoDashboard
              : emptyDashboard(team),
        });
      } else if (!dashboardMatchesTeam) {
        // The store keeps the team's last payload across the switch, so the
        // board never blanks; it only needs the marker that forces a snapshot.
        markTeamStale(registry, teamId);
      }
      if (!dashboardMatchesTeam) deps.resetTeamHealth();
    },
  };
}

export function useOrganizationActions(
  deps: OrganizationActionDeps,
): OrganizationActions {
  const registry = useRegistry();
  const { api, bumpReconnectRequest, lockedTeamId, resetTeamHealth } = deps;
  return useMemo(
    () =>
      createOrganizationActions(registry, {
        api,
        bumpReconnectRequest,
        lockedTeamId,
        resetTeamHealth,
      }),
    [api, bumpReconnectRequest, lockedTeamId, registry, resetTeamHealth],
  );
}
