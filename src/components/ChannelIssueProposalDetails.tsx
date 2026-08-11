import { useState } from "react";
import { useI18n } from "../i18n";
import {
  channelIssueProposalPayloadSchema,
  type ChannelMessageProposal,
} from "../lib/channels-contract";

export function channelIssueProposalDetails(
  proposal: ChannelMessageProposal | null | undefined,
) {
  if (proposal?.actionType !== "request_issue_create") return null;
  const parsed = channelIssueProposalPayloadSchema.safeParse(proposal.payload);
  return parsed.success ? parsed.data.issue : null;
}

export function ChannelIssueProposalDetails({
  projectName,
  proposal,
}: {
  projectName: string | null;
  proposal: ChannelMessageProposal;
}) {
  const { t } = useI18n();
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const issue = channelIssueProposalDetails(proposal);
  if (!issue) return null;
  const descriptionNeedsExpansion = Boolean(
    issue.description &&
    (issue.description.length > 240 || issue.description.split("\n").length > 3),
  );

  return (
    <div className="channel-proposal-details">
      <strong className="channel-proposal-title">{issue.title}</strong>
      {issue.description ? (
        <>
          <p
            className={`channel-proposal-description${
              descriptionNeedsExpansion && !descriptionExpanded
                ? " is-collapsed"
                : " is-expanded"
            }`}
          >
            {issue.description}
          </p>
          {descriptionNeedsExpansion ? (
            <button
              aria-expanded={descriptionExpanded}
              className="channel-proposal-description-toggle"
              onClick={() => setDescriptionExpanded((expanded) => !expanded)}
              type="button"
            >
              {t(
                descriptionExpanded
                  ? "channel.issueProposalHideDescription"
                  : "channel.issueProposalShowDescription",
              )}
            </button>
          ) : null}
        </>
      ) : null}
      <div className="channel-proposal-metadata">
        <span>
          {issue.priority === null
            ? t("channel.issueProposalNoPriority")
            : t("channel.issueProposalPriority", { priority: issue.priority })}
        </span>
        {projectName ? (
          <span>
            {t("channel.issueProposalProject", { project: projectName })}
          </span>
        ) : null}
        <span>{t("channel.issueProposalBacklogOnly")}</span>
      </div>
    </div>
  );
}
