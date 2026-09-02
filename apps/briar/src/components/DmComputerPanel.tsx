import type RFB from "@novnc/novnc";
import {
  Expand,
  Keyboard,
  Minimize2,
  MonitorUp,
  RefreshCw,
  Scan,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useI18n } from "../i18n";
import {
  createManagedComputerRemoteSession,
  endManagedComputerRemoteSession,
  loadManagedComputers,
  loadOrganizationExecutionWorkers,
  loadProjectAgents,
} from "../lib/api";
import type { ChannelAgentSummary } from "../lib/channels-contract";
import {
  type DmAgentComputerTarget,
  resolveDmAgentComputerTarget,
} from "../lib/dm-agent-computer";
import { supportsManagedComputerRemoteDesktop } from "../lib/platform";
import { setRemoteDesktopKeyboardCapture } from
  "../lib/remote-desktop-focus";
import {
  createRemoteDesktopPasteController,
  isRemoteDesktopPasteShortcut,
} from "../lib/remote-desktop-paste";
import { cn } from "../lib/utils";
import { managedComputerRemoteErrorMessage } from
  "./ManagedComputerRemoteDesktop";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

type ConnectionState = "connecting" | "connected" | "reconnect" | "error";

export type DmComputerRfbConstructor = new (
  target: HTMLElement,
  url: string,
  options: { shared: boolean; wsProtocols: string[] },
) => RFB;

export type DmComputerPanelServices = {
  createRemoteSession: typeof createManagedComputerRemoteSession;
  endRemoteSession: typeof endManagedComputerRemoteSession;
  loadComputers: typeof loadManagedComputers;
  loadProjectAgents: typeof loadProjectAgents;
  loadRfbClient: () => Promise<DmComputerRfbConstructor>;
  loadWorkers: typeof loadOrganizationExecutionWorkers;
};

const defaultServices: DmComputerPanelServices = {
  createRemoteSession: createManagedComputerRemoteSession,
  endRemoteSession: endManagedComputerRemoteSession,
  loadComputers: loadManagedComputers,
  loadProjectAgents,
  loadRfbClient: async () => (await import("@novnc/novnc")).default,
  loadWorkers: loadOrganizationExecutionWorkers,
};

