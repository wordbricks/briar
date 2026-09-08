import type RFB from "@novnc/novnc";
import {
  Expand,
  Eye,
  MousePointer2,
  Keyboard,
  Minimize2,
  MonitorUp,
  RefreshCw,
  Scan,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  type SyntheticEvent,
  useRef,
  useState,
} from "react";

import { useRemoteDesktopClipboard } from "../hooks/useRemoteDesktopClipboard";
import { useI18n } from "../i18n";
import {
  createManagedComputerRemoteSession,
  endManagedComputerRemoteSession,
  loadManagedComputers,
  loadOrganizationExecutionWorkers,
  loadProjectAgents,
} from "../lib/api";
import { findApiError } from "../lib/api/errors";
import type { ChannelAgentSummary } from "../lib/channels-contract";
import {
  type DmAgentComputerTarget,
  resolveDmAgentComputerTarget,
  sameDmAgentComputerTarget,
} from "../lib/dm-agent-computer";
import { supportsManagedComputerRemoteDesktop } from "../lib/platform";
import { setRemoteDesktopKeyboardCapture } from
  "../lib/remote-desktop-focus";
import {
  createRemoteDesktopPasteController,
  isRemoteDesktopPasteShortcut,
} from "../lib/remote-desktop-paste";
import { cn } from "../lib/utils";
import type { ManagedComputerRemoteSessionTicket } from "../types";
import { managedComputerRemoteErrorMessage } from
  "./ManagedComputerRemoteDesktop";
import { RemoteDesktopClipboardButton } from "./RemoteDesktopClipboardButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

type ConnectionState = "connecting" | "connected" | "reconnect" | "error";

/*
  Leaving a screen ends its session and opening the next one asks for a new
  ticket, and the two requests are in flight together: whenever the new ticket
  is read first, Briar still sees the old session holding the computer and
  answers `MANAGED_COMPUTER_REMOTE_IN_USE`. The end lands a moment later, so
  the panel waits it out instead of leaving the user on an error with a manual
  reconnect button. A rejected ticket costs nothing against the rate limit —
  only issued sessions count.
*/
const remoteSessionRetryDelaysMs = [400, 1_200, 2_500];

