import { Check } from "lucide-react";
import type { IssueResultReview } from "@/types";
import { cn } from "@/lib/utils";
export function IssueResultReviewers({
  compact = false,
  emptyLabel,
  reviews
}: {
  compact?: boolean;
  emptyLabel: string;
  reviews: IssueResultReview[];
}) {
  if (reviews.length === 0) {
    return <span className="issue-result-reviewers-empty text-2xs text-muted-foreground">{emptyLabel}</span>;
  }
  return <div className={cn("issue-result-reviewers flex min-w-0 flex-wrap items-center gap-1.5", compact && "compact gap-1")}>
      {reviews.map(review => {
      const displayName = review.username ? `@${review.username}` : review.name;
      return <span className="issue-result-reviewer inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted px-1.5 py-1 text-2xs" key={review.userId} title={`${review.name} · ${review.completedAt}`}>
            <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-[9px] font-bold text-primary-foreground [&>img]:size-full [&>img]:object-cover">
              {review.image ? <img alt="" src={review.image} /> : review.name.slice(0, 1).toUpperCase()}
            </span>
            <strong className="max-w-36 overflow-hidden text-ellipsis whitespace-nowrap font-medium">{displayName}</strong>
            <Check aria-hidden="true" className="text-[var(--status-success-foreground)]" size={13} />
          </span>;
    })}
    </div>;
}
