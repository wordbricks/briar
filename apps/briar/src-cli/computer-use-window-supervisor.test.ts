import { expect, it, vi } from "vitest";
import {
  computerUseBrowserProfileDirectory,
  computerUseRfbPort,
  computerUseWindowUnit,
  ProcessComputerUseWindowSupervisor,
  SystemdComputerUseWindowSupervisor,
} from "./computer-use-window-supervisor";

const assignment = {
  agentId: "agent-a",
  displayIndex: 2,
  ownerToken: "owner-a",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const emptyReport = () => ({ merged: [], replaced: [], copied: [], skipped: [] });

it("starts and stops only the assigned systemd window", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const isListening = vi.fn().mockResolvedValue(true);
  const remove = vi.fn().mockResolvedValue(undefined);
  const seed = vi.fn().mockResolvedValue(emptyReport());
  const capture = vi.fn().mockResolvedValue(emptyReport());
  const supervisor = new SystemdComputerUseWindowSupervisor({
    commandRunner: { run },
    portProbe: { isListening },
    browserProfileCleaner: { remove },
    browserLoginStore: { seed, capture },
  });

  await supervisor.ensureWindow(assignment);
  await supervisor.stopWindow(assignment);

  expect(run).toHaveBeenNthCalledWith(1, "/usr/bin/sudo", [
    "-n",
    "/usr/bin/systemctl",
    "start",
    "briar-computer-use-window@2.service",
  ]);
  expect(run).toHaveBeenNthCalledWith(2, "/usr/bin/sudo", [
    "-n",
    "/usr/bin/systemctl",
    "stop",
    "briar-computer-use-window@2.service",
  ]);
  expect(isListening).toHaveBeenCalledWith("127.0.0.1", 5_902);
  expect(remove).toHaveBeenCalledWith(2);
});

it("seeds the systemd display profile before start and captures before cleanup", async () => {
  const order: string[] = [];
  const supervisor = new SystemdComputerUseWindowSupervisor({
    commandRunner: {
      run: async (_binary, arguments_) => {
        order.push(`systemctl:${arguments_[2]}`);
      },
    },
    portProbe: { isListening: async () => true },
    browserProfileCleaner: {
      remove: async () => {
        order.push("remove");
      },
    },
    browserLoginStore: {
      seed: async () => {
        order.push("seed");
        return emptyReport();
      },
      capture: async () => {
        order.push("capture");
        return emptyReport();
      },
    },
  });

  await supervisor.ensureWindow(assignment);
  await supervisor.stopWindow(assignment);

  expect(order).toEqual([
    "seed",
    "systemctl:start",
    "systemctl:stop",
    "capture",
    "remove",
  ]);
});

/**
 * A stand-in for the detached window process. It has no pid, so the supervisor
 * falls back from the process-group signal to `child.kill`, which resolves the
 * exit listener the supervisor is waiting on.
 */
const fakeWindowProcess = () => {
  const exitListeners: (() => void)[] = [];
  const child = {
    exitCode: null as number | null,
    signalCode: null as string | null,
    pid: undefined as number | undefined,
    once(event: string, listener: () => void) {
      if (event === "exit") exitListeners.push(listener);
      return child;
    },
    kill() {
      child.exitCode = 0;
      for (const listener of exitListeners.splice(0)) listener();
      return true;
    },
  };
  return child;
};

it("seeds a process window only when it is not already running", async () => {
  const order: string[] = [];
  const children = new Set<ReturnType<typeof fakeWindowProcess>>();
  const supervisor = new ProcessComputerUseWindowSupervisor({
    portProbe: { isListening: async () => true },
    browserProfileCleaner: {
      remove: async () => {
        order.push("remove");
      },
    },
    browserLoginStore: {
      seed: async () => {
        order.push("seed");
        return emptyReport();
      },
      capture: async () => {
        order.push("capture");
        return emptyReport();
      },
    },
    spawnWindow: () => {
      order.push("spawn");
      const child = fakeWindowProcess();
      children.add(child);
      return child as never;
    },
  });

  await supervisor.ensureWindow(assignment);
  await supervisor.ensureWindow(assignment);
  await supervisor.stopWindow(assignment);

  expect(order).toEqual(["seed", "spawn", "capture", "remove"]);
  expect(children.size).toBe(1);
});

it("keeps display 1 outside the Agent window supervisor", () => {
  expect(() => computerUseWindowUnit(1)).toThrow();
  expect(computerUseRfbPort(2)).toBe(5_902);
  expect(computerUseBrowserProfileDirectory(2)).toBe(
    "/var/lib/briar-computer-use/profiles/display-2",
  );
});
