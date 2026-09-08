import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { expect, it, vi } from "vitest";
import {
  computerUseBrowserProfileDirectory,
  computerUseRfbPort,
  computerUseWindowUnit,
  defaultPortProbe,
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

it("captures a systemd window's logins in place without stopping it", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const captureLiveDisplay = vi.fn().mockResolvedValue(emptyReport());
  const supervisor = new SystemdComputerUseWindowSupervisor({
    commandRunner: { run },
    portProbe: { isListening: async () => true },
    browserProfileCleaner: { remove },
    browserLoginStore: {
      seed: async () => emptyReport(),
      capture: async () => emptyReport(),
      captureLiveDisplay,
    },
  });

  await supervisor.captureWindowLogins(assignment);

  expect(captureLiveDisplay).toHaveBeenCalledWith(2);
  expect(run).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("captures a process window's logins in place and keeps it running", async () => {
  const captureLiveDisplay = vi.fn().mockResolvedValue(emptyReport());
  const child = fakeWindowProcess();
  const supervisor = new ProcessComputerUseWindowSupervisor({
    portProbe: { isListening: async () => true },
    browserProfileCleaner: { remove: async () => undefined },
    browserLoginStore: {
      seed: async () => emptyReport(),
      capture: async () => emptyReport(),
      captureLiveDisplay,
    },
    spawnWindow: () => child as never,
  });
  await supervisor.ensureWindow(assignment);

  await supervisor.captureWindowLogins(assignment);

  expect(captureLiveDisplay).toHaveBeenCalledWith(2);
  expect(child.exitCode).toBeNull();
});

it("keeps display 1 outside the Agent window supervisor", () => {
  expect(() => computerUseWindowUnit(1)).toThrow();
  expect(computerUseRfbPort(2)).toBe(5_902);
  expect(computerUseBrowserProfileDirectory(2)).toBe(
    "/var/lib/briar-computer-use/profiles/display-2",
  );
});

interface FakeRfbConnection {
  /** Everything the client wrote, in order. */
  readonly received: Buffer[];
  /** True once the client selected a security type and read SecurityResult. */
  authenticated: boolean;
  /** True when the socket died with a reset instead of a FIN. */
  aborted: boolean;
  /** Resolves when the connection is fully closed. */
  readonly closed: Promise<void>;
}

/**
 * A TigerVNC stand-in speaking the `SecurityTypes None` handshake, recording
 * whether the client saw it through. TigerVNC black-lists a peer that keeps
 * disconnecting before this point, which is exactly the regression under test.
 */
const fakeRfbServer = async (
  behaviour: "handshake" | "silent" = "handshake",
): Promise<{
  readonly port: number;
  readonly connection: () => FakeRfbConnection | undefined;
  readonly close: () => Promise<void>;
}> => {
  let connection: FakeRfbConnection | undefined;
  const server: Server = createServer((socket: Socket) => {
    let resolveClosed: () => void = () => {};
    const record: FakeRfbConnection = {
      received: [],
      authenticated: false,
      aborted: false,
      closed: new Promise<void>((resolve) => {
        resolveClosed = resolve;
      }),
    };
    connection = record;
    socket.on("error", () => {
      record.aborted = true;
    });
    socket.on("close", () => resolveClosed());
    if (behaviour === "silent") return;
    socket.write("RFB 003.008\n");
    socket.on("data", (chunk) => {
      record.received.push(chunk);
      const seen = Buffer.concat(record.received);
      if (seen.length === 12) socket.write(Buffer.of(1, 1));
      if (seen.length === 13) {
        // SecurityResult OK: past here TigerVNC has authenticated the peer.
        socket.write(Buffer.of(0, 0, 0, 0));
        record.authenticated = true;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connection: () => connection,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
};

it("completes the RFB handshake instead of aborting the probe connection", async () => {
  const server = await fakeRfbServer();

  const listening = await defaultPortProbe.isListening("127.0.0.1", server.port);

  const connection = server.connection();
  expect(listening).toBe(true);
  expect(connection).toBeDefined();
  await connection?.closed;
  expect(Buffer.concat(connection!.received)).toEqual(
    Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.of(1)]),
  );
  expect(connection?.authenticated).toBe(true);
  expect(connection?.aborted).toBe(false);
  await server.close();
});

it("reports a port with nothing listening as not ready", async () => {
  const server = await fakeRfbServer();
  const { port } = server;
  await server.close();

  expect(await defaultPortProbe.isListening("127.0.0.1", port)).toBe(false);
});

it("gives up on a socket that accepts without sending an RFB banner", async () => {
  const server = await fakeRfbServer("silent");

  const started = performance.now();
  const listening = await defaultPortProbe.isListening("127.0.0.1", server.port);

  expect(listening).toBe(false);
  expect(performance.now() - started).toBeLessThan(5_000);
  await server.close();
});
