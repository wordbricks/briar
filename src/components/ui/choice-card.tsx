import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChoiceCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  badge?: React.ReactNode;
  description?: React.ReactNode;
  icon: React.ReactNode;
  iconClassName?: string;
  selected?: boolean;
  title: React.ReactNode;
  trailing?: React.ReactNode;
}

const ChoiceCard = React.forwardRef<HTMLButtonElement, ChoiceCardProps>(
  (
    {
      badge,
      className,
      description,
      icon,
      iconClassName,
      selected = false,
      title,
      trailing,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      aria-pressed={selected || undefined}
      data-slot="choice-card"
      data-state={selected ? "selected" : "idle"}
      ref={ref}
      type={type}
      className={cn(
        "group flex min-h-44 w-full min-w-0 flex-col items-start gap-4 rounded-2xl border border-border bg-muted p-5 text-left text-foreground transition-[transform,border-color,background-color,box-shadow] duration-150 hover:not-disabled:-translate-y-0.5 hover:not-disabled:border-ring/40 hover:not-disabled:bg-accent hover:not-disabled:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-70 data-[state=selected]:border-ring/55 data-[state=selected]:bg-accent data-[state=selected]:shadow-sm",
        className,
      )}
      {...props}
    >
      <span
        data-slot="choice-card-icon"
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-6",
          iconClassName,
        )}
      >
        {icon}
      </span>
      <span data-slot="choice-card-content" className="grid min-w-0 gap-2">
        <strong className="text-md leading-snug font-semibold">{title}</strong>
        {description ? (
          <small className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </small>
        ) : null}
      </span>
      {badge ? (
        <span
          data-slot="choice-card-badge"
          className="mt-auto inline-flex rounded-full bg-secondary px-2 py-1 text-2xs font-semibold text-muted-foreground"
        >
          {badge}
        </span>
      ) : trailing ? (
        <span
          data-slot="choice-card-trailing"
          className="mt-auto self-end text-accent-foreground [&_svg]:size-[18px]"
        >
          {trailing}
        </span>
      ) : null}
    </button>
  ),
);
ChoiceCard.displayName = "ChoiceCard";

export { ChoiceCard };
