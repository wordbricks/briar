import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  ChannelSidebarSection,
  ChannelSummary,
} from "../../lib/channels-contract";
import { organizationChannelsAtom } from "../entities/channels";
import { shallowArrayEqual } from "../entities/upsert";
import { activeWorkspaceIdAtom } from "../workspace/atoms";
import { lockedTeamIdAtom } from "../platform";
import type { AtomRegistry } from "../registry";

/** The shared empty list every "nothing here" branch returns. */
const noChannels: ChannelSummary[] = [];

/*
  The channel state the app shell owned: which channel is open, which one a
  deep link or a notification asked for, and how far the catalog has loaded.

  Everything here is scoped to one workspace. The shell expressed that as a
  list of `setX(null)` calls at the top of the catalog effect, so the reset was
  one render late and easy to forget an entry in. The selection atoms below
  carry the workspace they were written for instead, and read as their
  initial value under any other one — the reset is the workspace key
  changing, not a statement someone has to remember to write.

  Returning to an workspace must not resurrect what was selected there
  before, though, so `resetChannelSelection` still drops the stored stamps. It
  is the one imperative step, and it happens inside a single batch.
*/

/** A value together with the workspace it was written under. */
interface WorkspaceScoped<A> {
  readonly workspaceId: string | null;
  readonly value: A;
}

const scopedStores: Atom.Writable<WorkspaceScoped<unknown>>[] = [];

/**
 * State that belongs to one workspace. Reads under a different workspace
 * see `initial`, which is what makes switching workspaces the reset.
 */
function organizationScopedAtom<A>(
  initial: A,
  label: string,
): Atom.Writable<A, A> {
  const stored = Atom.make<WorkspaceScoped<A>>({
    workspaceId: null,
    value: initial,
  }).pipe(Atom.keepAlive, Atom.withLabel(`${label}/stored`));
  scopedStores.push(stored as Atom.Writable<WorkspaceScoped<unknown>>);
  return Atom.writable<A, A>(
    (get) => {
      const held = get(stored);
      return held.workspaceId === get(activeWorkspaceIdAtom)
        ? held.value
        : initial;
    },
    (ctx, value) => {
      ctx.set(stored, {
        workspaceId: ctx.get(activeWorkspaceIdAtom),
        value,
      });
    },
  ).pipe(Atom.keepAlive, Atom.withLabel(label));
}

/** The shared empty list every "no sections yet" branch returns. */
const noSidebarSections: ChannelSidebarSection[] = [];

/**
 * The caller's own sidebar sections for the active workspace, in position
 * order. They arrive with the catalog and are replaced by whatever a section
 * RPC returns, so the list never has to merge one section into the others.
 */
export const channelSidebarSectionsAtom = organizationScopedAtom<
  ChannelSidebarSection[]
>(noSidebarSections, "channels/sidebarSections");

/** The channel the app considers open, within the active workspace. */
export const activeChannelIdAtom = organizationScopedAtom<string | null>(
  null,
  "channels/activeId",
);

/** A channel whose settings dialog should open once the view mounts. */
export const requestedChannelSettingsIdAtom = organizationScopedAtom<
  string | null
>(null, "channels/requestedSettingsId");

/** A channel the companion shell should open once its list is ready. */
export const requestedChannelIdAtom = organizationScopedAtom<string | null>(
  null,
  "channels/requestedId",
);

/** A freshly created channel whose invite dialog opens once. */
export const initialChannelInviteIdAtom = organizationScopedAtom<string | null>(
  null,
  "channels/initialInviteId",
);

/**
 * The cursor the active workspace's catalog was loaded at, or `null` while
 * it has not loaded. Views pass it down so their own delta sync resumes from
 * the same place, and the deep link handlers wait on it.
 */
export const channelCatalogCursorAtom = organizationScopedAtom<number | null>(
  null,
  "channels/catalogCursor",
);

/** A message a deep link or a notification asked to scroll to. */
export const requestedChannelMessageAtom = Atom.make<{
  readonly channelId: string;
  readonly messageId: string;
  readonly rootMessageId: string;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("channels/requestedMessage"));

