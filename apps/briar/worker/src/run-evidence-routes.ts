import { getArchivedEvidenceImage, listArchivedRunEvidence } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getProject,
  getRunEvidenceImage,
  listRunEvidence,
  listRunEvidenceImages,
  listRunStageRevisions,
  type RunEvidenceImageRow,
} from "./db";
import { HttpError } from "./http-response";
import { issueAttachmentResponse } from "./issue-attachment-service";
import { runEvidenceJson } from "./run-evidence-json";

type RequireRunExecutionProject = (
  db: D1Database,
  request: Request,
  runId: string,
) => Promise<string>;

type RequireProjectAccess = (
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  projectId: string,
) => Promise<void>;

const isWorkerRequest = (request: Request) =>
  request.headers.get("authorization")?.startsWith(
    "Bearer briar_worker_",
  ) ?? false;

export async function listProjectRunEvidence(input: {
  db: D1Database;
  archivesBucket: R2Bucket;
  projectId: string;
  runId: string;
  userId: string;
}) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) throw new HttpError(404, "Project not found");
  const [hotEvidence, revisions, hotImages, archived] = await Promise.all([
    listRunEvidence(input.db, project.id, input.runId),
    listRunStageRevisions(input.db, project.id, input.runId),
    listRunEvidenceImages(input.db, project.id, input.runId),
    listArchivedRunEvidence(
      input.db,
      input.archivesBucket,
      project.id,
      input.runId,
    ),
  ]);
  if (!hotEvidence || !revisions || !hotImages) {
    throw new HttpError(404, "Run not found");
  }
  const evidence = [
    ...new Map(
      [...archived.evidence, ...hotEvidence].map((item) => [item.id, item]),
    ).values(),
  ].sort(
    (left, right) =>
      left.observed_at.localeCompare(right.observed_at) ||
      left.id.localeCompare(right.id),
  );
  const images = [
    ...new Map(
      [...archived.images, ...hotImages].map((item) => [item.id, item]),
    ).values(),
  ];
  const imagesByEvidence = new Map<string, RunEvidenceImageRow[]>();
  for (const image of images) {
    const evidenceImages = imagesByEvidence.get(image.evidence_id) ?? [];
    evidenceImages.push(image);
    imagesByEvidence.set(image.evidence_id, evidenceImages);
  }
  return {
    runId: input.runId,
    attempt: revisions.attempt,
    revision: revisions.revision,
    evidence: evidence.map((item) =>
      runEvidenceJson(
        item,
        revisions.requirements.get(item.workflow_stage) ?? 1,
        imagesByEvidence.get(item.id) ?? [],
      )
    ),
  };
}

export async function handleRunEvidenceRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  archivesBucket: R2Bucket;
  requireRunExecutionProject: RequireRunExecutionProject;
  requireProjectAccess: RequireProjectAccess;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket,
    requireRunExecutionProject,
    requireProjectAccess,
  } = input;

  const projectEvidenceImageMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/evidence\/images\/([0-9a-f-]+)$/u,
  );
  if (
    projectEvidenceImageMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    if (isWorkerRequest(request)) {
      if (
        (await requireRunExecutionProject(
          db,
          request,
          projectEvidenceImageMatch[2],
        )) !== projectEvidenceImageMatch[1]
      ) {
        throw new HttpError(404, "Evidence image not found");
      }
    } else {
      await requireProjectAccess(
        auth,
        db,
        request,
        projectEvidenceImageMatch[1],
      );
    }
    const image = (await getRunEvidenceImage(
      db,
      projectEvidenceImageMatch[1],
      projectEvidenceImageMatch[2],
      projectEvidenceImageMatch[3],
    )) ?? (await getArchivedEvidenceImage(
      db,
      archivesBucket,
      projectEvidenceImageMatch[1],
      projectEvidenceImageMatch[2],
      projectEvidenceImageMatch[3],
    ));
    if (!image) throw new HttpError(404, "Evidence image not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(image.object_key);
      if (!object) throw new HttpError(404, "Evidence image not found");
      return issueAttachmentResponse(image, object, null);
    }
    const object = await attachmentsBucket.get(image.object_key);
    if (!object) throw new HttpError(404, "Evidence image not found");
    return issueAttachmentResponse(image, object, object.body);
  }

  return undefined;
}
