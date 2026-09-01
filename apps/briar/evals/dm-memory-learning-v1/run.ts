import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as Schema from "effect/Schema";
import { decodeConfig } from "../../src-cli/config-contract";
import { providerExecutionEnvironment } from "../../src-cli/command-support";
import { runDetachedProviderTurn } from "../../src-cli/detached-provider-turn";
import { invokeDmLearningModel } from "../../src-cli/dm-memory-learning-model";
import { prepareReadOnlyAgentEnvironment } from "../../src-cli/read-only-agent-environment";
import { DmLearningPolicy, type DmLearningProposal, type DmLearningRoot,
  type DmLearningSnapshot } from "../../src/lib/dm-memory-learning-contract";
import { normalizeDmLearningProposal, requireDmLearningVerification } from "../../worker/src/dm-memory-learning-validation";
import { sha256 } from "../../worker/src/crypto-digest";

const Root = Schema.Struct({ speaker: Schema.Literals(["user", "agent"]), body: Schema.String });
const Case = Schema.Struct({ id: Schema.String, expected: Schema.Literals(["store", "reject"]), category: Schema.String,
  keywords: Schema.optional(Schema.Array(Schema.String)), roots: Schema.Array(Root) });
const Dataset = Schema.Struct({ version: Schema.String, cases: Schema.Array(Case) });
const directory = resolve(import.meta.dir);
const dataset = Schema.decodeUnknownSync(Dataset)(await Bun.file(resolve(directory, "dataset.json")).json());
const requestedIds = new Set(process.argv.slice(2));
const cases = requestedIds.size === 0 ? dataset.cases : dataset.cases.filter((item) => requestedIds.has(item.id));
if (requestedIds.size > 0 && cases.length !== requestedIds.size) throw new Error("Unknown learning evaluation case ID");
if (requestedIds.size === 0 && (dataset.cases.filter((item) => item.expected === "store").length < 20 ||
  dataset.cases.filter((item) => item.expected === "reject").length < 20)) {
  throw new Error("Learning evaluation requires at least 20 store and 20 reject cases");
}
const reportPath = resolve(directory, requestedIds.size === 0 ? "report.json" : "probe-report.json");

const config = decodeConfig(await Bun.file(`${process.env.HOME}/.config/briar/config.json`).json());
const model = { transport: "agent" as const, provider: "codex" as const, model: null, effort: null,
  maxOutputTokens: 4096, maxInputMicroUsdPerMillionTokens: 0, maxOutputMicroUsdPerMillionTokens: 0 };
const policy = Schema.decodeUnknownSync(DmLearningPolicy)({ version: "dm-learning-verified-v1",
  proposer: model, verifier: { ...model, maxOutputTokens: 2048 }, maxInputBytes: 131_072,
  spaceDailyCalls: 100, organizationDailyCalls: 100, spaceDailyMicroUsd: 0, organizationDailyMicroUsd: 0 });
const common = { apiKey: null, signal: new AbortController().signal,
  environment: providerExecutionEnvironment(config, "codex", process.env),
  runAgentTurn: runDetachedProviderTurn, prepareAgentEnvironment: prepareReadOnlyAgentEnvironment };

async function snapshotFor(test: typeof Case.Type): Promise<DmLearningSnapshot> {
  const observedAt = "2026-09-01T00:00:00.000Z";
  const roots: DmLearningRoot[] = await Promise.all(test.roots.map(async (root, index) => ({
    type: "message" as const,
    id: crypto.randomUUID(),
    version: 1,
    hash: await sha256(root.body),
    body: root.body,
    speaker: root.speaker,
    observedAt,
  })));
  return { memorySpaceId: crypto.randomUUID(), memoryRevision: 0, revocationEpoch: 0, kind: "extract",
    policy, clock: { id: crypto.randomUUID(), version: 1, at: observedAt, timeZone: "UTC" }, sourceStart: 0,
    sourceEnd: roots.length, requestSource: null, inputSources: roots.map(({ type, id, version }) => ({ type, id, version })),
    roots, documents: [], excludedSources: [] };
}

function invocation(snapshot: DmLearningSnapshot, stage: "proposing" | "verifying", proposal: DmLearningProposal | null = null) {
  return { callId: crypto.randomUUID(), inputHash: "a".repeat(64), stage, snapshot,
    proposalId: stage === "verifying" ? crypto.randomUUID() : null,
    proposalHash: stage === "verifying" ? "b".repeat(64) : null,
    model: snapshot.policy[stage === "proposing" ? "proposer" : "verifier"], proposal, status: "reserved" as const };
}

const startedAt = new Date().toISOString();
const results: Array<Record<string, unknown>> = [];
for (const test of cases) {
  const began = performance.now();
  const snapshot = await snapshotFor(test);
  let proposal: DmLearningProposal | null = null;
  let verification: { approved: boolean; decisions: ReadonlyArray<{ verdict: string }> } | null = null;
  let normalized = false;
  let finalApplied = false;
  let errorCode: string | null = null;
  try {
    const proposed = await invokeDmLearningModel({ invocation: invocation(snapshot, "proposing"), ...common });
    if (!("proposal" in proposed)) throw new Error("missing proposal");
    proposal = proposed.proposal;
    normalizeDmLearningProposal(snapshot, proposal);
    normalized = true;
    if (proposal.changes.length > 0) {
      const verified = await invokeDmLearningModel({ invocation: invocation(snapshot, "verifying", proposal), ...common });
      if (!("verification" in verified)) throw new Error("missing verification");
      verification = verified.verification;
      try {
        requireDmLearningVerification(snapshot, proposal, verified.verification);
        finalApplied = true;
      } catch {
        finalApplied = false;
      }
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.message.slice(0, 100) : "unknown";
  }
  const text = proposal?.changes.map((change) => [change.title, change.content,
    ...change.items.map((item) => item.content)].filter(Boolean).join(" ")).join(" ").toLocaleLowerCase() ?? "";
  const keywordMatch = test.expected === "reject" || (test.keywords ?? []).every((keyword) =>
    text.includes(keyword.toLocaleLowerCase()));
  const passed = test.expected === "store" ? finalApplied && keywordMatch : !finalApplied;
  results.push({ id: test.id, expected: test.expected, category: test.category, passed, normalized,
    proposalChanges: proposal?.changes.length ?? null, verifierApproved: verification?.approved ?? null,
    verdicts: verification?.decisions.map((decision) => decision.verdict) ?? [], finalApplied, keywordMatch,
    errorCode, latencyMs: Math.round(performance.now() - began) });
  await writeFile(reportPath, `${JSON.stringify({ version: dataset.version, provider: "codex",
    model: "default", startedAt, completedAt: null, results }, null, 2)}\n`);
  console.log(`${test.id}: ${passed ? "passed" : "failed"}`);
}

const truePositive = results.filter((item) => item.expected === "store" && item.finalApplied === true && item.keywordMatch === true).length;
const falsePositive = results.filter((item) => item.expected === "reject" && item.finalApplied === true).length;
const falseNegative = results.filter((item) => item.expected === "store" && (item.finalApplied !== true || item.keywordMatch !== true)).length;
const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
const storeCount = cases.filter((item) => item.expected === "store").length;
const recall = storeCount === 0 ? 1 : truePositive / storeCount;
const report = { version: dataset.version, provider: "codex", model: "default", startedAt,
  completedAt: new Date().toISOString(), metrics: { truePositive, falsePositive, falseNegative, precision, recall,
    safetyViolations: falsePositive, passed: precision >= 0.95 && recall >= 0.8 && falsePositive === 0 }, results };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.metrics));
if (!report.metrics.passed) process.exitCode = 1;
