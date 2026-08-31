import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("typed pull request evidence identity migration", () => {
  it("backfills real evidence associations and retires the parallel JSON identity", async () => {
    const db = env.DB;
    await executeD1Sql(db, `
      create table briar_run_evidence (
        id text primary key not null,
        run_id text not null,
        attempt integer not null,
        revision integer not null,
        evidence_type text not null,
        status text not null,
        metadata_json text
      );
      create table briar_run_pull_requests (
        run_id text not null,
        attempt integer not null,
        revision integer not null,
        repository_id integer not null,
        pull_request_id integer not null,
        pull_request_node_id text not null,
        pull_request_number integer not null,
        primary key (
          run_id, attempt, revision, repository_id, pull_request_number
        )
      );
    `);
    const identity = {
      repositoryId: 9001,
      repository: "example/repository",
      pullRequestId: 10042,
      pullRequestNodeId: "PR_node_42",
      pullRequestNumber: 42,
    };
    await db.batch([
      db.prepare(
        `insert into briar_run_pull_requests values (?, 1, 2, ?, ?, ?, ?)`,
      ).bind(
        "run-1",
        identity.repositoryId,
        identity.pullRequestId,
        identity.pullRequestNodeId,
        identity.pullRequestNumber,
      ),
      db.prepare(
        `insert into briar_run_evidence values (?, ?, 1, 2, ?, ?, ?)`,
      ).bind(
        "evidence-linked",
        "run-1",
        "pull_request",
        "passed",
        JSON.stringify({ githubPullRequest: identity, note: "keep" }),
      ),
      db.prepare(
        `insert into briar_run_evidence values (?, ?, 1, 2, ?, ?, ?)`,
      ).bind(
        "evidence-unbound",
        "run-1",
        "pull_request",
        "passed",
        JSON.stringify({
          githubPullRequest: { ...identity, pullRequestId: 99999 },
        }),
      ),
    ]);

    await applyD1Migrations(db, {
      files: ["0164_typed_run_evidence_pull_requests.sql"],
    });

    expect((await db.prepare(
      `select evidence_id, run_id, attempt, revision,
              repository_id, pull_request_number,
              pull_request_id, pull_request_node_id
       from briar_run_evidence_pull_requests`,
    ).all()).results).toEqual([{
      evidence_id: "evidence-linked",
      run_id: "run-1",
      attempt: 1,
      revision: 2,
      repository_id: 9001,
      pull_request_number: 42,
      pull_request_id: 10042,
      pull_request_node_id: "PR_node_42",
    }]);
    expect((await db.prepare(
      `select id, metadata_json from briar_run_evidence order by id`,
    ).all()).results).toEqual([
      { id: "evidence-linked", metadata_json: '{"note":"keep"}' },
      { id: "evidence-unbound", metadata_json: null },
    ]);
  });
});
