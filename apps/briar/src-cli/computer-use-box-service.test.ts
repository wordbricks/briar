import { create } from "@bufbuild/protobuf";
import {
  ComputerUseActionSchema,
  ComputerUseArgsSchema,
  ComputerUseResultSchema,
  ComputerUseSuccessSchema,
  ScreenshotActionSchema,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import {
  SimpleControlledExecManager,
  computerUseExecutorResource,
  createConnectRemoteExecManager,
  loopbackBoxExecConnection,
} from "@briar/agent-exec";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComputerUseDesktopManager,
  type ComputerUseAssignmentStore,
  type ComputerUseDesktopAssignment,
  type ComputerUseWindowSupervisor,
} from "./computer-use-desktop-manager";
import { ComputerUseBoxClient } from "./computer-use-box-client";
import { ComputerUseBoxService } from "./computer-use-box-service";

class MemoryStore implements ComputerUseAssignmentStore {
  assignments: readonly ComputerUseDesktopAssignment[] = [];
  async load() { return this.assignments; }
  async save(assignments: readonly ComputerUseDesktopAssignment[]) {
    this.assignments = structuredClone(assignments);
  }
}

class MemorySupervisor implements ComputerUseWindowSupervisor {
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  async ensureWindow(assignment: ComputerUseDesktopAssignment) {
    this.started.push(assignment.displayIndex);
  }
  async stopWindow(assignment: ComputerUseDesktopAssignment) {
    this.stopped.push(assignment.displayIndex);
  }
}

describe("ComputerUseBoxService", () => {
  let service: ComputerUseBoxService | undefined;
  afterEach(async () => service?.stop());

  it("allocates a fork window and routes only its owner to the executor", async () => {
    const supervisor = new MemorySupervisor();
    const desktopManager = new ComputerUseDesktopManager(
      new MemoryStore(),
      supervisor,
      {
        mintOwnerToken: () => "owner_token_abcdefghijklmnopqrstuvwxyz123456",
        now: () => "2026-09-02T00:00:00.000Z",
      },
    );
    const controlledExecManager = new SimpleControlledExecManager(5);
    computerUseExecutorResource.registerControlledImplementation({
      execute: async (_args, options) => create(ComputerUseResultSchema, {
        result: {
          case: "success",
          value: create(ComputerUseSuccessSchema, {
            actionCount: 1,
            durationMs: 3,
            log: `display:${options?.displayIndex}`,
          }),
        },
      }),
    }, controlledExecManager);
    service = new ComputerUseBoxService({
      authToken: "box_token_abcdefghijklmnopqrstuvwxyz1234567890",
      host: "127.0.0.1",
      primaryPort: 0,
      forkPort: 0,
      desktopManager,
      controlledExecManager,
    });
    await service.start();
    const addresses = service.addresses();
    const client = await ComputerUseBoxClient.connect({
      authToken: "box_token_abcdefghijklmnopqrstuvwxyz1234567890",
      primaryPort: addresses.primaryPort,
    });
    const assigned = await client.assign("agent-a", addresses.forkPort);
    expect(assigned.assignment).toMatchObject({
      agentId: "agent-a",
      displayIndex: 2,
      ownerToken: "owner_token_abcdefghijklmnopqrstuvwxyz123456",
    });

    const result = await assigned.executor.execute(create(ComputerUseArgsSchema, {
      actions: [create(ComputerUseActionSchema, {
        action: { case: "screenshot", value: create(ScreenshotActionSchema) },
      })],
    }));
    expect(result.result.case).toBe("success");
    if (result.result.case !== "success") throw new Error("expected success");
    expect(result.result.value.log).toBe("display:2");

    const wrongOwnerManager = createConnectRemoteExecManager({
      ...loopbackBoxExecConnection({
        authToken: "box_token_abcdefghijklmnopqrstuvwxyz1234567890",
        displayIndex: 2,
        ownerToken: "wrong_owner_abcdefghijklmnopqrstuvwxyz123456",
      }),
      baseUrl: `http://127.0.0.1:${addresses.forkPort}`,
    });
    const remote = computerUseExecutorResource.remoteImplementation(wrongOwnerManager);
    await expect(remote.execute(create(ComputerUseArgsSchema, {
      actions: [create(ComputerUseActionSchema, {
        action: { case: "screenshot", value: create(ScreenshotActionSchema) },
      })],
    }))).rejects.toThrow(/ownership/u);

    await assigned.release();
    expect(supervisor.started).toEqual([2]);
    expect(supervisor.stopped).toEqual([2]);
  });

  it("runs the owner display login watcher for as long as it serves", async () => {
    const events: string[] = [];
    const desktopManager = new ComputerUseDesktopManager(
      new MemoryStore(),
      new MemorySupervisor(),
    );
    service = new ComputerUseBoxService({
      authToken: "box_token_abcdefghijklmnopqrstuvwxyz1234567890",
      host: "127.0.0.1",
      primaryPort: 0,
      forkPort: 0,
      desktopManager,
      primaryLoginWatcher: {
        start: () => events.push("start"),
        stop: () => events.push("stop"),
      },
    });

    await service.start();
    expect(events).toEqual(["start"]);

    await service.stop();
    service = undefined;
    expect(events).toEqual(["start", "stop"]);
  });
});
