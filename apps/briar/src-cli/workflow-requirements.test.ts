import { describe, expect, it } from "vitest";
import {
  inspectWorkflowRequirements,
  workflowRequirementReadinessDetail,
} from "./workflow-requirements";

describe("inspectWorkflowRequirements", () => {
  it("marks executable tools healthy when present on PATH", () => {
    const health = inspectWorkflowRequirements(
      [
        {
          id: "bun",
          label: "Bun runtime",
          kind: "executable",
          tool: "bun",
          reason: "Runs CI.",
        },
        {
          id: "missing",
          label: "Missing tool",
          kind: "executable",
          tool: "definitely-not-installed-xyz",
          reason: "Would fail.",
        },
      ],
      {
        which: (tool) => (tool === "bun" ? "/usr/local/bin/bun" : null),
        run: () => ({ success: false, stdout: "", stderr: "" }),
      },
    );

    expect(health).toEqual([
      {
        id: "bun",
        label: "Bun runtime",
        kind: "executable",
        tool: "bun",
        reason: "Runs CI.",
        healthy: true,
        detail: "/usr/local/bin/bun",
      },
      {
        id: "missing",
        label: "Missing tool",
        kind: "executable",
        tool: "definitely-not-installed-xyz",
        reason: "Would fail.",
        healthy: false,
        detail: "'definitely-not-installed-xyz' 실행 파일을 찾지 못했습니다.",
      },
    ]);
    expect(workflowRequirementReadinessDetail(health)).toContain("Missing tool");
  });

  it("counts available iOS simulators from simctl JSON", () => {
    const health = inspectWorkflowRequirements(
      [
        {
          id: "ios_simulator",
          label: "iOS Simulator",
          kind: "ios_simulator",
          tool: "xcrun",
          reason: "Runs mobile QA.",
        },
      ],
      {
        which: (tool) => (tool === "xcrun" ? "/usr/bin/xcrun" : null),
        run: () => ({
          success: true,
          stdout: JSON.stringify({
            devices: {
              "iOS 18": [{ name: "iPhone 16" }, { name: "iPhone SE" }],
              "iOS 17": [],
            },
          }),
          stderr: "",
        }),
      },
    );

    expect(health[0]?.healthy).toBe(true);
    expect(health[0]?.detail).toBe("사용 가능한 시뮬레이터 2개");
  });

  it("returns null readiness detail when every tool is healthy", () => {
    const health = inspectWorkflowRequirements(
      [
        {
          id: "jq",
          label: "jq",
          kind: "executable",
          tool: "jq",
          reason: "Parses release JSON.",
        },
      ],
      {
        which: () => "/usr/bin/jq",
        run: () => ({ success: true, stdout: "", stderr: "" }),
      },
    );
    expect(workflowRequirementReadinessDetail(health)).toBeNull();
  });
});
