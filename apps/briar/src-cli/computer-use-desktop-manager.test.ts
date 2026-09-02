import { describe, expect, it, vi } from "vitest";
import {
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

  it("keeps an assignment when window teardown fails", async () => {
    const store = new MemoryAssignmentStore();
    const stopWindow = vi.fn().mockRejectedValue(new Error("still running"));
    const manager = new ComputerUseDesktopManager(
      store,
      { ensureWindow: vi.fn(), stopWindow },
      makeOptions(),
    );
    const assignment = await manager.ensureAssignment("agent-a");

    await expect(manager.releaseAssignment("agent-a")).rejects.toThrow("still running");
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
});
