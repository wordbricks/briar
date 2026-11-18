import { LoadingState } from "@/components/ui/loading-state";
import { useI18n } from "../i18n";
import { displayChannelActivityHeadline } from "../lib/auto-hunt-agent";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";

/*
  Two inputs, one line each, and neither one stands in for the other.

  `pendingAgentNames` is durable reply state: an agent that has been asked and
  has not answered yet. `activityByAgentName` is the live socket: what that
  agent says it is doing right now. A channel passes both, because a runner
  that never publishes commentary — a Codex-backed agent answering a mention
  spent two minutes without a single frame — must still be visible; a DM passes
  only the second, because its placeholder row is commentary-only by design.

  They are separate props rather than one nullable map so that "no name to
  show" and "a name with no headline yet" cannot collapse into each other.
*/
export function ChannelTypingState({
  activityByAgentName,
  className,
  pendingAgentNames,
}: {
  /**
   * The live headline of each agent that published one, keyed by the same name
   * `pendingAgentNames` uses. An agent absent from here is still typing.
   */
  activityByAgentName: Readonly<
    Record<string, ChannelAgentActivityDescriptor | undefined>
  >;
  className?: string;
  /**
   * The agents whose queued or running reply earns a line whether or not the
   * activity socket has said anything. Empty on surfaces that show progress
   * only when there is something concrete to show.
   */
  pendingAgentNames: readonly string[];
}) {
  const { t } = useI18n();
  const names = [
    ...new Set([...pendingAgentNames, ...Object.keys(activityByAgentName)]),
  ];
  if (names.length === 0) return null;

  return names.map((name) => {
    const activity = activityByAgentName[name];
    return (
      <div
        aria-live="polite"
        className={`channel-typing${className ? ` ${className}` : ""}`}
        key={name}
        role="status"
      >
        <LoadingState
          label={
            activity
              ? `${name} · ${displayChannelActivityHeadline(activity)}`
              : t("channel.namedAgentTyping", { name })
          }
        />
      </div>
    );
  });
}
