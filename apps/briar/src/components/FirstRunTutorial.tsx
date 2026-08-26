import {
  ArrowRight,
  Code2,
  Compass,
  Eye,
  ListChecks,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";

type TutorialPhase = "purpose" | "collaborator-demo";

export function FirstRunTutorial({
  onCollaboratorComplete,
  onDeveloperSelect,
  open,
}: {
  onCollaboratorComplete: () => void;
  onDeveloperSelect: () => void;
  open: boolean;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<TutorialPhase>("purpose");

  useEffect(() => {
    if (open) setPhase("purpose");
  }, [open]);

  return (
    <Dialog open={open}>
      <DialogContent
        className="w-[min(720px,calc(100vw-40px))] max-w-none gap-6 rounded-3xl p-[30px] shadow-[0_28px_90px_rgba(29,31,26,0.24)] max-[680px]:p-[22px]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showClose={false}
      >
        {phase === "purpose" ? (
          <>
            <DialogHeader className="gap-[7px] text-left">
              <span
                aria-hidden="true"
                className="mb-1 grid size-[46px] place-items-center rounded-[14px] bg-accent text-accent-foreground"
              >
                <Compass size={22} />
              </span>
              <Typography as="span" tone="primary" variant="micro">
                {t("tutorial.purposeEyebrow")}
              </Typography>
              <DialogTitle className="text-2xl leading-[var(--leading-2xl)] tracking-tight">
                {t("tutorial.purposeTitle")}
              </DialogTitle>
              <DialogDescription className="max-w-[590px] text-xs leading-[1.7]">
                {t("tutorial.purposeDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
              <Button
                className="flex min-h-[220px] flex-col items-start gap-2.5 rounded-[18px] border border-border bg-muted p-5 text-left text-foreground shadow-none transition-[transform,border-color,background-color,box-shadow] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent hover:shadow-[0_12px_30px_rgba(55,45,90,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[.985] max-[680px]:min-h-[170px]"
                onClick={onDeveloperSelect}
                type="button"
                variant="ghost"
              >
                <span className="mb-1.5 grid size-[42px] place-items-center rounded-[13px] bg-accent text-accent-foreground">
                  <Code2 size={21} />
                </span>
                <Typography
                  as="strong"
                  className="font-semibold leading-[1.35] tracking-tight"
                  variant="bodyLg"
                >
                  {t("tutorial.developerTitle")}
                </Typography>
                <Typography
                  as="small"
                  className="text-left leading-[1.65]"
                  variant="caption"
                >
                  {t("tutorial.developerDescription")}
                </Typography>
                <span className="mt-auto flex w-full items-center justify-between text-xs font-bold text-primary">
                  {t("tutorial.developerAction")} <ArrowRight size={16} />
                </span>
              </Button>
              <Button
                className="flex min-h-[220px] flex-col items-start gap-2.5 rounded-[18px] border border-border bg-muted p-5 text-left text-foreground shadow-none transition-[transform,border-color,background-color,box-shadow] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent hover:shadow-[0_12px_30px_rgba(55,45,90,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[.985] max-[680px]:min-h-[170px]"
                onClick={() => setPhase("collaborator-demo")}
                type="button"
                variant="ghost"
              >
                <span className="mb-1.5 grid size-[42px] place-items-center rounded-[13px] bg-success/10 text-success">
                  <Eye size={21} />
                </span>
                <Typography
                  as="strong"
                  className="font-semibold leading-[1.35] tracking-tight"
                  variant="bodyLg"
                >
                  {t("tutorial.collaboratorTitle")}
                </Typography>
                <Typography
                  as="small"
                  className="text-left leading-[1.65]"
                  variant="caption"
                >
                  {t("tutorial.collaboratorDescription")}
                </Typography>
                <span className="mt-auto flex w-full items-center justify-between text-xs font-bold text-primary">
                  {t("tutorial.collaboratorAction")} <ArrowRight size={16} />
                </span>
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="gap-[7px] text-left">
              <span
                aria-hidden="true"
                className="mb-1 grid size-[46px] place-items-center rounded-[14px] bg-success/10 text-success"
              >
                <Sparkles size={22} />
              </span>
              <Typography as="span" tone="primary" variant="micro">
                {t("tutorial.demoEyebrow")}
              </Typography>
              <DialogTitle className="text-2xl leading-[var(--leading-2xl)] tracking-tight">
                {t("tutorial.demoTitle")}
              </DialogTitle>
              <DialogDescription className="max-w-[590px] text-xs leading-[1.7]">
                {t("tutorial.demoDescription")}
              </DialogDescription>
            </DialogHeader>
            <ol className="m-0 grid list-none gap-[9px] p-0">
              <li className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-[11px] rounded-[14px] border border-border bg-muted p-3.5">
                <span className="grid size-[38px] place-items-center rounded-[11px] bg-accent text-accent-foreground">
                  <ListChecks size={18} />
                </span>
                <div className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodySm">
                    {t("tutorial.demoIssueTitle")}
                  </Typography>
                  <Typography
                    as="small"
                    className="leading-[1.55]"
                    variant="micro"
                  >
                    {t("tutorial.demoIssueDescription")}
                  </Typography>
                </div>
              </li>
              <li className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-[11px] rounded-[14px] border border-border bg-muted p-3.5">
                <span className="grid size-[38px] place-items-center rounded-[11px] bg-accent text-accent-foreground">
                  <Eye size={18} />
                </span>
                <div className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodySm">
                    {t("tutorial.demoProgressTitle")}
                  </Typography>
                  <Typography
                    as="small"
                    className="leading-[1.55]"
                    variant="micro"
                  >
                    {t("tutorial.demoProgressDescription")}
                  </Typography>
                </div>
              </li>
              <li className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-[11px] rounded-[14px] border border-border bg-muted p-3.5">
                <span className="grid size-[38px] place-items-center rounded-[11px] bg-accent text-accent-foreground">
                  <MessageSquareText size={18} />
                </span>
                <div className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodySm">
                    {t("tutorial.demoFeedbackTitle")}
                  </Typography>
                  <Typography
                    as="small"
                    className="leading-[1.55]"
                    variant="micro"
                  >
                    {t("tutorial.demoFeedbackDescription")}
                  </Typography>
                </div>
              </li>
            </ol>
            <DialogFooter>
              <Button
                className="min-h-[42px] gap-2 rounded-full"
                onClick={onCollaboratorComplete}
                type="button"
              >
                {t("tutorial.demoFinish")}
                <ArrowRight aria-hidden="true" size={16} />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
