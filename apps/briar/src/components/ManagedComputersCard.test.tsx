/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import * as api from "../lib/api";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { ManagedComputer, ManagedComputerProduct, Project } from "../types";
import {
  ManagedComputersCard,
  managedComputerSetupProjects,
} from "./ManagedComputersCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = "11111111-1111-4111-8111-111111111111";
const deviceId = "managed-device";
const projects: Project[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Existing project",
    issueKeyPrefix: "EP",
    scheduleTabEnabled: true,
    icon: null,
    iconName: null,
    iconColor: null,
    organizationId,
    organizationName: "Briar",
    role: "owner",
    createdAt: "2026-08-30T00:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "New project",
    issueKeyPrefix: "NP",
    scheduleTabEnabled: true,
    icon: null,
    iconName: null,
    iconColor: null,
    organizationId,
    organizationName: "Briar",
    role: "owner",
    createdAt: "2026-08-30T00:00:00.000Z",
  },
];

const computer: ManagedComputer = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId,
  requesterUserId: "owner",
  state: "ready",
  provider: "aws",
  label: null,
  region: "us-east-1",
  instanceId: "i-managed",
  volumeId: "vol-managed",
  deviceId,
  error: null,
  retryCount: 0,
  retryAvailable: false,
  createdAt: "2026-08-30T00:00:00.000Z",
  expiresAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const product: ManagedComputerProduct = {
  product: {
    currency: "USD",
    monthlyPriceCents: 10_000,
    quantity: 1,
    specification: {
      instanceType: "m7i.large",
      vcpu: 2,
      memoryGiB: 8,
      volumeGiB: 80,
      maxConcurrentRuns: 1,
      region: "us-east-1",
    },
    modelApiCostsIncluded: false,
  },
  applicationsEnabled: true,
  remoteDesktopEnabled: false,
  configurationReady: true,
  canApply: true,
  organizationLimit: 1,
  fleetLimit: 10,
};

afterEach(() => vi.restoreAllMocks());

