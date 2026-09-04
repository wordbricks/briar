import type { ChannelSummary } from "../../lib/channels-contract";
import type {
  AutoHuntSession,
  DashboardDeltaPayload,
  DashboardPayload,
  HuntRun,
  TeamSettings,
} from "../../types";

/*
  Everything that may change the normalized store, expressed as data.

  Snapshot loads, cursor deltas, realtime transports and the responses of user
  triggered writes all describe their effect as one of these events and hand it
  to `applySyncEvent`. Keeping the merge rules behind a single entry point is
  what makes them testable in one place — and what stops a second code path from
  quietly inventing a different one.
*/
export type SyncEvent =
  /**
   * A full `DashboardPayload` replaces everything known about the team. Run
   * order is the server's, verbatim and uncapped, which is what the dashboard
   * has always rendered after a snapshot.
   */
  | { readonly kind: "team-snapshot"; readonly teamId: string; readonly payload: DashboardPayload }
  /**
   * One cursor page. Ignored for a team with no payload yet: a delta only makes
   * sense against a base, and the loader falls back to a snapshot instead.
   */
  | { readonly kind: "team-delta"; readonly teamId: string; readonly payload: DashboardDeltaPayload }
  /**
   * One run was created or changed outside the delta stream — a realtime event
   * or a confirmed write. A run the team does not list yet is prepended.
   */
  | { readonly kind: "run-changed"; readonly run: HuntRun; readonly teamId?: string }
  /** One run is gone. */
  | { readonly kind: "run-deleted"; readonly teamId: string; readonly runId: string }
  /**
   * One channel summary was created or changed without moving in the list — a
   * read receipt or a realtime edit. A channel the organization does not list
   * yet is appended.
   */
  | { readonly kind: "channel-changed"; readonly channel: ChannelSummary }
  /**
   * The organization's whole channel list, in the order it renders. Both the
   * catalog load and the local writes that reorder the list (creating a
   * channel, a conversation view replacing its own copy) describe themselves
   * this way, because order is the one thing a per-channel event cannot carry.
   */
  | {
      readonly kind: "channel-catalog-snapshot";
      readonly organizationId: string;
      readonly channels: readonly ChannelSummary[];
    }
  /**
   * One cursor page of the channel catalog. `reset` drops what is stored before
   * merging, and the merged list is re-sorted by name — the order the catalog
   * has always taken after a delta.
   */
  | {
      readonly kind: "channel-catalog-delta";
      readonly organizationId: string;
      readonly channels: readonly ChannelSummary[];
      readonly removedChannelIds: readonly string[];
      readonly reset: boolean;
    }
  /** One channel is gone from an organization. */
  | {
      readonly kind: "channel-removed";
      readonly organizationId: string;
      readonly channelId: string;
    }
  /** The organization's catalog is dropped: nothing is known about it again. */
  | { readonly kind: "channel-catalog-cleared"; readonly organizationId: string }
  /**
   * A confirmed settings write for one team. Applied only to the team whose
   * payload is the one on screen: a write for any other team would otherwise
   * install settings next to entities nobody refreshed, and the next snapshot
   * for it replaces them anyway.
   */
  | {
      readonly kind: "team-settings-changed";
      readonly teamId: string;
      readonly settings: TeamSettings;
    }
  /**
   * Agent sessions this device wrote: one started, settled, stopped or folded
   * back together with the native dispatch it spawned. A session the store does
   * not list yet is prepended, because the list renders newest first; the ones
   * it already has keep their position.
   *
   * The kinds are plural because two of the writers work on a set at a time —
   * the dispatch reconciliation walks a team, and native recovery answers for
   * every session it found. A single session is a one element array.
   */
  | {
      readonly kind: "agent-sessions-changed";
      readonly sessions: readonly AutoHuntSession[];
    }
  /**
   * Server copies of sessions, merged under the rule that the newer
   * `updatedAt` wins and the detail only this device has survives. Re-sorts the
   * whole list by `startedAt`, which is the order the server's page has.
   */
  | {
      readonly kind: "agent-sessions-merged";
      readonly sessions: readonly AutoHuntSession[];
    }
  /**
   * One project's session page. Remote-owned sessions the page dropped go away
   * and `reset` replaces the project's remote half wholesale, but a session
   * this device owns is never removed by a server page.
   */
  | {
      readonly kind: "agent-sessions-synced";
      readonly teamId: string;
      readonly sessions: readonly AutoHuntSession[];
      readonly deletedSessionIds: readonly string[];
      readonly reset: boolean;
    }
  /** Every session of one team is dropped: the team itself is gone. */
  | { readonly kind: "agent-sessions-removed"; readonly teamId: string }
  /** The team's entities and per-team state are dropped. */
  | { readonly kind: "team-cleared"; readonly teamId: string }
  /**
   * The account left an organization, so every team outside
   * `retainedOrganizationId` drops its entities. `null` retains nothing.
   */
  | { readonly kind: "organization-left"; readonly retainedOrganizationId: string | null }
  /** The session ended or changed accounts: nothing may survive. */
  | { readonly kind: "session-cleared" };
