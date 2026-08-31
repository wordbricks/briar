import { Brain, Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  dmMemoryApi, type DmMemoryClient, type DmMemoryApiScope,
} from "../lib/api/dm-memory";
import {
  dmMemoryClasses, dmMemoryDocumentMaxBytes, type DmMemoryClass,
  type DmMemoryDocumentDetail, type DmMemoryPage,
} from "../lib/dm-memory-contract";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function DmMemoryDialog({ scope, onClose, client = dmMemoryApi }: {
  scope: DmMemoryApiScope; onClose: () => void; client?: DmMemoryClient;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<DmMemoryPage | null>(null);
  const [selected, setSelected] = useState<DmMemoryDocumentDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [memoryClass, setMemoryClass] = useState<DmMemoryClass>("profile");
  const [sourceLanguage, setSourceLanguage] = useState("und");
  const [observedAt, setObservedAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const requestId = useRef(crypto.randomUUID());
  const selectedSpace = page?.spaces.find((space) => space.id === page.selectedSpaceId);
  const writable = page?.eligible && (!selectedSpace || selectedSpace.status === "active");

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setBusy(true);
    void client.load(scope, undefined, undefined, controller.signal).then((result) => {
      if (generation.current === current) setPage(result);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => { if (generation.current === current) setBusy(false); });
    return () => { generation.current++; controller.abort(); };
  }, [scope.token, scope.organizationId, scope.channelId, client]);

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
    setSelected(document); setTitle(document?.title ?? ""); setBody(document?.body ?? "");
    setMemoryClass(document?.memoryClass ?? "profile"); setSourceLanguage(document?.sourceLanguage ?? "und");
    setObservedAt(document?.observedAt ?? ""); setValidUntil(document?.validUntil ?? "");
    requestId.current = crypto.randomUUID(); setEditing(true); setNotice(null);
  }
  const changeDraft = () => { requestId.current = crypto.randomUUID(); };
  const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent closeLabel={t("common.close")} className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogTitle className="flex items-center gap-2"><Brain size={18} />{t("memory.title")}</DialogTitle>
      <DialogDescription>{t("memory.scope")}</DialogDescription>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!page && busy && <p role="status">{t("memory.loading")}</p>}
      {page && <>
        {!page.capabilities.recall && <p className="text-sm text-muted-foreground">{t("memory.recallPending")}</p>}
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
                useEnabled: enabled, autoEnabled: false });
              await refresh(space.id);
            }); }} />{t("memory.use")}
        </label>}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" disabled checked={selectedSpace?.autoEnabled ?? false} />{t("memory.automaticPending")}
        </label>
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
        {page.documents.length === 0 && <p className="text-sm text-muted-foreground">{t("memory.empty")}</p>}
        <ul className="grid gap-2" aria-label={t("memory.list")}>
          {page.documents.map((item) => <li key={item.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" disabled={busy} onClick={() => void perform(async () => {
                const detail = await client.get(scope, item.id); beginEdit(detail);
              })}>
                <span className="block break-words font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.memoryClass} · v{item.version} · {item.indexState === "ready" ? t("memory.indexReady") : item.indexState === "failed" ? t("memory.indexFailed") : t("memory.indexPending")}</span>
                {item.protectedByUser && <span className="ml-2 text-xs">{t("memory.protected")}</span>}
                {(item.conflicted || item.status !== "active") && <span className="block text-xs">{t("memory.needsReview")}</span>}
              </button>
              <Button size="icon" variant="ghost" disabled={busy} aria-label={t("memory.delete")} onClick={() => void perform(async () => {
                await client.remove(scope, item.id); if (selected?.id === item.id) setEditing(false);
                await refresh(); setNotice(t("memory.deleted"));
              })}><Trash2 size={16} /></Button>
            </div>
          </li>)}
        </ul>
        {page.nextCursor && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
          const next = await client.load(scope, page.selectedSpaceId ?? undefined, page.nextCursor ?? undefined);
          setPage({ ...next, documents: [...page.documents, ...next.documents] });
        })}>{t("memory.more")}</Button>}
        {editing && <form className="grid gap-3 border-t border-border pt-4" onSubmit={(event) => {
          event.preventDefault(); void perform(async () => {
            const input = { requestId: requestId.current, memorySpaceId: selectedSpace?.id,
              title, body, memoryClass, sourceLanguage, observedAt: observedAt || null, validUntil: validUntil || null };
            await client.save(scope, selected ? { ...input, expectedVersion: selected.version } : input, selected?.id);
            setEditing(false); await refresh(); setNotice(t("common.saved"));
          });
        }}>
          <label className="grid gap-1 text-sm">{t("memory.documentTitle")}<input required maxLength={200} disabled={!writable || busy} className={inputClass} value={title} onChange={(event) => { changeDraft(); setTitle(event.target.value); }} /></label>
          <label className="grid gap-1 text-sm">{t("memory.body")}<textarea required rows={6} disabled={!writable || busy} className={inputClass} value={body} onChange={(event) => { changeDraft(); setBody(event.target.value); }} /></label>
          <span className="text-xs text-muted-foreground">{new TextEncoder().encode(body).length} / {dmMemoryDocumentMaxBytes} bytes</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">{t("memory.class")}<select disabled={!writable || busy} className={inputClass} value={memoryClass} onChange={(event) => { changeDraft(); setMemoryClass(event.target.value as DmMemoryClass); }}>
              {dmMemoryClasses.map((value) => <option key={value}>{value}</option>)}
            </select></label>
            <label className="grid gap-1 text-sm">{t("memory.language")}<input disabled={!writable || busy} className={inputClass} value={sourceLanguage} onChange={(event) => { changeDraft(); setSourceLanguage(event.target.value); }} /></label>
            <label className="grid gap-1 text-sm">{t("memory.observed")}<input disabled={!writable || busy} className={inputClass} placeholder="2026-09-01T09:00:00+09:00" value={observedAt} onChange={(event) => { changeDraft(); setObservedAt(event.target.value); }} /></label>
            <label className="grid gap-1 text-sm">{t("memory.expiry")}<input disabled={!writable || busy} className={inputClass} placeholder={t("memory.optionalDate")} value={validUntil} onChange={(event) => { changeDraft(); setValidUntil(event.target.value); }} /></label>
          </div>
          {selected && <div className="break-all text-xs text-muted-foreground">
            <p>{t("memory.updated")} {selected.updatedAt}</p>
            <p>{t("memory.sources")}: {selected.sources.map((source) => `${source.type}:${source.id}@${source.version}`).join(", ")}</p>
          </div>}
          <div className="flex gap-2">
            {writable && <Button type="submit" disabled={busy || new TextEncoder().encode(body).length > dmMemoryDocumentMaxBytes}>{busy ? t("common.saving") : t("common.save")}</Button>}
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>{t("common.close")}</Button>
          </div>
        </form>}
      </>}
    </DialogContent>
  </Dialog>;
}
