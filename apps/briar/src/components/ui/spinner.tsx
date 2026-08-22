import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

import { cn } from "@/lib/utils";

export type SpinnerProps = LucideProps & {
  /** Use another Lucide icon when a loading action should keep its icon shape. */
  icon?: LucideIcon;
  /** Render the icon without animation when the associated action is idle. */
  spinning?: boolean;
};

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, icon: Icon = LoaderCircle, spinning = true, ...props }, ref) => (
    <Icon
      ref={ref}
      {...props}
      className={cn(spinning && "spin", className)}
    />
  ),
);

Spinner.displayName = "Spinner";
