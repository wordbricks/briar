export type IssueResultReviewRow = {
  run_id: string;
  user_id: string;
  name: string;
  username: string | null;
  image: string | null;
  completed_at: string;
};

export async function listIssueResultReviewsByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const reviews = await db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where run.project_id = ?
         and review.run_id in (select value from json_each(?))
       order by review.completed_at asc, lower(user.name), user.id`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<IssueResultReviewRow>();
  return reviews.results;
}

export async function completeIssueResultReview(
  db: D1Database,
  projectId: string,
  runId: string,
  reviewerUserId: string,
  completedAt: string,
) {
  await db
    .prepare(
      `insert into briar_issue_result_reviews (
         run_id, reviewer_user_id, completed_at
       )
       select run.id, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
       on conflict (run_id, reviewer_user_id) do nothing`,
    )
    .bind(reviewerUserId, completedAt, runId, projectId)
    .run();

  return db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where review.run_id = ? and review.reviewer_user_id = ?
         and run.project_id = ?`,
    )
    .bind(runId, reviewerUserId, projectId)
    .first<IssueResultReviewRow>();
}
