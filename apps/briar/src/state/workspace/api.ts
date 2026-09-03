import * as Atom from "effect/unstable/reactivity/Atom";

import type { RepositoryReadiness } from "../../generated/tauri";
import {
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  connectLinearImport,
  createAgentToken,
  createProjectGithubCredential,
  createTeam,
  deleteTeam,
  dispatchHuntRun,
  importLinearIssues,
  loadDashboard,
  loadGithubIntegration,
  loadLinearImportStates,
  loadOrganizations,
  renewProjectAgentScheduleRun,
  retryHuntRun,
  updateCheckpointPolicy,
  updateTeamIcon,
  updateTeamSettings,
} from "../../lib/api";
import { executeScheduledTeamAgent } from "../../lib/team-agent-schedule-execution";
import { startTeamAgentSchedulePolling } from "../../lib/team-agent-schedule-runner";
import { runTeamAgent } from "../../lib/team-llm";
import { syncSharedProjectWorkflows } from "../../lib/shared-workflow-sync";
import { createLocalProjectReadinessCoordinator } from "../../lib/local-team-connection";
import {
  configureLocalExecutionWorker,
  connectLocalTeam,
  createTeamWorkspace,
  disconnectLocalTeam,
  discoverRepositoryIcon,
  inspectLovableRepositoryCompatibility,
  inspectRepositoryReadiness,
  inspectVelen,
  loadAutoHuntHealth,
  loadConnectedTeamIds,
  loadTeamRepositoryReadiness,
  pickGitRepository,
  preflightLocalTeamConnection,
  prepareTeamRepository,
  repairAutoHunt,
  updateLocalTeamVelenOrg,
  updateLocalTeamWorkflow,
} from "../../lib/team-connection";
import {
  analyzeTeamWorkflowRequirements,
  generateTeamWorkflow,
  reviseTeamWorkflow,
} from "../../lib/team-workflow";
import type { ClaimedProjectAgentScheduleRun, HuntRun } from "../../types";
import { demoMode, remoteMode } from "../platform";
import type { AtomRegistry } from "../registry";

/**
 * The two platform flags every workspace flow branches on. They are build time
 * constants, and the test runner always resolves them to "configured desktop",
 * so an atom is what lets a test reach the demo and companion branches without
 * mocking the module that defines them.
 */
export interface WorkspaceModes {
  readonly demoMode: boolean;
  readonly remoteMode: boolean;
}

export const workspaceModesAtom = Atom.make<WorkspaceModes>({
  demoMode,
  remoteMode,
}).pipe(Atom.keepAlive, Atom.withLabel("workspace/modes"));

/** The platform flags in force for this registry. */
export const workspaceModes = (registry: AtomRegistry): WorkspaceModes =>
  registry.get(workspaceModesAtom);

