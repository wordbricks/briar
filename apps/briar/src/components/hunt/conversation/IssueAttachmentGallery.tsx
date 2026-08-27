import { Paperclip } from "lucide-react";
import type { IssueAttachment } from "@/types";
import { useI18n } from "@/i18n";
import { IssueAttachmentPreview } from "./IssueAttachmentPreview";
export function IssueAttachmentGallery({
  attachments,
  onLoadAttachment
}: {
  attachments: IssueAttachment[];
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
}) {
  const {
    t
  } = useI18n();
  return <section className="run-attachments mt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Paperclip size={14} />{t("run.attachments")} <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-2xs font-medium text-accent-foreground">{attachments.length}</span></h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
        {attachments.map(attachment => <IssueAttachmentPreview attachment={attachment} key={attachment.id} onLoadAttachment={onLoadAttachment} />)}
      </div>
    </section>;
}
