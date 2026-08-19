import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "../../i18n";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and a live elapsed timer
 * in mono tabular figures. Reduced motion freezes the grid
 * to its dim state; the timer still ticks.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export const LOADING_STATE_VARIANTS = ["Drive", "Dots", "Orbit"] as const;
export type LoadingStateVariant = (typeof LOADING_STATE_VARIANTS)[number];

const PATTERNS: Record<
  LoadingStateVariant,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export function formatElapsed(deciseconds: number) {
  const total = deciseconds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  return formatElapsed(ds);
}

export function LoadingState({
  className,
  label,
  size = "default",
  variant = "Drive",
}: {
  className?: string;
  label?: string;
  size?: "default" | "compact";
  variant?: LoadingStateVariant;
}) {
  const { t } = useI18n();
  const elapsed = useElapsed();
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;

  return (
    <div
      className={cn(
        "loading-state flex w-fit min-w-0 max-w-full items-center",
        size === "compact" ? "gap-2" : "gap-2.5",
        className,
      )}
      data-size={size}
      data-testid="loading-state"
      data-variant={variant}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0",
          size === "compact"
            ? "grid-cols-[repeat(3,3px)] gap-[1px]"
            : "grid-cols-[repeat(3,4px)] gap-[1.5px]",
        )}
      >
        {delays.map((d, i) => (
          <span
            key={i}
            className={cn(
              "loading-state-pixel bg-ink",
              size === "compact" ? "size-[3px]" : "size-[4px]",
              round ? "rounded-full" : "rounded-[1px]",
            )}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation:
                d === null ? "none" : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className="loading-state-label min-w-0 truncate bg-clip-text text-base font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label ?? t("loading.churning")}
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 font-mono text-sm text-ink-3 tabular-nums"
      >
        {elapsed}
      </span>
    </div>
  );
}