/*
  The single seam for everything the workspace, workflow and integration
  actions reach outside the store: Tauri commands that talk to this device, and
  the team endpoints that own the settings those commands mirror.

  It is one seam rather than three because the readiness coordinator and the
  effects in `useWorkspaceSync` are shared with the actions — a hook and an
  action module cannot hand each other a partial API, so the overrides live in
  an atom the registry owns. `setSessionDataSources` seeds it from one option
  and tests seed it with in-memory implementations, which is what lets these
  flows be exercised without module mocking.
*/
export interface WorkspaceApi {
  readonly analyzeTeamWorkflowRequirements: typeof analyzeTeamWorkflowRequirements;
  readonly claimProjectAgentScheduleRuns: typeof claimProjectAgentScheduleRuns;
  readonly completeProjectAgentScheduleRun: typeof completeProjectAgentScheduleRun;
  readonly configureLocalExecutionWorker: typeof configureLocalExecutionWorker;
  readonly connectLinearImport: typeof connectLinearImport;
  readonly connectLocalTeam: typeof connectLocalTeam;
  readonly createAgentToken: typeof createAgentToken;
  readonly createProjectGithubCredential: typeof createProjectGithubCredential;
  readonly createTeam: typeof createTeam;
  readonly createTeamWorkspace: typeof createTeamWorkspace;
  readonly deleteTeam: typeof deleteTeam;
  readonly disconnectLocalTeam: typeof disconnectLocalTeam;
  readonly dispatchHuntRun: typeof dispatchHuntRun;
  readonly discoverRepositoryIcon: typeof discoverRepositoryIcon;
  readonly executeScheduledTeamAgent: typeof executeScheduledTeamAgent;
  readonly generateTeamWorkflow: typeof generateTeamWorkflow;
  readonly importLinearIssues: typeof importLinearIssues;
  readonly inspectLovableRepositoryCompatibility: typeof inspectLovableRepositoryCompatibility;
  readonly inspectRepositoryReadiness: typeof inspectRepositoryReadiness;
  readonly inspectVelen: typeof inspectVelen;
  readonly loadAutoHuntHealth: typeof loadAutoHuntHealth;
  readonly loadConnectedTeamIds: typeof loadConnectedTeamIds;
  readonly loadDashboard: typeof loadDashboard;
  readonly loadGithubIntegration: typeof loadGithubIntegration;
  readonly loadLinearImportStates: typeof loadLinearImportStates;
  readonly loadOrganizations: typeof loadOrganizations;
  readonly loadTeamRepositoryReadiness: typeof loadTeamRepositoryReadiness;
  readonly pickGitRepository: typeof pickGitRepository;
  readonly preflightLocalTeamConnection: typeof preflightLocalTeamConnection;
  readonly prepareTeamRepository: typeof prepareTeamRepository;
  readonly renewProjectAgentScheduleRun: typeof renewProjectAgentScheduleRun;
  readonly repairAutoHunt: typeof repairAutoHunt;
  readonly retryHuntRun: typeof retryHuntRun;
  readonly reviseTeamWorkflow: typeof reviseTeamWorkflow;
  readonly runTeamAgent: typeof runTeamAgent;
  readonly startTeamAgentSchedulePolling: typeof startTeamAgentSchedulePolling;
  readonly syncSharedProjectWorkflows: typeof syncSharedProjectWorkflows;
  readonly updateCheckpointPolicy: typeof updateCheckpointPolicy;
  readonly updateLocalTeamVelenOrg: typeof updateLocalTeamVelenOrg;
  readonly updateLocalTeamWorkflow: typeof updateLocalTeamWorkflow;
  readonly updateTeamIcon: typeof updateTeamIcon;
  readonly updateTeamSettings: typeof updateTeamSettings;
}

export const liveWorkspaceApi: WorkspaceApi = {
  analyzeTeamWorkflowRequirements,
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  configureLocalExecutionWorker,
  connectLinearImport,
  connectLocalTeam,
  createAgentToken,
  createProjectGithubCredential,
  createTeam,
  createTeamWorkspace,
  deleteTeam,
  disconnectLocalTeam,
  discoverRepositoryIcon,
  dispatchHuntRun,
  executeScheduledTeamAgent,
  generateTeamWorkflow,
  importLinearIssues,
  inspectLovableRepositoryCompatibility,
  inspectRepositoryReadiness,
  inspectVelen,
  loadAutoHuntHealth,
  loadConnectedTeamIds,
  loadDashboard,
  loadGithubIntegration,
  loadLinearImportStates,
  loadOrganizations,
  loadTeamRepositoryReadiness,
  pickGitRepository,
  preflightLocalTeamConnection,
  prepareTeamRepository,
  renewProjectAgentScheduleRun,
  repairAutoHunt,
  retryHuntRun,
  reviseTeamWorkflow,
  runTeamAgent,
  startTeamAgentSchedulePolling,
  syncSharedProjectWorkflows,
  updateCheckpointPolicy,
  updateLocalTeamVelenOrg,
  updateLocalTeamWorkflow,
  updateTeamIcon,
  updateTeamSettings,
};

/**
 * Overrides layered over {@link liveWorkspaceApi}. Partial so a caller replaces
 * only the calls it cares about.
 */
export const workspaceApiAtom = Atom.make<Partial<WorkspaceApi>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("workspace/api"),
);

/** The API in force for this registry, resolved at call time. */
export function resolveWorkspaceApi(
  registry: AtomRegistry,
  overrides?: Partial<WorkspaceApi> | undefined,
): WorkspaceApi {
  return {
    ...liveWorkspaceApi,
    ...registry.get(workspaceApiAtom),
    ...overrides,
  };
}

/*
  The mutable state the workspace flows share, one instance per registry.

  The readiness coordinator deduplicates inventory reads and drops superseded
  probes, so the sync hook that inspects every team on boot and the actions a
  user triggers have to be looking at the same one. The shared workflow keys and
  the health request counter are the same story: they were refs on `useBriar`,
  and their lifetime is the registry's.
*/
interface WorkspaceCoordinators {
  readonly readiness: ReturnType<
    typeof createLocalProjectReadinessCoordinator<RepositoryReadiness>
  >;
  /**
   * The last workflow content mirrored into each connected repository, so a
   * repeat of the same content skips the write.
   */
  readonly lastSyncedSharedWorkflowKeys: Map<string, string>;
  /** Generation counters guarding the health probe and the reconnect flow. */
  readonly requests: { health: number; reconnect: number };
}

