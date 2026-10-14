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
    path: "entities/people/synthetic-memory.md",
    recordType: "person",
    recordStatus: null,
    readOnly: false,
  };
  const { body: _body, sources: _sources, ...summary } = detail;
  const readme: DmMemoryDocumentDetail = {
    ...detail, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "README.md", memoryClass: "note",
    protectedByUser: false, path: "README.md", recordType: "readme", readOnly: true,
    body: "# Memory vault\n\nApp-owned guide.\n", sources: [],
  };
  const { body: _readmeBody, sources: _readmeSources, ...readmeSummary } = readme;
  const folders = [
    "browser-guidance/attempts", "comms", "entities/infrastructure", "entities/orgs", "entities/people",
    "entities/projects", "entities/tools", "knowledge/decisions", "knowledge/facts", "knowledge/lessons",
    "knowledge/preferences", "knowledge/procedures", "timeline/daily", "timeline/monthly", "timeline/weekly",
    "workstreams",
  ];
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
    documents: [summary],
    nextCursor: null,
    folders,
  };
  const scope = { token: "test", workspaceId: "22222222-2222-4222-8222-222222222222", channelId: page.spaces[0].channelId };
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
  const items = () => [...dialog().querySelectorAll<HTMLElement>('[role="treeitem"]')];
  /** The tree row whose own name (not its secondary label) is `name`. */
  const item = (name: string) => items().find((node) => node.querySelector("span.truncate")?.textContent === name);
  async function edit() {
    await act(async () => item("synthetic-memory.md")!.click());
  }
  const key = async (target: HTMLElement, value: string) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })); });
  };
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
    expect(client.save.mock.calls[0]).toEqual([scope, {
      requestId: expect.any(String), memorySpaceId: spaceId, title: detail.title, body: detail.body,
      memoryClass: detail.memoryClass, expectedVersion: detail.version,
    }, detail.id]);
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
  it("shows no legacy learning, validity or index state", async () => {
    // Vault records carry no sources; the server sends an empty list.
    client.get.mockResolvedValue({ ...detail, sources: [] });
    await render(); await edit();
    const text = dialog().textContent ?? "";
    for (const legacy of ["Learning", "learning", "Valid until", "Observed at", "Source language", "Awaiting index", "Searchable", "needs review"]) {
      expect(text).not.toContain(legacy);
    }
    expect(dialog().querySelectorAll("form input")).toHaveLength(1);
    expect(text).not.toContain("Sources:");
  });

  it("keeps automatic writing opt-in separate and turns it off when memory use stops", async () => {
    const enabled = { ...page, capabilities: { recall: true, automaticLearning: true } };
    client.load.mockResolvedValue(enabled);
    client.settings.mockResolvedValue({ ...enabled.spaces[0]!, autoEnabled: true });
    await render();
    const automatic = [...dialog().querySelectorAll("label")].find((label) => label.textContent === "Let the Agent save memories on its own")!
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
  it("shows the vault's folder skeleton with files nested at their paths", async () => {
    const lesson = { ...summary, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "old-move", memoryClass: "note" as const,
      protectedByUser: false, version: 3, path: "workstreams/completed/old-move.md", recordType: "workstream",
      recordStatus: "completed" };
    client.load.mockResolvedValue({ ...page, documents: [readmeSummary, summary, lesson] });
    await render();
    const tree = dialog().querySelector('[role="tree"]')!;
    expect(tree.getAttribute("aria-label")).toBe("Memory folders");
    // Folders holding files are open; empty ones are listed, dimmed and closed.
    expect(item("memory")!.getAttribute("aria-expanded")).toBe("true");
    expect(item("entities")!.getAttribute("aria-expanded")).toBe("true");
    expect(item("people")!.getAttribute("aria-level")).toBe("3");
    expect(item("synthetic-memory.md")!.getAttribute("aria-level")).toBe("4");
    expect(item("synthetic-memory.md")!.textContent).toContain("person · r1 · User protected");
    expect(item("orgs")!.className).toContain("text-muted-foreground");
    expect(item("orgs")!.hasAttribute("aria-expanded")).toBe(false);
    expect(item("knowledge")!.getAttribute("aria-expanded")).toBe("false");
    expect(item("facts")).toBeUndefined();
    expect(item("comms")!.className).toContain("text-muted-foreground");
    // A legacy workstream folder appears because a file lives there.
    expect(item("completed")!.getAttribute("aria-level")).toBe("3");
    expect(item("old-move.md")!.textContent).toContain("workstream · completed · r3");
    // Folders first, then root files.
    expect(items().filter((node) => node.getAttribute("aria-level") === "2").map((node) => node.querySelector("span.truncate")!.textContent))
      .toEqual(["browser-guidance", "comms", "entities", "knowledge", "timeline", "workstreams", "README.md"]);
    expect(item("README.md")!.textContent).toContain("readme · Read only");
  });

  it("expands and collapses folders by click and by arrow keys with one tab stop", async () => {
    await render();
    expect(items().filter((node) => node.tabIndex === 0)).toHaveLength(1);
    await act(async () => item("knowledge")!.click());
    expect(item("knowledge")!.getAttribute("aria-expanded")).toBe("true");
    expect(item("facts")!.getAttribute("aria-level")).toBe("3");
    await act(async () => item("knowledge")!.click());
    expect(item("facts")).toBeUndefined();

    const entities = item("entities")!;
    entities.focus();
    await key(entities, "ArrowLeft");
    expect(item("entities")!.getAttribute("aria-expanded")).toBe("false");
    expect(item("synthetic-memory.md")).toBeUndefined();
    await key(item("entities")!, "ArrowRight");
    expect(item("entities")!.getAttribute("aria-expanded")).toBe("true");
    // ArrowRight on an open folder moves to its first child; ArrowLeft returns to the parent.
    await key(item("entities")!, "ArrowRight");
    expect(document.activeElement).toBe(item("infrastructure"));
    expect(item("infrastructure")!.tabIndex).toBe(0);
    await key(item("infrastructure")!, "ArrowLeft");
    expect(document.activeElement).toBe(item("entities"));
    await key(item("entities")!, "ArrowDown");
    expect(document.activeElement).toBe(item("infrastructure"));
    await key(item("infrastructure")!, "End");
    expect(document.activeElement).toBe(items().at(-1));
    await key(items().at(-1)!, "Home");
    expect(document.activeElement).toBe(item("memory"));

    // Enter on a file opens it.
    expect(client.get).not.toHaveBeenCalled();
    await key(item("synthetic-memory.md")!, "Enter");
    expect(client.get).toHaveBeenCalledWith(scope, detail.id);
    expect(dialog().querySelector("textarea")?.value).toBe(detail.body);
  });

  it("opens a file into the detail view with its path, history, edit and forget", async () => {
    client.remove.mockResolvedValue({ deleted: true, purgeState: "pending" } as Awaited<ReturnType<DmMemoryClient["remove"]>>);
    await render(); await edit();
    expect(item("synthetic-memory.md")!.getAttribute("aria-selected")).toBe("true");
    expect(dialog().textContent).toContain("entities/people/synthetic-memory.md");
    expect(dialog().querySelector<HTMLInputElement>("form input")!.value).toBe(detail.title);
    expect(button("Save")).toBeDefined();
    expect(button("Revision history")).toBeDefined();
    await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Forget memory"]')!.click());
    expect(client.remove).toHaveBeenCalledWith(scope, detail.id);
    expect(dialog().querySelector("form")).toBeNull();
  });

  it("shows README.md read only, without edit, history or forget", async () => {
    client.load.mockResolvedValue({ ...page, documents: [readmeSummary, summary] });
    client.get.mockResolvedValue(readme);
    await render();
    await act(async () => item("README.md")!.click());
    expect(client.get).toHaveBeenCalledWith(scope, readme.id);
    expect(dialog().querySelector("pre")?.textContent).toBe(readme.body);
    expect(dialog().textContent).toContain("You can read it but not edit or delete it.");
    expect(dialog().querySelector("textarea")).toBeNull();
    expect(dialog().querySelector("form input")).toBeNull();
    expect(button("Save")).toBeUndefined();
    expect(button("Revision history")).toBeUndefined();
    expect(dialog().querySelector('[aria-label="Forget memory"]')).toBeNull();
  });

  it("lists records from a server before the folder tree at the root under their titles", async () => {
    client.load.mockResolvedValue({ ...page, folders: [],
      documents: [{ ...summary, path: null, recordType: null, recordStatus: null }] });
    await render();
    expect(items().map((node) => node.querySelector("span.truncate")!.textContent)).toEqual(["memory", detail.title]);
    expect(item(detail.title)!.textContent).toContain("profile · r1");
    await act(async () => item(detail.title)!.click());
    expect(dialog().querySelector("textarea")?.value).toBe(detail.body);
  });
});
