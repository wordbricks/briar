import { describe, expect, it } from "vitest";
import { MemoryVaultError } from "./errors";
import {
  insertJournalLine,
  journalDay,
  journalLine,
  journalTime,
  normalizeJournalReferences,
  normalizeJournalText,
} from "./journal";
import {
  applyPlaybookRules,
  applyVoiceGuideRules,
  applyVoiceRules,
  checkLesson,
  removePlaybookLinks,
} from "./record-rules";
import {
  RECORD_TYPES,
  assertRecordId,
  assertSavableRecord,
  describeRecordFile,
  normalizeAliases,
  normalizeRecordBody,
  parseRecordFile,
  parseRecordPath,
  recordPath,
  renderRecordFile,
} from "./records";
import { detectSecrets } from "./secret-detector";
import { parseVaultCommitMessage, scrubVaultCommitMessage, vaultCommitMessage } from "./trailers";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof MemoryVaultError) return error.vaultCode;
    throw error;
  }
  return null;
};

describe("record paths and ids", () => {
  it("maps every type to its path and back", () => {
    for (const type of Object.keys(RECORD_TYPES) as (keyof typeof RECORD_TYPES)[]) {
      const id = type === "playbook" ? "playbook"
        : type === "timeline-weekly" ? "2026-w42"
        : type === "timeline-monthly" ? "2026-10"
        : type === "timeline-daily" ? "2026-10-13"
        : "bay-area-relocation";
      const path = recordPath(type, id);
      expect(parseRecordPath(path)).toEqual({ type, id, legacyStatus: null });
    }
    expect(recordPath("person", "owner")).toBe("entities/people/owner.md");
    expect(recordPath("lesson", "x")).toBe("knowledge/lessons/x.md");
  });

  it("recognizes the legacy workstream layout and nothing outside the layout", () => {
    expect(parseRecordPath("workstreams/active/move.md")).toEqual({ type: "workstream", id: "move", legacyStatus: "active" });
    expect(parseRecordPath("workstreams/completed/move.md")).toEqual({ type: "workstream", id: "move", legacyStatus: "completed" });
    expect(parseRecordPath("README.md")).toBeNull();
    expect(parseRecordPath("notes/random.md")).toBeNull();
    expect(parseRecordPath("entities/people/Upper.md")).toBeNull();
  });

  it("validates ids per type", () => {
    expect(code(() => assertRecordId("fact", "a"))).toBeNull();
    expect(code(() => assertRecordId("fact", "-a"))).toBe("invalid_record");
    expect(code(() => assertRecordId("fact", "A"))).toBe("invalid_record");
    expect(code(() => assertRecordId("fact", "a".repeat(64)))).toBe("invalid_record");
    expect(code(() => assertRecordId("fact", "readme"))).toBe("readme_read_only");
    expect(code(() => assertRecordId("playbook", "other"))).toBe("invalid_record");
    expect(code(() => assertRecordId("fact", "playbook"))).toBe("invalid_record");
    expect(code(() => assertRecordId("timeline-weekly", "2026-w42"))).toBeNull();
    expect(code(() => assertRecordId("timeline-weekly", "2026-w54"))).toBe("invalid_record");
    // 2026 has 53 ISO weeks; 2027 has 52.
    expect(code(() => assertRecordId("timeline-weekly", "2026-w53"))).toBeNull();
    expect(code(() => assertRecordId("timeline-weekly", "2027-w53"))).toBe("invalid_record");
    expect(code(() => assertRecordId("timeline-monthly", "2026-13"))).toBe("invalid_record");
    expect(code(() => assertRecordId("timeline-daily", "2026-02-30"))).toBe("invalid_record");
  });

  it("requires a status exactly for workstreams and keeps daily files journal-only", () => {
    expect(code(() => assertSavableRecord({ type: "workstream", id: "w", status: null }))).toBe("invalid_record");
    expect(code(() => assertSavableRecord({ type: "workstream", id: "w", status: "paused" }))).toBe("invalid_record");
    expect(code(() => assertSavableRecord({ type: "workstream", id: "w", status: "someday" }))).toBeNull();
    expect(code(() => assertSavableRecord({ type: "fact", id: "f", status: "active" }))).toBe("invalid_record");
    expect(code(() => assertSavableRecord({ type: "timeline-daily", id: "2026-10-13", status: null }))).toBe("invalid_record");
  });

  it("validates aliases", () => {
    expect(normalizeAliases("x", ["a", "a", " b "])).toEqual(["a", "b"]);
    expect(code(() => normalizeAliases("x", ["x"]))).toBe("invalid_record");
    expect(normalizeAliases("x", ["커피", "Bay Area move"])).toEqual(["커피", "Bay Area move"]);
    expect(code(() => normalizeAliases("x", ["X"]))).toBe("invalid_record");
    for (const broken of ["a, b", "[a]", "line\nbreak", "x".repeat(61)]) {
      expect(code(() => normalizeAliases("x", [broken]))).toBe("invalid_record");
    }
    expect(code(() => normalizeAliases("x", Array.from({ length: 11 }, (_, index) => `a${index}`)))).toBe("invalid_record");
  });
});

