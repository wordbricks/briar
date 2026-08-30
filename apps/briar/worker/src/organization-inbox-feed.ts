import { buildInboxFeedMessages } from "./inbox-feed";
import { listDashboardRuns } from "./hunt-run-read-repository";
import {
  listChannelConversationNotifications,
  listIssueConversationNotifications,
  listOrganizationIssueSubscriptionRunIds,
} from "./issue-notification-repository";
import { issueSubscribers } from "./issue-subscribers";
import { listProjectAgentSessionSummaries } from "./project-agent-session-repository";
import { listOrganizationInboxProjects } from "./project-repository";

const occurredAtOrAfter = (occurredAt: string, subscribedAt: string) => {
  const occurredTime = Date.parse(occurredAt);
  const subscribedTime = Date.parse(subscribedAt);
  return Number.isFinite(occurredTime) &&
    Number.isFinite(subscribedTime) &&
    occurredTime >= subscribedTime;
};

export async function loadOrganizationInboxFeed(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const projects = await listOrganizationInboxProjects(
    db,
    organizationId,
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
              listProjectAgentSessionSummaries(
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
      listChannelConversationNotifications(db, organizationId, userId),
      listOrganizationIssueSubscriptionRunIds(db, organizationId, userId),
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
