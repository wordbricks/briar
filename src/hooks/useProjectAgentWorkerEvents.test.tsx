/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
});
