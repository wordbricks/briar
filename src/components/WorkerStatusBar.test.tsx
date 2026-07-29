import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import type { ExecutionWorker } from "../types";
import { WorkerStatusBar, workerProviders } from "./WorkerStatusBar";

const worker = (overrides: Partial<ExecutionWorker> = {}): ExecutionWorker => ({
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "owner-1",
  label: "Janet's Mac",
  agentProvider: "codex",
  providers: ["codex", "claude", "codex"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-07-29T00:00:00Z",
  createdAt: "2026-07-29T00:00:00Z",
  ...overrides,
});

describe("WorkerStatusBar", () => {
  it("shows readiness, name, and every supported provider icon", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <WorkerStatusBar workers={[worker()]} />
      </I18nProvider>,
    );

    expect(markup).toContain("worker-status-dot available");
    expect(markup).toContain("Janet&#x27;s Mac");
    expect(markup).toContain('aria-label="Codex"');
    expect(markup).toContain('aria-label="Claude"');
    expect(markup.match(/title="Codex"/g)).toHaveLength(1);
    expect(markup.match(/title="Claude"/g)).toHaveLength(1);
  });

  it("falls back to the worker binding provider for older responses", () => {
    expect(
      workerProviders(worker({ agentProvider: "grok", providers: undefined })),
    ).toEqual(["grok"]);
  });
});
