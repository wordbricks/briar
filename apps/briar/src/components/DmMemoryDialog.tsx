import { ArrowLeft, Brain, Download, History, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  dmMemoryApi, type DmMemoryClient, type DmMemoryApiScope,
} from "../lib/api/dm-memory";
import {
  dmMemoryClasses, dmMemoryDocumentMaxBytes, type DmMemoryClass,
  type DmMemoryDocumentDetail, type DmMemoryPage, type DmMemoryRevisionPage,
} from "../lib/dm-memory-contract";
import type { DmMemoryReference } from "../lib/dm-memory-query-contract";
import { dmMemoryFileDetails } from "../lib/dm-memory-tree";
import { cn } from "../lib/utils";
import { DmMemoryTree } from "./DmMemoryTree";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

/**
 * What the right-hand pane shows. Nothing is selected at first, so the pane is
 * blank; a file opens read, and edit and revision history replace its body in
 * place. Below the `md` breakpoint only one pane shows: the tree while the pane
 * is empty, the pane otherwise.
 */
type Pane =
  | { readonly kind: "empty" }
  | { readonly kind: "create" }
  | { readonly kind: "file"; readonly document: DmMemoryDocumentDetail; readonly view: "read" | "edit" | "history" };

const emptyPane: Pane = { kind: "empty" };
/** Tailwind's `md` breakpoint, below which the dialog shows one pane at a time. */
const narrowQuery = "(max-width: 767.98px)";
const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(narrowQuery).matches;

