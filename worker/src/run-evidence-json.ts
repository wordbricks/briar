import type {
  RunEvidenceImageRow,
  RunEvidenceRow,
} from "./run-evidence-repository";

export const evidenceImageJson = (image: RunEvidenceImageRow) => ({
  id: image.id,
  filename: image.filename,
  contentType: image.content_type,
  byteSize: image.byte_size,
  sha256: image.sha256,
  position: image.position,
  url: `/projects/${image.project_id}/runs/${image.run_id}/evidence/images/${image.id}`,
});

export const runEvidenceJson = (
  evidence: RunEvidenceRow,
  requiredRevision: number,
  images: RunEvidenceImageRow[] = [],
) => ({
  key: evidence.evidence_key,
  attempt: evidence.attempt,
  revision: evidence.revision,
  stage: evidence.workflow_stage,
  type: evidence.evidence_type,
  status: evidence.status,
  detail: evidence.detail,
  command: evidence.command,
  url: evidence.url,
  metadata: evidence.metadata_json ? JSON.parse(evidence.metadata_json) : null,
  actor: evidence.actor,
  observedAt: evidence.observed_at,
  recordedAt: evidence.recorded_at,
  images: images.map(evidenceImageJson),
  requiredRevision,
  canonical: evidence.revision >= requiredRevision,
});
