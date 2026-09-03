import {
  Expand,
  Keyboard,
  Minimize2,
  MonitorUp,
  RefreshCw,
  Scan,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type RFB from "@novnc/novnc";

import { useRemoteDesktopClipboard } from "../hooks/useRemoteDesktopClipboard";
import { useI18n } from "../i18n";
import {
  createManagedComputerRemoteSession,
  endManagedComputerRemoteSession,
} from "../lib/api";
import { ApiError } from "../lib/api/errors";
import { setRemoteDesktopKeyboardCapture } from "../lib/remote-desktop-focus";
import {
  createRemoteDesktopPasteController,
  isRemoteDesktopPasteShortcut,
} from "../lib/remote-desktop-paste";
import type { ManagedComputer } from "../types";
import { RemoteDesktopClipboardButton } from "./RemoteDesktopClipboardButton";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { Typography } from "./ui/typography";

type ConnectionState = "connecting" | "connected" | "reconnect" | "error";

const errorMessages = {
  MANAGED_COMPUTER_REMOTE_DISABLED:
    "managedComputer.remote.unavailable",
  MANAGED_COMPUTER_REMOTE_NOT_CONFIGURED:
    "managedComputer.remote.error.relay",
  MANAGED_COMPUTER_REMOTE_FORBIDDEN:
    "managedComputer.remote.error.forbidden",
  MANAGED_COMPUTER_REMOTE_OFFLINE:
    "managedComputer.remote.error.offline",
  MANAGED_COMPUTER_REMOTE_IN_USE:
    "managedComputer.remote.error.inUse",
  MANAGED_COMPUTER_REMOTE_TOKEN_EXPIRED:
    "managedComputer.remote.error.expired",
  MANAGED_COMPUTER_REMOTE_TOKEN_INVALID:
    "managedComputer.remote.error.expired",
  MANAGED_COMPUTER_REMOTE_SESSION_NOT_FOUND:
    "managedComputer.remote.error.expired",
  MANAGED_COMPUTER_REMOTE_RELAY_UNAVAILABLE:
    "managedComputer.remote.error.relay",
  MANAGED_COMPUTER_REMOTE_RATE_LIMITED:
    "managedComputer.remote.error.rateLimited",
  MANAGED_COMPUTER_REMOTE_ORGANIZATION_LIMIT:
    "managedComputer.remote.error.limit",
  MANAGED_COMPUTER_REMOTE_FLEET_LIMIT:
    "managedComputer.remote.error.limit",
} as const;

export function managedComputerRemoteErrorMessage(error: unknown) {
  if (!(error instanceof ApiError) || !error.code) return null;
  return errorMessages[error.code as keyof typeof errorMessages] ?? null;
}

export function ManagedComputerRemoteDesktop({
  agentId,
  computer,
  onClose,
  organizationId,
  token,
}: {
  agentId?: string;
  computer: ManagedComputer;
  onClose: () => void;
  organizationId: string;
  token: string;
}) {
  const { t } = useI18n();
  const targetRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const remoteSessionIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);
  const fitScreenRef = useRef(true);
  const generationRef = useRef(0);
  const { controller: clipboardController, state: clipboardState } =
    useRemoteDesktopClipboard();
  const [pasteController] = useState(() =>
    createRemoteDesktopPasteController({
      getTarget: () => rfbRef.current,
    }),
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [fitScreen, setFitScreen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const storageKey = `briar.remoteDesktop.${computer.id}.${agentId ?? "primary"}`;

  const destroyRfb = useCallback(() => {
    clipboardController.reset();
    pasteController.reset();
    const rfb = rfbRef.current;
    rfbRef.current = null;
    rfb?.disconnect();
  }, [clipboardController, pasteController]);

  const connect = useCallback(async (reconnect: boolean) => {
    const generation = ++generationRef.current;
    destroyRfb();
    setConnectionState(reconnect ? "reconnect" : "connecting");
    setError(null);
    try {
      const reconnectSessionId = remoteSessionIdRef.current ??
        window.sessionStorage.getItem(storageKey) ?? undefined;
      const ticket = await createManagedComputerRemoteSession(
        token,
        organizationId,
        computer.id,
        {
          requestId: crypto.randomUUID(),
          ...(agentId ? { agentId } : {}),
          ...(reconnectSessionId ? { reconnectSessionId } : {}),
        },
      );
      if (generation !== generationRef.current || !targetRef.current) {
        void endManagedComputerRemoteSession(
          token,
          organizationId,
          computer.id,
          ticket.session.id,
        ).catch(() => undefined);
        return;
      }
      remoteSessionIdRef.current = ticket.session.id;
      window.sessionStorage.setItem(storageKey, ticket.session.id);
      const { default: RFBClient } = await import("@novnc/novnc");
      if (generation !== generationRef.current || !targetRef.current) return;
      const rfb = new RFBClient(targetRef.current, ticket.socket.url, {
        shared: false,
        wsProtocols: [ticket.socket.protocol],
      });
      rfb.focusOnClick = true;
      rfb.viewOnly = false;
      rfb.clipViewport = false;
      rfb.scaleViewport = fitScreenRef.current;
      rfb.resizeSession = true;
      rfb.compressionLevel = 6;
      rfb.qualityLevel = 6;
      rfb.addEventListener("connect", () => {
        if (generation !== generationRef.current) return;
        setConnectionState("connected");
        setError(null);
        rfb.focus();
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
  }, [agentId, clipboardController, computer.id, destroyRfb, organizationId, storageKey, t, token]);

  const endAndClose = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    generationRef.current += 1;
    destroyRfb();
    const sessionId = remoteSessionIdRef.current ??
      window.sessionStorage.getItem(storageKey);
    remoteSessionIdRef.current = null;
    window.sessionStorage.removeItem(storageKey);
    setRemoteDesktopKeyboardCapture(false);
    if (sessionId) {
      try {
        await endManagedComputerRemoteSession(
          token,
          organizationId,
          computer.id,
          sessionId,
        );
      } catch {
        // The short-lived connection closes immediately; server expiry remains
        // the fail-safe when the explicit end request cannot reach Briar.
      }
    }
    onClose();
  }, [computer.id, destroyRfb, onClose, organizationId, storageKey, token]);

  useEffect(() => {
    setRemoteDesktopKeyboardCapture(true);
    void connect(false);
    return () => {
      generationRef.current += 1;
      destroyRfb();
      setRemoteDesktopKeyboardCapture(false);
      if (!endingRef.current) {
        const sessionId = remoteSessionIdRef.current ??
          window.sessionStorage.getItem(storageKey);
        remoteSessionIdRef.current = null;
        window.sessionStorage.removeItem(storageKey);
        if (sessionId) {
          void endManagedComputerRemoteSession(
            token,
            organizationId,
            computer.id,
            sessionId,
          ).catch(() => undefined);
        }
      }
    };
  }, [computer.id, connect, destroyRfb, organizationId, storageKey, token]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    fitScreenRef.current = fitScreen;
    if (rfbRef.current) rfbRef.current.scaleViewport = fitScreen;
  }, [fitScreen]);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await shellRef.current?.requestFullscreen();
    }
  };

  return (
    <Dialog onOpenChange={(open) => {
      if (!open) void endAndClose();
    }} open>
      <DialogContent
        aria-describedby="managed-computer-remote-description"
        className="h-[min(94vh,960px)] max-w-[min(97vw,1500px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-zinc-950 p-0 text-white"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        ref={shellRef}
        showClose={false}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-900 px-4 py-3">
          <DialogHeader className="min-w-0 gap-0 text-left">
            <DialogTitle className="flex items-center gap-2 text-white">
              <MonitorUp aria-hidden="true" size={18} />
              {t("managedComputer.remote.title")}
            </DialogTitle>
            <DialogDescription
              className="text-zinc-400"
              id="managed-computer-remote-description"
            >
              {t("managedComputer.remote.leaveWarning")}
            </DialogDescription>
            <div
              aria-live="polite"
              className="mt-1 flex items-center gap-1.5 text-xs text-zinc-300"
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  connectionState === "connected"
                    ? "bg-emerald-400"
                    : connectionState === "error"
                      ? "bg-red-400"
                      : "bg-amber-400"
                }`}
              />
              {t(connectionState === "connected"
                ? "managedComputer.remote.connected"
                : connectionState === "connecting"
                  ? "managedComputer.remote.connecting"
                  : connectionState === "reconnect"
                    ? "managedComputer.remote.disconnected"
                    : "managedComputer.remote.failed")}
            </div>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RemoteDesktopClipboardButton
              onCopy={clipboardController.copyToLocal}
              state={clipboardState}
            />
            <Button
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={() => {
                setFitScreen((current) => !current);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Scan size={14} />
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
              <Keyboard size={14} />
              Ctrl Alt Del
            </Button>
            <Button
              aria-label={t("managedComputer.remote.fullscreen")}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={() => void toggleFullscreen()}
              size="icon"
              type="button"
              variant="outline"
            >
              {fullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
            </Button>
            <Button
              onClick={() => void endAndClose()}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Unplug size={14} />
              {t("managedComputer.remote.end")}
            </Button>
          </div>
        </div>

        <div
          className="relative min-h-0 overflow-auto bg-black"
          data-briar-remote-desktop="true"
          data-tauri-drag-region="false"
          onKeyDownCapture={(event) => {
            if (
              connectionState === "connected" &&
              isRemoteDesktopPasteShortcut(event)
            ) {
              // Keep the shortcut out of noVNC while preserving the browser's
              // native paste event and its synchronous clipboardData access.
              event.stopPropagation();
            }
          }}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          onPasteCapture={(event) => {
            if (connectionState !== "connected") return;
            const text = event.clipboardData.getData("text/plain");
            if (!pasteController.enqueue(text)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          tabIndex={-1}
        >
          <div className="size-full min-h-[360px]" ref={targetRef} />
          {connectionState !== "connected" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center">
              <div className="grid max-w-md justify-items-center gap-3">
                {connectionState === "connecting" || connectionState === "reconnect" ? (
                  <Spinner className="text-white" size={24} />
                ) : null}
                <Typography className="text-white" variant="bodyLg">
                  {t(connectionState === "connecting"
                    ? "managedComputer.remote.connecting"
                    : connectionState === "reconnect"
                      ? "managedComputer.remote.disconnected"
                      : "managedComputer.remote.failed")}
                </Typography>
                {error ? (
                  <Typography className="text-zinc-300" variant="caption">
                    {error}
                  </Typography>
                ) : null}
                {connectionState === "reconnect" || connectionState === "error" ? (
                  <Button
                    onClick={() => void connect(true)}
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw size={14} />
                    {t("managedComputer.remote.reconnect")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-emerald-500/90 px-2.5 py-1 text-xs font-medium text-white shadow">
              {t("managedComputer.remote.connected")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
