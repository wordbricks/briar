import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react";
import {
  connectedMentionSegments,
  type ConnectedMention,
} from "../lib/connected-mentions";

type ComposerControl = HTMLInputElement | HTMLTextAreaElement;

export function MentionComposerField<T extends ComposerControl>({
  body,
  children,
  className,
  controlRef,
  mentions,
  onMentionClick,
}: {
  body: string;
  children: ReactNode;
  className?: string;
  controlRef: RefObject<T | null>;
  mentions: readonly ConnectedMention[];
  onMentionClick?: (mention: ConnectedMention) => void;
}) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const segments = connectedMentionSegments(body, mentions);
  const syncScroll = (control: ComposerControl | null) => {
    const mirror = mirrorRef.current;
    if (!control || !mirror) return;
    mirror.scrollLeft = control.scrollLeft;
    mirror.scrollTop = control.scrollTop;
  };

  useLayoutEffect(() => {
    syncScroll(controlRef.current);
  }, [body, controlRef]);

  const handleScrollCapture = (event: UIEvent<HTMLDivElement>) => {
    if (event.target === controlRef.current) {
      syncScroll(controlRef.current);
    }
  };

  return (
    <div
      className={`mention-composer-field${className ? ` ${className}` : ""}`}
      onScrollCapture={handleScrollCapture}
    >
      <div className="mention-composer-mirror" ref={mirrorRef}>
        {segments.map((segment) =>
          segment.type === "mention" ? (
            <button
              aria-label={segment.mention.label ?? segment.value}
              className="conversation-mention-button"
              data-mention-handle={segment.mention.handle}
              key={`${segment.start}:${segment.mention.key}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMentionClick?.(segment.mention);
              }}
              onMouseDown={(event) => event.preventDefault()}
              title={segment.mention.label}
              type="button"
            >
              {segment.value}
            </button>
          ) : (
            <span aria-hidden="true" key={`${segment.start}:text`}>
              {segment.value}
            </span>
          ),
        )}
        {body.endsWith("\n") ? <span aria-hidden="true">&nbsp;</span> : null}
      </div>
      {children}
    </div>
  );
}
