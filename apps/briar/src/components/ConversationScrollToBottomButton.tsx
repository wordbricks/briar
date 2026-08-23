import { ArrowDown } from "lucide-react";

export function ConversationScrollToBottomButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="conversation-scroll-to-bottom"
      onClick={onClick}
      title={label}
      type="button"
    >
      <ArrowDown aria-hidden="true" size={18} strokeWidth={2.4} />
    </button>
  );
}
