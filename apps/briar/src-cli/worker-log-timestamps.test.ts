import { describe, expect, it } from "vitest";
import {
  installWorkerLogTimestamps,
  timestampedLogArguments,
  workerLogTimestamp,
  workerLogTimestampsEnabled,
} from "./worker-log-timestamps";

const recordingConsole = () => {
  const lines: string[] = [];
  const write = (...values: unknown[]) => {
    lines.push(values.map((value) => String(value)).join(" "));
  };
  return { lines, target: { log: write, warn: write, error: write } };
};

describe("worker log timestamps", () => {
  it("prefixes one line with an ISO-8601 UTC timestamp", () => {
    const { lines, target } = recordingConsole();
    const restore = installWorkerLogTimestamps({
      enabled: true,
      target,
      now: () => Date.parse("2026-09-10T02:14:05.123Z"),
    });
    try {
      target.log("claimed briar-channel:abc (run-1)");
    } finally {
      restore();
    }

    expect(lines).toEqual([
      "2026-09-10T02:14:05.123Z claimed briar-channel:abc (run-1)",
    ]);
  });

  it("prefixes the first line of a multi-line message only", () => {
    const { lines, target } = recordingConsole();
    const restore = installWorkerLogTimestamps({
      enabled: true,
      target,
      now: () => Date.parse("2026-09-10T02:14:05.123Z"),
    });
    try {
      target.error("worker iteration failed: boom\n  at one\n  at two");
    } finally {
      restore();
    }

    expect(lines[0]?.split("\n")).toEqual([
      "2026-09-10T02:14:05.123Z worker iteration failed: boom",
      "  at one",
      "  at two",
    ]);
  });

  it("restores the console it wrapped", () => {
    const { lines, target } = recordingConsole();
    const restore = installWorkerLogTimestamps({
      enabled: true,
      target,
      now: () => Date.parse("2026-09-10T02:14:05.123Z"),
    });
    target.warn("first");
    restore();
    target.warn("second");

    expect(lines).toEqual(["2026-09-10T02:14:05.123Z first", "second"]);
  });

  it("writes nothing extra when the escape hatch is set", () => {
    const { lines, target } = recordingConsole();
    const restore = installWorkerLogTimestamps({
      enabled: workerLogTimestampsEnabled("0"),
      target,
      now: () => Date.parse("2026-09-10T02:14:05.123Z"),
    });
    try {
      target.log("worker briar-mac starting as worker-1");
    } finally {
      restore();
    }

    expect(lines).toEqual(["worker briar-mac starting as worker-1"]);
    expect(workerLogTimestampsEnabled("false")).toBe(false);
    expect(workerLogTimestampsEnabled(undefined)).toBe(true);
    expect(workerLogTimestampsEnabled("1")).toBe(true);
  });

  it("keeps a leading format string in first position", () => {
    expect(timestampedLogArguments("STAMP", ["%s failed", "codex"])).toEqual([
      "STAMP %s failed",
      "codex",
    ]);
    expect(timestampedLogArguments("STAMP", [{ workId: "abc" }])).toEqual([
      "STAMP",
      { workId: "abc" },
    ]);
    expect(timestampedLogArguments("STAMP", [])).toEqual(["STAMP"]);
  });

  it("formats the stamp with milliseconds", () => {
    expect(workerLogTimestamp(Date.parse("2026-09-10T02:14:05.000Z")))
      .toBe("2026-09-10T02:14:05.000Z");
  });
});
