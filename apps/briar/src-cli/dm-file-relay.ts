import { randomUUID } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import { chmod, lstat, mkdtemp, open, opendir, rename, rm, unlink } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MAX_BYTES = 128 * 1024;
const MAX_CONCURRENT = 8;
const MAX_FILES = 64;
const DEADLINE_MS = 20_000;
const requestName = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.request$/u;

async function assertDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("dm_file_relay_directory_invalid");
}

async function readPrivateFile(path: string) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("dm_file_relay_file_invalid");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.ino !== before.ino || info.dev !== before.dev ||
        info.size < 1 || info.size > MAX_BYTES) {
      throw new Error("dm_file_relay_file_invalid");
    }
    // A concurrent writer cannot cause an unbounded read after the initial stat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 1 || bytesRead > MAX_BYTES) throw new Error("dm_file_relay_payload_invalid");
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function atomicWrite(directory: string, name: string, bytes: Uint8Array) {
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    await rename(temporary, join(directory, name));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function exchangeSocket(socketPath: string, request: Uint8Array, sockets: Set<Socket>) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const socket = connect(socketPath);
    sockets.add(socket);
    let bytes = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      sockets.delete(socket);
      socket.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, bytes));
    };
    const timeout = setTimeout(() => finish(new Error("dm_file_relay_socket_timeout")), DEADLINE_MS);
    socket.once("connect", () => socket.end(request));
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) return finish(new Error("dm_file_relay_response_too_large"));
      chunks.push(chunk);
    });
    socket.once("end", () => finish(bytes ? undefined : new Error("dm_file_relay_empty_response")));
    socket.once("error", () => finish(new Error("dm_file_relay_socket_failed")));
    socket.once("close", () => finish(new Error("dm_file_relay_socket_closed")));
  });
}

/** Relays opaque authenticated protobuf frames to one invocation's fixed socket. */
export async function startDmFileRelay(workspacePath: string, socketPath: string): Promise<{
  directory: string; cleanup(): Promise<void>;
}> {
  const directory = await mkdtemp(join(workspacePath, ".briar-dm-relay-"));
  await chmod(directory, 0o700);
  const sockets = new Set<Socket>();
  const tasks = new Set<Promise<void>>();
  const retained = new Map<string, number>();
  const active = new Set<string>();
  let closed = false;
  let scanning: Promise<void> | null = null;
  let watcher: FSWatcher | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const processRequest = async (name: string, id: string, overloaded: boolean) => {
    try {
      if (overloaded) throw new Error("dm_file_relay_busy");
      const request = await readPrivateFile(join(directory, name));
      if (closed) return;
      const response = await exchangeSocket(socketPath, request, sockets);
      if (!closed) await atomicWrite(directory, `${id}.response`, response);
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error && error.message.startsWith("dm_file_relay_")
          ? error.message : "dm_file_relay_request_failed";
        await atomicWrite(directory, `${id}.error`, Buffer.from(message)).catch(() => undefined);
      }
    } finally {
      await unlink(join(directory, name)).catch(() => undefined);
    }
  };
  const scan = () => {
    if (closed || scanning) return;
    scanning = (async () => {
      await assertDirectory(directory);
      for (const [id, started] of retained) {
        if (active.has(id)) continue;
        const present = await Promise.all(["response", "error"].map((suffix) =>
          lstat(join(directory, `${id}.${suffix}`)).then(() => true, () => false)));
        if (!present.some(Boolean)) { retained.delete(id); continue; }
        if (Date.now() - started < DEADLINE_MS * 2) continue;
        await Promise.all(["request", "response", "error"].map((suffix) => unlink(join(directory, `${id}.${suffix}`)).catch(() => undefined)));
        retained.delete(id);
      }
      const entries = await opendir(directory);
      let visited = 0;
      for await (const entry of entries) {
        if (closed || ++visited > MAX_FILES || retained.size >= MAX_FILES / 2) break;
        const match = requestName.exec(entry.name);
        if (!match || retained.has(match[1]!)) continue;
        const id = match[1]!;
        retained.set(id, Date.now());
        active.add(id);
        const task = processRequest(entry.name, id, tasks.size >= MAX_CONCURRENT);
        tasks.add(task);
        void task.finally(() => { tasks.delete(task); active.delete(id); });
      }
    })().catch(() => undefined).finally(() => { scanning = null; });
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    closed = true;
    watcher?.close();
    if (poll) clearInterval(poll);
    for (const socket of sockets) socket.destroy();
    await scanning;
    await Promise.allSettled([...tasks]);
    // This exact random directory is the only tree the relay owns.
    await rm(directory, { recursive: true, force: true });
  })();
  try {
    watcher = watch(directory, scan);
    watcher.on("error", scan); // Periodic scans also cover lost/coalesced notifications.
    poll = setInterval(scan, 1_000);
    poll.unref();
    scan();
    return { directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function exchangeDmFileRelay(directory: string, request: Uint8Array): Promise<Uint8Array> {
  if (request.byteLength < 1 || request.byteLength > MAX_BYTES) throw new Error("dm_file_relay_payload_invalid");
  await assertDirectory(directory);
  const id = randomUUID();
  const paths = ["request", "response", "error"].map((suffix) => join(directory, `${id}.${suffix}`));
  const deadline = Date.now() + DEADLINE_MS;
  try {
    await atomicWrite(directory, `${id}.request`, request);
    while (Date.now() < deadline) {
      for (const [suffix, path] of [["error", paths[2]!], ["response", paths[1]!]] as const) {
        let bytes: Uint8Array;
        try { bytes = await readPrivateFile(path); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (suffix === "error") throw new Error(`dm_file_relay_failed: ${Buffer.from(bytes).toString("utf8").slice(0, 200)}`);
        return bytes;
      }
      await delay(25);
    }
    throw new Error("dm_file_relay_timeout");
  } finally {
    await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
  }
}