function useDmAgentComputerTarget(input: {
  agents: readonly ChannelAgentSummary[];
  organizationId: string;
  services: DmComputerPanelServices;
  token: string;
}) {
  const [target, setTarget] = useState<DmAgentComputerTarget | null>(null);
  const eligibleAgents = useMemo(
    () => input.agents.filter(
      (agent) =>
        agent.projectId !== null &&
        agent.computerUsePolicy === "unattended",
    ),
    [input.agents],
  );

  useEffect(() => {
    setTarget(null);
    if (
      !supportsManagedComputerRemoteDesktop() ||
      eligibleAgents.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const projectIds = [...new Set(
      eligibleAgents.flatMap((agent) => agent.projectId ?? []),
    )];
    void Promise.all([
      input.services.loadWorkers(input.token, input.organizationId),
      input.services.loadComputers(input.token, input.organizationId),
      Promise.all(projectIds.map((projectId) =>
        input.services.loadProjectAgents(input.token, projectId)
      )),
    ]).then(([workerResponse, computerResponse, agentGroups]) => {
      if (cancelled) return;
      setTarget(resolveDmAgentComputerTarget({
        agents: eligibleAgents,
        agentConfigurations: agentGroups.flat(),
        computers: computerResponse.computers,
        workers: workerResponse.workers,
      }));
    }).catch(() => {
      if (!cancelled) setTarget(null);
    });
    return () => {
      cancelled = true;
    };
  }, [eligibleAgents, input.organizationId, input.services, input.token]);

  return target;
}

function DmComputerScreen({
  organizationId,
  services,
  target,
  token,
}: {
  organizationId: string;
  services: DmComputerPanelServices;
  target: DmAgentComputerTarget;
  token: string;
}) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const remoteSessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const endingRef = useRef(false);
  const expandedRef = useRef(false);
  const fitScreenRef = useRef(true);
  const wasExpandedRef = useRef(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fitScreen, setFitScreen] = useState(true);
  const [pasteController] = useState(() =>
    createRemoteDesktopPasteController({
      getTarget: () => rfbRef.current,
    })
  );
  const storageKey =
    `briar.remoteDesktop.${target.computer.id}.${target.agentId}`;
  const screenLabel = t("dm.computer.screen", { name: target.agentName });

  const destroyRfb = useCallback(() => {
    pasteController.reset();
    const rfb = rfbRef.current;
    rfbRef.current = null;
    rfb?.disconnect();
  }, [pasteController]);

  const connect = useCallback(async (reconnect: boolean) => {
    const generation = ++generationRef.current;
    destroyRfb();
    endingRef.current = false;
    setConnectionState(reconnect ? "reconnect" : "connecting");
    setError(null);
    try {
      const reconnectSessionId = remoteSessionIdRef.current ??
        window.sessionStorage.getItem(storageKey) ?? undefined;
      const ticket = await services.createRemoteSession(
        token,
        organizationId,
        target.computer.id,
        {
          requestId: crypto.randomUUID(),
          agentId: target.agentId,
          ...(reconnectSessionId ? { reconnectSessionId } : {}),
        },
      );
      if (generation !== generationRef.current || !targetRef.current) {
        void services.endRemoteSession(
          token,
          organizationId,
          target.computer.id,
          ticket.session.id,
        ).catch(() => undefined);
        return;
      }
      remoteSessionIdRef.current = ticket.session.id;
      window.sessionStorage.setItem(storageKey, ticket.session.id);

      const RFBClient = await services.loadRfbClient();
      if (generation !== generationRef.current || !targetRef.current) return;
      const rfb = new RFBClient(targetRef.current, ticket.socket.url, {
        shared: false,
        wsProtocols: [ticket.socket.protocol],
      });
      rfb.focusOnClick = expandedRef.current;
      rfb.viewOnly = !expandedRef.current;
      rfb.clipViewport = false;
      rfb.scaleViewport = fitScreenRef.current;
      rfb.resizeSession = false;
      rfb.compressionLevel = 6;
      rfb.qualityLevel = 6;
      rfb.addEventListener("connect", () => {
        if (generation !== generationRef.current) return;
        setConnectionState("connected");
        setError(null);
        if (expandedRef.current) rfb.focus();
      });
      rfb.addEventListener("disconnect", () => {
        if (generation !== generationRef.current || endingRef.current) return;
        setConnectionState("reconnect");
      });
      rfb.addEventListener("securityfailure", () => {
        if (generation !== generationRef.current) return;
        setConnectionState("error");
        setError(t("managedComputer.remote.error.relay"));
      });
      rfbRef.current = rfb;
    } catch (caught) {
      if (generation !== generationRef.current) return;
      const messageKey = managedComputerRemoteErrorMessage(caught);
      setConnectionState("error");
      setError(
        messageKey
          ? t(messageKey)
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    }
  }, [
    destroyRfb,
    organizationId,
    services,
    storageKey,
    t,
    target.agentId,
    target.computer.id,
    token,
  ]);

  useEffect(() => {
    void connect(false);
    return () => {
      endingRef.current = true;
      generationRef.current += 1;
      destroyRfb();
      setRemoteDesktopKeyboardCapture(false);
      const sessionId = remoteSessionIdRef.current ??
        window.sessionStorage.getItem(storageKey);
      remoteSessionIdRef.current = null;
      window.sessionStorage.removeItem(storageKey);
      if (sessionId) {
        void services.endRemoteSession(
          token,
          organizationId,
          target.computer.id,
          sessionId,
        ).catch(() => undefined);
      }
    };
  }, [
    connect,
    destroyRfb,
    organizationId,
    services,
    storageKey,
    target.computer.id,
    token,
  ]);

  useEffect(() => {
    expandedRef.current = expanded;
    setRemoteDesktopKeyboardCapture(expanded);
    const rfb = rfbRef.current;
    if (rfb) {
      rfb.viewOnly = !expanded;
      rfb.focusOnClick = expanded;
    }
    if (expanded) {
      shellRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => rfbRef.current?.focus(), 0);
    } else {
      setFitScreen(true);
      if (wasExpandedRef.current) openButtonRef.current?.focus();
    }
    wasExpandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  useEffect(() => {
    fitScreenRef.current = fitScreen;
    if (rfbRef.current) rfbRef.current.scaleViewport = fitScreen;
  }, [fitScreen]);

  const statusKey = connectionState === "connected"
    ? "managedComputer.remote.connected"
    : connectionState === "connecting"
      ? "managedComputer.remote.connecting"
      : connectionState === "reconnect"
        ? "managedComputer.remote.disconnected"
        : "managedComputer.remote.failed";

  return (
    <aside
      aria-label={screenLabel}
      aria-modal={expanded || undefined}
      className={cn(
        "dm-computer-panel flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-card text-foreground",
        expanded
          ? "fixed inset-0 z-[100] h-screen w-screen border-0 bg-zinc-950 text-white outline-none"
          : "w-[clamp(300px,32vw,420px)] max-[760px]:hidden",
      )}
      ref={shellRef}
      role={expanded ? "dialog" : "complementary"}
      tabIndex={expanded ? -1 : undefined}
    >
      <header
        className={cn(
          "flex h-[52px] shrink-0 items-center justify-between gap-3 border-b px-4",
          expanded
            ? "border-white/10 bg-zinc-900/95"
            : "border-border bg-card",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <MonitorUp aria-hidden="true" className="shrink-0" size={17} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {t("dm.computer.title")}
            </div>
            <div
              aria-live="polite"
              className={cn(
                "flex items-center gap-1.5 truncate text-[11px]",
                expanded ? "text-zinc-400" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  connectionState === "connected"
                    ? "bg-emerald-500"
                    : connectionState === "error"
                      ? "bg-red-500"
                      : "bg-amber-500",
                )}
              />
              <span className="truncate">{t(statusKey)}</span>
            </div>
          </div>
        </div>
        {expanded ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={() => setFitScreen((current) => !current)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Scan aria-hidden="true" size={14} />
              {t(fitScreen
                ? "managedComputer.remote.actualSize"
                : "managedComputer.remote.fit")}
            </Button>
            <Button
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              disabled={connectionState !== "connected"}
              onClick={() => rfbRef.current?.sendCtrlAltDel()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Keyboard aria-hidden="true" size={14} />
              Ctrl Alt Del
            </Button>
            <Button
              aria-label={t("dm.computer.close")}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 active:scale-[.96]"
              onClick={() => setExpanded(false)}
              size="icon"
              title={t("dm.computer.close")}
              type="button"
              variant="outline"
            >
              <Minimize2 aria-hidden="true" size={16} />
            </Button>
          </div>
        ) : null}
      </header>

      <div
        className={cn(
          "min-h-0",
          expanded
            ? "flex flex-1 items-center justify-center bg-black p-4"
            : "overflow-auto p-4",
        )}
      >
        <div
          className={cn(
            "relative isolate aspect-video overflow-hidden bg-black shadow-sm",
            expanded
              ? "max-h-full w-full max-w-[calc((100vh-84px)*16/9)] rounded-xl ring-1 ring-white/10"
              : "w-full rounded-xl border border-border",
          )}
          data-briar-remote-desktop="true"
          data-tauri-drag-region="false"
          onKeyDownCapture={(event) => {
            if (
              expanded &&
              connectionState === "connected" &&
              isRemoteDesktopPasteShortcut(event)
            ) {
              event.stopPropagation();
            }
          }}
          onKeyDown={(event) => {
            if (expanded) event.stopPropagation();
          }}
          onKeyUp={(event) => {
            if (expanded) event.stopPropagation();
          }}
          onPasteCapture={(event) => {
            if (!expanded || connectionState !== "connected") return;
            const text = event.clipboardData.getData("text/plain");
            if (!pasteController.enqueue(text)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          tabIndex={expanded ? -1 : undefined}
        >
          <div className="size-full" ref={targetRef} />
          {connectionState !== "connected" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-5 text-center text-white">
              <div className="grid max-w-xs justify-items-center gap-2.5">
                {connectionState === "connecting" ||
                    connectionState === "reconnect" ? (
                  <Spinner className="text-white" size={22} />
                ) : null}
                <span className="text-sm font-medium">{t(statusKey)}</span>
                {error ? (
                  <span className="text-xs leading-relaxed text-zinc-300">
                    {error}
                  </span>
                ) : null}
                {connectionState === "reconnect" ||
                    connectionState === "error" ? (
                  <Button
                    onClick={() => void connect(true)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw aria-hidden="true" size={14} />
                    {t("managedComputer.remote.reconnect")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!expanded && connectionState === "connected" ? (
            <button
              aria-label={t("dm.computer.open")}
              className="group absolute inset-0 grid cursor-zoom-in place-items-center bg-transparent text-white transition-colors hover:bg-black/25 focus-visible:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 active:bg-black/35"
              onClick={() => setExpanded(true)}
              ref={openButtonRef}
              title={t("dm.computer.open")}
              type="button"
            >
              <span className="flex translate-y-1 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold opacity-0 shadow-lg backdrop-blur-md transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
                <Expand aria-hidden="true" size={14} />
                {t("dm.computer.open")}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {!expanded ? (
        <div className="shrink-0 px-4 pb-4 text-center">
          <div className="truncate text-xs font-medium text-muted-foreground">
            {screenLabel}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground/75">
            {target.workerLabel}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function DmComputerPanel({
  agents,
  organizationId,
  services = defaultServices,
  token,
}: {
  agents: readonly ChannelAgentSummary[];
  organizationId: string;
  services?: DmComputerPanelServices;
  token: string;
}) {
  const target = useDmAgentComputerTarget({
    agents,
    organizationId,
    services,
    token,
  });
  if (!target) return null;
  return (
    <DmComputerScreen
      key={`${target.computer.id}:${target.agentId}`}
      organizationId={organizationId}
      services={services}
      target={target}
      token={token}
    />
  );
}
