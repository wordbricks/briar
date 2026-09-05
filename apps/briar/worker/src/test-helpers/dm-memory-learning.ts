import { dmLearningAgentPolicy, type DmLearningChange, type DmLearningPolicy,
  type DmLearningSnapshot } from "../../../src/lib/dm-memory-learning-contract";

export const syntheticDmLearningPolicy: DmLearningPolicy = dmLearningAgentPolicy("codex");
/** Only the dormant OpenRouter client path still exercises a metered policy. */
export const syntheticOpenRouterDmLearningPolicy: DmLearningPolicy = {
  version: "dm-learning-verified-v1",
  proposer: { transport: "openrouter", model: "synthetic/proposer", upstreamProvider: "synthetic",
    maxOutputTokens: 4096, maxInputMicroUsdPerMillionTokens: 1_000_000, maxOutputMicroUsdPerMillionTokens: 2_000_000 },
  verifier: { transport: "openrouter", model: "synthetic/verifier", upstreamProvider: "synthetic",
    maxOutputTokens: 2048, maxInputMicroUsdPerMillionTokens: 1_000_000, maxOutputMicroUsdPerMillionTokens: 2_000_000 },
  maxInputBytes: 131_072, spaceDailyCalls: 24, organizationDailyCalls: 240,
  spaceDailyMicroUsd: 5_000_000, organizationDailyMicroUsd: 50_000_000,
};
export function syntheticDmLearningSnapshot(): DmLearningSnapshot {
  const ref = { type: "message" as const, id: crypto.randomUUID(), version: 1 };
  return { memorySpaceId: crypto.randomUUID(), memoryRevision: 0, revocationEpoch: 0, kind: "extract",
    policy: syntheticDmLearningPolicy, clock: { id: crypto.randomUUID(), version: 1, at: "2026-09-01T00:00:00.000Z", timeZone: "UTC" },
    sourceStart: 0, sourceEnd: 1, requestSource: null, inputSources: [ref], excludedSources: [], documents: [],
    roots: [{ ...ref, hash: "a".repeat(64), body: "앞으로 기술 설명은 결론부터 해 주세요.",
      speaker: "user", observedAt: "2026-09-01T00:00:00.000Z" }] };
}
export function syntheticDmLearningChange(snapshot: DmLearningSnapshot, overrides: Partial<DmLearningChange> = {}): DmLearningChange {
  return { changeId: "change-1", action: "create", documentId: null, expectedVersion: null,
    replacementDocumentId: null, replacementVersion: null, replacementChangeId: null,
    documentKind: "observation", title: "설명 순서", content: "사용자는 기술 설명에서 결론을 먼저 듣기를 원한다.", items: [],
    memoryClass: "profile", evidenceType: "explicit_user", sourceLanguage: "ko", observedAt: snapshot.roots[0]!.observedAt,
    validUntil: null, conflicted: false, sourceRefs: snapshot.inputSources, ...overrides };
}