describe("frontmatter", () => {
  const frontmatter = {
    id: "bay-area-relocation", type: "workstream" as const, status: "active" as const, aliases: ["relocation"],
    revision: 4, createdAt: "2026-10-13T12:40:50Z", updatedAt: "2026-10-13T14:02:11Z",
  };

  it("renders the spec layout and parses it back", () => {
    const file = renderRecordFile(frontmatter, "Goal: move.\n");
    expect(file).toBe([
      "---", "id: bay-area-relocation", "type: workstream", "status: active", "aliases: [relocation]",
      "revision: 4", "created_at: 2026-10-13T12:40:50Z", "updated_at: 2026-10-13T14:02:11Z", "---", "Goal: move.", "",
    ].join("\n"));
    const parsed = parseRecordFile("workstreams/bay-area-relocation.md", file);
    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.body).toBe("Goal: move.\n");
    expect(parsed.bodyStartLine).toBe(10);
  });

  it("treats a file whose frontmatter disagrees with its path as legacy body", () => {
    const file = renderRecordFile(frontmatter, "x\n");
    expect(parseRecordFile("workstreams/other.md", file).frontmatter).toBeNull();
    const legacy = describeRecordFile("workstreams/completed/old.md", "# Old\n");
    expect(legacy).toMatchObject({ id: "old", type: "workstream", status: "completed", revision: 1, frontmatter: null });
  });

  it("rejects a body that starts with frontmatter and bodies over 64 KiB", () => {
    expect(code(() => normalizeRecordBody("---\nid: x\n---\nbody"))).toBe("frontmatter_not_allowed");
    expect(code(() => normalizeRecordBody("﻿---\nx"))).toBe("frontmatter_not_allowed");
    expect(normalizeRecordBody("text\r\nmore")).toBe("text\nmore\n");
    expect(code(() => normalizeRecordBody("가".repeat(22_000)))).toBe("invalid_record");
    expect(code(() => normalizeRecordBody("a".repeat(65_535)))).toBeNull();
  });
});

