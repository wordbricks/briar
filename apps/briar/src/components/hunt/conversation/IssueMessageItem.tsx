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
import { cn } from "@/lib/utils";
export function IssueMessageItem({
  currentUserId = null,
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
  return <article className={cn("issue-message group relative grid min-w-0 max-w-full grid-cols-[34px_minmax(0,1fr)] items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-muted", message.optimistic && "is-optimistic bg-muted/60")}>
      <MessageAvatar message={message} />
      <div className="min-w-0 max-w-full">
        <header className="flex min-w-0 min-h-[19px] items-baseline gap-2">
          <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground">{message.author.name}</strong>
          <time className="shrink-0 font-mono text-2xs text-muted-foreground" dateTime={message.createdAt}>
            {formatDate(message.createdAt, localeTag)}
          </time>
        </header>
        {parentMessage ? <blockquote className="issue-message-parent-quote my-1.5 flex items-start gap-1.5 rounded-lg bg-muted/80 px-2 py-1.5 text-2xs leading-relaxed text-muted-foreground">
            <CornerUpLeft aria-hidden="true" size={13} />
            <span className="line-clamp-2 min-w-0 break-words whitespace-pre-wrap">{parentMessage.body}</span>
          </blockquote> : null}
        <MarkdownContent className="issue-message-body mt-0.5 min-w-0 max-w-full text-xs leading-[1.65] text-foreground [overflow-wrap:anywhere] [&>p]:m-0 [&>p]:whitespace-pre-wrap [&>p+p]:mt-2 [&_ul]:my-1.5 [&_ul]:pl-6 [&_ol]:my-1.5 [&_ol]:pl-6 [&_li+li]:mt-1 [&_blockquote]:my-1.5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-2.5 [&_img]:mt-2 [&_img]:block [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border [&_img]:object-contain" components={{
        a: ({
          children,
          href,
          node: _node,
          ...props
        }) => {
          const mentionHandle = issueMentionHandleFromUrl(href);
          const isMention = mentionHandle !== null;
          if (isMention) {
            return <button className="conversation-mention-button issue-mention-button rounded-md border-0 bg-secondary px-1 py-px font-semibold text-inherit outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={event => {
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
        {proposal ? <section className="issue-rework-proposal mt-2.5 grid min-w-0 max-w-full gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <header className="flex min-w-0 items-center justify-between gap-2.5">
              <strong className="min-w-0 break-words text-xs">{proposalTitle}</strong>
              {proposal.type === "request_issue_rework" ? <small className="min-w-0 break-words text-2xs text-muted-foreground">
                  {t("run.reworkProposalStage", {
              stage: reworkStageLabel ?? proposal.workflowStage
            })}
                </small> : proposal.type === "request_issue_create" ? <small className="min-w-0 break-words text-2xs text-muted-foreground">
                  {t("channel.issueProposalBacklogOnly")}
                </small> : null}
            </header>
            {proposal.type === "request_issue_rework" ? <p className="m-0 break-words text-xs leading-relaxed">{proposal.reason}</p> : proposal.type === "request_issue_update" ? <dl className="issue-action-proposal-fields m-0 grid min-w-0 gap-1.5">
                {proposal.changes.title !== undefined ? <div className="grid min-w-0 gap-0.5"><dt className="text-2xs font-semibold text-muted-foreground">{t("run.issueProposalTitleField")}</dt><dd className="m-0 break-words whitespace-pre-wrap text-xs leading-relaxed">{proposal.changes.title}</dd></div> : null}
                {proposal.changes.description !== undefined ? <div className="grid min-w-0 gap-0.5"><dt className="text-2xs font-semibold text-muted-foreground">{t("run.issueProposalDescriptionField")}</dt><dd className="m-0 break-words whitespace-pre-wrap text-xs leading-relaxed">{proposal.changes.description || t("run.issueProposalClearValue")}</dd></div> : null}
                {proposal.changes.priority !== undefined ? <div className="grid min-w-0 gap-0.5"><dt className="text-2xs font-semibold text-muted-foreground">{t("run.issueProposalPriorityField")}</dt><dd className="m-0 break-words text-xs leading-relaxed">{proposal.changes.priority ? `P${proposal.changes.priority}` : t("run.issueProposalClearValue")}</dd></div> : null}
              </dl> : <div className="issue-action-proposal-create grid min-w-0 gap-1.5">
                <strong className="break-words text-sm">{proposal.issue.title}</strong>
                {proposal.issue.description ? <p className="m-0 break-words text-xs leading-relaxed">{proposal.issue.description}</p> : null}
                <small className="text-2xs text-muted-foreground">
                  {t("run.issueProposalPriorityField")}: {proposal.issue.priority ? `P${proposal.issue.priority}` : t("run.issueProposalClearValue")}
                </small>
                {proposal.executeAfterCreate ? <small className="text-2xs text-muted-foreground">{t("channel.issueProposalExecutionRequested")}</small> : null}
              </div>}
            {proposal.status === "accepted" ? <>
                <div className="issue-rework-proposal-accepted flex items-center gap-1.5 break-words text-xs font-semibold text-primary">
                  <BadgeCheck aria-hidden="true" size={15} />
                  {proposal.type === "request_issue_rework" ? t("run.reworkProposalAccepted", {
              revision: proposal.appliedRevision ?? ""
            }) : proposal.type === "request_issue_create" ? t("run.issueCreateProposalAccepted") : t("run.issueUpdateProposalAccepted")}
                </div>
                {proposal.type === "request_issue_create" && proposal.resultRunId && onIssueOpen ? <button className="issue-rework-proposal-view inline-flex min-h-8 w-fit max-w-full items-center gap-1.5 rounded-lg border-0 bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onIssueOpen(proposal.resultRunId!)} type="button">
                    <ChevronRight aria-hidden="true" size={15} />
                    {t("channel.viewIssue")}
                  </button> : null}
              </> : onAcceptIssueAction ? <button className="issue-rework-proposal-accept inline-flex min-h-8 w-fit max-w-full items-center gap-1.5 rounded-lg border-0 bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60" disabled={actionProposalState?.accepting} onClick={onAcceptIssueAction} type="button">
                {actionProposalState?.accepting ? <Spinner aria-hidden="true" size={15} /> : proposal.type === "request_issue_create" ? <Plus aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
                {actionProposalState?.accepting ? t("run.reworkProposalAccepting") : proposalAcceptLabel}
              </button> : null}
            {actionProposalState?.error ? <p className="issue-rework-proposal-error flex min-w-0 items-center gap-1.5 break-words text-2xs text-destructive">
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
      {(onReply || canManage) && <div aria-label={t("run.replyInThread")} className="issue-message-actions absolute right-2 top-1 z-[2] flex translate-y-0 items-center rounded-lg border border-border bg-card p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" role="toolbar">
          {onReply ? <button aria-controls={replyComposerId} aria-expanded={isReplying} aria-label={t("run.replyInThread")} className="issue-reply-trigger grid size-7 place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onReply} title={t("run.replyInThread")} type="button">
              <MessageCircle aria-hidden="true" size={16} />
            </button> : null}
          {canManage ? <>
              <button aria-controls={editComposerId} aria-expanded={isEditing} aria-label={t("run.editMessage")} className="issue-reply-trigger grid size-7 place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onEdit} title={t("run.editMessage")} type="button">
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button aria-label={t("run.deleteMessage")} className="issue-reply-trigger grid size-7 place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onDelete} title={t("run.deleteMessage")} type="button">
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </> : null}
        </div>}
      {actionError ? <p className="issue-message-action-error col-span-full m-0 flex min-w-0 items-center gap-1.5 break-words text-2xs text-destructive">
          <CircleAlert aria-hidden="true" size={14} />
          {actionError}
        </p> : null}
    </article>;
}