/*
  Read through the wrapper rather than matching the outer error: Connect
  re-wraps whatever the transport raises, so an `instanceof ApiError` check saw
  a `ConnectError` and this retry never fired for the very races it exists for.
*/
function remoteSessionInUse(error: unknown) {
  return findApiError(error)?.code === "MANAGED_COMPUTER_REMOTE_IN_USE";
}

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
    if (
      !supportsManagedComputerRemoteDesktop() ||
      eligibleAgents.length === 0
    ) {
      setTarget(null);
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
      const resolved = resolveDmAgentComputerTarget({
        agents: eligibleAgents,
        agentConfigurations: agentGroups.flat(),
        computers: computerResponse.computers,
        workers: workerResponse.workers,
      });
      setTarget((current) =>
        sameDmAgentComputerTarget(current, resolved) ? current : resolved
      );
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
  id,
  onClose,
  open,
  organizationId,
  services,
  target,
  token,
}: {
  id?: string;
  onClose?: () => void;
  open: boolean;
  organizationId: string;
  services: DmComputerPanelServices;
  target: DmAgentComputerTarget;
  token: string;
}) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const remoteSessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const endingRef = useRef(false);
  const controlRef = useRef(false);
  const controlButtonRef = useRef<HTMLButtonElement | null>(null);
  const mouseRef = useRef<{ target: EventTarget; x: number; y: number } | null>(null);
  const fitScreenRef = useRef(true);
  const wasExpandedRef = useRef(false);
  const { controller: clipboardController, state: clipboardState } =
    useRemoteDesktopClipboard();
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [inputHint, setInputHint] = useState(false);
  const [fitScreen, setFitScreen] = useState(true);
  const [pasteController] = useState(() =>
    createRemoteDesktopPasteController({
      getTarget: () => controlRef.current ? rfbRef.current : null,
    })
  );
  const storageKey =
    `briar.remoteDesktop.${target.computer.id}.${target.agentId}`;
  const screenLabel = t("dm.computer.screen", { name: target.agentName });

  const releaseControl = useCallback(() => {
    pasteController.reset();
    const rfb = rfbRef.current;
    // Release held keys/buttons while input is still enabled, then gate all
    // future input. Release noVNC's window-level pointer capture explicitly.
    if (controlRef.current) {
      rfb?.blur();
      const mouse = mouseRef.current;
      if (mouse) {
        const options = {
          bubbles: true, cancelable: true, buttons: 0,
          clientX: mouse.x, clientY: mouse.y,
        };
        // noVNC proxies window mouseup to its canvas and releases capture.
        // Without capture (e.g. a touch gesture), release on the canvas itself.
        const release = new MouseEvent("mouseup", options);
        window.dispatchEvent(release);
        if (!release.defaultPrevented) {
          mouse.target.dispatchEvent(new MouseEvent("mouseup", options));
        }
      }
    }
    mouseRef.current = null;
    controlRef.current = false;
    if (rfb) {
      rfb.viewOnly = true;
      rfb.focusOnClick = false;
    }
    setRemoteDesktopKeyboardCapture(false);
    setControlling(false);
  }, [pasteController]);

  const closeExpanded = useCallback(() => {
    releaseControl();
    setExpanded(false);
  }, [releaseControl]);

  const blockReadOnlyInput = (event: SyntheticEvent) => {
    if (controlRef.current || !targetRef.current?.contains(event.target as Node)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (expanded) setInputHint(true);
    return true;
  };

  const destroyRfb = useCallback(() => {
    releaseControl();
    clipboardController.reset();
    const rfb = rfbRef.current;
    rfbRef.current = null;
    rfb?.disconnect();
  }, [clipboardController, releaseControl]);

  const connect = useCallback(async (reconnect: boolean) => {
    const generation = ++generationRef.current;
    destroyRfb();
    endingRef.current = false;
    setConnectionState(reconnect ? "reconnect" : "connecting");
    setError(null);
    try {
      const reconnectSessionId = remoteSessionIdRef.current ??
        window.sessionStorage.getItem(storageKey) ?? undefined;
      let ticket: ManagedComputerRemoteSessionTicket | null = null;
      for (let attempt = 0; ticket === null; attempt += 1) {
        try {
          ticket = await services.createRemoteSession(
            token,
            organizationId,
            target.computer.id,
            {
              requestId: crypto.randomUUID(),
              agentId: target.agentId,
              ...(reconnectSessionId ? { reconnectSessionId } : {}),
            },
          );
        } catch (caught) {
          if (generation !== generationRef.current) return;
          if (
            !remoteSessionInUse(caught) ||
            attempt >= remoteSessionRetryDelaysMs.length
          ) {
            throw caught;
          }
          await new Promise((resolve) =>
            window.setTimeout(resolve, remoteSessionRetryDelaysMs[attempt])
          );
          if (generation !== generationRef.current) return;
        }
      }
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
      rfb.focusOnClick = false;
      rfb.viewOnly = true;
      rfb.clipViewport = false;
      rfb.scaleViewport = fitScreenRef.current;
      rfb.resizeSession = false;
      rfb.compressionLevel = 6;
      rfb.qualityLevel = 6;
      rfb.addEventListener("connect", () => {
        if (generation !== generationRef.current) return;
        setConnectionState("connected");
        setError(null);
      });
      rfb.addEventListener("disconnect", () => {
        if (generation !== generationRef.current || endingRef.current) return;
        releaseControl();
        setConnectionState("reconnect");
      });
      rfb.addEventListener("securityfailure", () => {
        if (generation !== generationRef.current) return;
        releaseControl();
        setConnectionState("error");
        setError(t("managedComputer.remote.error.relay"));
      });
      rfbRef.current = rfb;
      clipboardController.bind(rfb);
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
    clipboardController,
    destroyRfb,
    organizationId,
    services,
    releaseControl,
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
    if (expanded) {
      shellRef.current?.focus({ preventScroll: true });
      controlButtonRef.current?.focus();
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
      closeExpanded();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeExpanded, expanded]);

  useEffect(() => {
    fitScreenRef.current = fitScreen;
    if (rfbRef.current) rfbRef.current.scaleViewport = fitScreen;
  }, [fitScreen]);

  useEffect(() => {
    setRemoteDesktopKeyboardCapture(open && controlRef.current);
  }, [open]);

  const statusKey = connectionState === "connected"
    ? "managedComputer.remote.connected"
    : connectionState === "connecting"
      ? "managedComputer.remote.connecting"
      : connectionState === "reconnect"
        ? "managedComputer.remote.disconnected"
        : "managedComputer.remote.failed";

  return (
    <div
      aria-label={screenLabel}
      aria-modal={expanded || undefined}
      className={cn(
        "dm-computer-panel min-h-0 shrink-0 overflow-hidden border-l border-border bg-card text-foreground",
        open ? "flex flex-col" : "hidden",
        expanded
          ? "fixed inset-0 z-[100] h-screen w-screen border-0 bg-zinc-950 text-white outline-none"
          : "w-[clamp(300px,32vw,420px)] max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:right-0 max-[760px]:z-20 max-[760px]:shadow-xl",
      )}
      hidden={!open}
      id={id}
      onKeyDownCapture={(event) => {
        if (!expanded) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeExpanded();
        } else if (event.key === "Tab" && targetRef.current?.contains(event.target as Node)) {
          event.preventDefault();
          event.stopPropagation();
          rfbRef.current?.blur();
          controlButtonRef.current?.focus();
        }
      }}
      ref={shellRef}
      role={expanded ? "dialog" : "complementary"}
      tabIndex={expanded ? -1 : undefined}
    >
      <header
        className={cn(
          "flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2",
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label={t("dm.computer.control")}
              aria-checked={controlling}
              className="border-white/30 bg-white/5 text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
              disabled={connectionState !== "connected"}
              onClick={() => {
                if (controlRef.current) {
                  releaseControl();
                } else if (expanded && connectionState === "connected" && rfbRef.current) {
                  controlRef.current = true;
                  rfbRef.current.viewOnly = false;
                  rfbRef.current.focusOnClick = true;
                  setRemoteDesktopKeyboardCapture(true);
                  setControlling(true);
                  setInputHint(false);
                }
              }}
              ref={controlButtonRef}
              role="switch"
              size="sm"
              type="button"
              variant="outline"
            >
              {controlling ? <MousePointer2 aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
              {t("dm.computer.control")}: {t(controlling ? "dm.computer.controlling" : "dm.computer.viewOnly")}
            </Button>
            <RemoteDesktopClipboardButton
              onCopy={clipboardController.copyToLocal}
              state={clipboardState}
            />
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
              disabled={!controlling || connectionState !== "connected"}
              onClick={() => {
                if (controlRef.current) rfbRef.current?.sendCtrlAltDel();
              }}
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
              onClick={closeExpanded}
              size="icon"
              title={t("dm.computer.close")}
              type="button"
              variant="outline"
            >
              <Minimize2 aria-hidden="true" size={16} />
            </Button>
          </div>
        ) : onClose ? (
          <Button
            aria-label={t("dm.computer.hidePanel")}
            onClick={onClose}
            size="icon"
            title={t("dm.computer.hidePanel")}
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" size={16} />
          </Button>
        ) : null}
      </header>
      {expanded ? (
        <div aria-live="polite" className="shrink-0 border-b border-white/10 bg-zinc-900 px-4 py-2 text-xs text-zinc-200">
          {t(controlling ? "dm.computer.controlHint" : "dm.computer.viewHint")}
          {inputHint ? <span className="ml-2 font-semibold">{t("dm.computer.inputBlocked")}</span> : null}
        </div>
      ) : null}

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
            if (blockReadOnlyInput(event)) return;
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
          onKeyUpCapture={blockReadOnlyInput}
          onKeyUp={(event) => {
            if (expanded) event.stopPropagation();
          }}
          onPasteCapture={(event) => {
            if (blockReadOnlyInput(event) || !expanded || connectionState !== "connected") return;
            const text = event.clipboardData.getData("text/plain");
            if (!pasteController.enqueue(text)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          tabIndex={expanded ? -1 : undefined}
        >
          <div
            className="size-full"
            onClickCapture={blockReadOnlyInput}
            onContextMenuCapture={blockReadOnlyInput}
            onMouseDownCapture={(event) => {
              if (blockReadOnlyInput(event)) return;
              mouseRef.current = { target: event.target, x: event.clientX, y: event.clientY };
            }}
            onMouseMoveCapture={(event) => {
              if (!controlRef.current) {
                event.stopPropagation();
                return;
              }
              if (mouseRef.current) {
                mouseRef.current.x = event.clientX;
                mouseRef.current.y = event.clientY;
              }
            }}
            onMouseUpCapture={(event) => {
              if (blockReadOnlyInput(event)) return;
              if (event.buttons === 0) mouseRef.current = null;
            }}
            onPointerDownCapture={blockReadOnlyInput}
            onPointerMoveCapture={(event) => {
              if (!controlRef.current) event.stopPropagation();
            }}
            onPointerUpCapture={blockReadOnlyInput}
            onTouchStartCapture={(event) => {
              if (blockReadOnlyInput(event)) return;
              const touch = event.touches[0];
              if (touch) mouseRef.current = { target: event.target, x: touch.clientX, y: touch.clientY };
            }}
            onTouchMoveCapture={(event) => {
              if (blockReadOnlyInput(event)) return;
              const touch = event.touches[0];
              if (touch && mouseRef.current) {
                mouseRef.current.x = touch.clientX;
                mouseRef.current.y = touch.clientY;
              }
            }}
            onTouchEndCapture={blockReadOnlyInput}
            onWheelCapture={blockReadOnlyInput}
            ref={targetRef}
          />
          {connectionState !== "connected" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-5 text-center text-white">
              <div className="grid max-w-xs justify-items-center gap-2.5">
                {connectionState === "connecting" ||
                    connectionState === "reconnect" ? (
                  <Spinner className="size-[22px] text-white" />
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
    </div>
  );
}

export function DmComputerPanel({
  agents,
  id,
  onAvailabilityChange,
  onClose,
  open = true,
  organizationId,
  services = defaultServices,
  token,
}: {
  agents: readonly ChannelAgentSummary[];
  id?: string;
  onAvailabilityChange?: (available: boolean) => void;
  onClose?: () => void;
  open?: boolean;
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
  useEffect(() => {
    onAvailabilityChange?.(target !== null);
  }, [onAvailabilityChange, target]);
  if (!target) return null;
  return (
    <DmComputerScreen
      key={`${target.computer.id}:${target.agentId}`}
      id={id}
      onClose={onClose}
      open={open}
      organizationId={organizationId}
      services={services}
      target={target}
      token={token}
    />
  );
}
