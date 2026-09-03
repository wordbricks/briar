import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { Channels } from "../Channels";
import { CompanionChannels } from "../CompanionChannels";
import { DirectMessages } from "../DirectMessages";
import { useChannelActions } from "../../state/channels/actions";
import {
  channelCatalogCursorAtom,
  getCompanionChannelCache,
  initialChannelInviteIdAtom,
  organizationDirectMessagesAtom,
  requestedChannelIdAtom,
  requestedChannelMessageAtom,
  requestedChannelSettingsIdAtom,
  visibleOrganizationChannelsAtom,
} from "../../state/channels/atoms";
import {
  activeOrganizationAtom,
  activeOrganizationIdAtom,
} from "../../state/organization/atoms";
import { useRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import {
  activeOrganizationTeamsAtom,
  activeTeamAtom,
} from "../../state/team/atoms";

/*
  The three conversation views, wired to `state/channels` instead of to
  `App.tsx`.

  Between them they took the catalog, its cursor, the open channel, the deep
  link requests and four "clear this once you have handled it" callbacks as
  props, so every unread flag flowing in from the catalog delta re-rendered the
  whole shell just to hand a new array to one view. They subscribe to the
  catalog themselves now, and the shell keeps only what it decides: where a
  selection navigates to, and which inbox signal is current.

  None of the three is behind a `lazy()` boundary today — the shell imports them
  statically — so these wrappers do the same.
*/

type ChannelsOwnProps = ComponentProps<typeof Channels>;

/** What the shell still decides for a desktop channel view. */
type ChannelsShellProps = Omit<
  ChannelsOwnProps,
  | "channelCatalogCursor"
  | "channels"
  | "currentUserId"
  | "initialInviteChannelId"
  | "initialSettingsChannelId"
  | "onChannelsChange"
  | "onInitialInviteHandled"
  | "onInitialSettingsHandled"
  | "onRequestedMessageOpen"
  | "onViewingChannelChange"
  | "organizationId"
  | "organizationName"
  | "projects"
  | "requestedMessage"
  | "token"
>;

/**
 * The channel conversation view. `activeChannelId` stays a prop because which
 * channel is open follows the navigation history, which the shell owns until
 * the navigation phase moves it.
 */
export function ChannelsWithCatalog(props: ChannelsShellProps) {
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const organization = useAtomValue(activeOrganizationAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const channels = useAtomValue(visibleOrganizationChannelsAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const projects = useAtomValue(activeOrganizationTeamsAtom);
  const initialInviteChannelId = useAtomValue(initialChannelInviteIdAtom);
  const initialSettingsChannelId = useAtomValue(
    requestedChannelSettingsIdAtom,
  );
  const requestedMessage = useAtomValue(requestedChannelMessageAtom);
  const {
    clearRequestedChannelMessage,
    replaceOrganizationChannels,
    setViewingChannel,
  } = useChannelActions();
  const registry = useRegistry();
  // The id is the gate, not the resolved organization: the shell rendered this
  // view from the id alone while the organization list was still loading.
  if (!organizationId || !token) return null;
  return (
    <Channels
      {...props}
      channelCatalogCursor={channelCatalogCursor}
      channels={channels}
      currentUserId={user?.id ?? null}
      initialInviteChannelId={props.inboxDetail ? null : initialInviteChannelId}
      initialSettingsChannelId={
        props.inboxDetail ? null : initialSettingsChannelId
      }
      onChannelsChange={replaceOrganizationChannels}
      onInitialInviteHandled={() =>
        registry.set(initialChannelInviteIdAtom, null)}
      onInitialSettingsHandled={() =>
        registry.set(requestedChannelSettingsIdAtom, null)}
      onRequestedMessageOpen={clearRequestedChannelMessage}
      onViewingChannelChange={setViewingChannel}
      organizationId={organizationId}
      organizationName={organization?.name}
      projects={projects}
      requestedMessage={requestedMessage}
      token={token}
    />
  );
}

type DirectMessagesShellProps = Omit<
  ComponentProps<typeof DirectMessages>,
  | "channelCatalogCursor"
  | "channels"
  | "currentUserId"
  | "onChannelsChange"
  | "onViewingChannelChange"
  | "organizationId"
  | "organizationName"
  | "projects"
  | "token"
>;

/** The direct message view, reading the same catalog filtered to DMs. */
export function DirectMessagesWithCatalog(props: DirectMessagesShellProps) {
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const organization = useAtomValue(activeOrganizationAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const channels = useAtomValue(organizationDirectMessagesAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const projects = useAtomValue(activeOrganizationTeamsAtom);
  const { replaceOrganizationChannels, setViewingChannel } =
    useChannelActions();
  if (!organizationId || !token) return null;
  return (
    <DirectMessages
      {...props}
      channelCatalogCursor={channelCatalogCursor}
      channels={channels}
      currentUserId={user?.id ?? null}
      onChannelsChange={replaceOrganizationChannels}
      onViewingChannelChange={setViewingChannel}
      organizationId={organizationId}
      organizationName={organization?.name}
      projects={projects}
      token={token}
    />
  );
}

type CompanionChannelsShellProps = Omit<
  ComponentProps<typeof CompanionChannels>,
  | "activeProjectId"
  | "channelCache"
  | "currentUserId"
  | "onRequestedChannelOpen"
  | "onRequestedMessageOpen"
  | "onViewingChannelChange"
  | "organizationId"
  | "projects"
  | "requestedChannelId"
  | "requestedMessage"
  | "token"
>;

/**
 * The companion channel view. Its message cache used to be a `useRef` on the
 * shell handed down as a prop, which is what let it survive the view
 * remounting; it lives on the registry now and survives for the same reason.
 */
export function CompanionChannelsWithCatalog(
  props: CompanionChannelsShellProps,
) {
  const registry = useRegistry();
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const activeTeam = useAtomValue(activeTeamAtom);
  const projects = useAtomValue(activeOrganizationTeamsAtom);
  const requestedMessage = useAtomValue(requestedChannelMessageAtom);
  const requestedChannelId = useAtomValue(requestedChannelIdAtom);
  const { clearRequestedChannelMessage, setViewingChannel } =
    useChannelActions();
  if (!organizationId) return null;
  return (
    <CompanionChannels
      {...props}
      activeProjectId={activeTeam?.id ?? null}
      channelCache={getCompanionChannelCache(registry)}
      currentUserId={user?.id ?? null}
      onRequestedChannelOpen={() => registry.set(requestedChannelIdAtom, null)}
      onRequestedMessageOpen={clearRequestedChannelMessage}
      onViewingChannelChange={setViewingChannel}
      organizationId={organizationId}
      projects={projects}
      requestedChannelId={requestedChannelId}
      requestedMessage={requestedMessage}
      token={token ?? ""}
    />
  );
}
