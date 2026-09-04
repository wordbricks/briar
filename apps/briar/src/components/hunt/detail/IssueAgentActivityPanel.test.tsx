/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "@/test/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { IssueAgentActivityPanel } from "./IssueAgentActivityPanel";
import type { AutoHuntAgentMessage } from "@/lib/auto-hunt-agent";
import type { ProjectAgentTranscriptSession } from "@/hooks/useProjectAgentTranscriptSessions";

const sessions: ProjectAgentTranscriptSession[] = [
  {
    sessionId: "detached-run-claim-2",
    workerId: "worker-1",
    provider: "codex",
    startedAtMs: Date.parse("2026-09-03T12:11:56.000Z"),
    lastEventAtMs: Date.parse("2026-09-04T02:50:48.000Z"),
    archived: false,
  },
  {
    sessionId: "detached-run-claim-1",
    workerId: "worker-1",
    provider: "codex",
    startedAtMs: Date.parse("2026-09-02T23:20:00.000Z"),
    lastEventAtMs: Date.parse("2026-09-02T23:54:00.000Z"),
    archived: false,
  },
];

const panelProps = {
  error: null,
  id: "activity-panel",
  isLive: false,
  labelledBy: "activity-tab",
  loading: false,
  provider: "codex" as const,
};

describe("IssueAgentActivityPanel", () => {
  beforeEach(() => {
    window.localStorage.setItem("briar.locale.v1", "en");
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  it("renders an activity that never produced a message", async () => {
    const activity: AutoHuntAgentMessage[] = [{
      id: "mcp-startup:figma",
      phase: null,
      text: "The figma MCP server is not logged in.",
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      isComplete: true,
      activity: {
        kind: "tool",
        title: "figma MCP unavailable",
        status: "failed",
      },
    }];
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <IssueAgentActivityPanel {...panelProps} activity={activity} />
      </I18nProvider>,
    );

    expect(container.textContent).toContain("figma MCP unavailable");
    expect(container.textContent).toContain(
      "The figma MCP server is not logged in.",
    );
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).not.toContain("No work log yet");
    await cleanup();
  });

  it("selects an earlier session and follows the newest one again", async () => {
    const onSelectSession = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <IssueAgentActivityPanel
          {...panelProps}
          activity={[]}
          onSelectSession={onSelectSession}
          selectedSessionId={null}
          sessions={sessions}
        />
      </I18nProvider>,
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      ".issue-agent-activity-session-select button",
    );
    expect(trigger?.textContent).toContain("Execution 2");
    expect(trigger?.textContent).toContain("latest");

    await act(async () => trigger?.click());
    const option = [
      ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((element) => element.textContent?.includes("Execution 1"));
    await act(async () => option?.click());

    expect(onSelectSession).toHaveBeenCalledWith("detached-run-claim-1");
    await cleanup();
  });

  it("marks a historic session while its work log is shown", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <IssueAgentActivityPanel
          {...panelProps}
          activity={[]}
          onSelectSession={vi.fn()}
          selectedSessionId="detached-run-claim-1"
          sessions={sessions}
        />
      </I18nProvider>,
    );

    expect(container.textContent).toContain(
      "Showing the work log of an earlier execution.",
    );
    await cleanup();
  });
});
