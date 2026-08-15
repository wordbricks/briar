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
        className="first-run-tutorial-dialog"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showClose={false}
      >
        {phase === "purpose" ? (
          <>
            <DialogHeader className="first-run-tutorial-header">
              <span className="first-run-tutorial-icon" aria-hidden="true">
                <Compass size={22} />
              </span>
              <span className="eyebrow">{t("tutorial.purposeEyebrow")}</span>
              <DialogTitle>{t("tutorial.purposeTitle")}</DialogTitle>
              <DialogDescription>
                {t("tutorial.purposeDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="first-run-tutorial-options">
              <button onClick={onDeveloperSelect} type="button">
                <span className="first-run-tutorial-option-icon developer">
                  <Code2 size={21} />
                </span>
                <strong>{t("tutorial.developerTitle")}</strong>
                <small>{t("tutorial.developerDescription")}</small>
                <span className="first-run-tutorial-option-action">
                  {t("tutorial.developerAction")} <ArrowRight size={16} />
                </span>
              </button>
              <button
                onClick={() => setPhase("collaborator-demo")}
                type="button"
              >
                <span className="first-run-tutorial-option-icon collaborator">
                  <Eye size={21} />
                </span>
                <strong>{t("tutorial.collaboratorTitle")}</strong>
                <small>{t("tutorial.collaboratorDescription")}</small>
                <span className="first-run-tutorial-option-action">
                  {t("tutorial.collaboratorAction")} <ArrowRight size={16} />
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="first-run-tutorial-header">
              <span className="first-run-tutorial-icon collaborator" aria-hidden="true">
                <Sparkles size={22} />
              </span>
              <span className="eyebrow">{t("tutorial.demoEyebrow")}</span>
              <DialogTitle>{t("tutorial.demoTitle")}</DialogTitle>
              <DialogDescription>{t("tutorial.demoDescription")}</DialogDescription>
            </DialogHeader>
            <ol className="first-run-demo-steps">
              <li>
                <span><ListChecks size={18} /></span>
                <div>
                  <strong>{t("tutorial.demoIssueTitle")}</strong>
                  <small>{t("tutorial.demoIssueDescription")}</small>
                </div>
              </li>
              <li>
                <span><Eye size={18} /></span>
                <div>
                  <strong>{t("tutorial.demoProgressTitle")}</strong>
                  <small>{t("tutorial.demoProgressDescription")}</small>
                </div>
              </li>
              <li>
                <span><MessageSquareText size={18} /></span>
                <div>
                  <strong>{t("tutorial.demoFeedbackTitle")}</strong>
                  <small>{t("tutorial.demoFeedbackDescription")}</small>
                </div>
              </li>
            </ol>
            <DialogFooter>
              <Button onClick={onCollaboratorComplete} type="button">
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
