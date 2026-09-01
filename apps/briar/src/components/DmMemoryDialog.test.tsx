/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createReactTestRoot, type ReactTestRoot } from "../test/react";
import type { DmMemoryDocumentDetail, DmMemoryPage } from "../lib/dm-memory-contract";
import type { DmMemoryClient } from "../lib/api/dm-memory";
import { DmMemoryDialog } from "./DmMemoryDialog";

describe("DM memory management", () => {
  let root: ReactTestRoot;
  const client = {
    history: vi.fn<DmMemoryClient["history"]>(),
    load: vi.fn<DmMemoryClient["load"]>(), get: vi.fn<DmMemoryClient["get"]>(),
    save: vi.fn<DmMemoryClient["save"]>(), remove: vi.fn<DmMemoryClient["remove"]>(),
    settings: vi.fn<DmMemoryClient["settings"]>(), export: vi.fn<DmMemoryClient["export"]>(),
    retryLearning: vi.fn<DmMemoryClient["retryLearning"]>(),
  } satisfies DmMemoryClient;
  const spaceId = "99999999-9999-4999-8999-999999999999";
  const channelId = "12121212-1212-4212-8212-121212121212";
  const detail: DmMemoryDocumentDetail = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    memorySpaceId: spaceId,
    kind: "observation",
    title: "Synthetic memory",
    version: 1,
    status: "active",
    conflicted: false,
    memoryClass: "profile",
    evidenceType: "explicit_user",
    protectedByUser: true,
    sourceLanguage: "ko",
    observedAt: null,
    validUntil: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    indexState: "pending",
    body: "설명은 결론부터 짧게 제시한다.",
    sources: [{ type: "user_edit_event", id: "fixture-edit", version: 1 }],
  };
  const page: DmMemoryPage = {
    eligible: true,
    capabilities: { recall: false, automaticLearning: false },
    spaces: [{
      id: spaceId,
      channelId,
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      rosterEpoch: 1,
      status: "active",
      useEnabled: true,
      autoEnabled: false,
      memoryRevision: 1,
      revocationEpoch: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }],
    selectedSpaceId: spaceId,
    documents: [detail],
    nextCursor: null,
  };
  const scope = { token: "test", organizationId: "22222222-2222-4222-8222-222222222222", channelId: page.spaces[0].channelId };
  const dialog = () => document.querySelector('[role="dialog"]')!;
  const button = (label: string) => [...dialog().querySelectorAll("button")]
    .find((element) => element.textContent?.trim() === label)!;
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem("briar.locale.v1", "en");
    client.load.mockResolvedValue(page);
    client.get.mockResolvedValue(detail);
    root = createReactTestRoot({ attachToDocument: true });
  });
  afterEach(async () => {
    await root.cleanup();
    // Radix FocusScope restores focus on the next task after unmount. Let that
    // task finish while this file's jsdom Event constructors are still active.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const render = () => root.render(<I18nProvider><DmMemoryDialog client={client} scope={scope} onClose={() => {}} /></I18nProvider>);
  async function edit() {
    const entry = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.includes(detail.title))!;
    await act(async () => entry.click());
  }
  const submit = async () => {
    await act(async () => { dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  };

  it("M18 keeps revision history read only and preserves the current edit", async () => {
    client.load.mockResolvedValue({ ...page, documents: page.documents.map((item) => ({ ...item, version: 2 })) });
    client.get.mockResolvedValueOnce({ ...detail, version: 2, body: "Current version" }).mockResolvedValue(detail);
    client.history.mockResolvedValue({ documentId: detail.id, currentVersion: 2, nextCursor: null,
      revisions: [{ version: 1, createdAt: detail.createdAt, memoryClass: detail.memoryClass,
        protectedByUser: true, validUntil: null, origin: "user_edit" }] });
    await render(); await edit();
    await act(async () => button("Revision history").click());
    const revision = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.startsWith("v1 ·"))!;
    await act(async () => revision.click());
    expect(dialog().querySelector("pre")?.textContent).toBe(detail.body);
    expect(dialog().querySelector("textarea")?.value).toBe("Current version");
    expect(dialog().textContent).toContain("Earlier version · read only");
    expect(client.get).toHaveBeenLastCalledWith(scope, detail.id, undefined, 1);
  });

  it("M01 does not claim saved while the server write is pending", async () => {
    let finish!: (value: { documentId: string; version: number; replayed: boolean }) => void;
    client.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(); await edit(); await submit();
    expect(button("Saving").disabled).toBe(true);
    expect(dialog().querySelector('[role="status"]')?.textContent).not.toBe("Saved");
    await act(async () => finish({ documentId: detail.id, version: 2, replayed: false }));
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe("Saved");
    expect(dialog().textContent).toContain("Awaiting index");
  });

  it("M12 preserves the edit and request ID after a failed write", async () => {
    client.save.mockRejectedValue(new Error("Version conflict"));
    await render(); await edit(); await submit();
    expect(dialog().querySelector("textarea")?.value).toBe(detail.body);
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Version conflict");
    const first = client.save.mock.calls[0][1];
    await submit();
    expect(client.save.mock.calls[1][1].requestId).toBe(first.requestId);
    expect(dialog().querySelector('[role="status"]')).toBeNull();
  });

  it("M18 exposes closed memories for management without an editable form", async () => {
    client.load.mockResolvedValue({ ...page, eligible: false,
      spaces: page.spaces.map((space) => ({ ...space, status: "closed", useEnabled: false })) });
    await render(); await edit();
    expect(dialog().textContent).toContain("closed after a participant change");
    expect(dialog().querySelector("textarea")?.disabled).toBe(true);
    expect(button("Save")).toBeUndefined();
    expect(button("Export Markdown").disabled).toBe(false);
    expect(dialog().querySelector('[aria-label="Forget memory"]')).not.toBeNull();
  });
  it("keeps learning opt-in separate, shows verification failure, and disables learning when memory use stops", async () => {
    const enabled = { ...page, capabilities: { recall: true, automaticLearning: true },
      spaces: page.spaces.map((space) => ({ ...space, useEnabled: true, autoEnabled: false })),
      learning: { configuration: { proposer: { model: "synthetic/proposer", provider: "synthetic" },
        verifier: { model: "synthetic/verifier", provider: "synthetic" }, spaceDailyCalls: 24, spaceDailyMicroUsd: 5_000_000 },
        callsToday: 2, reservedMicroUsdToday: 50_000, pendingJobs: 0, failedJobs: 1,
        lastJob: { id: crypto.randomUUID(), kind: "extract" as const, status: "failed" as const, stage: "verifying" as const,
          errorCode: "verification_rejected" as const, updatedAt: "2026-09-01T00:00:00.000Z" },
        retryableJob: { id: crypto.randomUUID(), callsUsed: 2 } } };
    client.load.mockResolvedValue(enabled);
    client.settings.mockResolvedValue({ ...enabled.spaces[0]!, autoEnabled: true });
    client.retryLearning.mockResolvedValue({ accepted: true, replayed: false });
    await render();
    expect(dialog().textContent).toContain("Independent verification rejected the proposal");
    expect(dialog().textContent).toContain("synthetic/proposer / synthetic/verifier");
    await act(async () => button("Retry failed learning").click());
    expect(client.retryLearning).toHaveBeenCalledWith(scope, enabled.learning.retryableJob.id, 0);
    const automatic = [...dialog().querySelectorAll("label")].find((label) => label.textContent === "Learn memories from this conversation")!
      .querySelector("input")!;
    expect(automatic.checked).toBe(false);
    client.load.mockResolvedValue({ ...enabled, spaces: enabled.spaces.map((space) => ({ ...space, autoEnabled: true })) });
    await act(async () => automatic.click());
    expect(client.settings.mock.calls[0]![1]).toMatchObject({ useEnabled: true, autoEnabled: true,
      expectedMemoryRevision: enabled.spaces[0]!.memoryRevision });
    const use = [...dialog().querySelectorAll("label")].find((label) => label.textContent === "Use memory in this DM")!.querySelector("input")!;
    await act(async () => use.click());
    expect(client.settings.mock.calls[1]![1]).toMatchObject({ useEnabled: false, autoEnabled: false });
  });
});
