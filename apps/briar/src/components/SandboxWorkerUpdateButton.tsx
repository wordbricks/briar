import { useAtomValue } from "@effect/atom-react";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { loadWorkspaceExecutionWorkers, requestWorkspaceExecutionWorkerUpdate } from "../lib/api";
import { activeWorkspaceIdAtom } from "../state/workspace/atoms";
import { tokenAtom } from "../state/session/atoms";
import type { ExecutionWorker, WorkspaceExecutionWorker } from "../types";
import { workerSandboxUpdateSupported } from "./WorkerStatusBar";
import { Spinner } from "./ui/spinner";

export function SandboxWorkerUpdateButton({ worker }: { worker: ExecutionWorker }) {
  const { t } = useI18n();
  const token = useAtomValue(tokenAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [canManage, setCanManage] = useState(false);
  const [pending, setPending] = useState(false);
  const [request, setRequest] = useState<WorkspaceExecutionWorker["updateRequest"]>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token || !workspaceId || !workerSandboxUpdateSupported(worker)) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await loadWorkspaceExecutionWorkers(token, workspaceId);
        if (disposed) return;
        setCanManage(response.canManage);
        setRequest(response.workers.find((device) => device.deviceId === worker.deviceId)?.updateRequest ?? null);
      } catch { /* The action stays hidden if permissions cannot be checked. */ }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [token, workspaceId, worker]);
  if (!canManage || !workerSandboxUpdateSupported(worker)) return null;
  const busy = pending || (Boolean(request) && request?.handoffState !== "failed");
  return <span className="flex items-center gap-2">
    <button
      aria-label={t("workspace.workerUpdate", { name: worker.label })}
      aria-busy={busy}
      className="grid size-10 shrink-0 place-items-center rounded-lg border border-border disabled:opacity-60"
      disabled={busy || worker.state !== "online"}
      onClick={() => {
        if (!token || !workspaceId) return;
        setPending(true); setError(null);
        void requestWorkspaceExecutionWorkerUpdate(token, workspaceId, worker.deviceId)
          .then(() => loadWorkspaceExecutionWorkers(token, workspaceId))
          .then((response) => setRequest(response.workers.find((device) => device.deviceId === worker.deviceId)?.updateRequest ?? null))
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setPending(false));
      }}
      type="button"
    >{busy ? <Spinner className="size-4" /> : <Download aria-hidden size={18} />}</button>
    {(error || request?.handoffError) ? <small role="alert">{error ?? request?.handoffError}</small> : null}
  </span>;
}
