/**
 * Generates apps/briar/migrations/0218_issue_attachment_sources.sql.
 *
 * Two edits, both of which have to reproduce long existing DDL verbatim apart
 * from the clause being changed:
 *
 *   1. `briar_issue_attachments.content_type` gains the document types a DM
 *      composer accepts. SQLite cannot alter a CHECK in place, so the leaf
 *      table is rebuilt and its indexes and triggers are recreated.
 *   2. The two `briar_hunt_runs` guard triggers that assert "the created run is
 *      exactly what was approved" learn the four-key proposal payload.
 *
 * Both are derived from migrations-snapshot/schema.sql rather than retyped:
 * each guard trigger runs to ~130 lines of assertions, and a clause lost in
 * transcription silently removes a guard. Every substitution below asserts it
 * matched exactly once, so a snapshot that drifts fails the generator instead
 * of producing a quietly weaker trigger.
 *
 * Run: bun run scripts/generate-issue-attachment-sources-migration.ts
 */
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const snapshotPath = resolve(
  repoRoot,
  "apps/briar/migrations-snapshot/schema.sql",
);
const migrationPath = resolve(
  repoRoot,
  "apps/briar/migrations/0218_issue_attachment_sources.sql",
);

const snapshot = await Bun.file(snapshotPath).text();
const snapshotStatements = snapshot
  .split("-- @statement\n")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

const statementStartingWith = (prefix: string) => {
  const matches = snapshotStatements.filter((statement) =>
    statement.startsWith(prefix)
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one snapshot statement starting with ${prefix}, found ${matches.length}`,
    );
  }
  return matches[0]!.replace(/;$/, "");
};

const replaceOnce = (source: string, find: string, replacement: string) => {
  const occurrences = source.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one occurrence of:\n${find}\nfound ${occurrences}`,
    );
  }
  return source.replace(find, replacement);
};

const issueAttachmentsTable = statementStartingWith(
  "CREATE TABLE briar_issue_attachments (",
);
const issueAttachmentsIndexes = [
  "CREATE INDEX briar_issue_attachments_run_idx",
  "CREATE INDEX briar_issue_attachments_project_idx",
].map(statementStartingWith);
const issueAttachmentsTriggers = [
  "CREATE TRIGGER briar_dashboard_attachments_insert_sync",
  "CREATE TRIGGER briar_dashboard_attachments_delete_sync",
].map(statementStartingWith);

const widenedIssueAttachmentsTable = replaceOnce(
  issueAttachmentsTable,
  `  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'video/mp4', 'video/webm', 'video/quicktime'
  )),`,
  `  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/markdown', 'text/plain'
  )),`,
);

/*
  A proposal stored before attachments could travel has three keys under
  `$.issue`; one stored after it has four, the fourth being `attachmentIds`.
  Both shapes stay approvable: the 24 pending three-key proposals in production
  cannot be rewritten (briar_channel_issue_proposal_payload_immutable forbids
  it), and rejecting them here would strand them permanently.
*/
const payloadKeyCount = `        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 3`;
const widenedPayloadKeyCount = `        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) in (3, 4)
        and (
          (
            select count(*)
            from json_each(proposal.payload_json, '$.issue')
          ) = 3
          or json_type(
            proposal.payload_json, '$.issue.attachmentIds'
          ) = 'array'
        )`;

/*
  The run's attachment count is bound to the approved payload rather than
  pinned to zero, so the run carries exactly the files the member saw on the
  card. A missing `attachmentIds` is the three-key shape, which named none.
*/
const attachmentCountAssertion =
  `        and json_extract(new.context_json, '$.attachmentCount') = 0`;
const boundAttachmentCountAssertion =
  `        and json_extract(new.context_json, '$.attachmentCount')
          = coalesce(
            json_array_length(proposal.payload_json, '$.issue.attachmentIds'),
            0
          )`;

const rebuiltGuardTrigger = (name: string) => {
  const trigger = statementStartingWith(`CREATE TRIGGER ${name}\n`);
  const widened = replaceOnce(
    replaceOnce(trigger, payloadKeyCount, widenedPayloadKeyCount),
    attachmentCountAssertion,
    boundAttachmentCountAssertion,
  );
  return `drop trigger if exists "${name}";\n\n${widened};`;
};

const header = `-- Carry DM and channel attachments onto the issue an approved proposal
-- creates, and let those files keep their own types.
--
-- Run a98bf275-d5d6-5e66-aa5f-89e77a4ca34a blocked on
-- missing-source-attachments: the user had attached two Markdown files to the
-- DM the Agent turned into an issue, and the created run carried none of them.
-- Two things were in the way. briar_issue_attachments accepted only image,
-- text/html and video types, so a Markdown or PDF source file could not be
-- stored at all; and the guard triggers below pinned every channel-approved
-- run to \`attachmentCount = 0\`, which is what made "no attachments" the only
-- legal outcome rather than an accident of the write path.
--
-- Row cost: briar_issue_attachments held 387 rows in production on 2026-09-09
-- and nothing foreign-keys into it, so the rebuild parks and restores those
-- 387 rows and reaches no descendant. Two indexes and two sync triggers are
-- recreated after the restore, plus the two briar_hunt_runs guard triggers
-- this migration rewrites. Well under 1,200 rows written in total.
--
-- Generated by scripts/generate-issue-attachment-sources-migration.ts.

-- Widen briar_issue_attachments.content_type to the union with the channel
-- composer's allowlist, so a file a user attached in a DM can be stored
-- against the issue that DM produced. A leaf table with no foreign-key
-- descendants, so the drop cascades nowhere; its own indexes and triggers go
-- with it and are recreated below.
pragma defer_foreign_keys = on;`;

const migration = [
  header,
  "create table briar_issue_attachment_type_backup as\nselect * from briar_issue_attachments;",
  "drop table briar_issue_attachments;",
  `${widenedIssueAttachmentsTable};`,
  "insert into briar_issue_attachments\nselect * from briar_issue_attachment_type_backup;",
  "drop table briar_issue_attachment_type_backup;",
  ...issueAttachmentsIndexes.map((index) => `${index};`),
  ...issueAttachmentsTriggers.map((trigger) => `${trigger};`),
  "pragma defer_foreign_keys = off;",
  `-- Teach the two guards that assert "the created run is exactly what was
-- approved" about the payload's fourth key. They are reproduced verbatim from
-- the schema snapshot apart from the two clauses named above; every other
-- assertion is unchanged.`,
  rebuiltGuardTrigger(
    "briar_hunt_runs_channel_proposal_reservation_required",
  ),
  rebuiltGuardTrigger("briar_hunt_runs_finalize_channel_proposal_approval"),
].join("\n\n");

await Bun.write(migrationPath, `${migration}\n`);
console.log(`wrote ${migrationPath}`);
