/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n";
import { demoDashboard } from "@/lib/demo-data";
import { RunManualQaGuide } from "./RunManualQaGuide";

describe("RunManualQaGuide", () => {
  it("makes overflowing local commands keyboard scrollable", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const run = {
      ...demoDashboard.runs[0]!,
      workflow: {
        ...demoDashboard.runs[0]!.workflow,
        stages: demoDashboard.runs[0]!.workflow.stages.map((stage) =>
          stage.id === "local_qa"
            ? {
                ...stage,
                checks: ["bun run test", "bun run build"],
              }
            : stage
        ),
      },
    };

    await act(async () => {
      root.render(
        <I18nProvider>
          <RunManualQaGuide
            evidence={[]}
            loadError={null}
            loading={false}
            onRetry={async () => undefined}
            run={run}
          />
        </I18nProvider>,
      );
    });

    const commandRegions = [
      ...container.querySelectorAll<HTMLPreElement>(
        ".run-manual-qa-checks pre",
      ),
    ];
    expect(commandRegions.map((region) => region.tabIndex)).toEqual([0, 0]);
    expect(commandRegions.map((region) => region.textContent)).toEqual([
      "bun run test",
      "bun run build",
    ]);
    expect(
      commandRegions.every((region) => region.querySelector("code")),
    ).toBe(true);

    await act(async () => root.unmount());
    container.remove();
  });
});
