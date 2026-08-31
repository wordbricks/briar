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
import {
  create,
  equals,
  toJson,
} from "@bufbuild/protobuf";
import { timestampDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  OrganizationAgentContextLookupSchema,
  OrganizationAgentContextService,
  type OrganizationAgentContextManifest,
} from "@briar/contracts/gen/briar/worker/v1/organization_agent_context_pb";
import type { Client } from "@connectrpc/connect";
import {
  decodeOrganizationAgentContextManifest,
  type OrganizationAgentContextLookupRequest,
  type OrganizationAgentContextManifest as OrganizationAgentContextIndexManifest,
} from "../src/lib/organization-agent-context-contract";
import { createAuthenticatedConnectClient } from "./connect-client";

export const organizationAgentContextDirectoryName =
  ".briar-organization-context";
const organizationAgentWorkspaceOwnerName = ".briar-workspace-owner.json";
const organizationAgentWorkspacePattern =
  /^channel-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unownedWorkspaceGraceMs = 60 * 60 * 1_000;

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

type OrganizationContextManifestCacheEntry = {
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

export type OrganizationAgentContextClient = Pick<
  Client<typeof OrganizationAgentContextService>,
  "getManifest" | "lookup"
>;

const organizationContextClient = (input: {
  apiUrl: string;
  workerToken: string;
  client?: OrganizationAgentContextClient;
}) => input.client ?? createAuthenticatedConnectClient(
  OrganizationAgentContextService,
  input.apiUrl,
  input.workerToken,
  { binary: true },
);

const required = <T>(value: T | undefined, field: string): T => {
  if (value === undefined) {
    throw new Error(`Organization Agent context omitted ${field}`);
  }
  return value;
};

const isoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  const date = timestampDate(required(value, field));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Organization Agent context returned invalid ${field}`);
  }
  return date.toISOString();
};

const optionalIsoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => value === undefined ? null : isoTimestamp(value, field);

const manifestFromProto = (
  manifest: OrganizationAgentContextManifest,
): OrganizationAgentContextIndexManifest =>
  decodeOrganizationAgentContextManifest({
    schemaVersion: 2,
    organizationId: manifest.organizationId,
    workId: manifest.workId,
    snapshotAt: isoTimestamp(manifest.snapshotAt, "manifest.snapshot_at"),
    revision: manifest.revision,
    projects: manifest.projects.map((project) => {
      const agents = required(project.agents, "manifest.projects.agents");
      const issues = required(project.issues, "manifest.projects.issues");
      const sessions = required(project.sessions, "manifest.projects.sessions");
      return {
        id: project.id,
        name: project.name,
        issueKeyPrefix: project.issueKeyPrefix,
        createdAt: isoTimestamp(
          project.createdAt,
          "manifest.projects.created_at",
        ),
        updatedAt: isoTimestamp(
          project.updatedAt,
          "manifest.projects.updated_at",
        ),
        resources: {
          settings: {
            revision: optionalIsoTimestamp(
              project.settingsRevision,
              "manifest.projects.settings_revision",
            ),
          },
          agents: {
            count: agents.count,
            revision: optionalIsoTimestamp(
              agents.revision,
              "manifest.projects.agents.revision",
            ),
          },
          issues: {
            count: issues.count,
            openCount: issues.openCount,
            pullRequestCount: issues.pullRequestCount,
            revision: optionalIsoTimestamp(
              issues.revision,
              "manifest.projects.issues.revision",
            ),
          },
          sessions: {
            count: sessions.count,
            archivedCount: sessions.archivedCount,
            revision: optionalIsoTimestamp(
              sessions.revision,
              "manifest.projects.sessions.revision",
            ),
          },
        },
      };
    }),
    loadedQueries: [],
  });

export const organizationAgentContextLookupToProto = (
  request: OrganizationAgentContextLookupRequest,
) => {
  if (request.resource === "project-settings") {
    return create(OrganizationAgentContextLookupSchema, {
      query: {
        case: "projectSettings",
        value: { projectId: request.projectId },
      },
    });
  }
  if (request.resource === "skills") {
    return create(OrganizationAgentContextLookupSchema, {
      query: {
        case: "skills",
        value: { projectId: request.projectId, ids: request.ids },
      },
    });
  }
  if (request.resource === "issue-pull-requests") {
    return create(OrganizationAgentContextLookupSchema, {
      query: {
        case: "issuePullRequests",
        value: {
          projectId: request.projectId,
          issueIds: request.issueIds,
        },
      },
    });
  }
  if (request.resource === "agents") {
    return request.detail === "summary"
      ? create(OrganizationAgentContextLookupSchema, {
          query: {
            case: "agentSummaries",
            value: {
              projectId: request.projectId,
              limit: request.limit,
              cursor: request.cursor ?? undefined,
            },
          },
        })
      : create(OrganizationAgentContextLookupSchema, {
          query: {
            case: "agentDetails",
            value: { projectId: request.projectId, ids: request.ids },
          },
        });
  }
  if (request.resource === "issues") {
    return request.detail === "summary"
      ? create(OrganizationAgentContextLookupSchema, {
          query: {
            case: "issueSummaries",
            value: {
              projectId: request.projectId,
              limit: request.limit,
              cursor: request.cursor ?? undefined,
            },
          },
        })
      : create(OrganizationAgentContextLookupSchema, {
          query: {
            case: "issueDetails",
            value: { projectId: request.projectId, ids: request.ids },
          },
        });
  }
  return request.detail === "summary"
    ? create(OrganizationAgentContextLookupSchema, {
        query: {
          case: "sessionSummaries",
          value: {
            projectId: request.projectId,
            limit: request.limit,
            cursor: request.cursor ?? undefined,
          },
        },
      })
    : create(OrganizationAgentContextLookupSchema, {
        query: {
          case: "sessionDetails",
          value: { projectId: request.projectId, ids: request.ids },
        },
      });
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
  client?: OrganizationAgentContextClient;
}) {
  const directory = organizationAgentContextDirectory(input.workspacePath);
  const cacheKey = `${input.apiUrl.replace(/\/$/u, "")}:${input.organizationId}`;
  const cached = organizationContextManifestCache.get(cacheKey);
  const client = organizationContextClient(input);
  await cleanupOrganizationAgentContext(input.workspacePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    const response = await client.getManifest(
      {
        claim: {
          organizationId: input.organizationId,
          workId: input.workId,
          workerId: input.workerId,
          claimToken: input.claimToken,
        },
        knownRevision: cached?.revision,
      },
      { signal: input.signal },
    );
    let manifest: OrganizationAgentContextIndexManifest;
    if (response.result.case === "unchanged") {
      if (!cached) {
        throw new Error("Organization Agent manifest cache is missing");
      }
      const unchanged = response.result.value;
      const snapshotAt = isoTimestamp(
        unchanged.snapshotAt,
        "manifest.snapshot_at",
      );
      if (unchanged.revision !== cached.revision) {
        throw new Error("Organization Agent manifest cache revision changed");
      }
      manifest = decodeOrganizationAgentContextManifest({
        schemaVersion: 2,
        organizationId: unchanged.organizationId,
        workId: unchanged.workId,
        snapshotAt,
        revision: cached.revision,
        projects: cached.projects,
        loadedQueries: [],
      });
    } else if (response.result.case === "manifest") {
      manifest = manifestFromProto(response.result.value);
      rememberOrganizationContextManifest(cacheKey, {
        revision: manifest.revision,
        projects: manifest.projects,
      });
    } else {
      throw new Error("Organization Agent manifest response omitted its result");
    }
    if (
      manifest.organizationId !== input.organizationId ||
      manifest.workId !== input.workId ||
      manifest.snapshotAt !== input.snapshotAt
    ) {
      throw new Error("Organization Agent manifest scope changed");
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
  client?: OrganizationAgentContextClient;
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
  const queries = requests.map(organizationAgentContextLookupToProto);
  const lookup = await organizationContextClient(input).lookup(
    {
      claim: {
        organizationId: input.organizationId,
        workId: input.workId,
        workerId: input.workerId,
        claimToken: input.claimToken,
      },
      queries,
      requestId: crypto.randomUUID(),
    },
    { signal: input.signal },
  );
  const lookupSnapshotAt = isoTimestamp(
    lookup.snapshotAt,
    "lookup.snapshot_at",
  );
  if (
    lookup.organizationId !== input.organizationId ||
    lookup.workId !== input.workId ||
    lookupSnapshotAt !== input.snapshotAt
  ) {
    throw new Error("Organization Agent lookup scope changed");
  }
  if (
    lookup.results.length !== requests.length ||
    lookup.results.some((result, index) =>
      !result.query ||
      !equals(OrganizationAgentContextLookupSchema, result.query, queries[index])
    )
  ) {
    throw new Error("Organization Agent lookup response did not match its request");
  }
  const results = lookup.results.map((result, index) => ({
    request: requests[index],
    data: toJson(ValueSchema, required(result.data, "lookup.results.data")),
  }));
  const nextLoadedQueries = [...manifest.loadedQueries];
  let contextBytes = new TextEncoder().encode(encodedPage(manifest)).byteLength;
  for (const loadedQuery of manifest.loadedQueries) {
    const loadedPath = contextFilePath(directory, loadedQuery.file);
    contextBytes += new TextEncoder().encode(
      await readFile(loadedPath, "utf8"),
    ).byteLength;
  }
  for (const result of results) {
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
    loaded: results.length,
  };
}
