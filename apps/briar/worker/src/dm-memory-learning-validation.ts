import type {
  DmLearningChange, DmLearningDocument, DmLearningProposal, DmLearningRoot,
  DmLearningSnapshot, DmLearningSourceRef, DmLearningVerification,
} from "../../src/lib/dm-memory-learning-contract";

export class DmLearningError extends Error {
  constructor(readonly code: "invalid_proposal" | "verification_rejected" | "stale" |
    "scope_revoked" | "budget_exhausted" | "model_unavailable" | "model_timeout" |
    "model_credentials" | "model_configuration" | "input_capacity") {
    super(code);
    this.name = "DmLearningError";
  }
}

function invalid(): never { throw new DmLearningError("invalid_proposal"); }
const key = (ref: DmLearningSourceRef) => `${ref.type}:${ref.id}:${ref.version}`;
const normalizedBody = (body: string) => body.replace(/\r\n?/gu, "\n").trim().normalize("NFC");

export type NormalizedDmLearningChange = {
  change: DmLearningChange;
  documentId: string;
  version: number;
  body: string;
  protectedByUser: boolean;
  replacementId: string | null;
  replacementVersion: number | null;
  roots: readonly { itemId: string; source: Pick<DmLearningRoot, "type" | "id" | "version" | "hash"> }[];
};

