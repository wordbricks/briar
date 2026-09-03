import { Check, Copy } from "lucide-react";

import { useI18n } from "../i18n";
import type { RemoteDesktopClipboardState } from "../lib/remote-desktop-clipboard";
import { Button } from "./ui/button";

export function RemoteDesktopClipboardButton({
  onCopy,
  state,
}: {
  onCopy: () => void;
  state: RemoteDesktopClipboardState;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <Button
        className="border-white/15 bg-white/5 text-white hover:bg-white/10"
        disabled={state === "empty" || state === "copying"}
        onClick={onCopy}
        size="sm"
        type="button"
        variant="outline"
      >
        {state === "copied"
          ? <Check aria-hidden="true" size={14} />
          : <Copy aria-hidden="true" size={14} />}
        {t(state === "copied"
          ? "managedComputer.remote.clipboardCopied"
          : "managedComputer.remote.copyToLocal")}
      </Button>
      {state === "blocked" ? (
        <span className="max-w-48 text-xs text-zinc-300" role="status">
          {t("managedComputer.remote.clipboardBlocked")}
        </span>
      ) : null}
    </div>
  );
}
