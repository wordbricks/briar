import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { DmMemoryDocument } from "../lib/dm-memory-contract";
import {
  buildDmMemoryTree, dmMemoryFileDetails, visibleDmMemoryTreeRows,
  type DmMemoryTreeFolder, type DmMemoryTreeRow,
} from "../lib/dm-memory-tree";
import { cn } from "../lib/utils";

/**
 * The memory vault as a file-explorer tree (WAI-ARIA tree pattern, flat
 * rendering with `aria-level`): one tab stop, arrow keys move and open or
 * close folders, Home and End jump, Enter and Space open a file or toggle a
 * folder. Folders holding files start open; the user's choices then stick
 * across the dialog's polling refreshes.
 */
export function DmMemoryTree({ folders, documents, selectedId, disabled, onOpen }: {
  folders: readonly string[];
  documents: readonly DmMemoryDocument[];
  selectedId: string | null;
  disabled: boolean;
  onOpen: (document: DmMemoryDocument) => void;
}) {
  const { t } = useI18n();
  const root = useMemo(() => buildDmMemoryTree(folders, documents), [folders, documents]);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const isExpanded = (folder: DmMemoryTreeFolder) => toggled.get(folder.key) ?? (folder.key === "" || folder.fileCount > 0);
  const rows = visibleDmMemoryTreeRows(root, isExpanded);
  const tabStop = rows.some((row) => row.node.key === focusKey) ? focusKey : rows[0]!.node.key;

  const setExpanded = (folder: DmMemoryTreeFolder, expanded: boolean) =>
    setToggled((current) => new Map(current).set(folder.key, expanded));
  const focus = (row: DmMemoryTreeRow | undefined) => {
    if (!row) return;
    setFocusKey(row.node.key);
    items.current.get(row.node.key)?.focus();
  };
  const activate = (row: DmMemoryTreeRow) => {
    if (row.node.kind === "folder") {
      if (row.node.children.length > 0) setExpanded(row.node, !isExpanded(row.node));
    } else if (!disabled) onOpen(row.node.document);
  };

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    const row = rows[index]!;
    const node = row.node;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    switch (event.key) {
      case "ArrowDown": handled(); focus(rows[index + 1]); break;
      case "ArrowUp": handled(); focus(rows[index - 1]); break;
      case "Home": handled(); focus(rows[0]); break;
      case "End": handled(); focus(rows.at(-1)); break;
      case "ArrowRight":
        handled();
        if (node.kind === "folder" && node.children.length > 0) {
          if (isExpanded(node)) focus(rows[index + 1]);
          else setExpanded(node, true);
        }
        break;
      case "ArrowLeft":
        handled();
        if (node.kind === "folder" && node.children.length > 0 && isExpanded(node)) setExpanded(node, false);
        else focus(rows.find((candidate) => candidate.node.key === row.parentKey));
        break;
      case "Enter":
      case " ":
        handled(); activate(row); break;
    }
  }

  return <ul role="tree" aria-label={t("memory.tree")}
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px font-mono text-sm">
    {rows.map((row, index) => {
      const { node } = row;
      const folder = node.kind === "folder" ? node : null;
      const expandable = folder !== null && folder.children.length > 0;
      const expanded = folder !== null && expandable && isExpanded(folder);
      const empty = folder !== null && folder.fileCount === 0;
      const selected = node.kind === "file" && node.document.id === selectedId;
      return <li key={node.key} role="treeitem"
        ref={(element) => { if (element) items.current.set(node.key, element); else items.current.delete(node.key); }}
        tabIndex={node.key === tabStop ? 0 : -1}
        aria-level={row.level} aria-setsize={row.setSize} aria-posinset={row.posInSet}
        aria-expanded={expandable ? expanded : undefined}
        aria-selected={node.kind === "file" ? selected : undefined}
        aria-disabled={node.kind === "file" && disabled ? true : undefined}
        onKeyDown={(event) => onKeyDown(event, index)}
        onFocus={() => setFocusKey(node.key)}
        onClick={() => { setFocusKey(node.key); activate(row); }}
        style={{ paddingLeft: `${(row.level - 1) * 1.125 + 0.25}rem` }}
        className={cn(
          "flex min-h-7 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 outline-none",
          "hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-accent text-accent-foreground",
          empty && "text-muted-foreground/70",
        )}>
        {expandable
          ? <ChevronRight aria-hidden size={14} className={cn("shrink-0 transition-transform", expanded && "rotate-90")} />
          : <span aria-hidden className="w-3.5 shrink-0" />}
        {folder
          ? (expanded ? <FolderOpen aria-hidden size={15} className="shrink-0" /> : <Folder aria-hidden size={15} className="shrink-0" />)
          : <FileText aria-hidden size={15} className="shrink-0 text-muted-foreground" />}
        <span className={cn("min-w-0 truncate", node.kind === "file" && "shrink-0 max-w-[75%]", folder && !empty && "font-medium")}>{node.name}</span>
        {folder && folder.fileCount > 0 && <span className="text-xs text-muted-foreground">{folder.fileCount}</span>}
        {node.kind === "file" && <span className="ml-auto min-w-0 truncate pl-3 font-sans text-xs text-muted-foreground">
          {[
            ...dmMemoryFileDetails(node.document),
            ...(node.document.readOnly ? [t("memory.readOnly")] : []),
            ...(node.document.protectedByUser ? [t("memory.protected")] : []),
          ].join(" · ")}
        </span>}
      </li>;
    })}
  </ul>;
}
