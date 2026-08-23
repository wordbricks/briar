import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Semantic typography scale for Briar.
 * Prefer these over raw font-size classes so product UI stays consistent.
 */
const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      display: "text-display",
      title: "text-title",
      heading: "text-heading",
      subheading: "text-subheading",
      bodyLg: "text-body-lg",
      body: "text-body",
      bodySm: "text-body-sm",
      label: "text-label",
      caption: "text-caption",
      micro: "text-micro text-muted-foreground",
      mono: "text-mono text-sm",
    },
    tone: {
      default: "",
      muted: "text-muted-foreground",
      faint: "text-[color:var(--faint)]",
      primary: "text-primary",
      destructive: "text-destructive",
      success: "text-success",
      inherit: "text-inherit",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
    },
  },
  defaultVariants: {
    variant: "body",
    tone: "default",
    align: "left",
  },
});

type TypographyElement =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "span"
  | "div"
  | "label"
  | "small"
  | "strong"
  | "em"
  | "code";

const defaultElement: Record<
  NonNullable<VariantProps<typeof typographyVariants>["variant"]>,
  TypographyElement
> = {
  display: "h1",
  title: "h1",
  heading: "h2",
  subheading: "h3",
  bodyLg: "p",
  body: "p",
  bodySm: "p",
  label: "span",
  caption: "p",
  micro: "span",
  mono: "code",
};

export interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof typographyVariants> {
  as?: TypographyElement;
}

const Typography = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, variant = "body", tone, align, as, ...props }, ref) => {
    const Comp = as ?? defaultElement[variant ?? "body"];
    return (
      <Comp
        ref={ref as never}
        className={cn(typographyVariants({ variant, tone, align }), className)}
        {...props}
      />
    );
  },
);
Typography.displayName = "Typography";

export { Typography, typographyVariants };
