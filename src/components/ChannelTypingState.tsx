import { LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";

export function ChannelTypingState({
  agentNames,
  className,
}: {
  agentNames: readonly string[];
  className?: string;
}) {
  const { t } = useI18n();
  if (agentNames.length === 0) return null;

  return agentNames.map((name) => (
    <div
      aria-live="polite"
      className={`channel-typing${className ? ` ${className}` : ""}`}
      key={name}
      role="status"
    >
      <LoaderCircle className="spin" size={15} />
      {t("channel.namedAgentTyping", { name })}
    </div>
  ));
}
