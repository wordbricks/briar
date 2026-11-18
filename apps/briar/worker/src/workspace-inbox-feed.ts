import { buildInboxFeedMessages } from "./inbox-feed";
import { listDashboardRuns } from "./hunt-run-read-repository";
import {
  listChannelConversationNotifications,
  listIssueConversationNotifications,
  listWorkspaceIssueSubscriptionRunIds,
} from "./issue-notification-repository";
import { issueSubscribers } from "./issue-subscribers";
import { listTeamAgentSessionSummaries } from "./team-agent-session-repository";
import { listWorkspaceInboxTeams } from "./team-repository";

const occurredAtOrAfter = (occurredAt: string, subscribedAt: string) => {
  const occurredTime = Date.parse(occurredAt);
  const subscribedTime = Date.parse(subscribedAt);
  return Number.isFinite(occurredTime) &&
    Number.isFinite(subscribedTime) &&
    occurredTime >= subscribedTime;
};

export async function loadWorkspaceInboxFeed(
  db: D1Database,
  workspaceId: string,
  userId: string,
) {
  const projects = await listWorkspaceInboxTeams(
    db,
    workspaceId,
    userId,
  );
  const [projectData, channelNotifications, subscribedIssueIds] =
    await Promise.all([
      Promise.all(
        projects.map(async (project) => {
          const [runs, conversationNotifications, sessionSummaries] =
            await Promise.all([
              listDashboardRuns(db, project.id),
              listIssueConversationNotifications(db, project.id, userId),
              listTeamAgentSessionSummaries(
                db,
                project.id,
                undefined,
                userId,
              ),
            ]);
          return {
            project,
            runs: runs.filter((run) => {
              const subscription = issueSubscribers(run).find(
                (subscriber) => subscriber.userId === userId,
              );
              return Boolean(
                subscription && occurredAtOrAfter(
                  run.last_event_at,
                  subscription.subscribedAt,
                ),
              );
            }),
            conversationNotifications,
            sessionSummaries,
          };
        }),
      ),
      listChannelConversationNotifications(db, workspaceId, userId),
      listWorkspaceIssueSubscriptionRunIds(db, workspaceId, userId),
    ]);
  return {
    messages: buildInboxFeedMessages(
      projectData,
      channelNotifications,
      userId,
    ),
    subscribedIssueIds,
    generatedAt: new Date().toISOString(),
  };
}
