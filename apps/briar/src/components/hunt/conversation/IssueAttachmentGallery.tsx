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
  return <section className="run-attachments">
      <h3><Paperclip size={14} />{t("run.attachments")} <span>{attachments.length}</span></h3>
      <div>
        {attachments.map(attachment => <IssueAttachmentPreview attachment={attachment} key={attachment.id} onLoadAttachment={onLoadAttachment} />)}
      </div>
    </section>;
}