const coordinators = new WeakMap<AtomRegistry, WorkspaceCoordinators>();

function workspaceCoordinators(registry: AtomRegistry): WorkspaceCoordinators {
  let current = coordinators.get(registry);
  if (!current) {
    current = {
      readiness: createLocalProjectReadinessCoordinator<RepositoryReadiness>({
        // Resolved per call so a registry seeded after the coordinator was
        // created still fetches through the seeded implementation.
        loadConnectedTeamIds: () =>
          resolveWorkspaceApi(registry).loadConnectedTeamIds(),
        loadReadiness: (teamId) =>
          resolveWorkspaceApi(registry).loadTeamRepositoryReadiness(teamId),
      }),
      lastSyncedSharedWorkflowKeys: new Map(),
      requests: { health: 0, reconnect: 0 },
    };
    coordinators.set(registry, current);
  }
  return current;
}

/** The shared readiness and inventory coordinator for this registry. */
export const getReadinessCoordinator = (registry: AtomRegistry) =>
  workspaceCoordinators(registry).readiness;

/** The shared workflow mirror bookkeeping for this registry. */
export const getSharedWorkflowKeys = (registry: AtomRegistry) =>
  workspaceCoordinators(registry).lastSyncedSharedWorkflowKeys;

/** Starts a health probe, invalidating whatever was in flight. */
export const beginHealthRequest = (registry: AtomRegistry) =>
  ++workspaceCoordinators(registry).requests.health;

/** Whether `request` is still the newest health probe. */
export const isCurrentHealthRequest = (
  registry: AtomRegistry,
  request: number,
) => workspaceCoordinators(registry).requests.health === request;

/**
 * Invalidates in-flight reconnect attempts. Every session, organization and
 * team transition does this, which is why it is a shared counter rather than a
 * callback the facade injects into each action module.
 */
export const bumpReconnectRequest = (registry: AtomRegistry) =>
  ++workspaceCoordinators(registry).requests.reconnect;

/** Whether `request` is still the newest reconnect attempt. */
export const isCurrentReconnectRequest = (
  registry: AtomRegistry,
  request: number,
) => workspaceCoordinators(registry).requests.reconnect === request;

/** The current reconnect generation, without bumping it. */
export const reconnectRequestGeneration = (registry: AtomRegistry) =>
  workspaceCoordinators(registry).requests.reconnect;

/**
 * The scheduled agent session callbacks only the app shell can supply:
 * `useAutoHuntSessions` owns the session list a scheduled run appears in, and
 * it renders far above the effect that polls for those runs.
 *
 * They are held per registry rather than passed as hook dependencies because
 * their identity changes on every render of the shell, while the schedule
 * poller must restart only when the token, the teams or the connection
 * inventory change — a restart re-claims, which is what could make one
 * scheduled run execute twice.
 */
export interface WorkspaceScheduleBridge {
  readonly startScheduledAgentSession?:
    | ((run: ClaimedProjectAgentScheduleRun) => string | null)
    | undefined;
  readonly settleScheduledAgentSession?:
    | ((
        sessionId: string,
        input: {
          status: "completed" | "failed" | "skipped";
          conversationId: string | null;
          workspaceRoot: string | null;
          summary: string | null;
          error: string | null;
        },
      ) => void)
    | undefined;
  readonly startScheduledAgentWorkerDispatch?:
    | ((
        parentSessionId: string,
        run: ClaimedProjectAgentScheduleRun,
        runs: readonly HuntRun[],
        dispatch: { dispatchId: string; runIds: string[] },
      ) => void)
    | undefined;
}

const scheduleBridges = new WeakMap<AtomRegistry, WorkspaceScheduleBridge>();

/** Installs the scheduled agent session callbacks for this registry. */
export function setWorkspaceScheduleBridge(
  registry: AtomRegistry,
  bridge: WorkspaceScheduleBridge,
): void {
  scheduleBridges.set(registry, bridge);
}

/** The scheduled agent session callbacks installed for this registry. */
export const getWorkspaceScheduleBridge = (
  registry: AtomRegistry,
): WorkspaceScheduleBridge => scheduleBridges.get(registry) ?? {};
