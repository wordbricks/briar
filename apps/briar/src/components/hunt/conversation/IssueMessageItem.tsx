import { BadgeCheck, ChevronRight, CircleAlert, CornerUpLeft, MessageCircle, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useMemo, useRef, type ComponentProps } from "react";
import { MarkdownContent, defaultMarkdownUrlTransform } from "@/components/MarkdownContent";
import { issueAttachmentReference } from "@/lib/issue-markdown";
import { mentionHandle } from "@/lib/channel-mentions";
import { isIssueMentionUrl, issueMentionHandleFromUrl, remarkIssueMentions } from "@/lib/issue-mentions";
import { ConversationReplySummary, type ConversationReplyParticipant } from "@/components/ConversationReplySummary";
import { IssueExecutionApproval } from "@/components/IssueExecutionApproval";
import { AgentSkillExecutionApproval } from "@/components/AgentSkillExecutionApproval";
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, ExecutionWorker, HuntRun, IssueAttachment, IssueMessage, IssueExecutionApprovalInput, IssueExecutionProposal, ProjectExecutionWorkerPolicy } from "@/types";
import { useI18n } from "@/i18n";
import { IssueMarkdownImage } from "./IssueMarkdownImage";
import { MessageAvatar } from "./MessageAvatar";
import { formatDate, relativeTime } from "../model/formatters";
export function IssueMessageItem({
  currentUserId = null,
  highlighted = false,
  isEditing = false,
  isReplying = false,
  localeTag,
  message,
  mentionHandles,
  onMentionOpen,
  onAcceptIssueAction,
  onAcceptIssueExecution,
  onAcceptSkillExecution,
  onExecutionProposalAccepted,
  onSkillExecutionProposalAccepted,
  loadSkillExecutionContext,
  executionPolicy,
  executionRun,
  executionWorkers,
  onDelete,
  onEdit,
  onIssueOpen,
  onLoadAttachment,
  onReply,
  parentMessage = null,
  replyParticipants,
  lastReplyAt,
  replyComposerId,
  editComposerId,
  actionProposalState,
  actionError,
  reworkStageLabel
}: {
  currentUserId?: string | null;
  highlighted?: boolean;
  isEditing?: boolean;
  isReplying?: boolean;
  localeTag: string;
  message: IssueMessage;
  mentionHandles: readonly string[];
  onMentionOpen: (handle: string) => void;
  onAcceptIssueAction?: () => void;
  onAcceptIssueExecution?: (input: IssueExecutionApprovalInput) => Promise<IssueExecutionProposal>;
  onAcceptSkillExecution?: (input: AgentSkillExecutionApprovalInput) => Promise<AgentSkillExecutionProposal>;
  onExecutionProposalAccepted: (proposal: IssueExecutionProposal) => void;
  onSkillExecutionProposalAccepted: (proposal: AgentSkillExecutionProposal) => void;
  onIssueOpen?: (runId: string) => void;
  loadSkillExecutionContext: () => Promise<{
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  executionPolicy?: ProjectExecutionWorkerPolicy;
  executionRun: HuntRun | null;
  executionWorkers: ExecutionWorker[];
  onDelete?: () => void;
  onEdit?: () => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onReply?: () => void;
  parentMessage?: IssueMessage | null;
  replyParticipants: readonly ConversationReplyParticipant[];
  lastReplyAt: string | null;
  replyComposerId?: string;
  editComposerId?: string;
  actionProposalState?: {
    accepting: boolean;
    error: string | null;
  };
  actionError?: string | null;
  reworkStageLabel?: string | null;
}) {
  const {
    t
  } = useI18n();
  const remarkPlugins = useMemo(() => [remarkIssueMentions(mentionHandles)], [mentionHandles]);
  const messageAttachmentsRef = useRef(message.attachments ?? []);
  messageAttachmentsRef.current = message.attachments ?? [];
  const renderMessageMarkdownImage = useCallback(({
    alt,
    src
  }: ComponentProps<"img">) => <IssueMarkdownImage alt={alt ?? ""} attachments={messageAttachmentsRef.current} onLoadAttachment={onLoadAttachment} src={src} />, [onLoadAttachment]);
  const canManage = Boolean(currentUserId && message.author.id === currentUserId && onEdit && onDelete);
  const proposal = message.proposedAction;
  const proposalTitle = proposal?.type === "request_issue_update" ? t("run.issueUpdateProposalTitle") : proposal?.type === "request_issue_create" ? t("run.issueCreateProposalTitle") : t("run.reworkProposalTitle");
  const proposalAcceptLabel = proposal?.type === "request_issue_update" ? t("run.issueUpdateProposalAccept") : proposal?.type === "request_issue_create" ? t("run.issueCreateProposalAccept") : t("run.reworkProposalAccept");
  return <article aria-current={highlighted ? "true" : undefined} className={`issue-message${highlighted ? " is-inbox-target" : ""}${message.optimistic ? " is-optimistic" : ""}`} data-issue-message-id={message.id} data-inbox-highlighted={highlighted ? "true" : undefined} tabIndex={highlighted ? -1 : undefined}>
      <MessageAvatar message={message} />
      <div>
        <header>
          <strong>{message.author.name}</strong>
          <time dateTime={message.createdAt}>
            {formatDate(message.createdAt, localeTag)}
          </time>
        </header>
        {parentMessage ? <blockquote className="issue-message-parent-quote">
            <CornerUpLeft aria-hidden="true" size={13} />
            <span>{parentMessage.body}</span>
          </blockquote> : null}
        <MarkdownContent className="issue-message-body" components={{
        a: ({
          children,
          href,
          node: _node,
          ...props
        }) => {
          const mentionHandle = issueMentionHandleFromUrl(href);
          const isMention = mentionHandle !== null;
          if (isMention) {
            return <button className="conversation-mention-button issue-mention-button" onClick={event => {
              event.preventDefault();
              onMentionOpen(mentionHandle);
            }} type="button">
                    {children}
                  </button>;
          }
          return <a {...props} className={props.className} href={href} onClick={props.onClick}>
                  {children}
                </a>;
        },
        img: renderMessageMarkdownImage
      }} remarkPlugins={remarkPlugins} urlTransform={url => isIssueMentionUrl(url) || issueAttachmentReference(url) ? url : defaultMarkdownUrlTransform(url)}>
          {message.body}
        </MarkdownContent>
        {proposal ? <section className="issue-rework-proposal">
            <header>
              <strong>{proposalTitle}</strong>
              {proposal.type === "request_issue_rework" ? <small>
                  {t("run.reworkProposalStage", {
              stage: reworkStageLabel ?? proposal.workflowStage
            })}
                </small> : proposal.type === "request_issue_create" ? <small>
                  {t("channel.issueProposalBacklogOnly")}
                </small> : null}
            </header>
            {proposal.type === "request_issue_rework" ? <p>{proposal.reason}</p> : proposal.type === "request_issue_update" ? <dl className="issue-action-proposal-fields">
                {proposal.changes.title !== undefined ? <div><dt>{t("run.issueProposalTitleField")}</dt><dd>{proposal.changes.title}</dd></div> : null}
                {proposal.changes.description !== undefined ? <div><dt>{t("run.issueProposalDescriptionField")}</dt><dd>{proposal.changes.description || t("run.issueProposalClearValue")}</dd></div> : null}
                {proposal.changes.priority !== undefined ? <div><dt>{t("run.issueProposalPriorityField")}</dt><dd>{proposal.changes.priority ? `P${proposal.changes.priority}` : t("run.issueProposalClearValue")}</dd></div> : null}
              </dl> : <div className="issue-action-proposal-create">
                <strong>{proposal.issue.title}</strong>
                {proposal.issue.description ? <p>{proposal.issue.description}</p> : null}
                <small>
                  {t("run.issueProposalPriorityField")}: {proposal.issue.priority ? `P${proposal.issue.priority}` : t("run.issueProposalClearValue")}
                </small>
                {proposal.executeAfterCreate ? <small>{t("channel.issueProposalExecutionRequested")}</small> : null}
              </div>}
            {proposal.status === "accepted" ? <>
                <div className="issue-rework-proposal-accepted">
                  <BadgeCheck aria-hidden="true" size={15} />
                  {proposal.type === "request_issue_rework" ? t("run.reworkProposalAccepted", {
              revision: proposal.appliedRevision ?? ""
            }) : proposal.type === "request_issue_create" ? t("run.issueCreateProposalAccepted") : t("run.issueUpdateProposalAccepted")}
                </div>
                {proposal.type === "request_issue_create" && proposal.resultRunId && onIssueOpen ? <button className="issue-rework-proposal-view" onClick={() => onIssueOpen(proposal.resultRunId!)} type="button">
                    <ChevronRight aria-hidden="true" size={15} />
                    {t("channel.viewIssue")}
                  </button> : null}
              </> : onAcceptIssueAction ? <button className="issue-rework-proposal-accept" disabled={actionProposalState?.accepting} onClick={onAcceptIssueAction} type="button">
                {actionProposalState?.accepting ? <Spinner aria-hidden="true" size={15} /> : proposal.type === "request_issue_create" ? <Plus aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
                {actionProposalState?.accepting ? t("run.reworkProposalAccepting") : proposalAcceptLabel}
              </button> : null}
            {actionProposalState?.error ? <p className="issue-rework-proposal-error">
                <CircleAlert aria-hidden="true" size={14} />
                {actionProposalState.error}
              </p> : null}
          </section> : null}
        {message.executionProposal ? <IssueExecutionApproval disabledReason={!onAcceptIssueExecution ? t("executionApproval.approvalUnavailable") : null} executionContext={{
        run: executionRun,
        workers: executionWorkers,
        policy: executionPolicy
      }} onAccept={async input => {
        if (!onAcceptIssueExecution) {
          throw new Error(t("executionApproval.targetUnavailable"));
        }
        return onAcceptIssueExecution(input);
      }} onAccepted={onExecutionProposalAccepted} onIssueOpen={onIssueOpen} proposal={message.executionProposal} surfaceKey={`${executionRun?.id ?? message.executionProposal.runId}:${message.id}`} /> : null}
        {message.skillExecutionProposal ? <AgentSkillExecutionApproval disabledReason={!onAcceptSkillExecution ? t("skillExecution.approvalUnavailable") : null} loadExecutionContext={loadSkillExecutionContext} onAccept={async input => {
        if (!onAcceptSkillExecution) {
          throw new Error(t("skillExecution.approvalUnavailable"));
        }
        return onAcceptSkillExecution(input);
      }} onAccepted={onSkillExecutionProposalAccepted} proposal={message.skillExecutionProposal} surfaceKey={`${message.runId}:${message.id}`} /> : null}
        {message.replyCount > 0 ? <ConversationReplySummary countLabel={t("run.replies", {
        count: message.replyCount
      })} lastReplyLabel={lastReplyAt ? t("conversation.lastReply", {
        time: relativeTime(lastReplyAt, t)
      }) : null} participants={replyParticipants} /> : null}
      </div>
      {(onReply || canManage) && <div aria-label={t("run.replyInThread")} className="issue-message-actions" role="toolbar">
          {onReply ? <button aria-controls={replyComposerId} aria-expanded={isReplying} aria-label={t("run.replyInThread")} className="issue-reply-trigger" onClick={onReply} title={t("run.replyInThread")} type="button">
              <MessageCircle aria-hidden="true" size={16} />
            </button> : null}
          {canManage ? <>
              <button aria-controls={editComposerId} aria-expanded={isEditing} aria-label={t("run.editMessage")} className="issue-reply-trigger" onClick={onEdit} title={t("run.editMessage")} type="button">
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button aria-label={t("run.deleteMessage")} className="issue-reply-trigger" onClick={onDelete} title={t("run.deleteMessage")} type="button">
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </> : null}
        </div>}
      {actionError ? <p className="issue-message-action-error">
          <CircleAlert aria-hidden="true" size={14} />
          {actionError}
        </p> : null}
    </article>;
}
