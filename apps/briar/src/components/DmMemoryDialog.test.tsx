/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import fixtures from "../../../../packages/mobile-contracts/fixtures/companion-v1.json";
import { I18nProvider } from "../i18n";
import { createReactTestRoot, type ReactTestRoot } from "../test/react";
import { DmMemoryDocumentDetail, DmMemoryPage } from "../lib/dm-memory-contract";
import type { DmMemoryClient } from "../lib/api/dm-memory";
import { DmMemoryDialog } from "./DmMemoryDialog";

describe("DM memory management", () => {
  let root: ReactTestRoot;
  const client = {
    load: vi.fn<DmMemoryClient["load"]>(), get: vi.fn<DmMemoryClient["get"]>(),
    save: vi.fn<DmMemoryClient["save"]>(), remove: vi.fn<DmMemoryClient["remove"]>(),
    settings: vi.fn<DmMemoryClient["settings"]>(), export: vi.fn<DmMemoryClient["export"]>(),
  } satisfies DmMemoryClient;
  const page = Schema.decodeUnknownSync(DmMemoryPage)(fixtures.operations.listDmMemory.response);
  const detail = Schema.decodeUnknownSync(DmMemoryDocumentDetail)(fixtures.operations.getDmMemoryDocument.response.document);
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
  afterEach(async () => { await root.cleanup(); });
  const render = () => root.render(<I18nProvider><DmMemoryDialog client={client} scope={scope} onClose={() => {}} /></I18nProvider>);
  async function edit() {
    const entry = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.includes(detail.title))!;
    await act(async () => entry.click());
  }
  const submit = async () => {
    await act(async () => { dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  };

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
});
