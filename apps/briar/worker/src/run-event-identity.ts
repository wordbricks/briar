import type { HuntRunRow } from "./db";
import { HttpError } from "./http-response";

export function assertRunEventIdentityNotOverridden(input: {
  run: Pick<HuntRunRow, "source" | "source_key"> | null;
  source?: string | null;
  sourceKey?: string | null;
}) {
  if (
    input.run &&
    (
      (input.source != null && input.source !== input.run.source) ||
      (input.sourceKey != null && input.sourceKey !== input.run.source_key)
    )
  ) {
    throw new HttpError(400, "A claimed run's identity cannot be changed");
  }
}

