// 프로젝트 목록은 계정 상태이고, 저장소 연결은 기기 상태입니다.
export type LocalTeamConnectionState =
  | "unknown"
  | "disconnected"
  | "connected";

export function localTeamConnectionState(
  connectedTeamIds: readonly string[] | null,
  projectId: string | null,
): LocalTeamConnectionState {
  if (!connectedTeamIds || !projectId) return "unknown";
  return connectedTeamIds.includes(projectId)
    ? "connected"
    : "disconnected";
}

export function isTeamConnectedLocally(
  connectedTeamIds: readonly string[] | null,
  projectId: string | null,
) {
  return localTeamConnectionState(connectedTeamIds, projectId) ===
    "connected";
}

export function localTeamReadiness<T>(
  connectionState: LocalTeamConnectionState,
  readiness: T | null,
): T | null {
  return connectionState === "connected" ? readiness : null;
}

export type TeamRepositoryDestination =
  | "reconnect"
  | "unavailable"
  | "settings"
  | "readiness";

export type LocalTeamRepositoryReadiness = {
  gitReady: boolean;
  prReady: boolean;
  requiresGithub: boolean;
};

export function isLocalTeamRepositoryReady(
  readiness: LocalTeamRepositoryReadiness | null,
) {
  return Boolean(
    readiness &&
      (readiness.requiresGithub ? readiness.prReady : readiness.gitReady),
  );
}

export function teamRepositoryDestination(input: {
  connectionState: LocalTeamConnectionState;
  readiness: LocalTeamRepositoryReadiness | null;
  requiresLocalReadiness: boolean;
}): TeamRepositoryDestination {
  if (!input.requiresLocalReadiness) return "settings";
  if (input.connectionState === "disconnected") return "readiness";
  if (input.connectionState === "unknown") return "unavailable";
  return isLocalTeamRepositoryReady(input.readiness)
    ? "settings"
    : "readiness";
}

export function withoutConnectedProject(
  connectedTeamIds: string[] | null,
  projectId: string,
) {
  if (!connectedTeamIds) return connectedTeamIds;
  return connectedTeamIds.filter((id) => id !== projectId);
}

export type LocalTeamReadinessObservation<T> =
  | { status: "superseded" }
  | {
      status: "unknown";
      connectedTeamIds: null;
      readiness: null;
      error: unknown;
    }
  | {
      status: "disconnected";
      connectedTeamIds: string[];
      readiness: null;
      error: null;
    }
  | {
      status: "ready";
      connectedTeamIds: string[];
      readiness: T;
      error: null;
    }
  | {
      status: "error";
      connectedTeamIds: string[];
      readiness: null;
      error: unknown;
    };

export type LocalProjectInventoryObservation =
  | {
      status: "loaded";
      connectedTeamIds: string[] | null;
      error: null;
    }
  | {
      status: "error";
      connectedTeamIds: null;
      error: unknown;
    };

export function createLocalProjectReadinessCoordinator<T>(input: {
  loadConnectedTeamIds: () => Promise<string[] | null>;
  loadReadiness: (projectId: string) => Promise<T | null>;
}) {
  let sequence = 0;
  const projectRequests = new Map<string, number>();
  let latestInventory: string[] | null = null;
  let inventoryLoad: Promise<string[] | null> | null = null;

  const begin = (projectId: string) => {
    const request = ++sequence;
    projectRequests.set(projectId, request);
    return request;
  };
  const isCurrent = (projectId: string, request: number) =>
    projectRequests.get(projectId) === request;
  const loadInventory = async (afterCurrent = false) => {
    if (afterCurrent && inventoryLoad) {
      await inventoryLoad.catch(() => null);
    }
    if (inventoryLoad) {
      return inventoryLoad;
    }
    const request = input.loadConnectedTeamIds()
      .then((connectedTeamIds) => {
        latestInventory = connectedTeamIds;
        return connectedTeamIds;
      })
      .catch((error) => {
        latestInventory = null;
        throw error;
      });
    inventoryLoad = request;
    try {
      return await request;
    } finally {
      if (inventoryLoad === request) inventoryLoad = null;
    }
  };
  const inspectInventory = async (
    afterCurrent = false,
  ): Promise<LocalProjectInventoryObservation> => {
    try {
      return {
        status: "loaded",
        connectedTeamIds: await loadInventory(afterCurrent),
        error: null,
      };
    } catch (error) {
      return {
        status: "error",
        connectedTeamIds: null,
        error,
      };
    }
  };
  const currentConnection = (
    projectId: string,
    request: number,
  ):
    | LocalTeamReadinessObservation<T>
    | { status: "connected"; connectedTeamIds: string[] } => {
    if (!isCurrent(projectId, request)) return { status: "superseded" };
    const connectedTeamIds = latestInventory;
    if (!connectedTeamIds) {
      return {
        status: "unknown",
        connectedTeamIds: null,
        readiness: null,
        error: new Error(
          "로컬 프로젝트 연결 상태를 확인할 수 없습니다.",
        ),
      };
    }
    if (!connectedTeamIds.includes(projectId)) {
      return {
        status: "disconnected",
        connectedTeamIds,
        readiness: null,
        error: null,
      };
    }
    return { status: "connected", connectedTeamIds };
  };
  const inspect = async (
    projectId: string,
  ): Promise<LocalTeamReadinessObservation<T>> => {
    const request = begin(projectId);
    const inventory = await inspectInventory();
    if (inventory.status === "error") {
      return isCurrent(projectId, request)
        ? {
            status: "unknown",
            connectedTeamIds: null,
            readiness: null,
            error: inventory.error,
          }
        : { status: "superseded" };
    }
    const connection = currentConnection(projectId, request);
    if (connection.status !== "connected") return connection;
    try {
      const readiness = await input.loadReadiness(projectId);
      const current = currentConnection(projectId, request);
      if (current.status !== "connected") return current;
      return readiness
        ? {
            status: "ready",
            connectedTeamIds: current.connectedTeamIds,
            readiness,
            error: null,
          }
        : {
            status: "error",
            connectedTeamIds: current.connectedTeamIds,
            readiness: null,
            error: new Error("로컬 저장소 준비 상태를 확인할 수 없습니다."),
          };
    } catch (error) {
      const current = currentConnection(projectId, request);
      return current.status === "connected"
        ? {
            status: "error",
            connectedTeamIds: current.connectedTeamIds,
            readiness: null,
            error,
          }
        : current;
    }
  };

  return { begin, inspect, inspectInventory, isCurrent };
}
