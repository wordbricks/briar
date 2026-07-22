/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoHuntHealth } from "../lib/project-connection";
import { ConnectionHealth } from "./HuntDashboard";

const health: AutoHuntHealth = {
  projectId: "project-1",
  healthy: false,
  repositoryPath: "/Users/jay/git/briar",
  repositoryRemote: "https://github.com/wordbricks/briar.git",
  repositoryHealthy: true,
  cliPath: "/Users/jay/.local/bin/briar",
  cliInstalled: true,
  cliVersion: "0.0.9",
  cliExpectedVersion: "1.0.0",
  cliCurrent: false,
  skillPath: "/Users/jay/.codex/skills/briar-auto-hunt",
  skillInstalled: true,
  skillVersion: "1.0.0",
  skillExpectedVersion: "1.0.0",
  skillCurrent: true,
  velenOrg: "jay-personal",
  velenAuthenticated: true,
  velenEmail: "jay@example.com",
  velenHealthy: true,
  issues: ["Briar CLI 버전이 앱 번들과 다릅니다."],
};

describe("ConnectionHealth", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens health details from the status dot and closes on Escape", async () => {
    const onRepair = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ConnectionHealth
          error={null}
          health={health}
          loading={false}
          onReconnect={() => undefined}
          onRefresh={() => undefined}
          onRepair={onRepair}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(".health-trigger");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Briar CLI");
    expect(container.textContent).toContain("CLI·스킬 복구");
    expect(container.textContent).toContain("Briar CLI 버전이 앱 번들과 다릅니다.");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".health-actions button")?.click();
    });
    expect(onRepair).toHaveBeenCalledOnce();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
