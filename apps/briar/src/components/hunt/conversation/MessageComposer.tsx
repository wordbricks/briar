import { Bot, CircleAlert, Paperclip, Send, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { dataTransferHasFiles, filesFromDataTransfer, maxIssueAttachmentCount, normalizeIssueAttachmentFile, validateIssueAttachments } from "@/lib/issue-attachments";
import { issueAttachmentMarkdown } from "@/lib/issue-markdown";
import { issueMentionAtCaret, issueMentionHandle, mentionsIssueHandle } from "@/lib/issue-agent-reply";
import { mentionHandle } from "@/lib/channel-mentions";
import { MentionComposerField } from "@/components/MentionComposerField";
import type { OrganizationMember, ProjectAgent } from "@/types";
import { useI18n } from "@/i18n";
import { MessageAttachmentPreview } from "./MessageAttachmentPreview";
import { cn } from "@/lib/utils";
export function MessageComposer({
  autoFocus = false,
  compact = false,
  disableAttachments = false,
  initialBody = "",
  mentionMembers,
  mentionAgents,
  onCancel,
  onMentionOpen,
  onSubmit,
  placeholder
}: {
  autoFocus?: boolean;
  compact?: boolean;
  disableAttachments?: boolean;
  initialBody?: string;
  mentionMembers: OrganizationMember[];
  mentionAgents: ProjectAgent[];
  onCancel?: () => void;
  onMentionOpen: (handle: string) => void;
  onSubmit: (body: string, mentionedUserIds: string[], mentionedAgentIds: string[], attachments: File[], attachmentReferences: string[]) => Promise<void>;
  placeholder: string;
}) {
  const {
    t
  } = useI18n();
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<Record<string, {
    handle: string;
    label: string;
    userId: string | null;
    agentId: string | null;
  }>>(() => {
    const existing: Record<string, {
      handle: string;
      label: string;
      userId: string | null;
      agentId: string | null;
    }> = {};
    if (initialBody) {
      for (const member of mentionMembers) {
        const handle = issueMentionHandle(member);
        if (handle && mentionsIssueHandle(initialBody, handle)) {
          existing[`user:${member.userId}`] = {
            handle,
            label: member.name,
            userId: member.userId,
            agentId: null
          };
        }
      }
      for (const agent of mentionAgents) {
        const handle = mentionHandle(agent.name);
        if (handle && mentionsIssueHandle(initialBody, handle)) {
          existing[`agent:${agent.id}`] = {
            handle,
            label: agent.name,
            userId: null,
            agentId: agent.id
          };
        }
      }
    }
    return existing;
  });
  const [attachments, setAttachments] = useState<Array<{
    file: File;
    reference: string;
  }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const mentionListId = useId();
  const connectedMentions = useMemo(() => Object.entries(selectedMentions).map(([key, mention]) => ({
    key,
    handle: mention.handle,
    label: mention.label
  })), [selectedMentions]);
  const activeMention = issueMentionAtCaret(body, caret);
  const mentionSuggestions = activeMention ? [...mentionMembers.map(member => ({
    handle: issueMentionHandle(member),
    image: member.image,
    name: member.name,
    userId: member.userId,
    agentId: null
  })).filter(member => member.handle.startsWith(activeMention.query.toLowerCase())), ...mentionAgents.map(agent => ({
    handle: mentionHandle(agent.name),
    image: agent.avatar,
    name: agent.name,
    userId: null,
    agentId: agent.id
  })).filter(agent => agent.handle.startsWith(activeMention.query.toLowerCase()))] : [];
  const showsMentionSuggestion = composerFocused && !mentionDismissed && activeMention !== null && mentionSuggestions.length > 0;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const textBody = body.trim();
    if (!textBody && attachments.length === 0 || sending) return;
    const attachmentMarkdown = attachments.map(({
      file,
      reference
    }) => issueAttachmentMarkdown(reference, file.name)).join("\n\n");
    const nextBody = [textBody, attachmentMarkdown].filter(Boolean).join("\n\n");
    const nextMentionedUserIds = Object.values(selectedMentions).flatMap(mention => mention.userId && mentionsIssueHandle(nextBody, mention.handle) ? [mention.userId] : []);
    const nextMentionedAgentIds = Object.values(selectedMentions).flatMap(mention => mention.agentId && mentionsIssueHandle(nextBody, mention.handle) ? [mention.agentId] : []);
    const previousMentions = selectedMentions;
    const previousAttachments = attachments;
    setSending(true);
    setError(null);
    setBody("");
    setCaret(0);
    setMentionDismissed(false);
    setSelectedMentions({});
    setAttachments([]);
    try {
      await onSubmit(nextBody, nextMentionedUserIds, nextMentionedAgentIds, previousAttachments.map(({
        file
      }) => file), previousAttachments.map(({
        reference
      }) => reference));
    } catch (caught) {
      setBody(nextBody);
      setCaret(nextBody.length);
      setSelectedMentions(previousMentions);
      setAttachments(previousAttachments);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const addImages = (selected: File[]) => {
    if (selected.length === 0) return;
    const normalized = selected.map(normalizeIssueAttachmentFile);
    if (normalized.some(file => !file.type.startsWith("image/"))) {
      setError("대화에는 이미지만 첨부할 수 있습니다.");
      return;
    }
    const next = [...attachments, ...normalized.map(file => ({
      file,
      reference: crypto.randomUUID()
    }))];
    const validationError = validateIssueAttachments(next.map(({
      file
    }) => file));
    if (validationError) {
      setError(validationError);
      return;
    }
    setAttachments(next);
    setError(null);
  };
  const completeMention = (suggestion: typeof mentionSuggestions[number]) => {
    const textarea = textareaRef.current;
    if (!textarea || !activeMention) return;
    const insertedMention = `@${suggestion.handle} `;
    const nextBody = `${body.slice(0, activeMention.start)}${insertedMention}${body.slice(activeMention.end)}`;
    const nextCaret = activeMention.start + insertedMention.length;
    setBody(nextBody);
    setCaret(nextCaret);
    setMentionDismissed(false);
    const mentionKey = suggestion.userId ? `user:${suggestion.userId}` : `agent:${suggestion.agentId}`;
    setSelectedMentions(current => ({
      ...current,
      [mentionKey]: {
        handle: suggestion.handle,
        label: suggestion.name,
        userId: suggestion.userId,
        agentId: suggestion.agentId
      }
    }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };
  return <form className={cn("issue-message-composer relative z-[1] grid min-w-0 shrink-0 grid-rows-[minmax(0,1fr)_auto] overflow-visible rounded-2xl border border-border bg-card shadow-md focus-within:border-input focus-within:ring-4 focus-within:ring-ring/15", compact && "compact shadow-sm")} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setComposerFocused(false);
    }
  }} onFocus={() => setComposerFocused(true)} onDragOver={event => {
    if (!disableAttachments && dataTransferHasFiles(event.dataTransfer)) {
      event.preventDefault();
    }
  }} onDrop={event => {
    if (disableAttachments || !dataTransferHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    addImages(filesFromDataTransfer(event.dataTransfer));
  }} onSubmit={event => void submit(event)}>
      {showsMentionSuggestion && <div aria-label={t("run.mention")} className="issue-composer-mention-menu absolute inset-x-3 bottom-[51px] z-[3] max-h-56 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-xl" id={mentionListId} role="listbox">
          {mentionSuggestions.map((suggestion, index) => <button aria-selected={index === 0} className="flex min-h-8 w-full items-center gap-2 rounded-md border-0 bg-accent px-2 py-1 text-left text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring" key={suggestion.userId ?? suggestion.agentId} onClick={() => completeMention(suggestion)} onMouseDown={event => event.preventDefault()} role="option" type="button">
              <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-accent-foreground [&>img]:size-full [&>img]:object-cover">
                {suggestion.userId ? suggestion.image ? <img alt="" src={suggestion.image} /> : suggestion.name.trim().charAt(0).toUpperCase() || "?" : suggestion.image ? <img alt="" src={suggestion.image} /> : <Bot size={14} />}
              </span>
              <strong className="text-xs">@{suggestion.handle}</strong>
              <small className="ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-2xs text-muted-foreground">{suggestion.name}</small>
            </button>)}
        </div>}
      {attachments.length > 0 && <div className="issue-composer-attachments flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map(({
        file,
        reference
      }) => <MessageAttachmentPreview file={file} key={reference} onRemove={() => setAttachments(current => current.filter(attachment => attachment.reference !== reference))} />)}
        </div>}
      <MentionComposerField body={body} className="issue-composer-field min-w-0 [&>textarea]:min-h-[68px] [&>textarea]:w-full [&>textarea]:resize-none [&>textarea]:border-0 [&>textarea]:bg-transparent [&>textarea]:px-[18px] [&>textarea]:pb-1.5 [&>textarea]:pt-[18px] [&>textarea]:text-sm [&>textarea]:leading-relaxed [&>textarea]:outline-none [&>textarea]:placeholder:text-muted-foreground [&>textarea]:focus-visible:ring-0" controlRef={textareaRef} mentions={connectedMentions} onMentionClick={mention => onMentionOpen(mention.handle)}>
        <textarea autoFocus={autoFocus} aria-autocomplete="list" aria-controls={showsMentionSuggestion ? mentionListId : undefined} aria-expanded={showsMentionSuggestion} aria-label={placeholder} className="text-foreground" disabled={sending} maxLength={10_000} onChange={event => {
        setBody(event.currentTarget.value);
        setCaret(event.currentTarget.selectionStart);
        setMentionDismissed(false);
      }} onKeyDown={event => {
        if (showsMentionSuggestion && (event.key === "Tab" || event.key === "Enter" && !event.metaKey && !event.ctrlKey)) {
          event.preventDefault();
          completeMention(mentionSuggestions[0]);
          return;
        }
        if (showsMentionSuggestion && event.key === "Escape") {
          event.preventDefault();
          setMentionDismissed(true);
          return;
        }
        if (event.key === "Escape" && onCancel && !sending) {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void submit();
        }
      }} onPaste={event => {
        if (disableAttachments) return;
        const images = filesFromDataTransfer(event.clipboardData).filter(file => file.type.startsWith("image/"));
        if (images.length === 0) return;
        event.preventDefault();
        addImages(images);
      }} onSelect={event => setCaret(event.currentTarget.selectionStart)} placeholder={placeholder} ref={textareaRef} rows={2} value={body} />
      </MentionComposerField>
      <footer className="flex min-h-12 items-center justify-end gap-1 px-3 pb-2.5 pt-1">
        {onCancel ? <button aria-label={t("run.cancelReply")} className="issue-reply-cancel mr-auto grid size-8 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={sending} onClick={onCancel} title={t("run.cancelReply")} type="button">
            <X size={17} />
          </button> : null}
        {!disableAttachments ? <>
            <button aria-label={t("issue.attachmentLabel")} className="issue-composer-link grid size-8 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={sending || attachments.length >= maxIssueAttachmentCount} onClick={() => attachmentInputRef.current?.click()} type="button">
              <Paperclip size={18} />
            </button>
            <input accept="image/*" className="issue-composer-file-input" disabled={sending || attachments.length >= maxIssueAttachmentCount} multiple onChange={event => {
          addImages(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }} ref={attachmentInputRef} type="file" />
          </> : null}
        <button aria-label={sending ? t("run.sendingMessage") : t("run.sendMessage")} className="issue-message-send grid size-8 place-items-center rounded-lg border-0 bg-transparent text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground" disabled={!body.trim() && attachments.length === 0 || sending} type="submit">
          {sending ? <Spinner size={16} /> : <Send aria-hidden="true" size={19} strokeWidth={2.2} />}
        </button>
      </footer>
      {error && <p className="issue-composer-error m-0 flex items-center gap-1.5 px-2.5 pb-2 text-2xs text-destructive">
          <CircleAlert size={13} />
          {error}
        </p>}
    </form>;
}
