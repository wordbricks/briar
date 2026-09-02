import { expect, it, vi } from "vitest";
import {
  computerUseBrowserProfileDirectory,
  computerUseRfbPort,
  computerUseWindowUnit,
  SystemdComputerUseWindowSupervisor,
} from "./computer-use-window-supervisor";

const assignment = {
  agentId: "agent-a",
  displayIndex: 2,
  ownerToken: "owner-a",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

it("starts and stops only the assigned systemd window", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const isListening = vi.fn().mockResolvedValue(true);
  const remove = vi.fn().mockResolvedValue(undefined);
  const supervisor = new SystemdComputerUseWindowSupervisor({
    commandRunner: { run },
    portProbe: { isListening },
    browserProfileCleaner: { remove },
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

it("keeps display 1 outside the Agent window supervisor", () => {
  expect(() => computerUseWindowUnit(1)).toThrow();
  expect(computerUseRfbPort(2)).toBe(5_902);
  expect(computerUseBrowserProfileDirectory(2)).toBe(
    "/var/lib/briar-computer-use/profiles/display-2",
  );
});
