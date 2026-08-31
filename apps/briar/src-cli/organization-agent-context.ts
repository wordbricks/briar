import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  decodeOrganizationAgentContextLookupResponse,
  decodeOrganizationAgentContextManifest,
  type OrganizationAgentContextLookupRequest,
  type OrganizationAgentContextManifest as OrganizationAgentContextIndexManifest,
} from "../src/lib/organization-agent-context-contract";

export const organizationAgentContextDirectoryName =
  ".briar-organization-context";
const organizationAgentWorkspaceOwnerName = ".briar-workspace-owner.json";
const organizationAgentWorkspacePattern =
  /^channel-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unownedWorkspaceGraceMs = 60 * 60 * 1_000;

type ContextFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const defaultMaxPageBytes = 2 * 1024 * 1024;
const defaultMaxContextBytes = 512 * 1024 * 1024;

export function organizationAgentContextDirectory(workspacePath: string) {
  return join(workspacePath, organizationAgentContextDirectoryName);
}

export async function cleanupOrganizationAgentContext(workspacePath: string) {
  await rm(organizationAgentContextDirectory(workspacePath), {
    recursive: true,
    force: true,
  });
}

export async function prepareOrganizationAgentWorkspace(
  workspacePath: string,
  ownerPid = process.pid,
  options: { reuse?: boolean; retainedUntil?: string } = {},
) {
  if (!options.reuse) {
    await rm(workspacePath, { recursive: true, force: true });
  } else {
    try {
      const metadata = await lstat(workspacePath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        await rm(workspacePath, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await mkdir(workspacePath, { recursive: true, mode: 0o700 });
  await chmod(workspacePath, 0o700);
  const ownerPath = join(workspacePath, organizationAgentWorkspaceOwnerName);
  const observedAt = new Date().toISOString();
  await writeFile(
    ownerPath,
    `${JSON.stringify({
      pid: ownerPid,
      createdAt: observedAt,
      lastUsedAt: observedAt,
      retainedUntil: options.retainedUntil ?? observedAt,
    })}\n`,
    { mode: 0o600 },
  );
  await chmod(ownerPath, 0o600);
}

const localProcessIsAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

/** Removes claim workspaces whose owning Worker process is no longer alive. */
export async function cleanupOrphanedOrganizationAgentWorkspaces(input: {
  workerSessionsDirectory: string;
  now?: number;
  isProcessAlive?: (pid: number) => boolean;
}) {
  let entries;
  try {
    entries = await readdir(input.workerSessionsDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const now = input.now ?? Date.now();
  const isProcessAlive = input.isProcessAlive ?? localProcessIsAlive;
  for (const entry of entries) {
    if (!organizationAgentWorkspacePattern.test(entry.name)) continue;
    const workspacePath = join(input.workerSessionsDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      await rm(workspacePath, { force: true });
      continue;
    }
    if (!entry.isDirectory()) continue;
    let ownerPid: number | null = null;
    let retainedUntil: number | null = null;
    try {
      const owner = JSON.parse(
        await readFile(
          join(workspacePath, organizationAgentWorkspaceOwnerName),
          "utf8",
        ),
      ) as { pid?: unknown; retainedUntil?: unknown };
      if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
        ownerPid = Number(owner.pid);
      }
      if (
        typeof owner.retainedUntil === "string" &&
        Number.isFinite(Date.parse(owner.retainedUntil))
      ) {
        retainedUntil = Date.parse(owner.retainedUntil);
      }
    } catch {
      const metadata = await lstat(workspacePath);
      if (now - metadata.mtimeMs < unownedWorkspaceGraceMs) continue;
    }
    if (ownerPid !== null && isProcessAlive(ownerPid)) continue;
    if (retainedUntil !== null && retainedUntil > now) continue;
    await rm(workspacePath, { recursive: true, force: true });
  }
}

const encodedPage = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const contextFilePath = (directory: string, relativePath: string) => {
  const root = resolve(directory);
  const target = resolve(root, relativePath);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error("Organization Agent context path escaped its workspace");
  }
  return target;
};

const boundedResponseText = async (
  response: Response,
  maxBytes: number,
  resource: string,
) => {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let contents = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Organization Agent ${resource} context page is too large`);
    }
    contents += decoder.decode(value, { stream: true });
  }
  return contents + decoder.decode();
};

type OrganizationContextManifestCacheEntry = {
  etag: string;
  revision: string;
  projects: OrganizationAgentContextIndexManifest["projects"];
};

const organizationContextManifestCache = new Map<
  string,
  OrganizationContextManifestCacheEntry
>();
const maxOrganizationContextManifestCacheEntries = 16;

const rememberOrganizationContextManifest = (
  cacheKey: string,
  entry: OrganizationContextManifestCacheEntry,
) => {
  organizationContextManifestCache.delete(cacheKey);
  organizationContextManifestCache.set(cacheKey, entry);
  while (
    organizationContextManifestCache.size >
      maxOrganizationContextManifestCacheEntries
  ) {
    const oldest = organizationContextManifestCache.keys().next().value;
    if (typeof oldest !== "string") break;
    organizationContextManifestCache.delete(oldest);
  }
};

/**
 * Prepares only the lightweight organization index. Detailed context remains
 * server-side until hydrateOrganizationAgentContext is called with a bounded,
 * model-selected request.
 */
export async function downloadOrganizationAgentContextManifest(input: {
  apiUrl: string;
  workerToken: string;
  organizationId: string;
  workId: string;
  workerId: string;
  claimToken: string;
  snapshotAt: string;
  workspacePath: string;
  signal?: AbortSignal;
  fetcher?: ContextFetcher;
  maxPageBytes?: number;
}) {
  const directory = organizationAgentContextDirectory(input.workspacePath);
  const fetcher = input.fetcher ?? fetch;
  const cacheKey = `${input.apiUrl.replace(/\/$/u, "")}:${input.organizationId}`;
  const cached = organizationContextManifestCache.get(cacheKey);
  await cleanupOrganizationAgentContext(input.workspacePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    const query = new URLSearchParams({ workerId: input.workerId });
    const response = await fetcher(
      `${input.apiUrl.replace(/\/$/u, "")}/organizations/${input.organizationId}/channel-reply-claims/${input.workId}/organization-context/manifest?${query}`,
      {
        redirect: "error",
        signal: input.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.workerToken}`,
          [channelReplyClaimTokenHeader]: input.claimToken,
          ...(cached ? { "If-None-Match": cached.etag } : {}),
        },
      },
    );
    let manifest: OrganizationAgentContextIndexManifest;
    if (response.status === 304) {
      if (!cached) {
        throw new Error("Organization Agent manifest cache is missing");
      }
      manifest = decodeOrganizationAgentContextManifest({
        schemaVersion: 2,
        organizationId: input.organizationId,
        workId: input.workId,
        snapshotAt: input.snapshotAt,
        revision: cached.revision,
        projects: cached.projects,
        loadedQueries: [],
      });
    } else {
      if (!response.ok) {
        throw new Error(
          `Organization Agent manifest download failed (${response.status})`,
        );
      }
      const text = await boundedResponseText(
        response,
        input.maxPageBytes ?? defaultMaxPageBytes,
        "manifest",
      );
      manifest = decodeOrganizationAgentContextManifest(JSON.parse(text));
      if (
        manifest.organizationId !== input.organizationId ||
        manifest.workId !== input.workId ||
        manifest.snapshotAt !== input.snapshotAt
      ) {
        throw new Error("Organization Agent manifest scope changed");
      }
      const etag = response.headers.get("ETag");
      if (etag) {
        rememberOrganizationContextManifest(cacheKey, {
          etag,
          revision: manifest.revision,
          projects: manifest.projects,
        });
      }
    }
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, encodedPage(manifest), { mode: 0o600 });
    await chmod(manifestPath, 0o600);
    return { directory, manifestPath, manifest };
  } catch (error) {
    await cleanupOrganizationAgentContext(input.workspacePath);
    throw error;
  }
}

