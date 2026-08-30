import {
  RecordRunEvidenceResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { contentDisposition } from "./attachment-storage";
import { sha256Bytes } from "./crypto-digest";
import {
  createRunEvidenceImages,
  EventKeyConflictError,
  HuntTransitionError,
  listEvidenceImagesForEvidence,
  recordRunEvidence,
  type RunEvidenceImageInput,
} from "./db";
import {
  HttpError,
  privateNoStoreProtobufResponse,
} from "./http-response";
import { readRunEvidenceRequest } from "./request-readers";
import { recordRunEvidenceResponseMessage } from "./run-evidence-connect";
import { evidenceImageJson } from "./run-evidence-json";

export type RunAgentRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  requireActiveWorkerRunClaim: (runId: string) => Promise<{
    projectId: string;
    claimTokenHash: string;
    authenticatedAt: string;
  }>;
};

export async function handleRunAgentRoute(
  routeInput: RunAgentRouteInput,
): Promise<Response | undefined> {
  const { request, url, db, attachmentsBucket } = routeInput;
  const { pathname } = url;
  const requireActiveWorkerRunClaim = (
    _db: D1Database,
    _request: Request,
    runId: string,
  ) => routeInput.requireActiveWorkerRunClaim(runId);

  const evidenceMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/evidence$/u);
  if (evidenceMatch && request.method === "POST") {
    const { projectId, claimTokenHash, authenticatedAt } =
      await requireActiveWorkerRunClaim(
      db,
      request,
      evidenceMatch[1],
      );
    const runId = evidenceMatch[1];
    const { input: parsed, images } = await readRunEvidenceRequest(request, {
      projectId,
      runId,
    });
    try {
      const evidence = await recordRunEvidence(db, projectId, {
        runId,
        ...parsed,
        detail: parsed.detail ?? null,
        command: parsed.command ?? null,
        url: parsed.url ?? null,
        metadata: parsed.metadata ?? null,
        observedAt: new Date(parsed.observedAt).toISOString(),
      }, { claimTokenHash, authenticatedAt });
      if (!evidence) throw new HttpError(404, "Run not found");
      let storedImages = await listEvidenceImagesForEvidence(
        db,
        projectId,
        evidence.run_id,
        evidence.id,
      );
      if (images.length > 0) {
        const prepared = await Promise.all(
          images.map(async (image, position) => {
            const bytes = await image.arrayBuffer();
            return {
              bytes,
              filename: image.name.normalize("NFC").trim(),
              contentType: image.type,
              byteSize: image.size,
              sha256: await sha256Bytes(bytes),
              position,
            };
          }),
        );
        if (storedImages.length > 0) {
          const sameImages =
            storedImages.length === prepared.length &&
            storedImages.every((stored, position) => {
              const incoming = prepared[position];
              return (
                incoming &&
                stored.filename === incoming.filename &&
                stored.content_type === incoming.contentType &&
                stored.byte_size === incoming.byteSize &&
                stored.sha256 === incoming.sha256 &&
                stored.position === incoming.position
              );
            });
          if (!sameImages) throw new EventKeyConflictError();
        } else {
          const imageInputs: RunEvidenceImageInput[] = prepared.map(
            (image) => {
              const id = crypto.randomUUID();
              return {
                id,
                object_key: `run-evidence/${projectId}/${evidence.run_id}/${evidence.id}/${id}`,
                filename: image.filename,
                content_type: image.contentType,
                byte_size: image.byteSize,
                sha256: image.sha256,
                position: image.position,
              };
            },
          );
          const uploadedKeys: string[] = [];
          try {
            for (const [position, image] of imageInputs.entries()) {
              const preparedImage = prepared[position];
              if (!preparedImage) throw new Error("Evidence image is missing");
              await attachmentsBucket.put(image.object_key, preparedImage.bytes, {
                httpMetadata: {
                  contentType: image.content_type,
                  contentDisposition: contentDisposition(image.filename),
                },
                customMetadata: {
                  evidenceId: evidence.id,
                  imageId: image.id,
                  projectId,
                  runId: evidence.run_id,
                  sha256: image.sha256,
                },
              });
              uploadedKeys.push(image.object_key);
            }
            const created = await createRunEvidenceImages(
              db,
              projectId,
              evidence.run_id,
              evidence.id,
              imageInputs,
            );
            if (!created) throw new HttpError(404, "Run evidence not found");
            storedImages = created;
          } catch (error) {
            if (uploadedKeys.length > 0) {
              try {
                await attachmentsBucket.delete(uploadedKeys);
              } catch (cleanupError) {
                console.error(
                  JSON.stringify({
                    message: "evidence image cleanup failed",
                    error:
                      cleanupError instanceof Error
                        ? cleanupError.message
                        : String(cleanupError),
                    evidenceId: evidence.id,
                  }),
                );
              }
            }
            throw error;
          }
        }
      }
      const response = recordRunEvidenceResponseMessage({
        runId: evidence.run_id,
        attempt: evidence.attempt,
        evidenceKey: evidence.evidence_key,
        stage: evidence.workflow_stage,
        type: evidence.evidence_type,
        status: evidence.status,
        images: storedImages.map(evidenceImageJson),
      });
      return privateNoStoreProtobufResponse(
        RecordRunEvidenceResponseSchema,
        response,
      );
    } catch (error) {
      if (
        error instanceof EventKeyConflictError ||
        error instanceof HuntTransitionError
      ) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  return undefined;
}
