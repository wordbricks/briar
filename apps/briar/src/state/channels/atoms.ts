import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  ChannelSidebarSection,
  ChannelSummary,
} from "../../lib/channels-contract";
import { organizationChannelsAtom } from "../entities/channels";
import { shallowArrayEqual } from "../entities/upsert";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import type { AtomRegistry } from "../registry";

/** The shared empty list every "nothing here" branch returns. */
const noChannels: ChannelSummary[] = [];

/*
  The channel state the app shell owned: which channel is open, which one a
  deep link or a notification asked for, and how far the catalog has loaded.

  Everything here is scoped to one organization. The shell expressed that as a
  list of `setX(null)` calls at the top of the catalog effect, so the reset was
  one render late and easy to forget an entry in. The selection atoms below
  carry the organization they were written for instead, and read as their
  initial value under any other one — the reset is the organization key
  changing, not a statement someone has to remember to write.

  Returning to an organization must not resurrect what was selected there
  before, though, so `resetChannelSelection` still drops the stored stamps. It
  is the one imperative step, and it happens inside a single batch.
*/

/** A value together with the organization it was written under. */
interface OrganizationScoped<A> {
  readonly organizationId: string | null;
  readonly value: A;
}

const scopedStores: Atom.Writable<OrganizationScoped<unknown>>[] = [];

/**
 * State that belongs to one organization. Reads under a different organization
 * see `initial`, which is what makes switching organizations the reset.
 */
function organizationScopedAtom<A>(
  initial: A,
  label: string,
): Atom.Writable<A, A> {
  const stored = Atom.make<OrganizationScoped<A>>({
    organizationId: null,
    value: initial,
  }).pipe(Atom.keepAlive, Atom.withLabel(`${label}/stored`));
  scopedStores.push(stored as Atom.Writable<OrganizationScoped<unknown>>);
  return Atom.writable<A, A>(
    (get) => {
      const held = get(stored);
      return held.organizationId === get(activeOrganizationIdAtom)
        ? held.value
        : initial;
    },
    (ctx, value) => {
      ctx.set(stored, {
        organizationId: ctx.get(activeOrganizationIdAtom),
        value,
      });
    },
  ).pipe(Atom.keepAlive, Atom.withLabel(label));
}

/** The shared empty list every "no sections yet" branch returns. */
const noSidebarSections: ChannelSidebarSection[] = [];

/**
 * The caller's own sidebar sections for the active organization, in position
 * order. They arrive with the catalog and are replaced by whatever a section
 * RPC returns, so the list never has to merge one section into the others.
 */
export const channelSidebarSectionsAtom = organizationScopedAtom<
  ChannelSidebarSection[]
>(noSidebarSections, "channels/sidebarSections");

/** The channel the app considers open, within the active organization. */
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
 * The cursor the active organization's catalog was loaded at, or `null` while
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

/** Whether the catalog request for the active organization is in flight. */
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

/** Every channel of the active organization, in catalog order. */
export const activeOrganizationChannelsAtom = Atom.make((get) => {
  const organizationId = get(activeOrganizationIdAtom);
  return organizationId
    ? get(organizationChannelsAtom(organizationId))
    : noChannels;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
  Atom.withLabel("channels/activeOrganization"),
);

/** The channels a channel list may show here: never direct messages. */
export const visibleOrganizationChannelsAtom = Atom.make((get) => {
  const lockedTeamId = get(lockedTeamIdAtom);
  return get(activeOrganizationChannelsAtom).filter((channel) =>
    channel.kind !== "dm" &&
    (!lockedTeamId || channel.defaultProjectId === lockedTeamId),
  );
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
  Atom.withLabel("channels/visible"),
);

/** The direct messages of the active organization. Empty in a project window. */
export const organizationDirectMessagesAtom = Atom.make((get) =>
  get(lockedTeamIdAtom)
    ? noChannels
    : get(activeOrganizationChannelsAtom).filter(
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
 * Selecting any channel ends it, and so does switching organizations.
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
 * Drops every organization scoped selection. Switching organizations already
 * hides them; this is what keeps coming back to one from restoring what was
 * open there before.
 */
export function resetChannelSelection(registry: AtomRegistry): void {
  Atom.batch(() => {
    for (const stored of scopedStores) {
      const held = registry.get(stored);
      if (held.organizationId === null) continue;
      registry.set(stored, { organizationId: null, value: held.value });
    }
  });
}
