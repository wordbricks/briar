export type KeyboardShortcutModeChoice = {
  id: string;
  key: string;
  label: string;
};

export function KeyboardShortcutModeHint({
  choices,
  label,
  prefix,
}: {
  choices: readonly KeyboardShortcutModeChoice[];
  label: string;
  prefix: string;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-10 z-[1320] flex justify-center px-4"
      role="status"
    >
      <div className="max-w-[min(720px,100%)] rounded-xl border border-border/80 bg-card/95 px-3 py-2 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
            <kbd className="min-w-6 rounded-md border border-border bg-muted px-1.5 py-1 text-center font-mono text-[10px] font-semibold uppercase shadow-xs">
              {prefix}
            </kbd>
            {label}
          </span>
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          {choices.map((choice) => (
            <span
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              key={choice.id}
            >
              <kbd className="min-w-5 rounded border border-border/80 bg-background px-1 py-0.5 text-center font-mono text-[9px] font-semibold uppercase text-foreground">
                {choice.key}
              </kbd>
              {choice.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
