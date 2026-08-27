import { useLayoutEffect, useMemo, useRef } from "react";
import { hyperlinkSegments } from "@/lib/hyperlink-text";
import { fitIssueDescriptionField } from "@/lib/issue-description-field-size";
import { cn } from "@/lib/utils";
export function IssueDescriptionField({
  autoSize = false,
  end,
  label,
  maxLength,
  onChange,
  placeholder,
  rows,
  start,
  value
}: {
  autoSize?: boolean;
  end: number;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  start: number;
  value: string;
}) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const syncScroll = (target: HTMLTextAreaElement) => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    mirror.scrollLeft = target.scrollLeft;
    mirror.scrollTop = target.scrollTop;
  };
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    if (autoSize) fitIssueDescriptionField(input);
    syncScroll(input);
    if (!autoSize || typeof ResizeObserver === "undefined") return undefined;
    let lastWidth = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? lastWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      fitIssueDescriptionField(input);
      syncScroll(input);
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [autoSize, rows, value]);
  const segments = useMemo(() => hyperlinkSegments(value), [value]);
  return <div className="issue-description-field relative min-h-0 min-w-0 flex-1" ref={fieldRef}>
      <div className="issue-description-mirror pointer-events-none absolute inset-0 z-[2] overflow-hidden whitespace-pre-wrap break-words text-foreground" ref={mirrorRef} aria-hidden="true">
        {segments.map((segment, segmentIndex) => segment.type === "link" ? <a href={segment.url} key={`link-${segmentIndex}`} onMouseDown={event => event.preventDefault()} rel="noreferrer" target="_blank">
              {segment.value}
            </a> : <span key={`text-${segmentIndex}`}>{segment.value}</span>)}
        {value.endsWith("\n") ? <span aria-hidden="true">&nbsp;</span> : null}
      </div>
      <textarea aria-label={label} className={cn("issue-description-input relative z-[1] block min-h-[80px] w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-transparent caret-foreground outline-none [-webkit-text-fill-color:transparent] placeholder:[-webkit-text-fill-color:var(--muted-foreground)] focus-visible:ring-0", autoSize ? "h-auto" : "min-h-[1.7em]")} data-description-end={end} data-description-start={start} maxLength={maxLength} onChange={event => {
      onChange(event.currentTarget.value);
    }} onScroll={event => {
      if (autoSize) event.currentTarget.scrollTop = 0;
      syncScroll(event.currentTarget);
    }} placeholder={placeholder} ref={textareaRef} rows={rows} value={value} />
    </div>;
}
