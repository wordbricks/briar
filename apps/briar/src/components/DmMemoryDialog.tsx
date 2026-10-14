import { Brain, Download, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { DmMemoryTree } from "./DmMemoryTree";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function DmMemoryDialog({ scope, onClose, client = dmMemoryApi, initialReference }: {
  scope: DmMemoryApiScope; onClose: () => void; client?: DmMemoryClient; initialReference?: DmMemoryReference;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<DmMemoryPage | null>(null);
  const [selected, setSelected] = useState<DmMemoryDocumentDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<DmMemoryRevisionPage | null>(null);
  const [historyPreview, setHistoryPreview] = useState<DmMemoryDocumentDetail | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [memoryClass, setMemoryClass] = useState<DmMemoryClass>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const requestId = useRef(crypto.randomUUID());
  const selectedSpace = page?.spaces.find((space) => space.id === page.selectedSpaceId);
  const writable = page?.eligible && (!selectedSpace || selectedSpace.status === "active");

  const historicalSelected = selected && page?.documents.find((item) => item.id === selected.id)?.version !== selected.version;
  // README.md belongs to the app: it is shown, never edited or forgotten.
  const canEdit = writable && !historicalSelected && !selected?.readOnly;
  const records = page?.documents.filter((item) => !item.readOnly) ?? [];
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (editing) form.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [editing, selected?.id]);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setBusy(true);
    void client.load(scope, undefined, undefined, controller.signal).then(async (result) => {
      if (generation.current !== current) return;
      setPage(result);
      if (initialReference) {
        const document = await client.get(scope, initialReference.documentId, controller.signal, initialReference.version);
        if (generation.current === current) beginEdit(document);
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
      if (busy || editing || !page) return;
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
  }, [busy, editing, page, selectedSpace?.memoryRevision, scope.token, scope.workspaceId, scope.channelId, client]);

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
  function beginEdit(document: DmMemoryDocumentDetail | null) {
    setHistory(null); setHistoryPreview(null);
    setSelected(document); setTitle(document?.title ?? ""); setBody(document?.body ?? "");
    setMemoryClass(document?.memoryClass ?? "profile");
    requestId.current = crypto.randomUUID(); setEditing(true); setNotice(null);
  }
  const changeDraft = () => { requestId.current = crypto.randomUUID(); };
  const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent closeLabel={t("common.close")} className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogTitle className="flex items-center gap-2"><Brain size={18} />{t("memory.title")}</DialogTitle>
      <DialogDescription>{t("memory.scope")}</DialogDescription>
      <p className="text-sm text-muted-foreground">{t("memory.forgetHelp")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!page && busy && <p role="status">{t("memory.loading")}</p>}
      {page && <>
        {page.spaces.length > 1 && <label className="grid gap-1 text-sm">{t("memory.space")}
          <select className={inputClass} disabled={busy} value={page.selectedSpaceId ?? ""}
            onChange={(event) => { setEditing(false); void perform(() => refresh(event.target.value)); }}>
            {page.spaces.map((space) => <option key={space.id} value={space.id}>
              {space.status === "closed" ? t("memory.closed") : t("memory.active")} · {space.createdAt.slice(0, 10)}
            </option>)}
          </select>
        </label>}
        {selectedSpace?.status === "closed" && <p className="text-sm">{t("memory.closedHelp")}</p>}
        {page.eligible && selectedSpace?.status === "closed" && <Button disabled={busy} onClick={() => void perform(async () => {
          const space = await client.settings(scope, { requestId: crypto.randomUUID(), expectedMemoryRevision: 0, useEnabled: false, autoEnabled: false });
          setEditing(false); await refresh(space.id);
        })}>{t("memory.newSpace")}</Button>}
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
        <p className="text-xs text-muted-foreground">{t("memory.automaticHelp")}</p>
        <div className="flex flex-wrap gap-2">
          {writable && <Button disabled={busy} onClick={() => beginEdit(null)}><Plus size={15} />{t("memory.add")}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => void perform(() => refresh())}><RefreshCw size={15} />{t("memory.refresh")}</Button>
          {selectedSpace && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
            const file = new File([await client.export(scope, selectedSpace.id)], `briar-memory-${selectedSpace.id}.zip`, { type: "application/zip" });
            if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
            else {
              const url = URL.createObjectURL(file);
              const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name;
              document.body.append(anchor); anchor.click(); anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 30_000);
            }
            setNotice(t("memory.exportWarning"));
          })}><Download size={15} />{t("memory.export")}</Button>}
        </div>
        {!page.eligible && !selectedSpace && <p>{t("memory.ineligible")}</p>}
        {records.length === 0 && <p className="text-sm text-muted-foreground">{t("memory.empty")}</p>}
        {(page.eligible || selectedSpace) && <DmMemoryTree folders={page.folders} documents={page.documents}
          selectedId={editing ? selected?.id ?? null : null} disabled={busy}
          onOpen={(item) => void perform(async () => { beginEdit(await client.get(scope, item.id)); })} />}
        {page.nextCursor && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
          const next = await client.load(scope, page.selectedSpaceId ?? undefined, page.nextCursor ?? undefined);
          setPage({ ...next, documents: [...page.documents, ...next.documents] });
        })}>{t("memory.more")}</Button>}
        {editing && <form ref={form} className="grid gap-3 border-t border-border pt-4" onSubmit={(event) => {
          event.preventDefault(); void perform(async () => {
            const input = { requestId: requestId.current, memorySpaceId: selectedSpace?.id,
              title, body, memoryClass };
            await client.save(scope, selected ? { ...input, expectedVersion: selected.version } : input, selected?.id);
            setEditing(false); await refresh(); setNotice(t("common.saved"));
          });
        }}>
          {selected?.path && <p className="break-all font-mono text-xs text-muted-foreground">{selected.path}</p>}
          {selected?.readOnly && <p className="text-sm text-muted-foreground">{t("memory.readmeHelp")}</p>}
          {historicalSelected && <p role="status">{t("memory.historical")}</p>}
          {selected?.readOnly
            ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-xs">{selected.body}</pre>
            : <>
              <label className="grid gap-1 text-sm">{t("memory.documentTitle")}<input required maxLength={200} disabled={!canEdit || busy} className={inputClass} value={title} onChange={(event) => { changeDraft(); setTitle(event.target.value); }} /></label>
              <label className="grid gap-1 text-sm">{t("memory.body")}<textarea required rows={6} disabled={!canEdit || busy} className={inputClass} value={body} onChange={(event) => { changeDraft(); setBody(event.target.value); }} /></label>
              <span className="text-xs text-muted-foreground">{new TextEncoder().encode(body).length} / {dmMemoryDocumentMaxBytes} bytes</span>
              <label className="grid gap-1 text-sm">{t("memory.class")}<select disabled={!canEdit || busy} className={inputClass} value={memoryClass} onChange={(event) => { changeDraft(); setMemoryClass(event.target.value as DmMemoryClass); }}>
                {dmMemoryClasses.map((value) => <option key={value}>{value}</option>)}
              </select></label>
            </>}
          {selected && !selected.readOnly && <div className="break-all text-xs text-muted-foreground">
            <p>{t("memory.updated")} {selected.updatedAt}</p>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(async () => {
              setHistory(await client.history(scope, selected.id));
            })}>{t("memory.history")}</Button>
            {historicalSelected && <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(async () => {
              beginEdit(await client.get(scope, selected.id));
            })}>{t("memory.currentVersion")}</Button>}
            {history && <div className="mt-2 grid gap-2">
              {history.revisions.map((revision) => <button type="button" className="text-left underline" disabled={busy} key={revision.version}
                onClick={() => void perform(async () => { setHistoryPreview(await client.get(scope, selected.id, undefined, revision.version)); })}>
                v{revision.version} · {revision.createdAt} · {revision.origin}
              </button>)}
              {history.nextCursor && <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(async () => {
                const next = await client.history(scope, selected.id, history.nextCursor ?? undefined);
                setHistory({ ...next, revisions: [...history.revisions, ...next.revisions] });
              })}>{t("memory.more")}</Button>}
              {historyPreview && <section aria-label={t("memory.history")} className="rounded border border-border p-3">
                <p>{t("memory.historical")} · v{historyPreview.version}</p>
                <pre className="whitespace-pre-wrap break-words">{historyPreview.body}</pre>
              </section>}
            </div>}
            {selected.sources.length > 0 && <p>{t("memory.sources")}: {selected.sources.map((source) => `${source.type}:${source.id}@${source.version}`).join(", ")}</p>}
          </div>}
          <div className="flex gap-2">
            {canEdit && <Button type="submit" disabled={busy || new TextEncoder().encode(body).length > dmMemoryDocumentMaxBytes}>{busy ? t("common.saving") : t("common.save")}</Button>}
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>{t("common.close")}</Button>
            {selected && !selected.readOnly && <Button type="button" variant="ghost" className="ml-auto text-destructive"
              disabled={busy} aria-label={t("memory.delete")} onClick={() => void perform(async () => {
                await client.remove(scope, selected.id); setEditing(false);
                await refresh(); setNotice(t("memory.deleted"));
              })}><Trash2 size={15} />{t("memory.delete")}</Button>}
          </div>
        </form>}
      </>}
    </DialogContent>
  </Dialog>;
}
