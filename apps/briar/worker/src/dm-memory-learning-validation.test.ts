import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { DmLearningProposal } from "../../src/lib/dm-memory-learning-contract";
import { dmLearningCallReservation, dmLearningPolicy, supportsDmMemoryLearning } from "./dm-memory-learning-policy";
import { normalizeDmLearningProposal, requireDmLearningVerification } from "./dm-memory-learning-validation";
import { syntheticAgentDmLearningPolicy, syntheticDmLearningPolicy, syntheticDmLearningSnapshot,
  syntheticDmLearningChange } from "./test-helpers/dm-memory-learning";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";

describe("DM learning proposal and independent verifier boundaries", () => {
  it("requires explicit configured models and budgets and charges both model phases", () => {
    const id = crypto.randomUUID();
    expect(dmLearningPolicy({}, id)).toBeNull();
    expect(dmLearningPolicy({ DM_MEMORY_LEARNING_ENABLED: "true", DM_MEMORY_LEARNING_POLICIES: "{}" }, id)).toBeNull();
    expect(dmLearningPolicy({ DM_MEMORY_LEARNING_ENABLED: "true", DM_MEMORY_LEARNING_POLICIES:
      JSON.stringify({ [id]: syntheticDmLearningPolicy }) }, id)).toEqual(syntheticDmLearningPolicy);
    const snapshot = syntheticDmLearningSnapshot();
    const proposal = { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot)] };
    const proposing = dmLearningCallReservation(snapshot.policy.proposer, JSON.stringify({ snapshot }), "proposing")!;
    const verifying = dmLearningCallReservation(snapshot.policy.verifier, JSON.stringify({ snapshot, proposal }), "verifying")!;
    expect(proposing.reservedMicroUsd).toBeGreaterThan(0);
    expect(verifying.reservedMicroUsd).toBeGreaterThan(0);
    expect(verifying.inputTokenCeiling).toBeGreaterThan(JSON.stringify(proposal).length);
  });
  it("accepts connected Agent providers, rejects missing providers and records no invented subscription cost", () => {
    const organizationId = crypto.randomUUID();
    expect(dmLearningPolicy({ DM_MEMORY_LEARNING_ENABLED: "true", DM_MEMORY_LEARNING_POLICIES:
      JSON.stringify({ [organizationId]: syntheticAgentDmLearningPolicy }) }, organizationId))
      .toEqual(syntheticAgentDmLearningPolicy);
    const capabilities = workerRuntimeFixture({ dmMemoryLearning: {
      protocol: 2, transports: ["agent"], providers: ["codex", "grok"],
    } }).capabilities;
    expect(supportsDmMemoryLearning(capabilities, syntheticAgentDmLearningPolicy)).toBe(true);
    expect(supportsDmMemoryLearning(workerRuntimeFixture({ dmMemoryLearning: {
      protocol: 2, transports: ["agent"], providers: ["codex"],
    } }).capabilities, syntheticAgentDmLearningPolicy)).toBe(false);
    expect(dmLearningCallReservation(syntheticAgentDmLearningPolicy.proposer, "{}", "proposing")?.reservedMicroUsd).toBe(0);
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
