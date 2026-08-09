/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadProjectAgentTranscript } from "../lib/api";
import { useProjectAgentWorkerEvents } from "./useProjectAgentWorkerEvents";

vi.mock("../lib/api", () => ({
  loadProjectAgentTranscript: vi.fn(),
}));

const mockedLoadProjectAgentTranscript = vi.mocked(loadProjectAgentTranscript);
let workerEvents: ReturnType<typeof useProjectAgentWorkerEvents>;

function Harness() {
  workerEvents = useProjectAgentWorkerEvents(
    "token",
    "project-1",
    ["run-1"],
    false,
  );
  return null;
}

describe("useProjectAgentWorkerEvents", () => {
  beforeEach(() => mockedLoadProjectAgentTranscript.mockReset());

  it("loads later pages when retry sequence ranges are non-contiguous", async () => {
    mockedLoadProjectAgentTranscript
      .mockResolvedValueOnce({
        session: {
          sessionId: "detached-run-1",
          runId: "run-1",
          workerId: "worker-1",
          agentProvider: "codex",
          startedAt: "2026-08-04T00:00:00.000Z",
          lastEventAt: "2026-08-04T00:01:00.000Z",
          eventCount: 3,
        },
        events: [
          {
            sequence: 1,
            direction: "server",
            message: { type: "first" },
            recordedAt: "2026-08-04T00:00:00.000Z",
          },
          {
            sequence: 10_001,
            direction: "server",
            message: { type: "retry" },
            recordedAt: "2026-08-04T00:01:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        session: {
          sessionId: "detached-run-1",
          runId: "run-1",
          workerId: "worker-1",
          agentProvider: "codex",
          startedAt: "2026-08-04T00:00:00.000Z",
          lastEventAt: "2026-08-04T00:02:00.000Z",
          eventCount: 3,
        },
        events: [{
          sequence: 10_002,
          direction: "server",
          message: { type: "resume" },
          recordedAt: "2026-08-04T00:02:00.000Z",
        }],
      });

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(mockedLoadProjectAgentTranscript).toHaveBeenNthCalledWith(
      2,
      "token",
      "project-1",
      "detached-run-1",
      10_001,
    );
    expect(workerEvents.events.map((event) => event.sequence)).toEqual([
      1,
      10_001,
      10_002,
    ]);

    await act(async () => root.unmount());
  });

  it("hydrates normalized activities with session-qualified ids", async () => {
    mockedLoadProjectAgentTranscript.mockResolvedValue({
      session: {
        sessionId: "detached-run-1",
        runId: "run-1",
        workerId: "worker-1",
        agentProvider: "claude",
        startedAt: "2026-08-04T00:00:00.000Z",
        lastEventAt: "2026-08-04T00:00:02.000Z",
        eventCount: 3,
      },
      events: [
        {
          sequence: 1,
          direction: "server",
          message: {
            type: "event",
            event: {
              type: "activityStarted",
              id: "tool-1",
              kind: "command",
              title: "bun test",
              text: "",
            },
          },
          recordedAt: "2026-08-04T00:00:00.000Z",
        },
        {
          sequence: 2,
          direction: "server",
          message: {
            type: "event",
            event: {
              type: "activityDelta",
              id: "tool-1",
              delta: "running tests\n",
            },
          },
          recordedAt: "2026-08-04T00:00:01.000Z",
        },
        {
          sequence: 3,
          direction: "server",
          message: {
            type: "event",
            event: {
              type: "activityCompleted",
              id: "tool-1",
              kind: "command",
              title: "bun test",
              text: "1 test failed",
              status: "failed",
            },
          },
          recordedAt: "2026-08-04T00:00:02.000Z",
        },
      ],
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(workerEvents.events.map((event) => event.event)).toEqual([
      {
        type: "activityStarted",
        id: "detached-run-1:tool-1",
        kind: "command",
        title: "bun test",
        text: "",
      },
      {
        type: "activityDelta",
        id: "detached-run-1:tool-1",
        delta: "running tests\n",
      },
      {
        type: "activityCompleted",
        id: "detached-run-1:tool-1",
        kind: "command",
        title: "bun test",
        text: "1 test failed",
        status: "failed",
      },
    ]);

    await act(async () => root.unmount());
  });
});
