import type { DmMemoryDocument } from "./dm-memory-contract";

/**
 * The owner's memory vault as a folder tree: the layout's folders (sent by the
 * server, so empty ones show too), legacy folders that only exist because a
 * file lives there, and every record file at its vault path. A record from a
 * server before the folder tree has no path and sits at the root under its
 * title, which turns the tree back into the flat list it replaces.
 */
export type DmMemoryTreeFolder = {
  readonly kind: "folder";
  /** `""` for the root, else the folder path such as `entities/people`. */
  readonly key: string;
  readonly name: string;
  readonly children: readonly DmMemoryTreeNode[];
  /** Files anywhere below: an empty folder is dimmed and starts collapsed. */
  readonly fileCount: number;
};

export type DmMemoryTreeFile = {
  readonly kind: "file";
  readonly key: string;
  readonly name: string;
  readonly document: DmMemoryDocument;
};

export type DmMemoryTreeNode = DmMemoryTreeFolder | DmMemoryTreeFile;

export const dmMemoryTreeRootName = "memory";

type MutableFolder = { key: string; name: string; folders: Map<string, MutableFolder>; files: DmMemoryTreeFile[] };

const byName = (left: { name: string }, right: { name: string }) =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0;

export function buildDmMemoryTree(folders: readonly string[], documents: readonly DmMemoryDocument[]): DmMemoryTreeFolder {
  const root: MutableFolder = { key: "", name: dmMemoryTreeRootName, folders: new Map(), files: [] };
  const folderAt = (path: string) => {
    let current = root;
    for (const segment of path.split("/").filter(Boolean)) {
      const key = current.key ? `${current.key}/${segment}` : segment;
      let next = current.folders.get(segment);
      if (!next) {
        next = { key, name: segment, folders: new Map(), files: [] };
        current.folders.set(segment, next);
      }
      current = next;
    }
    return current;
  };
  for (const folder of folders) folderAt(folder);
  for (const document of documents) {
    if (document.path === null) {
      root.files.push({ kind: "file", key: `#${document.id}`, name: document.title, document });
      continue;
    }
    const slash = document.path.lastIndexOf("/");
    const parent = slash < 0 ? root : folderAt(document.path.slice(0, slash));
    parent.files.push({ kind: "file", key: document.path, name: document.path.slice(slash + 1), document });
  }
  const freeze = (folder: MutableFolder): DmMemoryTreeFolder => {
    const subfolders = [...folder.folders.values()].sort(byName).map(freeze);
    const files = [...folder.files].sort(byName);
    return {
      kind: "folder",
      key: folder.key,
      name: folder.name,
      children: [...subfolders, ...files],
      fileCount: files.length + subfolders.reduce((sum, child) => sum + child.fileCount, 0),
    };
  };
  return freeze(root);
}

export type DmMemoryTreeRow = {
  readonly node: DmMemoryTreeNode;
  /** 1-based, as `aria-level`. */
  readonly level: number;
  readonly setSize: number;
  readonly posInSet: number;
  /** The containing folder's key; null for the root. */
  readonly parentKey: string | null;
};

/** The rows a reader sees, depth first, given which folders are open. */
export function visibleDmMemoryTreeRows(root: DmMemoryTreeFolder, isExpanded: (folder: DmMemoryTreeFolder) => boolean) {
  const rows: DmMemoryTreeRow[] = [];
  const visit = (node: DmMemoryTreeNode, level: number, setSize: number, posInSet: number, parentKey: string | null) => {
    rows.push({ node, level, setSize, posInSet, parentKey });
    if (node.kind === "folder" && isExpanded(node)) {
      node.children.forEach((child, index) => visit(child, level + 1, node.children.length, index + 1, node.key));
    }
  };
  visit(root, 1, 1, 1, null);
  return rows;
}

/** The quiet label beside a file: its real type, a workstream's status and the revision. */
export function dmMemoryFileDetails(document: DmMemoryDocument) {
  // A server before the folder tree sends no record type, only the legacy class.
  const type = document.recordType === null ? document.memoryClass : document.recordType;
  if (document.readOnly) return [type];
  return [type, ...(document.recordStatus ? [document.recordStatus] : []), `r${document.version}`];
}