describe("lesson, playbook, voice and voice guide rules", () => {
  const lesson = [
    "## Situation", "Deploy failed.", "## What was done", "Retried blindly.", "## Next time", "Read the log first.",
    "## Evidence", "- AH-1849 on 2026-10-12", "## Confirmed", "2 times, last 2026-10-13", "",
  ].join("\n");

  it("accepts a complete lesson and a retraction, rejects incomplete ones", () => {
    expect(checkLesson(lesson)).toEqual({ retraction: null });
    expect(checkLesson("Retracted 2026-10-13: the log was wrong.\n\nold text\n")).toEqual({
      retraction: { date: "2026-10-13", why: "the log was wrong." },
    });
    expect(code(() => checkLesson(lesson.replace("## Next time", "## Later")))).toBe("invalid_record");
    expect(code(() => checkLesson(lesson.replace("- AH-1849 on 2026-10-12", "- yesterday")))).toBe("invalid_record");
    expect(code(() => checkLesson(lesson.replace("- AH-1849 on 2026-10-12", "- 2026-10-12: fixed")))).toBe("invalid_record");
    expect(code(() => checkLesson(lesson.replace("2 times, last 2026-10-13", "often")))).toBe("invalid_record");
  });

  const playbookLine = (when: string, count: number, date: string, id: string) =>
    `- ${when} → read the log first (${count}회, ${date}) [[${id}]]`;

  it("validates playbook lines and trims lowest count, then oldest date", () => {
    expect(code(() => applyPlaybookRules("- when deploy fails, read the log\n"))).toBe("invalid_record");
    expect(applyPlaybookRules(`${playbookLine("deploy", 2, "2026-10-12", "a")}\n- x → y (3 times, 2026-10-01) [[b]]\n`).dropped).toEqual([]);
    const filler = "x".repeat(1_900);
    const body = [
      playbookLine(`keep ${filler}`, 5, "2026-01-01", "a"),
      playbookLine(`newer ${filler}`, 1, "2026-10-10", "b"),
      playbookLine(`older ${filler}`, 1, "2026-09-01", "c"),
    ].join("\n") + "\n";
    const trimmed = applyPlaybookRules(body);
    expect(trimmed.dropped.map((line) => line.slice(2, 7))).toEqual(["older"]);
    expect(trimmed.body.length).toBeLessThanOrEqual(4_001);
    expect(trimmed.body).toContain("keep");
  });

  it("validates voice traits, refuses quoted messages, trims at 2,000 characters", () => {
    expect(applyVoiceRules("- writes short replies (4회, 2026-10-13)\n").dropped).toEqual([]);
    expect(code(() => applyVoiceRules("- greets with \"hello there my friend\" (1회, 2026-10-13)\n"))).toBe("invalid_record");
    expect(code(() => applyVoiceRules("- no count here\n"))).toBe("invalid_record");
    const long = Array.from({ length: 30 }, (_, index) => `- trait ${index} ${"y".repeat(60)} (${index + 1} times, 2026-10-13)`).join("\n") + "\n";
    const trimmed = applyVoiceRules(long);
    expect(trimmed.body.length).toBeLessThanOrEqual(2_001);
    expect(trimmed.dropped[0]).toContain("trait 0 ");
  });

  it("protects (user, …) voice-guide lines unless the person asked", () => {
    const previous = "- Reply in Korean (user, 2026-10-01)\n- Keep it short\n";
    expect(applyVoiceGuideRules("- Reply in Korean (user, 2026-10-01)\n- Keep it brief\n", previous, false)).toContain("brief");
    expect(code(() => applyVoiceGuideRules("- Keep it short\n", previous, false))).toBe("protected_record");
    expect(code(() => applyVoiceGuideRules("- Reply in English (user, 2026-10-13)\n", previous, false))).toBe("protected_record");
    expect(applyVoiceGuideRules("- Reply in English (user, 2026-10-13)\n", previous, true)).toContain("English");
    expect(code(() => applyVoiceGuideRules("Reply in Korean\n", null, false))).toBe("invalid_record");
  });

  it("removes playbook lines linking a retracted lesson", () => {
    const playbook = `${playbookLine("a", 1, "2026-10-01", "deploy-log")}\n${playbookLine("b", 1, "2026-10-01", "other")}\n`;
    const pruned = removePlaybookLinks(playbook, "deploy-log");
    expect(pruned.removed).toHaveLength(1);
    expect(pruned.body).not.toContain("deploy-log");
    expect(pruned.body).toContain("[[other]]");
  });
});

describe("journal lines", () => {
  const now = new Date("2026-10-13T13:00:00Z");

  it("requires an offset and refuses the future", () => {
    expect(journalTime(undefined, now)).toBe(now);
    expect(journalTime("2026-10-13T21:40:00+09:00", now).toISOString()).toBe("2026-10-13T12:40:00.000Z");
    expect(code(() => journalTime("2026-10-13T21:40:00", now))).toBe("invalid_request");
    expect(code(() => journalTime("2026-10-13T13:06:00Z", now))).toBe("invalid_request");
    expect(code(() => journalTime("2026-10-13T13:04:00Z", now))).toBeNull();
  });

  it("files the event under its UTC day with references as suffixes", () => {
    const time = journalTime("2026-10-14T01:30:00+09:00", new Date("2026-10-14T00:00:00Z"));
    expect(journalDay(time)).toBe("2026-10-13");
    expect(journalLine(time, "Deployed v2", ["release", "ops"])).toBe("- 16:30 | Deployed v2 [[release]] [[ops]]");
  });

  it("validates text and references", () => {
    expect(code(() => normalizeJournalText("two\nlines"))).toBe("invalid_record");
    expect(code(() => normalizeJournalText("x".repeat(501)))).toBe("invalid_record");
    expect(normalizeJournalText(` ${"가".repeat(500)} `)).toHaveLength(500);
    expect(code(() => normalizeJournalReferences(["Not An Id"]))).toBe("invalid_record");
  });

  it("inserts in time order without touching existing lines and dedupes identical lines", () => {
    const body = "- 09:00 | first\n- 11:00 | third\n";
    const inserted = insertJournalLine(body, "- 10:00 | second");
    expect(inserted.body).toBe("- 09:00 | first\n- 10:00 | second\n- 11:00 | third\n");
    expect(insertJournalLine(inserted.body, "- 10:00 | second")).toEqual({ body: inserted.body, duplicate: true });
    expect(insertJournalLine(body, "- 11:00 | same minute").body).toBe("- 09:00 | first\n- 11:00 | third\n- 11:00 | same minute\n");
    expect(insertJournalLine(body, "- 08:00 | earliest").body.split("\n")[0]).toBe("- 08:00 | earliest");
    expect(insertJournalLine("", "- 08:00 | only").body).toBe("- 08:00 | only\n");
  });
});

