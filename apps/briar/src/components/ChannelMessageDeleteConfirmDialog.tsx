import { useAtom } from "@effect/atom-react";

import { useI18n } from "../i18n";
import { channelMessageDeleteConfirmationAtom } from "../state/channel-conversation/delete-confirmation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/*
  Answers the question `removeMessage` publishes on
  `channelMessageDeleteConfirmationAtom`. The confirmation lives in the app
  rather than in a blocking `window.confirm` so the tab never freezes on a
  native dialog (BR-7181), and so the prompt matches the rest of the UI.
  Mounted once by AppDialogs for both the desktop and the companion shell.
*/
export function ChannelMessageDeleteConfirmDialog() {
  const { t } = useI18n();
  const [confirmation] = useAtom(channelMessageDeleteConfirmationAtom);
  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) confirmation?.resolve(false);
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("channel.deleteMessage")}</DialogTitle>
          <DialogDescription>{confirmation?.prompt}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => confirmation?.resolve(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => confirmation?.resolve(true)}
          >
            {t("channel.deleteMessage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
