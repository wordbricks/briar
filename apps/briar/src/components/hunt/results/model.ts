import type { HuntRun } from "@/types";
export function hasResultReviews(run: Pick<HuntRun, "resultReviews">) {
  return (run.resultReviews?.length ?? 0) > 0;
}
