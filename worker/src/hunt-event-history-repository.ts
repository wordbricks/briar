import { type HuntEventRow } from "./hunt-event-model";

export async function listHuntRunEvents(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const events = await db
    .prepare(
      `select event.id, event.run_id, event.event_key, event.attempt,
              event.revision, event.stage, event.status, event.workflow_stage,
              event.detail, event.actor, event.branch, event.commit_sha,
              event.qa_status, event.tracker_issue_state,
              event.pull_request_urls, event.target_sha,
              event.occurred_at, event.recorded_at
       from briar_hunt_events event
       join briar_hunt_runs run on run.id = event.run_id
       where run.project_id = ? and event.run_id = ?
       order by event.occurred_at desc, event.id desc`,
    )
    .bind(projectId, runId)
    .all<HuntEventRow>();

  return events.results;
}

export async function resolveHuntEventActorNames(
  db: D1Database,
  projectId: string,
  actors: readonly string[],
) {
  const userIds = [...new Set(
    actors
      .filter((actor) => actor.startsWith("briar-app:"))
      .map((actor) => actor.slice("briar-app:".length))
      .filter(Boolean),
  )];
  const names = new Map<string, string>();
  const chunkSize = 50;
  for (let offset = 0; offset < userIds.length; offset += chunkSize) {
    const chunk = userIds.slice(offset, offset + chunkSize);
    const users = await db
      .prepare(
        `select account.id, account.name
         from "user" account
         join briar_organization_members member on member.user_id = account.id
         join briar_projects project
           on project.organization_id = member.organization_id
         where project.id = ?
           and account.id in (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(projectId, ...chunk)
      .all<{ id: string; name: string }>();
    for (const user of users.results) {
      names.set(`briar-app:${user.id}`, user.name);
    }
  }
  return names;
}
