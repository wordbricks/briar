import { BadgeCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const toneClasses = {
  amber: "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]",
  blue: "border-[var(--status-info-border)] bg-[var(--status-info-surface)] text-[var(--status-info-foreground)]",
  emerald: "border-[var(--status-success-border)] bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]",
  indigo: "border-[var(--status-info-border)] bg-[var(--status-info-surface)] text-[var(--status-info-foreground)]",
  orange: "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]",
  red: "border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] text-[var(--status-destructive-foreground)]",
  rose: "border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] text-[var(--status-destructive-foreground)]",
  slate: "border-border bg-muted text-muted-foreground",
  violet: "border-[#ddd4fb] bg-[#f1edff] text-[#654bb8]",
} satisfies Record<string, string>;
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
  return <Tag aria-label={reviewed ? `${label} · ${t("run.resultReviewed")}` : undefined} className={cn("status-pill inline-flex min-h-[23px] w-fit items-center gap-1 rounded-md border px-2 text-2xs font-semibold not-italic", toneClasses[tone as keyof typeof toneClasses] ?? toneClasses.slate, reviewed && "reviewed")} title={reviewed ? t("run.resultReviewed") : undefined}>
      {status === "running" && <Spinner size={11} />}
      {reviewed && <BadgeCheck aria-hidden="true" className="status-pill-review-icon shrink-0 text-[#c45f8a]" size={11} />}
      {label}
    </Tag>;
}
