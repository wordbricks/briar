import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { DmLearningProposal, dmLearningAgentPolicy, dmLearningPreferredProvider,
  dmMemoryLearningVerifiedProviders, resolveDmLearningProvider,
  type DmLearningChange } from "../../src/lib/dm-memory-learning-contract";
import { advertisedDmLearningProviders, dmLearningCallReservation, supportsDmMemoryLearning } from "./dm-memory-learning-policy";
import { normalizeDmLearningProposal, requireDmLearningVerification } from "./dm-memory-learning-validation";
import { syntheticDmLearningPolicy, syntheticDmLearningSnapshot,
  syntheticDmLearningChange } from "./test-helpers/dm-memory-learning";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";

describe("DM learning proposal and independent verifier boundaries", () => {
  it("derives the policy from the DM Agent and never invents a subscription cost", () => {
    expect(dmMemoryLearningVerifiedProviders).toEqual(["codex", "claude"]);
    expect(dmLearningPreferredProvider("codex")).toBe("codex");
    expect(dmLearningPreferredProvider("claude")).toBe("claude");
    expect(dmLearningPreferredProvider("grok")).toBe("codex");
    expect(dmLearningAgentPolicy("codex")).toEqual(syntheticDmLearningPolicy);
    expect(dmLearningAgentPolicy("codex")).toMatchObject({ spaceDailyCalls: 48, organizationDailyCalls: 240,
      maxInputBytes: 131_072, spaceDailyMicroUsd: 0, organizationDailyMicroUsd: 0 });
    expect(dmLearningAgentPolicy("codex").proposer).toMatchObject({ transport: "agent", maxOutputTokens: 4096 });
    expect(dmLearningAgentPolicy("codex").verifier).toMatchObject({ transport: "agent", maxOutputTokens: 2048 });
    const snapshot = syntheticDmLearningSnapshot();
    const proposal = { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot)] };
    const proposing = dmLearningCallReservation(snapshot.policy.proposer, JSON.stringify({ snapshot }), "proposing")!;
    const verifying = dmLearningCallReservation(snapshot.policy.verifier, JSON.stringify({ snapshot, proposal }), "verifying")!;
    expect(proposing.reservedMicroUsd).toBe(0);
    expect(verifying.reservedMicroUsd).toBe(0);
    expect(verifying.inputTokenCeiling).toBeGreaterThan(JSON.stringify(proposal).length);
  });
  it("accepts only protocol-2 Workers advertising a verified Agent provider", () => {
    const capabilities = workerRuntimeFixture({ dmMemoryLearning: {
      protocol: 2, transports: ["agent"], providers: ["codex", "grok"],
    } }).capabilities;
    expect(advertisedDmLearningProviders(capabilities)).toEqual(["codex"]);
    expect(supportsDmMemoryLearning(capabilities)).toBe(true);
    expect(supportsDmMemoryLearning(workerRuntimeFixture({ dmMemoryLearning: {
      protocol: 2, transports: ["agent"], providers: ["cursor", "grok"],
    } }).capabilities)).toBe(false);
    expect(supportsDmMemoryLearning(workerRuntimeFixture({ dmMemoryLearning: {
      protocol: 2, transports: ["openrouter"], providers: ["codex"],
    } }).capabilities)).toBe(false);
    expect(supportsDmMemoryLearning(workerRuntimeFixture({ dmMemoryLearning: true }).capabilities)).toBe(false);
    expect(resolveDmLearningProvider("codex", ["codex"])).toBe("codex");
    expect(resolveDmLearningProvider("claude", ["codex"])).toBe("codex");
    expect(resolveDmLearningProvider("grok", ["claude", "codex"])).toBe("codex");
    expect(resolveDmLearningProvider("codex", [])).toBeNull();
  });
  it("separates schema validity from evidence validity and never accepts model protection", () => {
    const snapshot = syntheticDmLearningSnapshot(), change = syntheticDmLearningChange(snapshot);
    expect(() => Schema.decodeUnknownSync(DmLearningProposal)({ explicitRequest: false,
      changes: [{ ...change, protectedByUser: true }] })).toThrow();
    expect(() => normalizeDmLearningProposal(snapshot, { explicitRequest: false, changes: [
      { ...change, sourceRefs: [{ type: "message", id: crypto.randomUUID(), version: 1 }] },
    ] })).toThrow("invalid_proposal");
    const normalized = normalizeDmLearningProposal(snapshot, { explicitRequest: false, changes: [change] });
    expect(normalized[0]!.protectedByUser).toBe(false);
    expect(normalized[0]!.roots[0]!.source.id).toBe(snapshot.roots[0]!.id);
    expect(normalized[0]!.roots[0]!.source).not.toHaveProperty("body");
  });
  it("does not extract unrelated old conversation from a current memory's root", () => {
    const snapshot = syntheticDmLearningSnapshot();
    const old = { ...snapshot.roots[0]!, id: crypto.randomUUID() };
    const expanded = { ...snapshot, roots: [...snapshot.roots, old] };
    expect(() => normalizeDmLearningProposal(expanded, { explicitRequest: false,
      changes: [syntheticDmLearningChange(snapshot, { sourceRefs: [{ type: "message", id: old.id, version: 1 }] })] }))
      .toThrow("invalid_proposal");
  });
  it("rejects overlong observations rather than truncating conditions", () => {
    const snapshot = syntheticDmLearningSnapshot();
    const decode = Schema.decodeUnknownSync(DmLearningProposal);
    expect(() => decode({ explicitRequest: false, changes: [syntheticDmLearningChange(snapshot,
      { content: "🙂".repeat(501) })] })).toThrow();
    expect(decode({ explicitRequest: false, changes: [syntheticDmLearningChange(snapshot,
      { content: "🙂".repeat(500) })] }).changes[0]!.content).toHaveLength(1000);
  });
  it("rejects a real cited source that the separate verifier does not support", () => {
    const snapshot = syntheticDmLearningSnapshot();
    const proposal = { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot, { content: "배포가 완료됐다." })] };
    expect(normalizeDmLearningProposal(snapshot, proposal)).toHaveLength(1);
    expect(() => requireDmLearningVerification(snapshot, proposal, { approved: false, explicitRequestAuthorized: false,
      decisions: [{ changeId: "change-1", verdict: "unsupported" }] })).toThrow("verification_rejected");
  });
  it("requires every change exactly once and rejects partial approvals", () => {
    const snapshot = syntheticDmLearningSnapshot();
    const proposal = { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot),
      syntheticDmLearningChange(snapshot, { changeId: "change-2", content: "별도 조건이 있는 합성 관찰이다." })] };
    for (const decisions of [[], [{ changeId: "change-1", verdict: "supported" as const }],
      [{ changeId: "change-1", verdict: "supported" as const }, { changeId: "change-1", verdict: "supported" as const }],
      [{ changeId: "change-1", verdict: "supported" as const }, { changeId: "change-2", verdict: "uncertain" as const }]]) {
      expect(() => requireDmLearningVerification(snapshot, proposal, { approved: true, explicitRequestAuthorized: false, decisions }))
        .toThrow("verification_rejected");
    }
  });
  it("requires a verified user request for protection, including while automatic learning is off", () => {
    const base = syntheticDmLearningSnapshot();
    const snapshot = { ...base, kind: "explicit_request" as const, requestSource: base.inputSources[0]! };
    const proposal = { explicitRequest: true, changes: [syntheticDmLearningChange(snapshot)] };
    expect(normalizeDmLearningProposal(snapshot, proposal)[0]!.protectedByUser).toBe(true);
    expect(() => requireDmLearningVerification(snapshot, proposal, { approved: true, explicitRequestAuthorized: false,
      decisions: [{ changeId: "change-1", verdict: "supported" }] })).toThrow("verification_rejected");
    expect(() => requireDmLearningVerification(snapshot, proposal, { approved: true, explicitRequestAuthorized: true,
      decisions: [{ changeId: "change-1", verdict: "supported" }] })).not.toThrow();
  });
  it("stores an episode only for a real exchange and never lets it expire", () => {
    const base = syntheticDmLearningSnapshot();
    const reply = { type: "message" as const, id: crypto.randomUUID(), version: 1, hash: "c".repeat(64),
      body: "행동 위험도 규칙 세 가지만 반영하자고 제안합니다.", speaker: "agent" as const,
      observedAt: "2026-09-01T00:05:00.000Z" };
    const snapshot = { ...base, sourceEnd: 2, roots: [...base.roots, reply],
      inputSources: [...base.inputSources, { type: reply.type, id: reply.id, version: reply.version }] };
    const episode = (overrides: Partial<Parameters<typeof syntheticDmLearningChange>[1]> = {}) =>
      syntheticDmLearningChange(snapshot, { memoryClass: "log", evidenceType: "observed", title: "제안 3가지",
        content: "사용자가 프롬프트를 공유했고 Agent는 세 가지만 반영하자고 제안했다.",
        observedAt: reply.observedAt, validUntil: null, sourceRefs: snapshot.inputSources, ...overrides });
    const propose = (change: DmLearningChange) => normalizeDmLearningProposal(snapshot,
      { explicitRequest: false, changes: [change] }, () => "3f1d0a5c-0000-4000-8000-000000000001");
    // One side of an exchange is not an episode, and an episode without its time
    // cannot be placed in the brief's timeline.
    expect(() => propose(episode({ sourceRefs: [snapshot.inputSources[0]!] }))).toThrow("invalid_proposal");
    expect(() => propose(episode({ sourceRefs: [snapshot.inputSources[1]!] }))).toThrow("invalid_proposal");
    expect(() => propose(episode({ observedAt: null }))).toThrow("invalid_proposal");
    const stored = propose(episode());
    expect(stored[0]!.change.validUntil).toBeNull();
    // Whatever expiry the model sent is dropped - episodes are kept for good -
    // and the normalized output is hashed with the proposal, so it must stay deterministic.
    const guessed = propose(episode({ validUntil: "2027-01-01T00:00:00.000Z" }));
    expect(guessed[0]!.change.validUntil).toBeNull();
    expect(JSON.stringify(guessed)).toBe(JSON.stringify(propose(episode({ validUntil: "2027-01-01T00:00:00.000Z" }))));
    expect(propose(syntheticDmLearningChange(snapshot, { validUntil: "2027-01-01T00:00:00.000Z" }))[0]!.change.validUntil)
      .toBe("2027-01-01T00:00:00.000Z");
  });
  it("blocks automatic edits to protected documents and circular replacements", () => {
    const snapshot = syntheticDmLearningSnapshot();
    const document = { id: crypto.randomUUID(), version: 1, kind: "observation" as const, title: "Protected",
      body: "Protected synthetic fact.", hash: "b".repeat(64), memoryClass: "profile" as const,
      evidenceType: "explicit_user" as const, protectedByUser: true, conflicted: false,
      observedAt: snapshot.clock.at, validUntil: null, sourceLanguage: "en", sources: snapshot.inputSources };
    const context = { ...snapshot, documents: [document] };
    expect(() => normalizeDmLearningProposal(context, { explicitRequest: false, changes: [syntheticDmLearningChange(context,
      { action: "revise", documentId: document.id, expectedVersion: 1 })] })).toThrow("invalid_proposal");
    const automatic = { ...context, documents: [{ ...document, protectedByUser: false }] };
    expect(() => normalizeDmLearningProposal(automatic, { explicitRequest: false, changes: [syntheticDmLearningChange(automatic,
      { action: "supersede", documentId: document.id, expectedVersion: 1,
        replacementDocumentId: document.id, replacementVersion: 1 })] })).toThrow("invalid_proposal");
  });
});
