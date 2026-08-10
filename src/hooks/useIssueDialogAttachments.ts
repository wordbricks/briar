import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type Dispatch,
  type DragEventHandler,
  type KeyboardEventHandler,
  type SetStateAction,
} from "react";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import {
  issueAttachmentMarkdown,
  issueAttachmentReferences,
  removeIssueAttachmentMarkdown,
} from "../lib/issue-markdown";

export type IssueDialogAttachment = {
  file: File;
  reference: string;
};

export function useIssueDialogAttachments({
  description,
  isSubmitting,
  setDescription,
}: {
  description: string;
  isSubmitting: boolean;
  setDescription: Dispatch<SetStateAction<string>>;
}) {
  const [attachments, setAttachments] = useState<IssueDialogAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const dragDepthRef = useRef(0);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSubmitting) return;
    dragDepthRef.current = 0;
    setIsDraggingAttachments(false);
  }, [isSubmitting]);

  const focusDescriptionAt = useCallback((offset: number) => {
    const inputs = Array.from(
      descriptionEditorRef.current?.querySelectorAll<HTMLTextAreaElement>(
        ".issue-description-input",
      ) ?? [],
    );
    const input =
      inputs.find((candidate) => {
        const start = Number(candidate.dataset.descriptionStart ?? 0);
        const end = Number(candidate.dataset.descriptionEnd ?? start);
        return offset >= start && offset <= end;
      }) ?? inputs.at(-1);
    if (!input) return;
    const start = Number(input.dataset.descriptionStart ?? 0);
    const caret = Math.max(0, Math.min(input.value.length, offset - start));
    input.focus();
    input.setSelectionRange(caret, caret);
  }, []);

  const addAttachments = useCallback(
    (
      selected: File[],
      insertImages = false,
      selection?: { start: number; end: number },
    ) => {
      if (selected.length === 0) return;
      const added = selected.map((file) => ({
        file: normalizeIssueAttachmentFile(file),
        reference: crypto.randomUUID(),
      }));
      const next = [...attachments, ...added];
      const error = validateIssueAttachments(next.map(({ file }) => file));
      setAttachmentError(error);
      if (error) return;
      setAttachments(next);

      const inlineImages = insertImages
        ? added.filter(({ file }) => file.type.startsWith("image/"))
        : [];
      if (inlineImages.length === 0) return;
      const start = selection?.start ?? description.length;
      const end = selection?.end ?? start;
      const before = description.slice(0, start);
      const after = description.slice(end);
      const markdown = inlineImages
        .map(({ file, reference }) =>
          issueAttachmentMarkdown(reference, file.name),
        )
        .join("\n\n");
      const prefix =
        before.length === 0 || before.endsWith("\n\n")
          ? ""
          : before.endsWith("\n")
            ? "\n"
            : "\n\n";
      const suffix =
        after.length === 0 || after.startsWith("\n\n")
          ? ""
          : after.startsWith("\n")
            ? "\n"
            : "\n\n";
      const insertion = `${prefix}${markdown}${suffix}`;
      setDescription(`${before}${insertion}${after}`);
      requestAnimationFrame(() => focusDescriptionAt(start + insertion.length));
    },
    [attachments, description, focusDescriptionAt, setDescription],
  );

  const removeAttachment = useCallback(
    (index: number, reference: string) => {
      setAttachments((current) =>
        current.filter((_, candidateIndex) => candidateIndex !== index),
      );
      setDescription((current) =>
        removeIssueAttachmentMarkdown(current, reference),
      );
      setAttachmentError(null);
    },
    [setDescription],
  );

  const onDragEnter: DragEventHandler<HTMLFormElement> = (event) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!isSubmitting) setIsDraggingAttachments(true);
  };

  const onDragLeave: DragEventHandler<HTMLFormElement> = (event) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingAttachments(false);
  };

  const onDragOver: DragEventHandler<HTMLFormElement> = (event) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (!isSubmitting) event.dataTransfer.dropEffect = "copy";
  };

  const onDrop: DragEventHandler<HTMLFormElement> = (event) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingAttachments(false);
    if (!isSubmitting) {
      addAttachments(filesFromDataTransfer(event.dataTransfer), true);
    }
  };

  const onKeyDown: KeyboardEventHandler<HTMLFormElement> = (event) => {
    const isTitleEnter =
      event.target instanceof HTMLInputElement &&
      event.target.classList.contains("issue-title-input") &&
      !event.metaKey &&
      !event.ctrlKey;
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      isSubmitting
    ) {
      return;
    }
    if (isTitleEnter) {
      event.preventDefault();
      event.currentTarget
        .querySelector<HTMLTextAreaElement>(".issue-description-input")
        ?.focus();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  const onPaste: ClipboardEventHandler<HTMLFormElement> = (event) => {
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const images =
      pastedImages.length > 0
        ? pastedImages
        : Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith("image/"),
          );
    if (images.length === 0) return;
    event.preventDefault();
    const target =
      event.target instanceof HTMLTextAreaElement ? event.target : null;
    const segmentStart = Number(
      target?.dataset.descriptionStart ?? description.length,
    );
    addAttachments(
      images,
      true,
      target
        ? {
            start: segmentStart + target.selectionStart,
            end: segmentStart + target.selectionEnd,
          }
        : undefined,
    );
  };

  return {
    addAttachments,
    attachmentError,
    attachments,
    descriptionEditorRef,
    formEventHandlers: {
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop,
      onKeyDown,
      onPaste,
    },
    inlineAttachmentReferences: issueAttachmentReferences(description),
    isDraggingAttachments,
    removeAttachment,
  };
}
