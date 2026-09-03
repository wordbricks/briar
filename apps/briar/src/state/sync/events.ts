import type { ChannelSummary } from "../../lib/channels-contract";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  HuntRun,
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
  /** One channel summary was created or changed. */
  | { readonly kind: "channel-changed"; readonly channel: ChannelSummary }
  /** The team's entities and per-team state are dropped. */
  | { readonly kind: "team-cleared"; readonly teamId: string }
  /**
   * The account left an organization, so every team outside
   * `retainedOrganizationId` drops its entities. `null` retains nothing.
   */
  | { readonly kind: "organization-left"; readonly retainedOrganizationId: string | null }
  /** The session ended or changed accounts: nothing may survive. */
  | { readonly kind: "session-cleared" };