describe("ManagedComputersCard", () => {
  it("offers unbound projects from a ready managed computer", async () => {
    window.localStorage.setItem("briar.locale.v1", "ko");
    vi.spyOn(api, "loadManagedComputerProduct").mockResolvedValue(product);
    vi.spyOn(api, "loadManagedComputers").mockResolvedValue({
      computers: [computer],
      generatedAt: "2026-08-30T00:00:00.000Z",
    });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ManagedComputersCard
          boundProjectIdsByDeviceId={{ [deviceId]: [projects[0]!.id] }}
          onProjectConnected={() => undefined}
          organizationId={organizationId}
          projects={projects}
          token="session-token"
          workerBindingsLoaded
        />
      </I18nProvider>,
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("팀 추가");
    });
    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("팀 추가"));
    expect(addButton?.disabled).toBe(false);

    await act(async () => addButton?.click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("관리형 컴퓨터에 팀 추가");
    expect(dialog?.textContent).toContain("New project");
    expect(dialog?.textContent).not.toContain("Existing project");
    await cleanup();
  });

  it("filters bound projects only when adding to a ready computer", () => {
    expect(managedComputerSetupProjects(
      computer,
      projects,
      { [deviceId]: [projects[0]!.id] },
    )).toEqual([projects[1]]);
    expect(managedComputerSetupProjects(
      { ...computer, state: "needs_setup" },
      projects,
      { [deviceId]: [projects[0]!.id] },
    )).toEqual(projects);
  });

  const renderStoppedComputers = async (canApply = true) => {
    window.localStorage.setItem("briar.locale.v1", "en");
    vi.spyOn(api, "loadManagedComputerProduct").mockResolvedValue({ ...product, canApply });
    vi.spyOn(api, "loadManagedComputers").mockResolvedValue({
      computers: [
        { ...computer, state: "stopped" },
        { ...computer, id: "55555555-5555-4555-8555-555555555555", state: "ready" },
        { ...computer, id: "66666666-6666-4666-8666-666666666666", state: "terminated" },
      ],
      generatedAt: computer.updatedAt,
    });
    const testRoot = createReactTestRoot({ attachToDocument: true });
    const onProjectConnected = vi.fn();
    await testRoot.render(
      <I18nProvider>
        <ManagedComputersCard
          boundProjectIdsByDeviceId={{}}
          onProjectConnected={onProjectConnected}
          organizationId={organizationId}
          projects={projects}
          token="session-token"
          workerBindingsLoaded
        />
      </I18nProvider>,
    );
    await vi.waitFor(() => expect(testRoot.container.querySelectorAll("article")).toHaveLength(2));
    return { ...testRoot, onProjectConnected };
  };

  const buttonWithText = (container: ParentNode, text: string) => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === text);
    expect(button).toBeDefined();
    return button!;
  };

  it("confirms permanent termination, prevents duplicate submissions, and removes only the terminated row", async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof api.terminateManagedComputer>>>();
    const terminate = vi.spyOn(api, "terminateManagedComputer").mockReturnValue(pending.promise);
    const { container, cleanup, onProjectConnected } = await renderStoppedComputers();
    try {
      expect(container.textContent).not.toContain("66666666");
      expect(container.querySelectorAll('button[aria-label^="Permanently terminate"]')).toHaveLength(1);
      await act(async () => buttonWithText(container, "Permanently terminate").click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("cannot be undone");
      expect(terminate).not.toHaveBeenCalled();
      await act(async () => buttonWithText(document, "Cancel").click());
      expect(terminate).not.toHaveBeenCalled();
      expect(container.querySelectorAll("article")).toHaveLength(2);

      await act(async () => buttonWithText(container, "Permanently terminate").click());
      const confirm = buttonWithText(document.querySelector('[role="dialog"]')!, "Permanently terminate");
      await act(async () => confirm.click());
      expect(confirm.disabled).toBe(true);
      expect(confirm.textContent).toContain("Terminating");
      expect(buttonWithText(document, "Cancel").disabled).toBe(true);
      expect(container.querySelectorAll("article")).toHaveLength(2);
      await act(async () => confirm.click());
      expect(terminate).toHaveBeenCalledExactlyOnceWith("session-token", organizationId, computer.id);
      await act(async () => pending.resolve({ computer: { ...computer, state: "terminated" }, duplicate: false }));
      expect(container.querySelectorAll("article")).toHaveLength(1);
      expect(container.textContent).not.toContain("44444444");
      expect(container.textContent).toContain("55555555");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(onProjectConnected).toHaveBeenCalledOnce();
    } finally {
      await cleanup();
    }
  });

  it("keeps the stopped row and allows retry when termination fails", async () => {
    const terminate = vi.spyOn(api, "terminateManagedComputer").mockRejectedValueOnce(new Error("Termination failed"));
    const { container, cleanup } = await renderStoppedComputers();
    try {
      await act(async () => buttonWithText(container, "Permanently terminate").click());
      await act(async () => buttonWithText(document.querySelector('[role="dialog"]')!, "Permanently terminate").click());
      expect(container.textContent).toContain("Termination failed");
      expect(container.querySelectorAll("article")).toHaveLength(2);
      expect(buttonWithText(container, "Permanently terminate").disabled).toBe(false);
      terminate.mockResolvedValueOnce({ computer: { ...computer, state: "terminated" }, duplicate: false });
      await act(async () => buttonWithText(container, "Permanently terminate").click());
      await act(async () => buttonWithText(document.querySelector('[role="dialog"]')!, "Permanently terminate").click());
      expect(container.textContent).not.toContain("44444444");
      expect(terminate).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });

  it("hides permanent termination from viewers", async () => {
    const { container, cleanup } = await renderStoppedComputers(false);
    try {
      expect(container.querySelector('button[aria-label^="Permanently terminate"]')).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
