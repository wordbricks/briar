import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { Channels } from "../Channels";
import { CompanionChannels } from "../CompanionChannels";
import {
  DirectMessageConversationPane,
  DirectMessages,
} from "../DirectMessages";
import { useChannelActions } from "../../state/channels/actions";
import {
  channelCatalogCursorAtom,
  directMessageComposeAtom,
  initialChannelInviteIdAtom,
  organizationDirectMessagesAtom,
  requestedChannelIdAtom,
  requestedChannelMessageAtom,
  requestedChannelSettingsIdAtom,
  visibleWorkspaceChannelsAtom,
} from "../../state/channels/atoms";
import { activeWorkspaceAtom, activeWorkspaceIdAtom } from "../../state/workspace/atoms";
import { useRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import {
  activeWorkspaceTeamsAtom,
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
  | "workspaceId"
  | "workspaceName"
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
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const channels = useAtomValue(visibleWorkspaceChannelsAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const projects = useAtomValue(activeWorkspaceTeamsAtom);
  const initialInviteChannelId = useAtomValue(initialChannelInviteIdAtom);
  const initialSettingsChannelId = useAtomValue(
    requestedChannelSettingsIdAtom,
  );
  const requestedMessage = useAtomValue(requestedChannelMessageAtom);
  const {
    clearRequestedChannelMessage,
    replaceWorkspaceChannels,
    setViewingChannel,
  } = useChannelActions();
  const registry = useRegistry();
  // The id is the gate, not the resolved workspace: the shell rendered this
  // view from the id alone while the workspace list was still loading.
  if (!workspaceId || !token) return null;
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
      onChannelsChange={replaceWorkspaceChannels}
      onInitialInviteHandled={() =>
        registry.set(initialChannelInviteIdAtom, null)}
      onInitialSettingsHandled={() =>
        registry.set(requestedChannelSettingsIdAtom, null)}
      onRequestedMessageOpen={clearRequestedChannelMessage}
      onViewingChannelChange={setViewingChannel}
      workspaceId={workspaceId}
      workspaceName={workspace?.name}
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
  | "workspaceId"
  | "workspaceName"
  | "projects"
  | "token"
>;

type DirectMessageConversationPaneShellProps = Omit<
  ComponentProps<typeof DirectMessageConversationPane>,
  | "channelCatalogCursor"
  | "channels"
  | "composing"
  | "currentUserId"
  | "onChannelsChange"
  | "onViewingChannelChange"
  | "workspaceId"
  | "workspaceName"
  | "projects"
  | "token"
>;

/**
 * The desktop DM page: the open conversation at full width, or the recipient
 * picker while a new one is being composed. Its list is the sidebar's.
 */
export function DirectMessageConversationPaneWithCatalog(
  props: DirectMessageConversationPaneShellProps,
) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const channels = useAtomValue(organizationDirectMessagesAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const composing = useAtomValue(directMessageComposeAtom);
  const projects = useAtomValue(activeWorkspaceTeamsAtom);
  const { replaceWorkspaceChannels, setViewingChannel } =
    useChannelActions();
  if (!workspaceId || !token) return null;
  return (
    <DirectMessageConversationPane
      {...props}
      channelCatalogCursor={channelCatalogCursor}
      channels={channels}
      composing={composing}
      currentUserId={user?.id ?? null}
      onChannelsChange={replaceWorkspaceChannels}
      onViewingChannelChange={setViewingChannel}
      workspaceId={workspaceId}
      workspaceName={workspace?.name}
      projects={projects}
      token={token}
    />
  );
}

/** The companion direct message view, reading the same catalog filtered to DMs. */
export function DirectMessagesWithCatalog(props: DirectMessagesShellProps) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const channels = useAtomValue(organizationDirectMessagesAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const projects = useAtomValue(activeWorkspaceTeamsAtom);
  const { replaceWorkspaceChannels, setViewingChannel } =
    useChannelActions();
  if (!workspaceId || !token) return null;
  return (
    <DirectMessages
      {...props}
      channelCatalogCursor={channelCatalogCursor}
      channels={channels}
      currentUserId={user?.id ?? null}
      onChannelsChange={replaceWorkspaceChannels}
      onViewingChannelChange={setViewingChannel}
      workspaceId={workspaceId}
      workspaceName={workspace?.name}
      projects={projects}
      token={token}
    />
  );
}

type CompanionChannelsShellProps = Omit<
  ComponentProps<typeof CompanionChannels>,
  | "activeProjectId"
  | "currentUserId"
  | "onRequestedChannelOpen"
  | "onRequestedMessageOpen"
  | "onViewingChannelChange"
  | "workspaceId"
  | "projects"
  | "requestedChannelId"
  | "requestedMessage"
  | "token"
>;

/**
 * The companion channel view. Its message cache used to be a `useRef` on the
 * shell handed down as a prop, then a `WeakMap` on the registry; it is the
 * `state/channel-conversation` store now, shared with the desktop view.
 */
export function CompanionChannelsWithCatalog(
  props: CompanionChannelsShellProps,
) {
  const registry = useRegistry();
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const activeTeam = useAtomValue(activeTeamAtom);
  const projects = useAtomValue(activeWorkspaceTeamsAtom);
  const requestedMessage = useAtomValue(requestedChannelMessageAtom);
  const requestedChannelId = useAtomValue(requestedChannelIdAtom);
  const { clearRequestedChannelMessage, setViewingChannel } =
    useChannelActions();
  if (!workspaceId) return null;
  return (
    <CompanionChannels
      {...props}
      activeProjectId={activeTeam?.id ?? null}
      currentUserId={user?.id ?? null}
      onRequestedChannelOpen={() => registry.set(requestedChannelIdAtom, null)}
      onRequestedMessageOpen={clearRequestedChannelMessage}
      onViewingChannelChange={setViewingChannel}
      workspaceId={workspaceId}
      projects={projects}
      requestedChannelId={requestedChannelId}
      requestedMessage={requestedMessage}
      token={token ?? ""}
    />
  );
}
