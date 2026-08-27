import { X } from "lucide-react";
import { useCallback } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
export function MessageAttachmentPreview({
  file,
  onRemove
}: {
  file: File;
  onRemove: () => void;
}) {
  const loadFile = useCallback(() => file, [file]);
  const {
    source
  } = useObjectUrl(loadFile);
  return <div className="issue-composer-attachment">
      {source ? <img alt="" src={source} /> : null}
      <span>{file.name}</span>
      <button aria-label={`Remove ${file.name}`} onClick={onRemove} type="button">
        <X aria-hidden="true" size={13} />
      </button>
    </div>;
}
