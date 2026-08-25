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
import * as Schema from "effect/Schema";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  decodeOrganizationAgentContextLookupResponse,
  decodeOrganizationAgentContextManifest,
  decodeOrganizationAgentContextResourcePage,
  type OrganizationAgentContextLookupRequest,
  type OrganizationAgentContextManifest as OrganizationAgentContextIndexManifest,
  type OrganizationAgentContextResource,
} from "../src/lib/organization-agent-context-contract";

export const organizationAgentContextDirectoryName =
  ".briar-organization-context";
const organizationAgentWorkspaceOwnerName = ".briar-workspace-owner.json";
const organizationAgentWorkspacePattern =
  /^channel-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unownedWorkspaceGraceMs = 60 * 60 * 1_000;

type ContextResource = OrganizationAgentContextResource;

const preserveExcessProperties = {
  onExcessProperty: "preserve",
} as const;

const passthrough = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: preserveExcessProperties });

const ContextItemId = Schema.String.check(Schema.isLengthBetween(1, 128));

const ProjectIdentity = passthrough(Schema.Struct({
  id: Schema.mutableKey(Schema.String.check(Schema.isUUID())),
}));

const ContextItemIdentity = passthrough(Schema.Struct({
  id: Schema.mutableKey(ContextItemId),
}));

const IssuePullRequestIdentity = passthrough(Schema.Struct({
  issueId: Schema.mutableKey(ContextItemId),
  position: Schema.mutableKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
}));

const decodeProjectIdentity = Schema.decodeUnknownSync(ProjectIdentity);
const decodeContextItemIdentity = Schema.decodeUnknownSync(ContextItemIdentity);
const decodeIssuePullRequestIdentity = Schema.decodeUnknownSync(
  IssuePullRequestIdentity,
);

export type OrganizationAgentContextManifest = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  complete: true;
  collections: {
    projects: ContextCollectionManifest;
    agents: ContextProjectCollectionManifest;
    issues: ContextProjectCollectionManifest;
    issuePullRequests: ContextProjectCollectionManifest;
    agentSessions: ContextProjectCollectionManifest;
  };
  retention: {
    agentSessions: string;
  };
  consistency: {
    snapshot: string;
  };
};

type ContextCollectionManifest = {
  total: number;
  pages: string[];
};

type ContextProjectCollectionManifest = {
  total: number;
  projects: Array<{
    projectId: string;
    total: number;
    pages: string[];
  }>;
};

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

const relativePagePath = (
  resource: ContextResource,
  pageNumber: number,
  projectId: string | null,
) => {
  const filename = `page-${String(pageNumber).padStart(6, "0")}.json`;
  if (resource === "projects") return join("projects", filename);
  if (!projectId) throw new Error(`${resource} context requires a project`);
  return join("projects", projectId, resource, filename);
};

