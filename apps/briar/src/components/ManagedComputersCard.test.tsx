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
      expect(container.textContent).toContain("프로젝트 추가");
    });
    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("프로젝트 추가"));
    expect(addButton?.disabled).toBe(false);

    await act(async () => addButton?.click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("관리형 컴퓨터에 프로젝트 추가");
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
});
