// 프로젝트 목록은 계정 상태이고, 저장소 연결은 기기 상태입니다.
export type LocalProjectConnectionState =
  | "unknown"
  | "disconnected"
  | "connected";

export function localProjectConnectionState(
  connectedProjectIds: readonly string[] | null,
  projectId: string | null,
): LocalProjectConnectionState {
  if (!connectedProjectIds || !projectId) return "unknown";
  return connectedProjectIds.includes(projectId)
    ? "connected"
    : "disconnected";
}

export function isProjectConnectedLocally(
  connectedProjectIds: readonly string[] | null,
  projectId: string | null,
) {
  return localProjectConnectionState(connectedProjectIds, projectId) ===
    "connected";
}

export function localProjectReadiness<T>(
  connectionState: LocalProjectConnectionState,
  readiness: T | null,
): T | null {
  return connectionState === "connected" ? readiness : null;
}

export type ProjectRepositoryDestination =
  | "reconnect"
  | "unavailable"
  | "settings"
  | "readiness";

export type LocalProjectRepositoryReadiness = {
  gitReady: boolean;
  prReady: boolean;
  requiresGithub: boolean;
};

export function isLocalProjectRepositoryReady(
  readiness: LocalProjectRepositoryReadiness | null,
) {
  return Boolean(
    readiness &&
      (readiness.requiresGithub ? readiness.prReady : readiness.gitReady),
  );
}

export function projectRepositoryDestination(input: {
  connectionState: LocalProjectConnectionState;
  readiness: LocalProjectRepositoryReadiness | null;
  requiresLocalReadiness: boolean;
}): ProjectRepositoryDestination {
  if (!input.requiresLocalReadiness) return "settings";
  if (input.connectionState === "disconnected") return "reconnect";
  if (input.connectionState === "unknown") return "unavailable";
  return isLocalProjectRepositoryReady(input.readiness)
    ? "settings"
    : "readiness";
}

export function withoutConnectedProject(
  connectedProjectIds: string[] | null,
  projectId: string,
) {
  if (!connectedProjectIds) return connectedProjectIds;
  return connectedProjectIds.filter((id) => id !== projectId);
}

export type LocalProjectReadinessObservation<T> =
  | { status: "superseded" }
  | {
      status: "unknown";
      connectedProjectIds: null;
      readiness: null;
      error: unknown;
    }
  | {
      status: "disconnected";
      connectedProjectIds: string[];
      readiness: null;
      error: null;
    }
  | {
      status: "ready";
      connectedProjectIds: string[];
      readiness: T;
      error: null;
    }
  | {
      status: "error";
      connectedProjectIds: string[];
      readiness: null;
      error: unknown;
    };

export type LocalProjectInventoryObservation =
  | {
      status: "loaded";
      connectedProjectIds: string[] | null;
      error: null;
    }
  | {
      status: "error";
      connectedProjectIds: null;
      error: unknown;
    };

export function createLocalProjectReadinessCoordinator<T>(input: {
  loadConnectedProjectIds: () => Promise<string[] | null>;
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
    const request = input.loadConnectedProjectIds()
      .then((connectedProjectIds) => {
        latestInventory = connectedProjectIds;
        return connectedProjectIds;
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
        connectedProjectIds: await loadInventory(afterCurrent),
        error: null,
      };
    } catch (error) {
      return {
        status: "error",
        connectedProjectIds: null,
        error,
      };
    }
  };
  const currentConnection = (
    projectId: string,
    request: number,
  ):
    | LocalProjectReadinessObservation<T>
    | { status: "connected"; connectedProjectIds: string[] } => {
    if (!isCurrent(projectId, request)) return { status: "superseded" };
    const connectedProjectIds = latestInventory;
    if (!connectedProjectIds) {
      return {
        status: "unknown",
        connectedProjectIds: null,
        readiness: null,
        error: new Error(
          "로컬 프로젝트 연결 상태를 확인할 수 없습니다.",
        ),
      };
    }
    if (!connectedProjectIds.includes(projectId)) {
      return {
        status: "disconnected",
        connectedProjectIds,
        readiness: null,
        error: null,
      };
    }
    return { status: "connected", connectedProjectIds };
  };
  const inspect = async (
    projectId: string,
  ): Promise<LocalProjectReadinessObservation<T>> => {
    const request = begin(projectId);
    const inventory = await inspectInventory();
    if (inventory.status === "error") {
      return isCurrent(projectId, request)
        ? {
            status: "unknown",
            connectedProjectIds: null,
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
            connectedProjectIds: current.connectedProjectIds,
            readiness,
            error: null,
          }
        : {
            status: "error",
            connectedProjectIds: current.connectedProjectIds,
            readiness: null,
            error: new Error("로컬 저장소 준비 상태를 확인할 수 없습니다."),
          };
    } catch (error) {
      const current = currentConnection(projectId, request);
      return current.status === "connected"
        ? {
            status: "error",
            connectedProjectIds: current.connectedProjectIds,
            readiness: null,
            error,
          }
        : current;
    }
  };

  return { begin, inspect, inspectInventory, isCurrent };
}
