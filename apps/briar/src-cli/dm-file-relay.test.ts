import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { exchangeDmFileRelay, startDmFileRelay } from "./dm-file-relay";

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), "dm-relay-"));
  const socketPath = join(workspace, "invocation.sock");
  const sockets = new Set<Socket>();
  const requests: Buffer[] = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      const request = Buffer.concat(chunks);
      requests.push(request);
      if (request[0] === 0x7e) return; // Keep this request pending until relay cleanup.
      if (request[0] === 0x7f) socket.end(request); // Opaque binary authority/payload is unchanged.
      else socket.destroy(); // Invocation authority is checked by the fixed upstream server.
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  const relay = await startDmFileRelay(workspace, socketPath);
  return { workspace, requests, relay, sockets, cleanup: async () => {
    await relay.cleanup();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  } };
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await readFile(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await delay(20);
  }
  throw new Error("test_file_timeout");
}

describe("DM workspace file relay", () => {
  it("preserves binary frames through the fixed socket and reports rejected authority", async () => {
    const f = await fixture();
    try {
      const request = Uint8Array.from([0x7f, 0, 0xff, 0x80, 0x0a]);
      expect(await exchangeDmFileRelay(f.relay.directory, request)).toEqual(Buffer.from(request));
      expect(f.requests).toEqual([Buffer.from(request)]);
      await expect(exchangeDmFileRelay(f.relay.directory, Uint8Array.from([0, 1])))
        .rejects.toThrow("dm_file_relay_failed");
      expect(await readdir(f.relay.directory)).toEqual([]);
      expect((await lstat(f.relay.directory)).mode & 0o777).toBe(0o700);
    } finally { await f.cleanup(); }
  });

  it("rejects oversized and symlink requests without forwarding and only removes its own directory", async () => {
    const f = await fixture();
    try {
      await expect(exchangeDmFileRelay(f.relay.directory, new Uint8Array(128 * 1024 + 1)))
        .rejects.toThrow("dm_file_relay_payload_invalid");
      const marker = join(f.workspace, "keep");
      await writeFile(marker, "untouched");
      const id = randomUUID();
      await symlink(marker, join(f.relay.directory, `${id}.request`));
      expect(await waitForFile(join(f.relay.directory, `${id}.error`))).toMatch(/dm_file_relay_/u);
      expect(f.requests).toHaveLength(0);
      const tooLarge = randomUUID();
      await writeFile(join(f.relay.directory, `${tooLarge}.request`), new Uint8Array(128 * 1024 + 1));
      expect(await waitForFile(join(f.relay.directory, `${tooLarge}.error`))).toBe("dm_file_relay_file_invalid");
      expect(f.requests).toHaveLength(0);
      await f.relay.cleanup();
      await f.relay.cleanup();
      await expect(lstat(f.relay.directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(marker, "utf8")).toBe("untouched");
    } finally { await f.cleanup(); }
  });
  it("bounds live socket exchanges and closes pending work during cleanup", async () => {
    const f = await fixture();
    try {
      for (let index = 0; index < 8; index++) {
        await writeFile(join(f.relay.directory, `${randomUUID()}.request`), Uint8Array.from([0x7e]));
      }
      for (let attempt = 0; f.requests.length < 8 && attempt < 100; attempt++) await delay(20);
      expect(f.requests).toHaveLength(8);
      await expect(exchangeDmFileRelay(f.relay.directory, Uint8Array.from([0x7f])))
        .rejects.toThrow("dm_file_relay_busy");
      expect(f.requests).toHaveLength(8);
      await f.relay.cleanup();
      for (const socket of f.sockets) socket.end(Buffer.from([1]));
      for (let attempt = 0; f.sockets.size && attempt < 20; attempt++) await delay(10);
      expect(f.sockets.size).toBe(0);
      await expect(lstat(f.relay.directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.cleanup(); }
  });

});
