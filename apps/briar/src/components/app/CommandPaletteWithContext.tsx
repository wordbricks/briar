import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useCallback, type ComponentProps } from "react";
import { MessageSquare } from "lucide-react";
import { searchChannelMessages } from "../../lib/api";
import { useI18n } from "../../i18n";
import { useChannelActions } from "../../state/channels/actions";
import { messageSearchChannelIdAtom, organizationDirectMessagesAtom, requestedChannelMessageAtom, visibleWorkspaceChannelsAtom } from "../../state/channels/atoms";
import { tokenAtom } from "../../state/session/atoms";
import { directMessageDisplayName } from "../../lib/direct-messages";
import { formatIssueKey } from "../../lib/issue-key";
import { channelAtom } from "../../state/entities/channels";
import { runAtom, teamRunIdsAtom } from "../../state/entities/runs";
import {
  activeChannelIdAtom,
  channelsLoadingAtom,
} from "../../state/channels/atoms";
import {
  activePageAtom,
  activeRunIdAtom,
} from "../../state/navigation/atoms";
import { activeWorkspaceAtom } from "../../state/workspace/atoms";
import { loadingAtom, userAtom } from "../../state/session/atoms";
import { activeTeamAtom } from "../../state/team/atoms";

const CommandPalette = lazy(() =>
  import("../CommandPalette").then((m) => ({ default: m.CommandPalette })),
);

/*
  The command palette, wired to the atoms that describe "where the user is".

  Its context line and its loading flag were assembled in the shell out of the
  dashboard, the channel catalog, the session and the selected team — four
  reads that put the whole shell in the palette's dependency graph for two
  strings. Where the user is comes from the navigation atoms, so the shell no
  longer names the page or the open run either.

  The `lazy()` boundary lives here so the chunk split stays exactly where the
  shell had it.
*/

type CommandPaletteShellProps = Omit<
  ComponentProps<typeof CommandPalette>,
  "contextLabel" | "loading" | "messageSearch"
>;

export function CommandPaletteWithContext(props: CommandPaletteShellProps) {
  const { t } = useI18n();
  const activePage = useAtomValue(activePageAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const sessionLoading = useAtomValue(loadingAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const user = useAtomValue(userAtom);
  const activeTeam = useAtomValue(activeTeamAtom);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const activeTeamRunIds = useAtomValue(teamRunIdsAtom(activeTeam?.id ?? ""));
  const storedRun = useAtomValue(runAtom(selectedRunId ?? ""));
  const currentChannel = useAtomValue(channelAtom(activeChannelId ?? ""));
  // Only a run the selected team actually lists names the context, which is
  // the guard the shell got for free by searching the team's own payload.
  const currentRun =
    selectedRunId && activeTeamRunIds?.includes(selectedRunId) ? storedRun : null;

  const token = useAtomValue(tokenAtom);
  const messageSearchChannelId = useAtomValue(messageSearchChannelIdAtom);
  const setMessageSearchChannelId = useAtomSet(messageSearchChannelIdAtom);
  const setRequestedMessage = useAtomSet(requestedChannelMessageAtom);
  const { openWorkspaceChannel } = useChannelActions();
  const visibleChannels = useAtomValue(visibleWorkspaceChannelsAtom);
  const visibleDms = useAtomValue(organizationDirectMessagesAtom);
  const messageSearch = useCallback(async (
    query: string, cursor?: string | null, kind?: "channel" | "dm",
  ) => {
    if (!token || !activeWorkspace) return { items: [], nextCursor: null };
    const { hits, nextCursor } = await searchChannelMessages(token, activeWorkspace.id, query, {
      channelId: messageSearchChannelId ?? undefined,
      kind,
      cursor: cursor ?? undefined,
      limit: 20,
    });
    const allowedIds = new Set([...visibleChannels, ...visibleDms].map((channel) => channel.id));
    return {
      nextCursor,
      items: hits.filter((hit) => allowedIds.has(hit.channelId)).map((hit) => {
        const index = hit.body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        const start = Math.max(0, index - 32);
        const snippet = hit.body.slice(start, start + 110);
        const relativeMatch = index >= 0 ? index - start : -1;
        const highlight = relativeMatch >= 0 ? {
          before: `${start > 0 ? "…" : ""}${snippet.slice(0, relativeMatch)}`,
          match: snippet.slice(relativeMatch, relativeMatch + query.length),
          after: `${snippet.slice(relativeMatch + query.length)}${hit.body.length > start + 110 ? "…" : ""}`,
        } : undefined;
        const when = new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium", timeStyle: "short",
        }).format(new Date(hit.createdAt));
        return {
          id: `message:${hit.messageId}`,
          label: `${start > 0 ? "…" : ""}${snippet}${hit.body.length > start + 110 ? "…" : ""}`,
          highlight,
          description: `${hit.authorName} · ${hit.isDirectMessage ? "DM" : `#${hit.channelName}`} · ${when}${hit.isThreadReply ? " · reply" : ""}`,
          icon: <MessageSquare />,
          scope: "messages" as const,
          section: "messages",
          sectionLabel: t("commandPalette.groupMessages"),
          remember: false,
          onSelect: () => {
            setRequestedMessage({
              channelId: hit.channelId,
              messageId: hit.messageId,
              rootMessageId: hit.rootMessageId,
            });
            openWorkspaceChannel(hit.channelId);
          },
        };
      }),
    };
  }, [token, activeWorkspace, messageSearchChannelId, visibleChannels, visibleDms, setRequestedMessage, openWorkspaceChannel, t]);
  const onPaletteOpenChange = useCallback((open: boolean) => {
    if (!open) setMessageSearchChannelId(null);
    props.onOpenChange(open);
  }, [props.onOpenChange, setMessageSearchChannelId]);

  const contextLabel =
    currentRun && activeTeam
      ? `${formatIssueKey(activeTeam.issueKeyPrefix, currentRun.runNumber)} · ${currentRun.title}`
      : currentChannel && (activePage === "channels" || activePage === "dms")
        ? activePage === "dms"
          ? directMessageDisplayName(currentChannel, user?.id ?? null)
          : `#${currentChannel.name}`
        : activeTeam?.name ?? activeWorkspace?.name ?? null;

  return (
    <Suspense fallback={null}>
      <CommandPalette
        {...props}
        onOpenChange={onPaletteOpenChange}
        messageSearch={messageSearch}
        contextLabel={contextLabel}
        loading={sessionLoading || channelsLoading}
      />
    </Suspense>
  );
}
