import {
  create,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ListRunEvidenceResponseSchema,
  RunEvidenceImageSchema,
  RunEvidenceSchema,
  RunEvidence_Status,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  RecordRunEvidenceResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { listRunEvidenceForProject } from "./run-evidence-routes";

type EvidenceResult = Awaited<ReturnType<typeof listRunEvidenceForProject>>;
type Evidence = EvidenceResult["evidence"][number];

const timestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Worker evidence has invalid ${field}`);
  }
  return timestampFromDate(date);
};

const jsonValue = (value: unknown, field: string): JsonValue => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${field}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = jsonValue(item, `${field}.${key}`);
    }
    return output;
  }
  throw new Error(`Worker evidence has non-JSON ${field}`);
};

const jsonObject = (value: unknown, field: string): JsonObject => {
  const mapped = jsonValue(value, field);
  if (mapped === null || Array.isArray(mapped) || typeof mapped !== "object") {
    throw new Error(`Worker evidence expected an object for ${field}`);
  }
  return mapped;
};

const evidenceStatus = {
  pending: RunEvidence_Status.PENDING,
  passed: RunEvidence_Status.PASSED,
  failed: RunEvidence_Status.FAILED,
  skipped: RunEvidence_Status.SKIPPED,
} as const satisfies Record<Evidence["status"], RunEvidence_Status>;

const evidenceImageMessage = (image: Evidence["images"][number]) =>
  create(RunEvidenceImageSchema, {
    id: image.id,
    filename: image.filename,
    contentType: image.contentType,
    byteSize: BigInt(image.byteSize),
    sha256: image.sha256,
    position: image.position,
    url: image.url,
  });

const evidenceMessage = (value: Evidence) => create(RunEvidenceSchema, {
  key: value.key,
  attempt: value.attempt,
  revision: value.revision,
  stage: value.stage,
  type: value.type,
  status: evidenceStatus[value.status],
  detail: value.detail ?? undefined,
  command: value.command ?? undefined,
  url: value.url ?? undefined,
  metadata: value.metadata === null
    ? undefined
    : jsonObject(value.metadata, "metadata"),
  actor: value.actor,
  observedAt: timestamp(value.observedAt, "observedAt"),
  recordedAt: timestamp(value.recordedAt, "recordedAt"),
  images: value.images.map(evidenceImageMessage),
  requiredRevision: value.requiredRevision,
  canonical: value.canonical,
});

export const runEvidenceResponseMessage = (value: EvidenceResult) =>
  create(ListRunEvidenceResponseSchema, {
    runId: value.runId,
    attempt: value.attempt,
    revision: value.revision,
    evidence: value.evidence.map(evidenceMessage),
  });

export const recordRunEvidenceResponseMessage = (value: {
  runId: string;
  attempt: number;
  evidenceKey: string;
  stage: string;
  type: string;
  status: Evidence["status"];
  images: Evidence["images"];
}) => create(RecordRunEvidenceResponseSchema, {
  runId: value.runId,
  attempt: value.attempt,
  evidenceKey: value.evidenceKey,
  stage: value.stage,
  type: value.type,
  status: evidenceStatus[value.status],
  images: value.images.map(evidenceImageMessage),
});
