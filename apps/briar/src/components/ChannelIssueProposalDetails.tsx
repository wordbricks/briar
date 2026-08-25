import * as Option from "effect/Option";
import { useState } from "react";
import { useI18n } from "../i18n";
import {
  decodeChannelIssueBatchProposalPayloadOption,
  decodeChannelIssueProposalPayloadOption,
  type ChannelMessageProposal,
} from "../lib/channels-contract";

export function channelIssueProposalDetails(
  proposal: ChannelMessageProposal | null | undefined,
) {
  if (proposal?.actionType !== "request_issue_create") return null;
  return Option.match(
    decodeChannelIssueProposalPayloadOption(proposal.payload),
    {
      onNone: () => null,
      onSome: (payload) => payload.issue,
    },
  );
}

export function channelIssueBatchProposalDetails(
  proposal: ChannelMessageProposal | null | undefined,
) {
  if (proposal?.actionType !== "request_issue_create") return null;
  return Option.match(
    decodeChannelIssueBatchProposalPayloadOption(proposal.payload),
    {
      onNone: () => null,
      onSome: (payload) => payload.batch,
    },
  );
}

export function channelIssueProposalIsValid(
  proposal: ChannelMessageProposal | null | undefined,
) {
  return Boolean(
    channelIssueProposalDetails(proposal) ||
      channelIssueBatchProposalDetails(proposal),
  );
}

export function channelIssueProposalRequestsExecution(
  proposal: ChannelMessageProposal | null | undefined,
) {
  if (proposal?.actionType !== "request_issue_create") return false;
  return Option.match(
    decodeChannelIssueProposalPayloadOption(proposal.payload),
    {
      onNone: () => false,
      onSome: (payload) => payload.executeAfterCreate,
    },
  );
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
  const batch = channelIssueBatchProposalDetails(proposal);
  if (!issue && !batch) return null;
  const requestsExecution = channelIssueProposalRequestsExecution(proposal);
  const descriptionNeedsExpansion = Boolean(
    issue?.description &&
    (issue.description.length > 240 || issue.description.split("\n").length > 3),
  );

  if (batch) {
    const resultByKey = new Map(
      (proposal.resultItems ?? []).map((item) => [item.localKey, item.runId]),
    );
    return (
      <div className="channel-proposal-details channel-batch-proposal-details">
        <div className="channel-batch-proposal-summary">
          {t("channel.issueBatchProposalCount", { count: batch.items.length })}
        </div>
        <ol className="channel-batch-proposal-items">
          {batch.items.map((item) => (
            <li key={item.key}>
              <code>{item.key}</code>
              <span>{item.issue.title}</span>
              <small>
                {item.issue.priority === null
                  ? t("channel.issueProposalNoPriority")
                  : t("channel.issueProposalPriority", {
                      priority: item.issue.priority,
                    })}
              </small>
              {resultByKey.get(item.key) ? (
                <small className="channel-batch-proposal-result">
                  {t("channel.issueBatchProposalCreated", {
                    runId: resultByKey.get(item.key)!,
                  })}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
        {batch.dependencies.length > 0 ? (
          <div className="channel-batch-proposal-dependencies">
            <strong>{t("channel.issueBatchProposalDependencies")}</strong>
            <ul>
              {batch.dependencies.map((dependency) => (
                <li
                  key={`${dependency.prerequisiteKey}:${dependency.dependentKey}`}
                >
                  <code>{dependency.prerequisiteKey}</code>
                  <span aria-hidden="true">→</span>
                  <code>{dependency.dependentKey}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="channel-proposal-metadata">
          {projectName ? (
            <span>
              {t("channel.issueProposalProject", { project: projectName })}
            </span>
          ) : null}
          <span>{t("channel.issueBatchProposalBacklogOnly")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="channel-proposal-details">
      <strong className="channel-proposal-title">{issue!.title}</strong>
      {issue!.description ? (
        <>
          <p
            className={`channel-proposal-description${
              descriptionNeedsExpansion && !descriptionExpanded
                ? " is-collapsed"
                : " is-expanded"
            }`}
          >
            {issue!.description}
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
          {issue!.priority === null
            ? t("channel.issueProposalNoPriority")
            : t("channel.issueProposalPriority", { priority: issue!.priority })}
        </span>
        {projectName ? (
          <span>
            {t("channel.issueProposalProject", { project: projectName })}
          </span>
        ) : null}
        <span>
          {t(
            requestsExecution
              ? "channel.issueProposalCreateAndExecute"
              : "channel.issueProposalBacklogOnly",
          )}
        </span>
      </div>
      {requestsExecution ? (
        <p className="channel-proposal-execution-intent">
          {t("channel.issueProposalExecutionRequested")}
        </p>
      ) : null}
    </div>
  );
}
