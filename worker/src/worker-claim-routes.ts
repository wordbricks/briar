import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import { HttpError, json } from "./http-response";
import { claimNextIssueReplyWork } from "./issue-reply-worker-routes";
import { claimNextProjectAgentTaskWork } from "./project-agent-task-worker-routes";
import { claimNextQueueWork } from "./queue-claim-routes";
import { readJson } from "./request-readers";
import { requireWorkerProjectBinding } from "./worker-route-auth";
import { decodeWorkerClaimInput } from "./worker-request-contract";

async function workFrom(response: Response) {
  if (!response.ok) {
    throw new HttpError(response.status, "Worker claim failed");
  }
  return (await response.json<{ work: unknown }>()).work;
}

export async function handleWorkerClaimRoute(input: {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, db, attachmentsBucket, env, context } = input;
  if (url.pathname !== "/worker-claims" || request.method !== "POST") {
    return undefined;
  }

  const claimInput = decodeWorkerClaimInput(await readJson(request));
  const authenticatedWorker = await requireWorkerProjectBinding(
    db,
    request,
    claimInput.projectId,
    claimInput.workerId,
  );
  const claims: Array<() => Promise<Response>> = [
    () => claimNextIssueReplyWork({
      request,
      url,
      claimInput,
      db,
      attachmentsBucket,
      env,
      context,
      authenticatedWorker,
    }),
    () => claimNextProjectAgentTaskWork({
      request,
      url,
      claimInput: {
        workerId: claimInput.workerId,
        projectId: claimInput.projectId,
      },
      db,
      env,
      context,
      authenticatedWorker,
    }),
    () => claimNextChannelReplyWork({
      request,
      input: {
        organizationId: authenticatedWorker.principal.organizationId,
        workerId: claimInput.workerId,
      },
      db,
      env,
      context,
      authenticatedWorker,
    }),
    () => claimNextQueueWork({
      request,
      url,
      claimInput,
      db,
      env,
      authenticatedWorker,
    }),
  ];

  for (const claim of claims) {
    const work = await workFrom(await claim());
    if (work !== null) return json({ work });
  }
  return json({ work: null, retryAfterMs: 15_000 });
}
