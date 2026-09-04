import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useRef } from "react";

import {
  CHANNEL_REALTIME_FALLBACK_MS,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "../../lib/channel-realtime";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { adoptsHydratedCatalog } from "../persistence/hydration";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { resolveChannelApi } from "./api";
import {
  channelCatalogCursorAtom,
  channelCatalogRetryAtom,
  channelsLoadingAtom,
  resetChannelSelection,
} from "./atoms";

/** How long a failed catalog request waits before it is retried. */
export const CHANNEL_CATALOG_RETRY_MS = 3_000;

/**
 * Keeps the active organization's channel catalog current: one snapshot per
 * organization, then a realtime subscription that pulls cursor deltas, with a
 * polling fallback while the subscription is down and a pause while the window
 * is hidden.
 *
 * Both halves were `useEffect` blocks on the app shell, which is why every
 * catalog change re-rendered the whole tree in order to hand a new array to the
 * channel list. They write through `applySyncEvent` now, so the store notifies
 * only the views that read the channels that actually moved.
 */
export function useChannelCatalogSync(): void {
  const registry = useRegistry();
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const token = useAtomValue(tokenAtom);
  const retry = useAtomValue(channelCatalogRetryAtom);
  const catalogLoaded = useAtomValue(channelCatalogCursorAtom) !== null;

  /*
    The cursor the delta loop resumes from.

    It is a ref rather than an atom because the loop compares it against itself
    to detect that a newer page already landed, and re-rendering on a cursor
    that no view displays would defeat the point of the split.
  */
  const cursorRef = useRef(0);
  /** The organization whose catalog is currently in the store, if any. */
  const catalogOrganizationRef = useRef<string | null>(null);

  useEffect(() => {
    Atom.batch(() => {
      const previousOrganizationId = catalogOrganizationRef.current;
      /*
        The catalog this run inherits is the one a stored snapshot put in the
        store, so it is this organization's own list rather than the leftovers
        of the previous one. Only the first run can inherit anything: after that
        the ref names whichever organization the store holds.
      */
      const hydrated =
        previousOrganizationId === null &&
        adoptsHydratedCatalog(registry, organizationId);
      for (const staleId of new Set(
        [previousOrganizationId, organizationId].filter(
          (value): value is string => value !== null,
        ),
      )) {
        if (hydrated && staleId === organizationId) continue;
        applySyncEvent(registry, {
          kind: "channel-catalog-cleared",
          organizationId: staleId,
        });
      }
      catalogOrganizationRef.current = organizationId;
      // Drops the open channel, the pending invite and the requested settings
      // dialog together with the catalog they referred to.
      resetChannelSelection(registry);
    });
    cursorRef.current = 0;
    if (!organizationId || !token) {
      registry.set(channelsLoadingAtom, false);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const api = resolveChannelApi(registry);
    registry.set(channelsLoadingAtom, true);
    void api
      .listChannels(token, organizationId)
      .then((result) => {
        if (cancelled) return;
        cursorRef.current = result.cursor;
        Atom.batch(() => {
          registry.set(channelCatalogCursorAtom, result.cursor);
          applySyncEvent(registry, {
            kind: "channel-catalog-snapshot",
            organizationId,
            channels: result.channels,
          });
        });
      })
      .catch(() => {
        // The conversation view reports request errors when opened. Keep the
        // sidebar usable so channel creation can still be retried.
        if (cancelled) return;
        retryTimer = window.setTimeout(
          () => registry.update(channelCatalogRetryAtom, (count) => count + 1),
          CHANNEL_CATALOG_RETRY_MS,
        );
      })
      .finally(() => {
        if (!cancelled) registry.set(channelsLoadingAtom, false);
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [organizationId, registry, retry, token]);

  useEffect(() => {
    if (!organizationId || !token || !catalogLoaded) return;

    let stopped = false;
    let inFlight = false;
    let pending = false;
    const abortController = new AbortController();
    const api = resolveChannelApi(registry);
    const transport = api.createChannelRealtimeTransport(token, organizationId);
    const sync = async () => {
      pending = true;
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        while (pending && !stopped) {
          pending = false;
          for (
            let page = 0;
            page < MAX_CHANNEL_DELTA_PAGES_PER_SYNC;
            page += 1
          ) {
            const requestedCursor = cursorRef.current;
            const delta = await api.loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (stopped || requestedCursor !== cursorRef.current) return;
            cursorRef.current = delta.cursor;
            applySyncEvent(registry, {
              kind: "channel-catalog-delta",
              organizationId,
              channels: delta.channels,
              removedChannelIds: delta.removedChannelIds,
              reset: delta.reset,
            });
            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn("Channel catalog delta refresh failed", error);
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) window.queueMicrotask(() => void sync());
      }
    };
    const unsubscribe = transport.subscribe((notification) => {
      if (
        notification.topic === "channels" &&
        notification.cursor > cursorRef.current
      ) {
        void sync();
      }
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else {
        transport.start();
        void sync();
      }
    };
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    const interval = window.setInterval(() => {
      if (!document.hidden) void sync();
    }, CHANNEL_REALTIME_FALLBACK_MS);
    return () => {
      stopped = true;
      unsubscribe();
      transport.stop();
      abortController.abort();
      document.removeEventListener("visibilitychange", updateVisibility);
      window.clearInterval(interval);
    };
  }, [catalogLoaded, organizationId, registry, token]);
}
