import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvidence } from "@/types";
export type RunEvidenceLoadState = {
  runId: string;
  evidence: RunEvidence[];
  loading: boolean;
  loadError: string | null;
};
export function useRunEvidenceLoader(runId: string, onLoad: () => Promise<RunEvidence[]>, enabled: boolean, fallbackError: string) {
  const [state, setState] = useState<RunEvidenceLoadState>(() => ({
    runId,
    evidence: [],
    loading: enabled,
    loadError: null
  }));
  const onLoadRef = useRef(onLoad);
  const requestRef = useRef(0);
  onLoadRef.current = onLoad;
  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setState({
      runId,
      evidence: [],
      loading: true,
      loadError: null
    });
    try {
      const evidence = await onLoadRef.current();
      if (request !== requestRef.current) return;
      setState({
        runId,
        evidence,
        loading: false,
        loadError: null
      });
    } catch (caught) {
      if (request !== requestRef.current) return;
      setState({
        runId,
        evidence: [],
        loading: false,
        loadError: caught instanceof Error ? caught.message : fallbackError
      });
    }
  }, [fallbackError, runId]);
  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1;
      return;
    }
    void reload();
    return () => {
      requestRef.current += 1;
    };
  }, [enabled, reload]);
  return state.runId === runId ? {
    ...state,
    reload
  } : {
    runId,
    evidence: [],
    loading: enabled,
    loadError: null,
    reload
  };
}
