/**
 * A minimal in-memory file system for isomorphic-git inside a Worker.
 *
 * isomorphic-git needs `promises.{readFile,writeFile,unlink,readdir,mkdir,
 * rmdir,stat,lstat,readlink,symlink,chmod}`. Missing entries must fail with an
 * error whose `code` is `ENOENT`, which is how isomorphic-git tells "absent"
 * from "broken"; `readlink` therefore always reports ENOENT because nothing
 * here is ever a link. Verified against Artifacts on 2026-10-13.
 */
type Entry =
  | { readonly kind: "dir"; readonly children: Set<string>; mtimeMs: number }
  | { readonly kind: "file"; data: Uint8Array; mtimeMs: number };

const fsError = (code: string, path: string) =>
  Object.assign(new Error(`${code}: ${path}`), { code });

class MemoryStats {
  constructor(private readonly entry: Entry) {}

  get size() {
    return this.entry.kind === "file" ? this.entry.data.byteLength : 0;
  }

  get mtimeMs() {
    return this.entry.mtimeMs;
  }

  get ctimeMs() {
    return this.entry.mtimeMs;
  }

  get mode() {
    return this.entry.kind === "file" ? 0o100644 : 0o040000;
  }

  get uid() {
    return 0;
  }

  get gid() {
    return 0;
  }

  get ino() {
    return 0;
  }

  get dev() {
    return 0;
  }

  isFile() {
    return this.entry.kind === "file";
  }

  isDirectory() {
    return this.entry.kind === "dir";
  }

  isSymbolicLink() {
    return false;
  }
}

const normalize = (input: string) => {
  const segments: string[] = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return `/${segments.join("/")}`;
};

const parentOf = (path: string) => {
  const parts = normalize(path).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
};

const baseName = (path: string) => normalize(path).split("/").filter(Boolean).pop() ?? "";

export class MemoryFS {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly entries = new Map<string, Entry>([
    ["/", { kind: "dir", children: new Set(), mtimeMs: Date.now() }],
  ]);

  readonly promises = {
    readFile: (path: string, options?: string | { encoding?: string }) => this.readFile(path, options),
    writeFile: (path: string, data: string | Uint8Array | ArrayBuffer) => this.writeFile(path, data),
    unlink: (path: string) => this.unlink(path),
    readdir: (path: string) => this.readdir(path),
    mkdir: (path: string, options?: { recursive?: boolean } | number) => this.mkdir(path, options),
    rmdir: (path: string) => this.rmdir(path),
    stat: (path: string) => this.stat(path),
    lstat: (path: string) => this.stat(path),
    readlink: async (path: string): Promise<string> => {
      throw fsError("ENOENT", path);
    },
    symlink: async (_target: string, path: string): Promise<void> => {
      throw fsError("EPERM", path);
    },
    chmod: async (): Promise<void> => {},
  };

  private entry(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry) throw fsError("ENOENT", path);
    return entry;
  }

  private directory(path: string) {
    const entry = this.entry(path);
    if (entry.kind !== "dir") throw fsError("ENOTDIR", path);
    return entry;
  }

  private async mkdir(path: string, options?: { recursive?: boolean } | number) {
    const target = normalize(path);
    if (target === "/") return;
    const recursive = typeof options === "object" && options !== null && options.recursive === true;
    const parent = parentOf(target);
    if (!this.entries.has(parent)) {
      if (!recursive) throw fsError("ENOENT", parent);
      await this.mkdir(parent, { recursive: true });
    }
    const existing = this.entries.get(target);
    if (existing) {
      if (existing.kind !== "dir") throw fsError("EEXIST", path);
      return;
    }
    this.entries.set(target, { kind: "dir", children: new Set(), mtimeMs: Date.now() });
    this.directory(parent).children.add(baseName(target));
  }

  private async writeFile(path: string, data: string | Uint8Array | ArrayBuffer) {
    const target = normalize(path);
    await this.mkdir(parentOf(target), { recursive: true });
    const bytes = typeof data === "string"
      ? this.encoder.encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data);
    this.entries.set(target, { kind: "file", data: bytes, mtimeMs: Date.now() });
    this.directory(parentOf(target)).children.add(baseName(target));
  }

  private async readFile(path: string, options?: string | { encoding?: string }) {
    const entry = this.entry(path);
    if (entry.kind !== "file") throw fsError("EISDIR", path);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? this.decoder.decode(entry.data) : entry.data;
  }

  private async readdir(path: string) {
    return [...this.directory(path).children].sort();
  }

  private async unlink(path: string) {
    const target = normalize(path);
    const entry = this.entry(target);
    if (entry.kind !== "file") throw fsError("EISDIR", path);
    this.entries.delete(target);
    this.directory(parentOf(target)).children.delete(baseName(target));
  }

  private async rmdir(path: string) {
    const target = normalize(path);
    const entry = this.directory(target);
    if (entry.children.size > 0) throw fsError("ENOTEMPTY", path);
    this.entries.delete(target);
    this.directory(parentOf(target)).children.delete(baseName(target));
  }

  private async stat(path: string) {
    return new MemoryStats(this.entry(path));
  }
}
