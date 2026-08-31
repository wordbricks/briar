import { useState } from "react";
import { useI18n } from "../i18n";
import type { DmMemoryApiScope } from "../lib/api/dm-memory";
import type { DmMemoryReference } from "../lib/dm-memory-query-contract";
import { DmMemoryDialog } from "./DmMemoryDialog";

export function DmMemoryCitations({ scope, references }: {
  scope: DmMemoryApiScope; references: DmMemoryReference[];
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<DmMemoryReference | null>(null);
  if (!references.length) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span>{t("memory.citations")}</span>
    {references.map((reference, index) => <button type="button" className="underline underline-offset-2"
      key={`${reference.documentId}:${reference.version}`} onClick={() => setSelected(reference)}
      aria-label={`${t("memory.citations")} ${index + 1} · v${reference.version}`}>
      {index + 1} · v{reference.version}
    </button>)}
    {selected && <DmMemoryDialog key={`${scope.token}:${scope.organizationId}:${scope.channelId}`}
      scope={scope} initialReference={selected} onClose={() => setSelected(null)} />}
  </div>;
}
