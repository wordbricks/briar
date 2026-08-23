import { useEffect, useState } from "react";
import {
  listenToAutoHuntAppServerEvents,
  loadAutoHuntAppServerEvents,
  mergeAutoHuntAppServerEvents,
  type AutoHuntAppServerEvent,
} from "../lib/auto-hunt-agent";

export function useAutoHuntAppServerEvents(sessionId: string | null) {
  const [events, setEvents] = useState<AutoHuntAppServerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    setEvents([]);
    setError(null);
    setIsLoading(Boolean(sessionId));
    if (!sessionId) return;

    void (async () => {
      try {
        unlisten = await listenToAutoHuntAppServerEvents((event) => {
          if (!active || event.sessionId !== sessionId) return;
          setEvents((current) => mergeAutoHuntAppServerEvents(current, event));
        });
        const stored = await loadAutoHuntAppServerEvents(sessionId);
        if (!active) return;
        setEvents((current) => mergeAutoHuntAppServerEvents(current, stored));
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
      unlisten();
    };
  }, [sessionId]);

  return { events, isLoading, error };
}
