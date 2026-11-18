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
  const preview = () => dialog().querySelector<HTMLElement>('section[aria-label="Memory preview"]')!;
  const paneShown = () => dialog().querySelector("[data-memory-pane]")!.getAttribute("data-memory-pane");
  const treePane = () => dialog().querySelector('[role="tree"]')!.parentElement!;
  const click = async (label: string) => { await act(async () => button(label).click()); };
  async function openFile() {
    await act(async () => item("synthetic-memory.md")!.click());
  }
  async function edit() {
    await openFile(); await click("Edit");
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
    await render(); await openFile();
    expect(preview().querySelector(".markdown-content")?.textContent).toBe("Current version");
    await click("Revision history");
    const revision = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.startsWith("v1 ·"))!;
    await act(async () => revision.click());
    // The revision opens in the right pane, rendered, with no way to edit it.
    const earlier = preview().querySelector('section[aria-label="Earlier version · read only · v1"]')!;
    expect(earlier.querySelector(".markdown-content")?.textContent).toBe(detail.body);
    expect(revision.getAttribute("aria-pressed")).toBe("true");
    expect(dialog().querySelector("textarea")).toBeNull();
    expect(button("Edit")).toBeUndefined();
    expect(client.get).toHaveBeenLastCalledWith(scope, detail.id, undefined, 1);
    await click("Back to file");
    expect(preview().querySelector(".markdown-content")?.textContent).toBe("Current version");
    expect(button("Edit")).toBeDefined();
  });

  it("M01 does not claim saved while the server write is pending", async () => {
    let finish!: (value: { documentId: string; version: number; replayed: boolean }) => void;
    client.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(); await edit(); await submit();
    expect(button("Saving").disabled).toBe(true);
    expect(dialog().querySelector('[role="status"]')?.textContent).not.toBe("Saved");
    client.get.mockResolvedValue({ ...detail, version: 2, body: "Saved text" });
    await act(async () => finish({ documentId: detail.id, version: 2, replayed: false }));
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe("Saved");
    // The saved file stays selected and its preview shows the new revision.
    expect(dialog().querySelector("form")).toBeNull();
    expect(client.get).toHaveBeenLastCalledWith(scope, detail.id);
    expect(preview().querySelector(".markdown-content")?.textContent).toBe("Saved text");
    expect(item("synthetic-memory.md")!.getAttribute("aria-selected")).toBe("true");
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
    await render(); await openFile();
    expect(dialog().textContent).toContain("closed after a participant change");
    expect(preview().textContent).toContain(detail.body);
    expect(button("Edit")).toBeUndefined();
    expect(dialog().querySelector("textarea")).toBeNull();
    expect(button("Save")).toBeUndefined();
    expect(button("Revision history")).toBeDefined();
    expect(button("Export Markdown").disabled).toBe(false);
    expect(dialog().querySelector('[aria-label="Forget memory"]')).not.toBeNull();
  });
  it("shows no legacy learning, validity or index state", async () => {
    // Vault records carry no sources; the server sends an empty list.
    client.get.mockResolvedValue({ ...detail, sources: [] });
    await render(); await openFile();
    const read = dialog().textContent ?? "";
    await click("Edit");
    const text = read + (dialog().textContent ?? "");
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
    item("synthetic-memory.md")!.focus();
    await key(item("synthetic-memory.md")!, "Enter");
    expect(client.get).toHaveBeenCalledWith(scope, detail.id);
    expect(preview().querySelector(".markdown-content")?.textContent).toBe(detail.body);
    // On a wide screen the tree stays in view, so focus stays on the row.
    expect(document.activeElement).toBe(item("synthetic-memory.md"));
    expect(item("synthetic-memory.md")!.getAttribute("aria-selected")).toBe("true");
  });

  it("starts with an empty preview pane beside the tree", async () => {
    await render();
    expect(paneShown()).toBe("tree");
    expect(preview().childElementCount).toBe(0);
    expect(preview().textContent).toBe("");
    expect(items().some((node) => node.getAttribute("aria-selected") === "true")).toBe(false);
    expect(client.get).not.toHaveBeenCalled();
  });

  it("previews a file with its path, meta line and rendered Markdown, and forgets it back to the empty pane", async () => {
    client.get.mockResolvedValue({ ...detail, body: "## Tone\n\n- Lead with the answer\n- Keep it short" });
    client.remove.mockResolvedValue({ deleted: true, purgeState: "pending" } as Awaited<ReturnType<DmMemoryClient["remove"]>>);
    await render(); await openFile();
    expect(paneShown()).toBe("preview");
    expect(item("synthetic-memory.md")!.getAttribute("aria-selected")).toBe("true");
    expect(preview().querySelector("h3")?.textContent).toBe(detail.title);
    expect(preview().textContent).toContain("entities/people/synthetic-memory.md");
    expect(preview().querySelector("[data-memory-meta]")?.textContent).toMatch(/^person · r1 · User protected · Updated at /u);
    expect(preview().querySelector(".markdown-content h2")?.textContent).toBe("Tone");
    expect([...preview().querySelectorAll(".markdown-content li")].map((node) => node.textContent))
      .toEqual(["Lead with the answer", "Keep it short"]);
    expect(button("Edit")).toBeDefined();
    expect(button("Revision history")).toBeDefined();
    await act(async () => preview().querySelector<HTMLButtonElement>('[aria-label="Forget memory"]')!.click());
    expect(client.remove).toHaveBeenCalledWith(scope, detail.id);
    expect(paneShown()).toBe("tree");
    expect(preview().textContent).toBe("");
    expect(items().some((node) => node.getAttribute("aria-selected") === "true")).toBe(false);
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain("Memory deleted");
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
  });

  it("edits in place in the right pane and cancels back to the preview", async () => {
    await render(); await edit();
    const form = preview().querySelector("form")!;
    expect(form.querySelector<HTMLInputElement>("input")!.value).toBe(detail.title);
    expect(form.querySelector("textarea")!.value).toBe(detail.body);
    expect(document.activeElement).toBe(form.querySelector("input"));
    expect(button("Revision history")).toBeUndefined();
    expect(item("synthetic-memory.md")!.getAttribute("aria-selected")).toBe("true");
    await click("Cancel");
    expect(dialog().querySelector("form")).toBeNull();
    expect(preview().querySelector(".markdown-content")?.textContent).toBe(detail.body);
    expect(client.save).not.toHaveBeenCalled();
  });

  it("opens Add memory as a form in the right pane and previews the new file after saving", async () => {
    const created = { ...detail, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "New note", body: "Fresh", path: "knowledge/facts/new-note.md" };
    client.save.mockResolvedValue({ documentId: created.id, version: 1, replayed: false });
    client.get.mockResolvedValue(created);
    await render(); await click("Add memory");
    expect(paneShown()).toBe("preview");
    expect(preview().querySelector("h3")?.textContent).toBe("Add memory");
    const form = preview().querySelector("form")!;
    expect(form.querySelector<HTMLInputElement>("input")!.value).toBe("");
    await click("Cancel");
    expect(paneShown()).toBe("tree");
    expect(preview().textContent).toBe("");

    await click("Add memory");
    const input = preview().querySelector<HTMLInputElement>("form input")!;
    const text = preview().querySelector<HTMLTextAreaElement>("form textarea")!;
    await act(async () => {
      for (const [field, value] of [[input, "New note"], [text, "Fresh"]] as const) {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await submit();
    expect(client.save).toHaveBeenCalledWith(scope, expect.objectContaining({ title: "New note", body: "Fresh", memorySpaceId: spaceId }), undefined);
    expect(client.get).toHaveBeenLastCalledWith(scope, created.id);
    expect(preview().querySelector("h3")?.textContent).toBe("New note");
    expect(preview().querySelector(".markdown-content")?.textContent).toBe("Fresh");
  });

  it("shows one pane at a time below the breakpoint, with a back control to the tree", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("max-width"), media: query })));
    try {
      await render();
      // Tree first: the preview pane is hidden until the wide layout shows both.
      expect(treePane().className.split(" ")).toContain("flex");
      expect(preview().className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
      await openFile();
      expect(paneShown()).toBe("preview");
      expect(treePane().className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
      expect(preview().className.split(" ")).toContain("flex");
      expect(preview().className.split(" ")).not.toContain("hidden");
      // The tree just disappeared, so focus moves to the preview's heading.
      expect(document.activeElement).toBe(preview().querySelector("h3"));
      const back = preview().querySelector<HTMLButtonElement>('[aria-label="Back to folders"]')!;
      expect(back.className.split(" ")).toContain("md:hidden");
      await act(async () => back.click());
      expect(paneShown()).toBe("tree");
      expect(treePane().className.split(" ")).not.toContain("hidden");
      expect(document.activeElement).toBe(item("synthetic-memory.md"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows README.md read only, without edit, history or forget", async () => {
    client.load.mockResolvedValue({ ...page, documents: [readmeSummary, summary] });
    client.get.mockResolvedValue(readme);
    await render();
    await act(async () => item("README.md")!.click());
    expect(client.get).toHaveBeenCalledWith(scope, readme.id);
    expect(preview().querySelector(".markdown-content h1")?.textContent).toBe("Memory vault");
    expect(preview().querySelector("[data-memory-meta]")?.textContent).toBe("readme · Read only");
    expect(button("Edit")).toBeUndefined();
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
    client.get.mockResolvedValue({ ...detail, path: null, recordType: null, recordStatus: null });
    await render();
    expect(items().map((node) => node.querySelector("span.truncate")!.textContent)).toEqual(["memory", detail.title]);
    expect(item(detail.title)!.textContent).toContain("profile · r1");
    await act(async () => item(detail.title)!.click());
    expect(preview().querySelector(".markdown-content")?.textContent).toBe(detail.body);
    expect(preview().querySelector("[data-memory-meta]")?.textContent).toMatch(/^profile · r1 · /u);
  });
});
