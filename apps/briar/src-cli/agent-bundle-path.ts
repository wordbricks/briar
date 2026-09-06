import { stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Candidate locations for a built agent bundle, relative to the module that
 * asks for it. The installed layout keeps `briar.js` beside an `agent/`
 * directory, so the CLI finds bundles under `agent/`. The Computer Use MCP
 * server is one of those bundles and runs from inside `agent/`, so it finds
 * its siblings next to itself. A checkout keeps every bundle in `dist-agent/`.
 */
export function agentBundleCandidates(
  moduleDirectory: string,
  fileName: string,
): string[] {
  return [
    resolve(moduleDirectory, "agent", fileName),
    resolve(moduleDirectory, fileName),
    resolve(moduleDirectory, "..", "dist-agent", fileName),
  ];
}

const isFile = (path: string): Promise<boolean> =>
  stat(path).then((metadata) => metadata.isFile(), () => false);

/** First existing candidate for `fileName`, or null when none was built. */
export async function findAgentBundle(
  moduleDirectory: string,
  fileName: string,
  exists: (path: string) => Promise<boolean> = isFile,
): Promise<string | null> {
  for (const candidate of agentBundleCandidates(moduleDirectory, fileName)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