/**
 * The channel the user is looking at right now, and the thread inside it. Used
 * to suppress notifications for what is already on screen, so it is deliberately
 * not scoped: the view reports `null` on unmount.
 */
export const viewingChannelIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("channels/viewingId"),
);

export const viewingChannelThreadRootMessageIdAtom = Atom.make<string | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("channels/viewingThreadRootMessageId"));

/** The issue conversation on screen, for the same notification suppression. */
export const viewingIssueConversationRunIdAtom = Atom.make<string | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("channels/viewingIssueConversationRunId"));

/** Whether the catalog request for the active workspace is in flight. */
export const channelsLoadingAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("channels/loading"),
);

/** Bumped to retry a catalog load that failed. */
export const channelCatalogRetryAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("channels/catalogRetry"),
);

/*
  The three lists the shell used to slice out of one `useState` array.

  A project window shows only the channels pinned to its team and no direct
  messages at all, which is why the pin is read here rather than passed down.
*/

/** Every channel of the active workspace, in catalog order. */
export const activeWorkspaceChannelsAtom = Atom.make((get) => {
  const workspaceId = get(activeWorkspaceIdAtom);
  return workspaceId
    ? get(organizationChannelsAtom(workspaceId))
    : noChannels;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
  Atom.withLabel("channels/activeWorkspace"),
);

/** The channels a channel list may show here: never direct messages. */
export const visibleWorkspaceChannelsAtom = Atom.make((get) => {
  const lockedTeamId = get(lockedTeamIdAtom);
  return get(activeWorkspaceChannelsAtom).filter((channel) =>
    channel.kind !== "dm" &&
    (!lockedTeamId || channel.defaultProjectId === lockedTeamId),
  );
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
  Atom.withLabel("channels/visible"),
);

/**
 * The Agent-to-Agent conversation the direct message page is showing, if any.
 *
 * It is deliberately outside the catalog, so every rule phrased as "the open
 * channel is not in the direct message list" — the page swapping in the latest
 * conversation, above all — would throw the reader straight back out of it.
 * The view that holds one says so here instead.
 */
export const openAgentConversationIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("channels/openAgentConversation"),
);

/**
 * Claims one before navigating to it. The navigation reconciles on the commit
 * the navigation lands in, and the shell's effects run ahead of the page's, so
 * whoever sends the reader there says so first.
 */
export function claimOpenAgentConversation(
  registry: AtomRegistry,
  channelId: string | null,
): void {
  registry.set(openAgentConversationIdAtom, channelId);
}

/** The direct messages of the active workspace. Empty in a project window. */
export const organizationDirectMessagesAtom = Atom.make((get) =>
  get(lockedTeamIdAtom)
    ? noChannels
    : get(activeWorkspaceChannelsAtom).filter(
        (channel) => channel.kind === "dm",
      ),
).pipe(
  Atom.keepAlive,
  Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
  Atom.withLabel("channels/directMessages"),
);

/**
 * The desktop DM page is composing a new conversation: the sidebar list shows
 * no open row and the pane shows the recipient picker instead of a timeline.
 * Selecting any channel ends it, and so does switching workspaces.
 */
export const directMessageComposeAtom = organizationScopedAtom<boolean>(
  false,
  "channels/directMessageCompose",
);

/** How many direct messages carry unread activity, for the navigation badge. */
export const unreadDirectMessageCountAtom = Atom.make(
  (get) =>
    get(organizationDirectMessagesAtom).filter((channel) => channel.hasUnread)
      .length,
).pipe(Atom.keepAlive, Atom.withLabel("channels/unreadDirectMessageCount"));

/**
 * Drops every workspace scoped selection. Switching workspaces already
 * hides them; this is what keeps coming back to one from restoring what was
 * open there before.
 */
export function resetChannelSelection(registry: AtomRegistry): void {
  Atom.batch(() => {
    for (const stored of scopedStores) {
      const held = registry.get(stored);
      if (held.workspaceId === null) continue;
      registry.set(stored, { workspaceId: null, value: held.value });
    }
  });
}
