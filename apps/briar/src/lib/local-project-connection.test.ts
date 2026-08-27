import { describe, expect, it, vi } from "vitest";
import {
  createLocalProjectReadinessCoordinator,
  localProjectConnectionState,
  localProjectReadiness,
  projectRepositoryDestination,
} from "./local-project-connection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("local project connection state", () => {
  it.each([
    [null, "project-1", "unknown"],
    [[], "project-1", "disconnected"],
    [["project-1"], "project-1", "connected"],
  ] as const)("maps %j to %s", (connectedProjectIds, projectId, expected) => {
    expect(localProjectConnectionState(connectedProjectIds, projectId)).toBe(
      expected,
    );
  });

  it("prioritizes local disconnection over stale server and readiness data", () => {
    expect(projectRepositoryDestination({
      connectionState: "disconnected",
      readiness: { gitReady: true, prReady: true, requiresGithub: true },
      requiresLocalReadiness: true,
    })).toBe("reconnect");
    expect(projectRepositoryDestination({
      connectionState: "unknown",
      readiness: { gitReady: true, prReady: true, requiresGithub: true },
      requiresLocalReadiness: true,
    })).toBe("unavailable");
    expect(projectRepositoryDestination({
      connectionState: "connected",
      readiness: { gitReady: true, prReady: true, requiresGithub: true },
      requiresLocalReadiness: true,
    })).toBe("settings");
    expect(projectRepositoryDestination({
      connectionState: "connected",
      readiness: { gitReady: true, prReady: false, requiresGithub: true },
      requiresLocalReadiness: true,
    })).toBe("readiness");
    expect(projectRepositoryDestination({
      connectionState: "connected",
      readiness: { gitReady: true, prReady: false, requiresGithub: false },
      requiresLocalReadiness: true,
    })).toBe("settings");
    expect(projectRepositoryDestination({
      connectionState: "connected",
      readiness: { gitReady: false, prReady: false, requiresGithub: false },
      requiresLocalReadiness: true,
    })).toBe("readiness");
    expect(projectRepositoryDestination({
      connectionState: "connected",
      readiness: null,
      requiresLocalReadiness: true,
    })).toBe("readiness");
    expect(projectRepositoryDestination({
      connectionState: "unknown",
      readiness: null,
      requiresLocalReadiness: false,
    })).toBe("settings");
  });

  it("ignores stale readiness unless the local connection is known", () => {
    const staleReadiness = { gitInstalled: true };

    expect(localProjectReadiness("unknown", staleReadiness)).toBeNull();
    expect(localProjectReadiness("disconnected", staleReadiness)).toBeNull();
    expect(localProjectReadiness("connected", staleReadiness)).toBe(
      staleReadiness,
    );
  });
});

describe("local readiness coordinator", () => {
  it("shares inventory while allowing different projects to finish", async () => {
    const inventory = deferred<string[] | null>();
    const loadConnectedProjectIds = vi.fn(() => inventory.promise);
    const loadReadiness = vi.fn(async (projectId: string) => ({ projectId }));
    const coordinator = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds,
      loadReadiness,
    });

    const projectA = coordinator.inspect("project-a");
    const projectB = coordinator.inspect("project-b");
    inventory.resolve(["project-a", "project-b"]);

    await expect(projectA).resolves.toMatchObject({
      status: "ready",
      readiness: { projectId: "project-a" },
    });
    await expect(projectB).resolves.toMatchObject({
      status: "ready",
      readiness: { projectId: "project-b" },
    });
    expect(loadConnectedProjectIds).toHaveBeenCalledOnce();
    expect(loadReadiness).toHaveBeenCalledTimes(2);
  });

  it("lets only the latest same-project observation commit", async () => {
    const firstReadiness = deferred<{ revision: number } | null>();
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let call = 0;
    const coordinator = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds: async () => ["project-a"],
      loadReadiness: async () => {
        call += 1;
        if (call === 1) {
          firstStarted();
          return firstReadiness.promise;
        }
        return { revision: 2 };
      },
    });

    const first = coordinator.inspect("project-a");
    await started;
    await expect(coordinator.inspect("project-a")).resolves.toMatchObject({
      status: "ready",
      readiness: { revision: 2 },
    });
    firstReadiness.resolve({ revision: 1 });
    await expect(first).resolves.toEqual({ status: "superseded" });
  });

  it("never returns an older inventory after a newer load finishes", async () => {
    const projectAReadiness = deferred<{ healthy: boolean } | null>();
    let projectAStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      projectAStarted = resolve;
    });
    let inventoryCall = 0;
    const coordinator = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds: async () => {
        inventoryCall += 1;
        return inventoryCall === 1 ? ["project-a"] : ["project-b"];
      },
      loadReadiness: async (projectId) => {
        if (projectId === "project-a") {
          projectAStarted();
          return projectAReadiness.promise;
        }
        return { healthy: true };
      },
    });

    const projectA = coordinator.inspect("project-a");
    await started;
    await expect(coordinator.inspect("project-b")).resolves.toMatchObject({
      status: "ready",
      connectedProjectIds: ["project-b"],
    });
    projectAReadiness.resolve({ healthy: true });
    await expect(projectA).resolves.toMatchObject({
      status: "disconnected",
      connectedProjectIds: ["project-b"],
    });
  });

  it("forces a fresh inventory after a connection commit", async () => {
    const staleInventory = deferred<string[] | null>();
    const loadConnectedProjectIds = vi.fn()
      .mockImplementationOnce(() => staleInventory.promise)
      .mockResolvedValueOnce(["project-new"]);
    const coordinator = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds,
      loadReadiness: async () => ({ healthy: true }),
    });

    const stale = coordinator.inspectInventory();
    const committed = coordinator.inspectInventory(true);
    staleInventory.resolve(["project-old"]);

    await expect(stale).resolves.toMatchObject({
      status: "loaded",
      connectedProjectIds: ["project-old"],
    });
    await expect(committed).resolves.toMatchObject({
      status: "loaded",
      connectedProjectIds: ["project-new"],
    });
    expect(loadConnectedProjectIds).toHaveBeenCalledTimes(2);
  });

  it("returns empty snapshots for inventory and readiness failures", async () => {
    const inventoryFailure = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds: async () => {
        throw new Error("inventory failed");
      },
      loadReadiness: async () => ({ healthy: true }),
    });
    await expect(inventoryFailure.inspect("project-a")).resolves.toMatchObject({
      status: "unknown",
      connectedProjectIds: null,
      readiness: null,
      error: new Error("inventory failed"),
    });

    const readinessFailure = createLocalProjectReadinessCoordinator({
      loadConnectedProjectIds: async () => ["project-a"],
      loadReadiness: async () => {
        throw new Error("probe failed");
      },
    });
    await expect(readinessFailure.inspect("project-a")).resolves.toMatchObject({
      status: "error",
      connectedProjectIds: ["project-a"],
      readiness: null,
      error: new Error("probe failed"),
    });
  });
});