/** Only snapshot references enter the commit plan. The caller verifies the snapshot's live authority. */
export function normalizeDmLearningProposal(
  snapshot: DmLearningSnapshot, proposal: DmLearningProposal,
  newId: () => string = () => crypto.randomUUID(),
): readonly NormalizedDmLearningChange[] {
  if (snapshot.kind === "explicit_request") {
    if (!proposal.explicitRequest || !snapshot.requestSource || snapshot.requestSource.type !== "message") {
      // An empty, well-formed non-request response consumes no storage exception.
      if (proposal.changes.length === 0 && !proposal.explicitRequest) return [];
      invalid();
    }
  } else if (proposal.explicitRequest) invalid();
  const documents = new Map(snapshot.documents.map((doc) => [doc.id, doc]));
  const roots = new Map(snapshot.roots.map((root) => [key(root), root]));
  const excluded = new Set(snapshot.excludedSources.map((ref) => `${ref.type}:${ref.id}`));
  const changes = new Map<string, DmLearningChange>();
  const assignedIds = new Map<string, string>();
  const mutatedIds = new Set<string>();
  for (const change of proposal.changes) {
    if (changes.has(change.changeId)) invalid();
    changes.set(change.changeId, change);
    if (change.action === "create") {
      if (change.documentId !== null || change.expectedVersion !== null) invalid();
      assignedIds.set(change.changeId, newId());
    } else {
      const target = change.documentId ? documents.get(change.documentId) : undefined;
      if (!target || target.version !== change.expectedVersion || mutatedIds.has(target.id)) invalid();
      if (target.protectedByUser && snapshot.kind !== "explicit_request") invalid();
      if (change.documentKind !== target.kind) invalid();
      mutatedIds.add(target.id);
      assignedIds.set(change.changeId, target.id);
    }
  }

  const resolve = (refs: readonly DmLearningSourceRef[]): DmLearningRoot[] => {
    const resolved = new Map<string, DmLearningRoot>();
    const addRoot = (ref: DmLearningSourceRef) => {
      const root = roots.get(key(ref));
      if (!root || excluded.has(`${ref.type}:${ref.id}`)) invalid();
      resolved.set(key(root), root);
    };
    const seen = new Set<string>();
    for (const ref of refs) {
      if (seen.has(key(ref))) invalid();
      seen.add(key(ref));
      if (ref.type === "clock") {
        if (ref.id !== snapshot.clock.id || ref.version !== snapshot.clock.version ||
          !refs.some((source) => source.type === "memory")) invalid();
      } else if (ref.type === "memory") {
        const document = documents.get(ref.id);
        if (!document || document.version !== ref.version || document.sources.length === 0) invalid();
        for (const source of document.sources) {
          if (source.type !== "message" && source.type !== "user_edit_event") invalid();
          addRoot(source);
        }
      } else addRoot(ref);
    }
    if (resolved.size === 0) invalid();
    return [...resolved.values()].sort((a, b) => key(a).localeCompare(key(b)));
  };

  const generatedBodies = new Set<string>();
  const targets = new Map<string, string>();
  const result = proposal.changes.map((change): NormalizedDmLearningChange => {
    const documentId = assignedIds.get(change.changeId) ?? invalid();
    const target = documents.get(documentId);
    const cited = resolve(change.sourceRefs);
    if (change.sourceRefs.some((ref) => ref.type === "memory" && ref.id !== documentId &&
      proposal.changes.some((other) => other.action === "revise" && other.documentId === ref.id))) invalid();
    if (snapshot.kind === "extract" && !change.sourceRefs.some((ref) =>
      snapshot.inputSources.some((input) => key(input) === key(ref)))) invalid();
    if (snapshot.kind === "explicit_request" && !cited.some((root) => root.speaker === "user" &&
      key(root) === key(snapshot.requestSource!))) invalid();
    if (change.evidenceType === "explicit_user" && !cited.some((root) => root.speaker === "user")) invalid();
    let replacementId: string | null = null;
    let replacementVersion: number | null = null;
    if (change.action === "supersede") {
      const replacement = change.replacementDocumentId
        ? documents.get(change.replacementDocumentId) : null;
      if (change.replacementChangeId) {
        const replacementChange = changes.get(change.replacementChangeId);
        if (replacement || change.replacementVersion !== null || replacementChange?.action !== "create") invalid();
        replacementId = assignedIds.get(change.replacementChangeId) ?? invalid();
        replacementVersion = 1;
      } else {
        if (!replacement || replacement.version !== change.replacementVersion) invalid();
        replacementId = replacement.id;
        replacementVersion = replacement.version;
      }
      if (replacementId === documentId) invalid();
      targets.set(documentId, replacementId);
    } else if (change.replacementDocumentId !== null || change.replacementChangeId !== null ||
      change.replacementVersion !== null) invalid();

    let body: string;
    const linked: { itemId: string; source: DmLearningRoot }[] = [];
    if (change.documentKind === "observation") {
      if (!change.content || change.items.length !== 0) invalid();
      body = normalizedBody(change.content);
      if ([...body].length > 500 || !body) invalid();
      linked.push(...cited.map((source) => ({ itemId: "", source })));
    } else {
      if (snapshot.kind === "extract" || change.content !== null || change.items.length === 0) invalid();
      const ids = new Set<string>();
      const citedKeys = new Set(cited.map(key));
      for (const item of change.items) {
        if (ids.has(item.itemId) || !item.content.trim() || [...item.content].length > 500) invalid();
        ids.add(item.itemId);
        for (const source of resolve(item.sourceRefs)) {
          if (!citedKeys.has(key(source))) invalid();
          linked.push({ itemId: item.itemId, source });
        }
      }
      if (!change.items.some((item) => item.section === "Current")) invalid();
      const section = (name: "Current" | "History") => `## ${name}\n\n${change.items
        .filter((item) => item.section === name)
        .map((item) => `- ${normalizedBody(item.content).replaceAll("\n", "\n  ")}`).join("\n")}`;
      body = `# ${change.title.replaceAll("\n", " ")}\n\n${section("Current")}\n\n${section("History")}`;
    }
    if (new TextEncoder().encode(body).length > 65_536) invalid();
    if (change.action !== "supersede") {
      const canonical = normalizedBody(body);
      if (generatedBodies.has(canonical) || snapshot.documents.some((document: DmLearningDocument) =>
        document.id !== documentId && normalizedBody(document.body) === canonical)) invalid();
      if (target && normalizedBody(target.body) === canonical && target.memoryClass === change.memoryClass &&
        target.evidenceType === change.evidenceType && target.observedAt === change.observedAt &&
        target.validUntil === change.validUntil && target.conflicted === change.conflicted &&
        target.sourceLanguage === change.sourceLanguage && target.title === change.title &&
        cited.every((source) => target.sources.some((existing) => key(source) === key(existing)))) invalid();
      generatedBodies.add(canonical);
    }
    return { change, documentId, version: target ? target.version + 1 : 1, body,
      protectedByUser: snapshot.kind === "explicit_request",
      replacementId, replacementVersion, roots: linked.map(({ itemId, source }) => ({ itemId,
        source: { type: source.type, id: source.id, version: source.version, hash: source.hash } })) };
  });
  for (const id of targets.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined) {
      if (visited.has(current)) invalid();
      visited.add(current);
      current = targets.get(current);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 262_144) invalid();
  return result;
}

export function requireDmLearningVerification(
  snapshot: DmLearningSnapshot, proposal: DmLearningProposal, verification: DmLearningVerification,
) {
  if (!verification.approved || (snapshot.kind === "explicit_request" && !verification.explicitRequestAuthorized) ||
    verification.decisions.length !== proposal.changes.length || proposal.changes.length === 0) {
    throw new DmLearningError("verification_rejected");
  }
  const pending = new Set(proposal.changes.map((change) => change.changeId));
  for (const decision of verification.decisions) {
    if (decision.verdict !== "supported" || !pending.delete(decision.changeId)) {
      throw new DmLearningError("verification_rejected");
    }
  }
  if (pending.size !== 0) throw new DmLearningError("verification_rejected");
}
