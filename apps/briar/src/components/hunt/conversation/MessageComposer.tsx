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
  const insertAgentMention = (agent: ProjectAgent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handle = mentionHandle(agent.name);
    const insertedMention = `@${handle} `;
    const nextBody = `${body.slice(0, caret)}${insertedMention}${body.slice(caret)}`;
    const nextCaret = caret + insertedMention.length;
    setBody(nextBody);
    setCaret(nextCaret);
    setMentionDismissed(false);
    setSelectedMentions(current => ({
      ...current,
      [`agent:${agent.id}`]: {
        handle,
        label: agent.name,
        userId: null,
        agentId: agent.id
      }
    }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };
  return <form className={`issue-message-composer${compact ? " compact" : ""}`} onBlur={event => {
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
      {showsMentionSuggestion && <div aria-label={t("run.mention")} className="issue-composer-mention-menu" id={mentionListId} role="listbox">
          {mentionSuggestions.map((suggestion, index) => <button aria-selected={index === 0} key={suggestion.userId ?? suggestion.agentId} onClick={() => completeMention(suggestion)} onMouseDown={event => event.preventDefault()} role="option" type="button">
              <span aria-hidden="true">
                {suggestion.userId ? suggestion.image ? <img alt="" src={suggestion.image} /> : suggestion.name.trim().charAt(0).toUpperCase() || "?" : suggestion.image ? <img alt="" src={suggestion.image} /> : <Bot size={14} />}
              </span>
              <strong>@{suggestion.handle}</strong>
              <small>{suggestion.name}</small>
            </button>)}
        </div>}
      {attachments.length > 0 && <div className="issue-composer-attachments">
          {attachments.map(({
        file,
        reference
      }) => <MessageAttachmentPreview file={file} key={reference} onRemove={() => setAttachments(current => current.filter(attachment => attachment.reference !== reference))} />)}
        </div>}
      <MentionComposerField body={body} className="issue-composer-field" controlRef={textareaRef} mentions={connectedMentions} onMentionClick={mention => onMentionOpen(mention.handle)}>
        <textarea autoFocus={autoFocus} aria-autocomplete="list" aria-controls={showsMentionSuggestion ? mentionListId : undefined} aria-expanded={showsMentionSuggestion} aria-label={placeholder} disabled={sending} maxLength={10_000} onChange={event => {
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
      <footer>
        {onCancel ? <button aria-label={t("run.cancelReply")} className="issue-reply-cancel" disabled={sending} onClick={onCancel} title={t("run.cancelReply")} type="button">
            <X size={17} />
          </button> : null}
        {mentionAgents.length > 0 && <div className="issue-composer-agent-shortcuts">
            {mentionAgents.map(agent => <button aria-label={`@${mentionHandle(agent.name)}`} disabled={sending} key={agent.id} onClick={() => insertAgentMention(agent)} onMouseDown={event => event.preventDefault()} title={agent.name} type="button">
                {agent.avatar ? <img alt="" src={agent.avatar} /> : <Bot size={14} />}
              </button>)}
          </div>}
        {!disableAttachments ? <>
            <button aria-label={t("issue.attachmentLabel")} className="issue-composer-link" disabled={sending || attachments.length >= maxIssueAttachmentCount} onClick={() => attachmentInputRef.current?.click()} type="button">
              <Paperclip size={18} />
            </button>
            <input accept="image/*" className="issue-composer-file-input" disabled={sending || attachments.length >= maxIssueAttachmentCount} multiple onChange={event => {
          addImages(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }} ref={attachmentInputRef} type="file" />
          </> : null}
        <button aria-label={sending ? t("run.sendingMessage") : t("run.sendMessage")} className="issue-message-send" disabled={!body.trim() && attachments.length === 0 || sending} type="submit">
          {sending ? <Spinner className="size-[16px]" /> : <Send aria-hidden="true" size={19} strokeWidth={2.2} />}
        </button>
      </footer>
      {error && <p className="issue-composer-error">
          <CircleAlert size={13} />
          {error}
        </p>}
    </form>;
}
