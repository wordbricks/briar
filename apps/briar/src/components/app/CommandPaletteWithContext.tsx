import { useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, type ComponentProps } from "react";

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
import { activeOrganizationAtom } from "../../state/organization/atoms";
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
  "contextLabel" | "loading"
>;

export function CommandPaletteWithContext(props: CommandPaletteShellProps) {
  const activePage = useAtomValue(activePageAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const sessionLoading = useAtomValue(loadingAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const user = useAtomValue(userAtom);
  const activeTeam = useAtomValue(activeTeamAtom);
  const activeOrganization = useAtomValue(activeOrganizationAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const activeTeamRunIds = useAtomValue(teamRunIdsAtom(activeTeam?.id ?? ""));
  const storedRun = useAtomValue(runAtom(selectedRunId ?? ""));
  const currentChannel = useAtomValue(channelAtom(activeChannelId ?? ""));
  // Only a run the selected team actually lists names the context, which is
  // the guard the shell got for free by searching the team's own payload.
  const currentRun =
    selectedRunId && activeTeamRunIds?.includes(selectedRunId) ? storedRun : null;

  const contextLabel =
    currentRun && activeTeam
      ? `${formatIssueKey(activeTeam.issueKeyPrefix, currentRun.runNumber)} · ${currentRun.title}`
      : currentChannel && (activePage === "channels" || activePage === "dms")
        ? activePage === "dms"
          ? directMessageDisplayName(currentChannel, user?.id ?? null)
          : `#${currentChannel.name}`
        : activeTeam?.name ?? activeOrganization?.name ?? null;

  return (
    <Suspense fallback={null}>
      <CommandPalette
        {...props}
        contextLabel={contextLabel}
        loading={sessionLoading || channelsLoading}
      />
    </Suspense>
  );
}
