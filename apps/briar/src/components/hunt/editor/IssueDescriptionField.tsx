import { useLayoutEffect, useMemo, useRef } from "react";
import { hyperlinkSegments } from "@/lib/hyperlink-text";
import { fitIssueDescriptionField } from "@/lib/issue-description-field-size";
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
  return <div className="issue-description-field" ref={fieldRef}>
      <div className="issue-description-mirror" ref={mirrorRef} aria-hidden="true">
        {segments.map((segment, segmentIndex) => segment.type === "link" ? <a href={segment.url} key={`link-${segmentIndex}`} onMouseDown={event => event.preventDefault()} rel="noreferrer" target="_blank">
              {segment.value}
            </a> : <span key={`text-${segmentIndex}`}>{segment.value}</span>)}
        {value.endsWith("\n") ? <span aria-hidden="true">&nbsp;</span> : null}
      </div>
      <textarea aria-label={label} className="issue-description-input" data-description-end={end} data-description-start={start} maxLength={maxLength} onChange={event => {
      onChange(event.currentTarget.value);
    }} onScroll={event => {
      if (autoSize) event.currentTarget.scrollTop = 0;
      syncScroll(event.currentTarget);
    }} placeholder={placeholder} ref={textareaRef} rows={rows} value={value} />
    </div>;
}
