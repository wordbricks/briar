import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  createOrganization as createRemoteOrganization,
  isOrganizationHandleAvailable as checkRemoteOrganizationHandle,
  updateOrganization as updateRemoteOrganization,
  updateOrganizationLogo as updateRemoteOrganizationLogo,
} from "../../lib/api";
import type { Organization, Project } from "../../types";
import { demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
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
 * The dashboard-shaped state Phase 1 does not own yet. `useBriar` keeps the
 * dashboard, its per-team cache and the health probe, so an organization switch
 * hands those transitions back to it rather than duplicating them here.
 */
export interface OrganizationActionDeps {
  readonly api?: Partial<OrganizationActionApi> | undefined;
  /**
   * Applies the dashboard and health half of an organization switch: keep, warm
   * from the cache, or blank the board for `team`.
   */
  readonly applyOrganizationSwitch: (
    team: Project | null,
    dashboardMatchesTeam: boolean,
  ) => void;
  /** Invalidates in-flight reconnect attempts. */
  readonly bumpReconnectRequest: () => void;
  /** Mirrors a renamed organization into the rendered dashboard. */
  readonly renameDashboardOrganization: (
    organizationId: string,
    organizationName: string,
  ) => void;
  /**
   * The team the rendered dashboard belongs to, or `null` when no dashboard is
   * on screen. Compared against the team an organization resolves to, so a
   * no-op switch stays a no-op.
   */
  readonly readDashboardTeamId: () => string | null;
  /** Blanks the dashboard and health for a freshly created organization. */
  readonly resetTeamViews: () => void;
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
        registry.set(activeTeamIdAtom, null);
        registry.set(sessionErrorAtom, null);
      });
      deps.resetTeamViews();
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
      });
      deps.renameDashboardOrganization(organizationId, organization.name);
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
      const dashboardMatchesTeam = deps.readDashboardTeamId() === teamId;
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
      deps.applyOrganizationSwitch(team, dashboardMatchesTeam);
    },
  };
}

export function useOrganizationActions(
  deps: OrganizationActionDeps,
): OrganizationActions {
  const registry = useRegistry();
  const {
    api,
    applyOrganizationSwitch,
    bumpReconnectRequest,
    lockedTeamId,
    readDashboardTeamId,
    renameDashboardOrganization,
    resetTeamViews,
  } = deps;
  return useMemo(
    () =>
      createOrganizationActions(registry, {
        api,
        applyOrganizationSwitch,
        bumpReconnectRequest,
        lockedTeamId,
        readDashboardTeamId,
        renameDashboardOrganization,
        resetTeamViews,
      }),
    [
      api,
      applyOrganizationSwitch,
      bumpReconnectRequest,
      lockedTeamId,
      readDashboardTeamId,
      registry,
      renameDashboardOrganization,
      resetTeamViews,
    ],
  );
}
