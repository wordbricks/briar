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
  return <div className="issue-composer-attachment flex h-[38px] max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-muted p-1">
      {source ? <img alt="" className="size-[30px] shrink-0 rounded-md object-cover" src={source} /> : null}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-2xs text-foreground">{file.name}</span>
      <button aria-label={`Remove ${file.name}`} className="grid size-[22px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onRemove} type="button">
        <X aria-hidden="true" size={13} />
      </button>
    </div>;
}