export async function downloadOrganizationAgentContext(input: {
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
  pageLimit?: number;
  maxPageBytes?: number;
  maxContextBytes?: number;
}) {
  const directory = organizationAgentContextDirectory(input.workspacePath);
  const fetcher = input.fetcher ?? fetch;
  const pageLimit = input.pageLimit ?? 25;
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 50) {
    throw new Error("Organization context page limit is invalid");
  }
  const maxPageBytes = input.maxPageBytes ?? defaultMaxPageBytes;
  const maxContextBytes = input.maxContextBytes ?? defaultMaxContextBytes;
  let contextBytes = 0;

  await cleanupOrganizationAgentContext(input.workspacePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const fetchCollection = async (
    resource: ContextResource,
    projectId: string | null,
  ): Promise<ContextCollectionManifest & { projectIds: string[] }> => {
    let cursor: string | null = null;
    let expectedTotal: number | null = null;
    let itemCount = 0;
    let pageNumber = 0;
    const seenCursors = new Set<string>();
    const pages: string[] = [];
    const projectIds: string[] = [];
    const seenProjectIds = new Set<string>();
    const seenItemIds = new Set<string>();

    do {
      input.signal?.throwIfAborted();
      const query = new URLSearchParams({
        workerId: input.workerId,
        limit: String(pageLimit),
      });
      if (cursor) query.set("cursor", cursor);
      const basePath =
        `/organizations/${input.organizationId}/channel-reply-claims/${input.workId}/organization-context`;
      const resourcePath = resource === "projects"
        ? `${basePath}/projects`
        : `${basePath}/projects/${projectId}/${resource}`;
      const response = await fetcher(
        `${input.apiUrl.replace(/\/$/u, "")}${resourcePath}?${query}`,
        {
          redirect: "error",
          signal: input.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.workerToken}`,
            [channelReplyClaimTokenHeader]: input.claimToken,
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Organization Agent ${resource} context download failed (${response.status})`,
        );
      }
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxPageBytes) {
        throw new Error(`Organization Agent ${resource} context page is too large`);
      }
      const text = await boundedResponseText(response, maxPageBytes, resource);
      const page = decodeOrganizationAgentContextResourcePage(
        JSON.parse(text),
      );
      if (
        page.organizationId !== input.organizationId ||
        page.workId !== input.workId ||
        page.resource !== resource ||
        page.projectId !== projectId ||
        page.snapshotAt !== input.snapshotAt
      ) {
        throw new Error(`Organization Agent ${resource} context scope changed`);
      }
      if (page.complete !== (page.nextCursor === null)) {
        throw new Error(`Organization Agent ${resource} context page is incomplete`);
      }
      if (!page.complete && page.items.length === 0) {
        throw new Error(`Organization Agent ${resource} context made no progress`);
      }
      if (expectedTotal === null) expectedTotal = page.total;
      if (page.total !== expectedTotal) {
        throw new Error(`Organization Agent ${resource} context total changed`);
      }
      itemCount += page.items.length;
      if (itemCount > page.total) {
        throw new Error(`Organization Agent ${resource} context exceeded its total`);
      }
      if (resource === "projects") {
        for (const rawItem of page.items) {
          const project = decodeProjectIdentity(rawItem);
          if (seenProjectIds.has(project.id)) {
            throw new Error("Organization Agent project context contains duplicates");
          }
          seenProjectIds.add(project.id);
          projectIds.push(project.id);
        }
      } else {
        for (const rawItem of page.items) {
          const itemId = resource === "issue-pull-requests"
            ? (() => {
                const item = decodeIssuePullRequestIdentity(rawItem);
                return `${item.issueId}:${item.position}`;
              })()
            : decodeContextItemIdentity(rawItem).id;
          if (seenItemIds.has(itemId)) {
            throw new Error(
              `Organization Agent ${resource} context contains duplicates`,
            );
          }
          seenItemIds.add(itemId);
        }
      }

      pageNumber += 1;
      const relativePath = relativePagePath(resource, pageNumber, projectId);
      const absolutePath = contextFilePath(directory, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
      const serialized = encodedPage(page);
      const serializedBytes = new TextEncoder().encode(serialized).byteLength;
      contextBytes += serializedBytes;
      if (contextBytes > maxContextBytes) {
        throw new Error("Organization Agent context exceeds the local size limit");
      }
      await writeFile(absolutePath, serialized, { mode: 0o600 });
      await chmod(absolutePath, 0o600);
      pages.push(relativePath);

      cursor = page.nextCursor;
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new Error(`Organization Agent ${resource} context cursor repeated`);
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== null);

    if (itemCount !== (expectedTotal ?? 0)) {
      throw new Error(`Organization Agent ${resource} context is incomplete`);
    }
    return { total: itemCount, pages, projectIds };
  };

  try {
    const projects = await fetchCollection("projects", null);
    const agents: ContextProjectCollectionManifest = { total: 0, projects: [] };
    const issues: ContextProjectCollectionManifest = { total: 0, projects: [] };
    const issuePullRequests: ContextProjectCollectionManifest = {
      total: 0,
      projects: [],
    };
    const agentSessions: ContextProjectCollectionManifest = {
      total: 0,
      projects: [],
    };
    for (const projectId of projects.projectIds) {
      const projectAgents = await fetchCollection("agents", projectId);
      agents.total += projectAgents.total;
      agents.projects.push({
        projectId,
        total: projectAgents.total,
        pages: projectAgents.pages,
      });
      const projectIssues = await fetchCollection("issues", projectId);
      issues.total += projectIssues.total;
      issues.projects.push({
        projectId,
        total: projectIssues.total,
        pages: projectIssues.pages,
      });
      const projectIssuePullRequests = await fetchCollection(
        "issue-pull-requests",
        projectId,
      );
      issuePullRequests.total += projectIssuePullRequests.total;
      issuePullRequests.projects.push({
        projectId,
        total: projectIssuePullRequests.total,
        pages: projectIssuePullRequests.pages,
      });
      const projectSessions = await fetchCollection(
        "agent-sessions",
        projectId,
      );
      agentSessions.total += projectSessions.total;
      agentSessions.projects.push({
        projectId,
        total: projectSessions.total,
        pages: projectSessions.pages,
      });
    }

    const manifest: OrganizationAgentContextManifest = {
      schemaVersion: 1,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      complete: true,
      collections: {
        projects: { total: projects.total, pages: projects.pages },
        agents,
        issues,
        issuePullRequests,
        agentSessions,
      },
      retention: {
        agentSessions:
          "Includes every hot or archived Project Agent session retained by Briar at snapshot time; sessions older than the configured retention period may already have expired.",
      },
      consistency: {
        snapshot:
          "Membership excludes records first visible after snapshotAt. Records deleted or expired before their collection is paged are no longer retained and therefore are not included.",
      },
    };
    const temporaryManifestPath = join(directory, "manifest.partial.json");
    const manifestPath = join(directory, "manifest.json");
    await writeFile(temporaryManifestPath, encodedPage(manifest), {
      mode: 0o600,
    });
    await chmod(temporaryManifestPath, 0o600);
    await rename(temporaryManifestPath, manifestPath);
    await chmod(manifestPath, 0o600);
    return { directory, manifestPath, manifest };
  } catch (error) {
    await cleanupOrganizationAgentContext(input.workspacePath);
    throw error;
  }
}

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