export async function hydrateOrganizationAgentContext(input: {
  apiUrl: string;
  workerToken: string;
  organizationId: string;
  workId: string;
  workerId: string;
  claimToken: string;
  snapshotAt: string;
  workspacePath: string;
  requests: OrganizationAgentContextLookupRequest[];
  signal?: AbortSignal;
  fetcher?: ContextFetcher;
  maxContextBytes?: number;
}) {
  const directory = organizationAgentContextDirectory(input.workspacePath);
  const manifestPath = join(directory, "manifest.json");
  const manifest = decodeOrganizationAgentContextManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (
    manifest.organizationId !== input.organizationId ||
    manifest.workId !== input.workId ||
    manifest.snapshotAt !== input.snapshotAt
  ) {
    throw new Error("Organization Agent manifest scope changed");
  }
  const loaded = new Set(
    manifest.loadedQueries.map((item) => JSON.stringify(item.request)),
  );
  const requests = input.requests.filter(
    (request) => !loaded.has(JSON.stringify(request)),
  );
  if (requests.length === 0) return { manifestPath, manifest, loaded: 0 };
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `${input.apiUrl.replace(/\/$/u, "")}/organizations/${input.organizationId}/channel-reply-claims/${input.workId}/organization-context/lookup`,
    {
      method: "POST",
      redirect: "error",
      signal: input.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.workerToken}`,
        [channelReplyClaimTokenHeader]: input.claimToken,
      },
      body: JSON.stringify({ workerId: input.workerId, requests }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Organization Agent context lookup failed (${response.status})`,
    );
  }
  const text = await boundedResponseText(
    response,
    input.maxContextBytes ?? defaultMaxContextBytes,
    "lookup",
  );
  const lookup = decodeOrganizationAgentContextLookupResponse(
    JSON.parse(text),
  );
  if (
    lookup.organizationId !== input.organizationId ||
    lookup.workId !== input.workId ||
    lookup.snapshotAt !== input.snapshotAt
  ) {
    throw new Error("Organization Agent lookup scope changed");
  }
  if (
    lookup.results.length !== requests.length ||
    lookup.results.some((result, index) =>
      JSON.stringify(result.request) !== JSON.stringify(requests[index])
    )
  ) {
    throw new Error("Organization Agent lookup response did not match its request");
  }
  const nextLoadedQueries = [...manifest.loadedQueries];
  let contextBytes = new TextEncoder().encode(encodedPage(manifest)).byteLength;
  for (const loadedQuery of manifest.loadedQueries) {
    const loadedPath = contextFilePath(directory, loadedQuery.file);
    contextBytes += new TextEncoder().encode(
      await readFile(loadedPath, "utf8"),
    ).byteLength;
  }
  for (const result of lookup.results) {
    const relativePath = join(
      "lookups",
      `query-${String(nextLoadedQueries.length + 1).padStart(6, "0")}.json`,
    );
    const absolutePath = contextFilePath(directory, relativePath);
    const serialized = encodedPage(result);
    contextBytes += new TextEncoder().encode(serialized).byteLength;
    if (contextBytes > (input.maxContextBytes ?? defaultMaxContextBytes)) {
      throw new Error("Organization Agent context exceeds the local size limit");
    }
    await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, serialized, { mode: 0o600 });
    await chmod(absolutePath, 0o600);
    nextLoadedQueries.push({ file: relativePath, request: result.request });
  }
  const nextManifest = decodeOrganizationAgentContextManifest({
    ...manifest,
    loadedQueries: nextLoadedQueries,
  });
  const temporaryManifestPath = join(directory, "manifest.partial.json");
  await writeFile(temporaryManifestPath, encodedPage(nextManifest), {
    mode: 0o600,
  });
  await chmod(temporaryManifestPath, 0o600);
  await rename(temporaryManifestPath, manifestPath);
  await chmod(manifestPath, 0o600);
  return {
    manifestPath,
    manifest: nextManifest,
    loaded: lookup.results.length,
  };
}
