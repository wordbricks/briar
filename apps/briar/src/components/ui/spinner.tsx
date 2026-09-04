import { LoaderIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/*
  shadcn/ui's Spinner (registry: base/spinner), with three changes for this app:
  - `shrink-0` and `align-middle` carry over from the `.spin` rule this
    replaced, so spinners keep their box in tight flex rows and stay on the
    text midline inline.
  - the default label is translated instead of the hard-coded "Loading".
  - a spinner the caller marked `aria-hidden` drops role and label: the control
    around it already carries the busy state, and a hidden live region is a
    contradiction assistive tech has to resolve.
*/
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useI18n();
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <LoaderIcon
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : t("loading.spinner")}
      className={cn("size-4 shrink-0 animate-spin align-middle", className)}
      {...props}
    />
  );
}

export { Spinner };
