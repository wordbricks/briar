import type { HuntRun } from "@/types";
export function hasResultReviews(
  run: Pick<HuntRun, "resultReviews" | "hasResultReview">
) {
  return (
    (run.resultReviews?.length ?? 0) > 0 ||
    run.hasResultReview === true
  );
}
