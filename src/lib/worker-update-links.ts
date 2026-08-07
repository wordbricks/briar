import { isSemanticVersion } from "./semantic-version";
import { listenForLinks } from "./issue-links";

const requestIdPattern = /^[0-9a-f-]{36}$/iu;

export type WorkerUpdateLinkTarget = {
  requestId: string;
  targetVersion: string;
};

export function parseWorkerUpdateLink(
  value: string,
): WorkerUpdateLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "briar-companion:" || url.hostname !== "worker-update") {
    return null;
  }
  const requestId = url.pathname.replace(/^\//u, "");
  const targetVersion = url.searchParams.get("target") ?? "";
  return requestIdPattern.test(requestId) && isSemanticVersion(targetVersion)
    ? { requestId, targetVersion }
    : null;
}

export function listenForWorkerUpdateLinks(
  onLink: (target: WorkerUpdateLinkTarget) => void,
): () => void {
  return listenForLinks(parseWorkerUpdateLink, onLink);
}
