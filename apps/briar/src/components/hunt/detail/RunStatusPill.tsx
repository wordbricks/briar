import { BadgeCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
export function RunStatusPill({
  as = "i",
  label,
  reviewed = false,
  status,
  tone
}: {
  as?: "i" | "span";
  label: string;
  reviewed?: boolean;
  status: HuntRun["status"];
  tone: string;
}) {
  const {
    t
  } = useI18n();
  const Tag = as;
  return <Tag aria-label={reviewed ? `${label} · ${t("run.resultReviewed")}` : undefined} className={`status-pill ${tone}${reviewed ? " reviewed" : ""}`} title={reviewed ? t("run.resultReviewed") : undefined}>
      {status === "running" && <Spinner className="size-[11px]" />}
      {reviewed && <BadgeCheck aria-hidden="true" className="status-pill-review-icon" size={11} />}
      {label}
    </Tag>;
}
