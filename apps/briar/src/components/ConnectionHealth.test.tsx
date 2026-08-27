/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoHuntHealth } from "../lib/project-connection";
import { I18nProvider } from "../i18n";
import { ConnectionHealth } from "./ConnectionHealth";

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
  skillPath: "/Users/jay/.codex/skills/briar-workflow",
  skillInstalled: true,
  skillVersion: "1.0.0",
  skillExpectedVersion: "1.0.0",
  skillCurrent: true,
  velenOrg: "jay-personal",
  velenAuthenticated: true,
  velenEmail: "jay@example.com",
  velenHealthy: true,
  requirements: [{
    id: "ios_simulator",
    label: "iOS Simulator",
    kind: "ios_simulator",
    tool: "xcrun",
    reason: "Runs the iOS validation suite.",
    healthy: false,
    detail: "사용 가능한 iOS 시뮬레이터가 없습니다.",
  }],
  issues: ["Briar CLI 버전이 앱 번들과 다릅니다."],
};

describe("ConnectionHealth", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    localStorage.removeItem("briar.locale.v1");
    vi.restoreAllMocks();
  });

  it("opens health details from the status bar trigger and closes on Escape", async () => {
    const onRepair = vi.fn();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ConnectionHealth
          error={null}
          health={health}
          loading={false}
          onReconnect={() => undefined}
          onRefresh={() => undefined}
          onRepair={onRepair}
        />
      </I18nProvider>,
    );

    const trigger = container.querySelector<HTMLButtonElement>(".health-trigger");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.textContent).toContain("확인 필요");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Briar CLI");
    expect(container.textContent).toContain("iOS Simulator");
    expect(container.textContent).toContain("사용 가능한 iOS 시뮬레이터가 없습니다.");
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

  });
});
