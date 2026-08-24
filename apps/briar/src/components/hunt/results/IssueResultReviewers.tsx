import { Check } from "lucide-react";
import type { IssueResultReview } from "@/types";
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
    return <span className="issue-result-reviewers-empty">{emptyLabel}</span>;
  }
  return <div className={`issue-result-reviewers${compact ? " compact" : ""}`}>
      {reviews.map(review => {
      const displayName = review.username ? `@${review.username}` : review.name;
      return <span className="issue-result-reviewer" key={review.userId} title={`${review.name} · ${review.completedAt}`}>
            <span className="issue-result-reviewer-avatar">
              {review.image ? <img alt="" src={review.image} /> : review.name.slice(0, 1).toUpperCase()}
            </span>
            <strong>{displayName}</strong>
            <Check aria-hidden="true" size={13} />
          </span>;
    })}
    </div>;
}