describe("secret detector", () => {
  const flagged = [
    "password: hunter2",
    "The wifi password is Sunflower!",
    "비밀번호는 abcd1234 입니다",
    "api_key = sk-proj-abcdefghijklmnopqrstuvwxyz123456",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB",
    "art_v2_0123456789abcdef0123?expires=1760000000",
    "worker token briar_worker_0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    "claim briar_channel_claim_8c2b1f0e7d6a5948372615a4b3c2d1e0",
    "AWS key AKIAIOSFODNN7EXAMPLE",
    // Assembled at runtime so the repository secret scanner does not flag the fixture.
    ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join("."),
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
    "card 4111 1111 1111 1111 exp 12/30",
    "인증번호 482913 입력",
    "your verification code: 482913",
    "the code is 123456",
    `client_secret: ${"Zm9vYmFyYmF6"}${"cXV4MTIzNDU2Nzg5"}`,
    "Authorization: Bearer abcDEF1234567890ghijKLMN",
  ];
  const clean = [
    "The password was rotated yesterday; ask the owner for access.",
    "Store tokens in 1Password, never in memory.",
    "password: <redacted>",
    "We discussed the token budget for the model.",
    "Order 4111111111111112 shipped",
    "error code 404 on the login page",
    "Meeting on 2026-10-13 at 10:00, room 1203",
    "Phone 010-1234-5678",
    "Table briar_memory_vault_records holds the index",
    "Version 1.2.232 released; PR #1849 merged",
    "Use sk- prefixes in docs as an example only",
  ];

  it.each(flagged)("flags %s", (text) => {
    expect(detectSecrets(text)).not.toEqual([]);
  });

  it.each(clean)("passes %s", (text) => {
    expect(detectSecrets(text)).toEqual([]);
  });
});

describe("commit trailers", () => {
  const message = vaultCommitMessage("memory: save secret-person r2", {
    vaultId: "v1", operation: "save", requestId: "req-1", payloadHash: "a".repeat(64), actor: "agent:a1", claim: "job-1",
    records: [
      { recordId: "secret-person", path: "entities/people/secret-person.md", revision: 2 },
      { recordId: "playbook", path: "playbook.md", revision: 5 },
    ],
    journalLine: "- 10:00 | Retracted lesson: x [[secret-person]]",
  });

  it("round-trips", () => {
    expect(parseVaultCommitMessage(message)).toEqual({
      vaultId: "v1", operation: "save", requestId: "req-1", payloadHash: "a".repeat(64), actor: "agent:a1", claim: "job-1",
      records: [
        { recordId: "secret-person", path: "entities/people/secret-person.md", revision: 2 },
        { recordId: "playbook", path: "playbook.md", revision: 5 },
      ],
      journalLine: "- 10:00 | Retracted lesson: x [[secret-person]]",
    });
    expect(parseVaultCommitMessage("plain message")).toBeNull();
  });

  it("scrubs the forgotten record from subject and trailers", () => {
    const scrubbed = scrubVaultCommitMessage(message, new Set(["secret-person"]), new Set(["entities/people/secret-person.md"]));
    expect(scrubbed.split("\n")[0]).toBe("memory: update");
    expect(scrubbed).not.toContain("entities/people/secret-person.md");
    expect(parseVaultCommitMessage(scrubbed)?.records).toEqual([{ recordId: "playbook", path: "playbook.md", revision: 5 }]);
  });
});
