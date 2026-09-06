import { describe, expect, it, vi } from "vitest";
import {
  COMPUTER_USE_CANARY_AGENT_ID,
  ComputerUseDesktopManager,
  ComputerUseDesktopOwnershipError,
  ComputerUseDesktopUnavailableError,
  type ComputerUseAssignmentStore,
  type ComputerUseDesktopAssignment,
} from "./computer-use-desktop-manager";

class MemoryAssignmentStore implements ComputerUseAssignmentStore {
  assignments: readonly ComputerUseDesktopAssignment[] = [];

  async load() {
    return this.assignments;
  }

  async save(assignments: readonly ComputerUseDesktopAssignment[]) {
    this.assignments = structuredClone(assignments);
  }
}

const makeOptions = (maxDisplayIndex = 3) => ({
  maxDisplayIndex,
  now: () => "2026-09-02T00:00:00.000Z",
  mintOwnerToken: vi.fn()
    .mockReturnValueOnce("owner-a")
    .mockReturnValueOnce("owner-b")
    .mockReturnValueOnce("owner-c"),
});

describe("Computer Use desktop manager", () => {
  it("assigns fork displays, persists them, and recovers the same agent", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    const manager = new ComputerUseDesktopManager(store, supervisor, makeOptions());

    const [agentA, agentB] = await Promise.all([
      manager.ensureAssignment("agent-a"),
      manager.ensureAssignment("agent-b"),
    ]);

    expect(agentA).toMatchObject({ displayIndex: 2, ownerToken: "owner-a" });
    expect(agentB).toMatchObject({ displayIndex: 3, ownerToken: "owner-b" });
    expect(await manager.ensureAssignment("agent-a")).toEqual(agentA);
    expect(store.assignments).toEqual([agentA, agentB]);
    expect(supervisor.ensureWindow).toHaveBeenCalledTimes(3);

    const recoveredSupervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    const recovered = new ComputerUseDesktopManager(
      store,
      recoveredSupervisor,
      makeOptions(),
    );
    await expect(recovered.restoreAssignments()).resolves.toEqual([agentA, agentB]);
    expect(recoveredSupervisor.ensureWindow).toHaveBeenCalledTimes(2);
  });

  it("does not expose primary or steal an occupied display", async () => {
    const store = new MemoryAssignmentStore();
    const manager = new ComputerUseDesktopManager(
      store,
      { ensureWindow: vi.fn(), stopWindow: vi.fn() },
      makeOptions(2),
    );
    const assigned = await manager.ensureAssignment("agent-a");
    expect(assigned.displayIndex).toBe(2);
    await expect(manager.ensureAssignment("agent-b"))
      .rejects.toBeInstanceOf(ComputerUseDesktopUnavailableError);
  });

  it("rejects a wrong owner token", async () => {
    const manager = new ComputerUseDesktopManager(
      new MemoryAssignmentStore(),
      { ensureWindow: vi.fn(), stopWindow: vi.fn() },
      makeOptions(),
    );
    const assignment = await manager.ensureAssignment("agent-a");
    await expect(manager.assertOwnership(assignment.displayIndex, "wrong-owner"))
      .rejects.toBeInstanceOf(ComputerUseDesktopOwnershipError);
  });

  it("keeps a transient assignment when window teardown fails", async () => {
    const store = new MemoryAssignmentStore();
    const stopWindow = vi.fn().mockRejectedValue(new Error("still running"));
    const manager = new ComputerUseDesktopManager(
      store,
      { ensureWindow: vi.fn(), stopWindow },
      makeOptions(),
    );
    const assignment = await manager.ensureAssignment(COMPUTER_USE_CANARY_AGENT_ID);

    await expect(manager.releaseAssignment(COMPUTER_USE_CANARY_AGENT_ID))
      .rejects.toThrow("still running");
    await expect(manager.snapshot()).resolves.toEqual([assignment]);
  });

  it("rolls back a new assignment when window startup fails", async () => {
    const store = new MemoryAssignmentStore();
    const manager = new ComputerUseDesktopManager(
      store,
      {
        ensureWindow: vi.fn().mockRejectedValue(new Error("monitor failed")),
        stopWindow: vi.fn(),
      },
      makeOptions(),
    );

    await expect(manager.ensureAssignment("agent-a")).rejects.toThrow("monitor failed");
    await expect(manager.snapshot()).resolves.toEqual([]);
    expect(store.assignments).toEqual([]);
  });

  it("keeps the window and the assignment when a turn releases its lease", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = {
      ensureWindow: vi.fn(),
      stopWindow: vi.fn(),
      captureWindowLogins: vi.fn(),
    };
    const manager = new ComputerUseDesktopManager(store, supervisor, makeOptions());
    const lease = await manager.ensureAssignment("agent-a");

    await manager.releaseOwnedAssignment("agent-a", lease.ownerToken);

    expect(supervisor.stopWindow).not.toHaveBeenCalled();
    expect(supervisor.captureWindowLogins).toHaveBeenCalledWith(lease);
    expect(store.assignments).toEqual([{ ...lease, ownerToken: null }]);
    await expect(manager.assertOwnership(lease.displayIndex, lease.ownerToken))
      .rejects.toBeInstanceOf(ComputerUseDesktopOwnershipError);
    // A late duplicate release finds nothing to release.
    await expect(manager.releaseOwnedAssignment("agent-a", "stale"))
      .resolves.toBeUndefined();
  });

  it("renews an idle display with a fresh token and shares a running lease", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    const manager = new ComputerUseDesktopManager(store, supervisor, makeOptions());
    const first = await manager.ensureAssignment("agent-a");
    await manager.releaseOwnedAssignment("agent-a", first.ownerToken);

    const second = await manager.ensureAssignment("agent-a");

    expect(second).toMatchObject({ displayIndex: 2, ownerToken: "owner-b" });
    expect(supervisor.ensureWindow).toHaveBeenCalledTimes(2);
    expect(await manager.ensureAssignment("agent-a")).toEqual(second);
    await expect(manager.assertOwnership(2, "owner-a"))
      .rejects.toBeInstanceOf(ComputerUseDesktopOwnershipError);
    await expect(manager.assertOwnership(2, "owner-b")).resolves.toEqual(second);
  });

  it("still tears down a transient display such as the capability canary", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = {
      ensureWindow: vi.fn(),
      stopWindow: vi.fn(),
      captureWindowLogins: vi.fn(),
    };
    const manager = new ComputerUseDesktopManager(store, supervisor, makeOptions());
    const lease = await manager.ensureAssignment(COMPUTER_USE_CANARY_AGENT_ID);

    await manager.releaseOwnedAssignment(COMPUTER_USE_CANARY_AGENT_ID, lease.ownerToken);

    expect(supervisor.stopWindow).toHaveBeenCalledWith(lease);
    expect(supervisor.captureWindowLogins).not.toHaveBeenCalled();
    expect(store.assignments).toEqual([]);
  });

  it("releases the lease even when the login capture fails", async () => {
    const store = new MemoryAssignmentStore();
    const log = vi.fn();
    const supervisor = {
      ensureWindow: vi.fn(),
      stopWindow: vi.fn(),
      captureWindowLogins: vi.fn().mockRejectedValue(new Error("cookies locked")),
    };
    const manager = new ComputerUseDesktopManager(store, supervisor, { ...makeOptions(), log });
    const lease = await manager.ensureAssignment("agent-a");

    await expect(manager.releaseOwnedAssignment("agent-a", lease.ownerToken))
      .resolves.toBeUndefined();

    expect(store.assignments).toEqual([{ ...lease, ownerToken: null }]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cookies locked"));
  });

  it("tears down displays that idled past the TTL and keeps the rest", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    let now = "2026-09-02T00:00:00.000Z";
    const manager = new ComputerUseDesktopManager(store, supervisor, {
      ...makeOptions(4),
      now: () => now,
      idleTtlMs: 60 * 60 * 1000,
    });
    const agentA = await manager.ensureAssignment("agent-a");
    const agentB = await manager.ensureAssignment("agent-b");
    const agentC = await manager.ensureAssignment("agent-c");
    await manager.releaseOwnedAssignment("agent-a", agentA.ownerToken);
    now = "2026-09-02T00:30:00.000Z";
    await manager.releaseOwnedAssignment("agent-b", agentB.ownerToken);
    now = "2026-09-02T01:10:00.000Z";

    const reaped = await manager.reapIdleAssignments();

    // agent-a idled 70 minutes, agent-b 40, and agent-c is still leased.
    expect(reaped).toEqual([
      { ...agentA, ownerToken: null, updatedAt: "2026-09-02T00:00:00.000Z" },
    ]);
    expect(supervisor.stopWindow).toHaveBeenCalledTimes(1);
    expect(store.assignments).toEqual([
      { ...agentB, ownerToken: null, updatedAt: "2026-09-02T00:30:00.000Z" },
      agentC,
    ]);
  });

  it("drops expired displays on restore instead of recreating them", async () => {
    const store = new MemoryAssignmentStore();
    const idle: ComputerUseDesktopAssignment = {
      agentId: "agent-a",
      displayIndex: 2,
      ownerToken: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const leased: ComputerUseDesktopAssignment = {
      agentId: "agent-b",
      displayIndex: 3,
      ownerToken: "owner-x",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    store.assignments = [idle, leased];
    const supervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    const manager = new ComputerUseDesktopManager(store, supervisor, {
      ...makeOptions(),
      now: () => "2026-09-05T00:00:00.000Z",
    });

    await expect(manager.restoreAssignments()).resolves.toEqual([leased]);

    expect(supervisor.stopWindow).toHaveBeenCalledWith(idle);
    expect(supervisor.ensureWindow).toHaveBeenCalledTimes(1);
    expect(supervisor.ensureWindow).toHaveBeenCalledWith(leased);
    expect(store.assignments).toEqual([leased]);
  });

  it("evicts the longest-idle display when every display is taken", async () => {
    const store = new MemoryAssignmentStore();
    const supervisor = { ensureWindow: vi.fn(), stopWindow: vi.fn() };
    let now = "2026-09-02T00:00:00.000Z";
    const manager = new ComputerUseDesktopManager(store, supervisor, {
      ...makeOptions(3),
      now: () => now,
    });
    const agentA = await manager.ensureAssignment("agent-a");
    const agentB = await manager.ensureAssignment("agent-b");
    await manager.releaseOwnedAssignment("agent-a", agentA.ownerToken);
    now = "2026-09-02T00:01:00.000Z";
    await manager.releaseOwnedAssignment("agent-b", agentB.ownerToken);
    now = "2026-09-02T00:02:00.000Z";

    const agentC = await manager.ensureAssignment("agent-c");

    expect(agentC).toMatchObject({ displayIndex: 2, ownerToken: "owner-c" });
    expect(supervisor.stopWindow).toHaveBeenCalledWith({
      ...agentA,
      ownerToken: null,
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(store.assignments.map((assignment) => assignment.agentId))
      .toEqual(["agent-b", "agent-c"]);
  });

  it("refuses a new agent when every display is leased", async () => {
    const manager = new ComputerUseDesktopManager(
      new MemoryAssignmentStore(),
      { ensureWindow: vi.fn(), stopWindow: vi.fn() },
      makeOptions(3),
    );
    await manager.ensureAssignment("agent-a");
    await manager.ensureAssignment("agent-b");
    await expect(manager.ensureAssignment("agent-c"))
      .rejects.toBeInstanceOf(ComputerUseDesktopUnavailableError);
  });
});
