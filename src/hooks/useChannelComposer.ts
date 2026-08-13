import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useI18n } from "../i18n";
import { channelBodyWithImages, draftChannelImage } from "../components/ChannelImages";
import {
  mentionAtCaret,
  mentionHandle,
  retainedMentions,
  type MentionTarget,
} from "../lib/channel-mentions";
import type {
  ChannelAgentSummary,
  ChannelMember,
} from "../lib/channels-contract";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../lib/issue-attachments";

type ComposerInput = HTMLInputElement | HTMLTextAreaElement;

type UseChannelComposerOptions = {
  agents: ChannelAgentSummary[];
  busy: boolean;
  currentUserId: string | null;
  members: ChannelMember[];
  onInvite?: () => void;
  onSend: (
    body: string,
    mentions: MentionTarget[],
    attachments: File[],
    attachmentReferences: string[],
  ) => void;
  submitOnEnter?: boolean;
};

export function useChannelComposer<T extends ComposerInput>({
  agents,
  busy,
  currentUserId,
  members,
  onInvite,
  onSend,
  submitOnEnter = false,
}: UseChannelComposerOptions) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  // Mentions are trusted only after a candidate is picked. Text that happens
  // to look like a handle must never become a hidden recipient.
  const [mentions, setMentions] = useState<MentionTarget[]>([]);
  const [images, setImages] = useState<ReturnType<typeof draftChannelImage>[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<T | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentionListId = useId();

  const candidates = useMemo<MentionTarget[]>(
    () => [
      ...agents.map((agent) => ({
        type: "agent" as const,
        id: agent.agentId,
        handle: agent.name,
        label: agent.name,
        detail: agent.projectId
          ? t("channel.projectAgent")
          : t("channel.orgAgent"),
      })),
      ...members.map((member) => ({
        type: "user" as const,
        id: member.userId,
        handle: mentionHandle(member.email.split("@")[0] || member.userId),
        label: member.name,
        detail:
          member.userId === currentUserId
            ? t("channel.mentionSelf", { email: member.email })
            : member.email,
        image: member.image,
      })),
    ],
    [agents, currentUserId, members, t],
  );
  const query = mentionAtCaret(body, caret);
  const suggestions = query
    ? candidates
        .filter((candidate) =>
          `${candidate.handle} ${candidate.label}`
            .toLowerCase()
            .includes(query.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const showsSuggestions = !mentionDismissed && suggestions.length > 0;

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [query?.query]);

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const nextCaret = pendingCaret.current;
    pendingCaret.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(nextCaret, nextCaret);
  }, [body]);

  const pickSuggestion = (target: MentionTarget) => {
    if (!query) return;
    const inserted = `@${target.handle} `;
    const nextCaret = query.start + inserted.length;
    setBody(`${body.slice(0, query.start)}${inserted}${body.slice(query.end)}`);
    setCaret(nextCaret);
    pendingCaret.current = nextCaret;
    setMentionDismissed(true);
    setMentions((current) =>
      current.some(
        (mention) => mention.id === target.id && mention.type === target.type,
      )
        ? current
        : [...current, target],
    );
  };

  const insertAtCaret = (text: string) => {
    const start = inputRef.current?.selectionStart ?? body.length;
    const end = inputRef.current?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`;
    const nextCaret = start + text.length;
    setBody(next);
    setCaret(nextCaret);
    pendingCaret.current = nextCaret;
    setMentionDismissed(false);
    inputRef.current?.focus();
  };

  const addImages = (files: readonly File[]) => {
    const normalized = files.map(normalizeIssueAttachmentFile);
    if (
      normalized.length === 0 ||
      normalized.some((file) => !file.type.startsWith("image/"))
    ) {
      setAttachmentError(t("channel.imageOnly"));
      return;
    }
    const next = [...images, ...normalized.map(draftChannelImage)];
    const validationError = validateIssueAttachments(
      next.map((image) => image.file),
    );
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }
    setImages(next);
    setAttachmentError(null);
  };

  const removeImage = (reference: string) => {
    setImages((current) =>
      current.filter((image) => image.reference !== reference),
    );
    setAttachmentError(null);
  };

  const submit = () => {
    if ((!body.trim() && images.length === 0) || busy) return;
    if (onInvite && body.trim() === "/invite" && images.length === 0) {
      onInvite();
    } else {
      onSend(
        channelBodyWithImages(body, images),
        retainedMentions(body, mentions),
        images.map((image) => image.file),
        images.map((image) => image.reference),
      );
    }
    setBody("");
    setImages([]);
    setMentions([]);
    setMentionDismissed(false);
  };

  const handleChange = (event: ChangeEvent<T>) => {
    setBody(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    setMentionDismissed(false);
  };
  const handleCaret = (
    event: KeyboardEvent<T> | MouseEvent<T>,
  ) => setCaret(event.currentTarget.selectionStart ?? 0);
  const handleKeyDown = (event: KeyboardEvent<T>) => {
    if (showsSuggestions) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        setActiveSuggestionIndex(
          (index) =>
            (index + offset + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const target = suggestions[activeSuggestionIndex] ?? suggestions[0];
        if (target) pickSuggestion(target);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (submitOnEnter && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  const handlePaste = (event: ClipboardEvent<T>) => {
    const pasted = filesFromDataTransfer(event.clipboardData).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (pasted.length === 0) return;
    event.preventDefault();
    addImages(pasted);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addImages(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  };
  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(true);
  };
  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(false);
    addImages(filesFromDataTransfer(event.dataTransfer));
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return {
    activeSuggestionIndex,
    attachmentError,
    attachmentInputRef,
    body,
    dragging,
    handleCaret,
    handleChange,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileChange,
    handleKeyDown,
    handlePaste,
    handleSubmit,
    images,
    inputRef,
    insertAtCaret,
    mentionListId,
    mentions,
    pickSuggestion,
    removeImage,
    setActiveSuggestionIndex,
    showsSuggestions,
    suggestions,
  };
}