export function DmMemoryDialog({ scope, onClose, client = dmMemoryApi, initialReference }: {
  scope: DmMemoryApiScope; onClose: () => void; client?: DmMemoryClient; initialReference?: DmMemoryReference;
}) {
  const { t, localeTag } = useI18n();
  const [page, setPage] = useState<DmMemoryPage | null>(null);
  const [pane, setPane] = useState<Pane>(emptyPane);
  const [history, setHistory] = useState<DmMemoryRevisionPage | null>(null);
  const [revision, setRevision] = useState<DmMemoryDocumentDetail | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [memoryClass, setMemoryClass] = useState<DmMemoryClass>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const requestId = useRef(crypto.randomUUID());
  const treePane = useRef<HTMLDivElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterRender = useRef<"tree" | "preview" | null>(null);
  const selectedSpace = page?.spaces.find((space) => space.id === page.selectedSpaceId);
  const writable = page?.eligible && (!selectedSpace || selectedSpace.status === "active");

  const opened = pane.kind === "file" ? pane.document : null;
  const historical = opened !== null && page?.documents.find((item) => item.id === opened.id)?.version !== opened.version;
  // README.md belongs to the app: it is shown, never edited or forgotten.
  const canEdit = writable && opened !== null && !historical && !opened.readOnly;
  const composing = pane.kind === "create" || (pane.kind === "file" && pane.view === "edit");
  const detailOpen = pane.kind !== "empty";
  const records = page?.documents.filter((item) => !item.readOnly) ?? [];

  useEffect(() => {
    const target = focusAfterRender.current;
    focusAfterRender.current = null;
    if (target === "tree") treePane.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
    else if (target === "preview") previewHeading.current?.focus();
  });

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setBusy(true);
    void client.load(scope, undefined, undefined, controller.signal).then(async (result) => {
      if (generation.current !== current) return;
      setPage(result);
      if (initialReference) {
        const document = await client.get(scope, initialReference.documentId, controller.signal, initialReference.version);
        if (generation.current === current) { show(document); focusAfterRender.current = "preview"; }
      }
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => { if (generation.current === current) setBusy(false); });
    return () => { generation.current++; controller.abort(); };
  }, [scope.token, scope.workspaceId, scope.channelId, client, initialReference?.documentId, initialReference?.version]);

  useEffect(() => {
    const controller = new AbortController();
    const current = generation.current;
    const timer = setInterval(() => {
      if (busy || composing || !page) return;
      void client.load(scope, page.selectedSpaceId ?? undefined, undefined, controller.signal).then(async (first) => {
        let fresh = first;
        while (fresh.nextCursor && fresh.documents.length < page.documents.length) {
          const next = await client.load(scope, page.selectedSpaceId ?? undefined, fresh.nextCursor, controller.signal);
          fresh = { ...next, documents: [...fresh.documents, ...next.documents] };
        }
        if (generation.current === current && !controller.signal.aborted) setPage(fresh);
      }).catch(() => { /* Explicit refresh retains actionable API errors. */ });
    }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [busy, composing, page, selectedSpace?.memoryRevision, scope.token, scope.workspaceId, scope.channelId, client]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally { if (current === generation.current) setBusy(false); }
  }
  async function refresh(spaceId = page?.selectedSpaceId ?? undefined) {
    const current = generation.current;
    const result = await client.load(scope, spaceId);
    if (current === generation.current) setPage(result);
  }
  function show(document: DmMemoryDocumentDetail) {
    setHistory(null); setRevision(null);
    setPane({ kind: "file", document, view: "read" });
  }
  function clear(focus: "tree" | null = "tree") {
    setHistory(null); setRevision(null);
    setPane(emptyPane);
    focusAfterRender.current = focus;
  }
  /** Opens the form in the right pane: an edit of `document`, or a new memory. */
  function compose(document: DmMemoryDocumentDetail | null) {
    setTitle(document?.title ?? ""); setBody(document?.body ?? "");
    setMemoryClass(document?.memoryClass ?? "profile");
    requestId.current = crypto.randomUUID(); setNotice(null);
    setPane(document ? { kind: "file", document, view: "edit" } : { kind: "create" });
  }
  function closeDraft() {
    if (opened) { setPane({ kind: "file", document: opened, view: "read" }); focusAfterRender.current = "preview"; }
    else clear();
  }
  const changeDraft = () => { requestId.current = crypto.randomUUID(); };
  const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  const bodyBytes = new TextEncoder().encode(body).length;

  const backToTree = <Button type="button" variant="ghost" size="icon-sm" className="-ml-2 shrink-0 md:hidden"
    aria-label={t("memory.backToTree")} onClick={() => clear()}><ArrowLeft /></Button>;

  function renderForm(document: DmMemoryDocumentDetail | null) {
    return <form className="flex min-h-full flex-col gap-3" onSubmit={(event) => {
      event.preventDefault(); void perform(async () => {
        const input = { requestId: requestId.current, memorySpaceId: selectedSpace?.id, title, body, memoryClass };
        const saved = await client.save(scope, document ? { ...input, expectedVersion: document.version } : input, document?.id);
        await refresh();
        show(await client.get(scope, saved.documentId));
        focusAfterRender.current = "preview";
        setNotice(t("common.saved"));
      });
    }}>
      <label className="grid gap-1 text-sm">{t("memory.documentTitle")}<input required autoFocus maxLength={200} disabled={busy} className={inputClass}
        value={title} onChange={(event) => { changeDraft(); setTitle(event.target.value); }} /></label>
      {/* The body grows into the pane's height, so Save stays in view without scrolling. */}
      <label className="flex min-h-40 flex-1 flex-col gap-1 text-sm">{t("memory.body")}<textarea required rows={4} disabled={busy}
        className={cn(inputClass, "min-h-32 flex-1 resize-none font-mono leading-relaxed")}
        value={body} onChange={(event) => { changeDraft(); setBody(event.target.value); }} /></label>
      {/* Sticky so Save stays reachable when a short window leaves the pane little height. */}
      <div className="sticky -bottom-4 -mb-4 flex flex-wrap items-end gap-3 bg-card pb-4 pt-2">
        <label className="grid gap-1 text-sm">{t("memory.class")}<select disabled={busy} className={inputClass} value={memoryClass}
          onChange={(event) => { changeDraft(); setMemoryClass(event.target.value as DmMemoryClass); }}>
          {dmMemoryClasses.map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <span className={cn("pb-2 text-xs text-muted-foreground", bodyBytes > dmMemoryDocumentMaxBytes && "text-destructive")}>
          {bodyBytes} / {dmMemoryDocumentMaxBytes} bytes
        </span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={closeDraft}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy || bodyBytes > dmMemoryDocumentMaxBytes}>{busy ? t("common.saving") : t("common.save")}</Button>
        </div>
      </div>
    </form>;
  }

  function renderFile(document: DmMemoryDocumentDetail, view: "read" | "edit" | "history") {
    const meta = [
      ...dmMemoryFileDetails(document),
      ...(document.readOnly ? [t("memory.readOnly")] : []),
      ...(document.protectedByUser ? [t("memory.protected")] : []),
      ...(document.readOnly ? [] : [`${t("memory.updated")} ${new Date(document.updatedAt).toLocaleString(localeTag, { dateStyle: "medium", timeStyle: "short" })}`]),
    ];
    return <>
      <div className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-5 py-3">
        {backToTree}
        <div className="min-w-0 flex-1">
          <h3 ref={previewHeading} tabIndex={-1} className="truncate text-base font-semibold outline-none">{document.title}</h3>
          {document.path && document.path !== document.title
            && <p className="break-all font-mono text-xs text-muted-foreground">{document.path}</p>}
          <p data-memory-meta className="mt-0.5 text-xs text-muted-foreground">{meta.join(" · ")}</p>
        </div>
        {view !== "edit" && !document.readOnly && <div className="flex shrink-0 flex-wrap gap-1.5 max-md:basis-full">
          {view === "read" && canEdit && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => compose(document)}><Pencil />{t("memory.edit")}</Button>}
          {view === "read" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => {
            setHistory(await client.history(scope, document.id)); setRevision(null);
            setPane({ kind: "file", document, view: "history" });
          })}><History />{t("memory.history")}</Button>}
          {view === "history" && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => { setRevision(null); setPane({ kind: "file", document, view: "read" }); }}><ArrowLeft />{t("memory.backToFile")}</Button>}
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} aria-label={t("memory.delete")}
            onClick={() => void perform(async () => {
              await client.remove(scope, document.id);
              clear();
              await refresh(); setNotice(t("memory.deleted"));
            })}><Trash2 />{t("memory.delete")}</Button>
        </div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {view === "edit" && renderForm(document)}
        {view === "read" && <div className="grid gap-4">
          {document.readOnly && <p className="text-sm text-muted-foreground">{t("memory.readmeHelp")}</p>}
          {historical && <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <p role="status">{t("memory.historical")} · v{document.version}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => {
              show(await client.get(scope, document.id));
            })}>{t("memory.currentVersion")}</Button>
          </div>}
          <MarkdownContent className="issue-description-markdown">{document.body}</MarkdownContent>
          {!document.readOnly && <div className="grid gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
            {document.sources.length > 0 && <p className="break-all">{t("memory.sources")}: {document.sources.map((source) => `${source.type}:${source.id}@${source.version}`).join(", ")}</p>}
            <p>{t("memory.forgetHelp")}</p>
          </div>}
        </div>}
        {view === "history" && history && <div className="grid gap-4">
          <ul aria-label={t("memory.history")} className="grid gap-1">
            {history.revisions.map((item) => <li key={item.version}>
              <button type="button" disabled={busy} aria-pressed={revision?.version === item.version}
                className={cn("w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary disabled:opacity-50",
                  revision?.version === item.version && "bg-accent text-accent-foreground")}
                onClick={() => void perform(async () => { setRevision(await client.get(scope, document.id, undefined, item.version)); })}>
                v{item.version} · {item.createdAt} · {item.origin}
              </button>
            </li>)}
          </ul>
          {history.nextCursor && <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={busy} onClick={() => void perform(async () => {
            const next = await client.history(scope, document.id, history.nextCursor ?? undefined);
            setHistory({ ...next, revisions: [...history.revisions, ...next.revisions] });
          })}>{t("memory.more")}</Button>}
          {revision && <section aria-label={`${t("memory.historical")} · v${revision.version}`} className="grid gap-3 rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{t("memory.historical")} · v{revision.version}</p>
            <MarkdownContent className="issue-description-markdown">{revision.body}</MarkdownContent>
          </section>}
        </div>}
      </div>
    </>;
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent closeLabel={t("common.close")} className={cn(
      "flex h-[85dvh] w-[min(1200px,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0",
      "max-md:h-[calc(100dvh-1rem)] max-md:w-[calc(100vw-1rem)] max-md:rounded-xl",
    )}>
      <div className="grid shrink-0 gap-2 border-b border-border py-3 pl-5 pr-12 max-md:max-h-[45%] max-md:overflow-y-auto">
        <DialogTitle className="flex items-center gap-2"><Brain size={18} />{t("memory.title")}</DialogTitle>
        <DialogDescription>{t("memory.scope")}</DialogDescription>
        {page && <div className={cn("grid gap-2", detailOpen && "max-md:hidden")}>
          {page.spaces.length > 1 && <label className="flex flex-wrap items-center gap-2 text-sm">{t("memory.space")}
            <select className={cn(inputClass, "w-auto py-1")} disabled={busy} value={page.selectedSpaceId ?? ""}
              onChange={(event) => { clear(null); void perform(() => refresh(event.target.value)); }}>
              {page.spaces.map((space) => <option key={space.id} value={space.id}>
                {space.status === "closed" ? t("memory.closed") : t("memory.active")} · {space.createdAt.slice(0, 10)}
              </option>)}
            </select>
          </label>}
          {selectedSpace?.status === "closed" && <p className="text-sm">{t("memory.closedHelp")}</p>}
          {page.eligible && selectedSpace?.status === "closed" && <Button size="sm" className="justify-self-start" disabled={busy} onClick={() => void perform(async () => {
            const space = await client.settings(scope, { requestId: crypto.randomUUID(), expectedMemoryRevision: 0, useEnabled: false, autoEnabled: false });
            clear(null); await refresh(space.id);
          })}>{t("memory.newSpace")}</Button>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {writable && <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={busy} checked={selectedSpace?.useEnabled ?? false}
                onChange={(event) => { const enabled = event.target.checked; void perform(async () => {
                  const space = await client.settings(scope, { requestId: crypto.randomUUID(),
                    memorySpaceId: selectedSpace?.id, expectedMemoryRevision: selectedSpace?.memoryRevision ?? 0,
                    useEnabled: enabled, autoEnabled: enabled && (selectedSpace?.autoEnabled ?? false) });
                  await refresh(space.id);
                }); }} />{t("memory.use")}
            </label>}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" disabled={busy || !writable || !selectedSpace?.useEnabled} checked={selectedSpace?.autoEnabled ?? false}
                onChange={(event) => { const enabled = event.target.checked; void perform(async () => {
                  const space = await client.settings(scope, { requestId: crypto.randomUUID(), memorySpaceId: selectedSpace?.id,
                    expectedMemoryRevision: selectedSpace?.memoryRevision ?? 0, useEnabled: true, autoEnabled: enabled });
                  await refresh(space.id);
                }); }} />{t("memory.automatic")}
            </label>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              {writable && <Button size="sm" disabled={busy} onClick={() => compose(null)}><Plus />{t("memory.add")}</Button>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => refresh())}><RefreshCw />{t("memory.refresh")}</Button>
              {selectedSpace && <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => {
                const file = new File([await client.export(scope, selectedSpace.id)], `briar-memory-${selectedSpace.id}.zip`, { type: "application/zip" });
                if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
                else {
                  const url = URL.createObjectURL(file);
                  const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name;
                  document.body.append(anchor); anchor.click(); anchor.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 30_000);
                }
                setNotice(t("memory.exportWarning"));
              })}><Download />{t("memory.export")}</Button>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("memory.automaticHelp")}</p>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </div>
      {!page && busy && <p role="status" className="p-5 text-sm text-muted-foreground">{t("memory.loading")}</p>}
      {page && <div data-memory-pane={detailOpen ? "preview" : "tree"}
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 md:grid-cols-[320px_minmax(0,1fr)]">
        <div ref={treePane} className={cn("min-h-0 flex-col gap-2 overflow-y-auto p-2 md:flex md:border-r md:border-border",
          detailOpen ? "hidden" : "flex")}>
          {!page.eligible && !selectedSpace && <p className="px-2 pt-1 text-sm">{t("memory.ineligible")}</p>}
          {records.length === 0 && <p className="px-2 pt-1 text-sm text-muted-foreground">{t("memory.empty")}</p>}
          {(page.eligible || selectedSpace) && <DmMemoryTree folders={page.folders} documents={page.documents}
            selectedId={opened?.id ?? null} disabled={busy}
            onOpen={(item) => void perform(async () => {
              show(await client.get(scope, item.id));
              // Below the breakpoint the tree just disappeared; on wide screens the reader keeps browsing it.
              if (isNarrow()) focusAfterRender.current = "preview";
            })} />}
          {page.nextCursor && <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void perform(async () => {
            const next = await client.load(scope, page.selectedSpaceId ?? undefined, page.nextCursor ?? undefined);
            setPage({ ...next, documents: [...page.documents, ...next.documents] });
          })}>{t("memory.more")}</Button>}
        </div>
        <section aria-label={t("memory.preview")} className={cn("min-h-0 flex-col md:flex", detailOpen ? "flex" : "hidden bg-muted/30")}>
          {pane.kind === "file" && renderFile(pane.document, pane.view)}
          {pane.kind === "create" && <>
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
              {backToTree}
              <h3 ref={previewHeading} tabIndex={-1} className="text-base font-semibold outline-none">{t("memory.add")}</h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{renderForm(null)}</div>
          </>}
        </section>
      </div>}
    </DialogContent>
  </Dialog>;
}
