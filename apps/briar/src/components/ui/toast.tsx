import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Clipboard } from "lucide-react";

import {
  errorDiagnosticOccurrenceKey,
  errorDiagnosticsForMessage,
} from "@/lib/error-diagnostics";
import { cn } from "@/lib/utils";

export type ToastTone = "default" | "success" | "error";

export type ToastOptions = {
  tone?: ToastTone;
  durationMs?: number;
  details?: string;
  dedupeKey?: string;
};

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
  details: string | null;
};

type ToastContextValue = {
  toast: (message: string, options?: ToastOptions) => void;
};

export const DEFAULT_TOAST_DURATION_MS = 2_000;
export const DEFAULT_ERROR_TOAST_DURATION_MS = 8_000;

const defaultToastValue: ToastContextValue = {
  toast: () => {},
};

const ToastContext = createContext<ToastContextValue>(defaultToastValue);

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy error details");
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const displayedDedupeKeys = useRef(new Set<string>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const tone = options?.tone ?? "default";
      const dedupeKey = options?.dedupeKey?.trim() || (
        tone === "error" ? errorDiagnosticOccurrenceKey(trimmed) : null
      );
      if (dedupeKey && displayedDedupeKeys.current.has(dedupeKey)) return;
      if (dedupeKey) {
        displayedDedupeKeys.current.add(dedupeKey);
        while (displayedDedupeKeys.current.size > 100) {
          const oldest = displayedDedupeKeys.current.values().next().value;
          if (oldest === undefined) break;
          displayedDedupeKeys.current.delete(oldest);
        }
      }
      const id = nextId.current++;
      const durationMs = options?.durationMs ?? (
        tone === "error"
          ? DEFAULT_ERROR_TOAST_DURATION_MS
          : DEFAULT_TOAST_DURATION_MS
      );
      const item: ToastItem = {
        id,
        message: trimmed,
        tone,
        durationMs,
        details: options?.details?.trim() || (
          tone === "error" ? errorDiagnosticsForMessage(trimmed) : null
        ),
      };
      setItems((current) => [...current, item].slice(-3));
      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        window.clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  if (typeof document === "undefined" || items.length === 0) return null;

  const copyDetails = async (item: ToastItem) => {
    if (!item.details) return;
    await copyText(item.details);
    setCopiedId(item.id);
    window.setTimeout(() => {
      setCopiedId((current) => current === item.id ? null : current);
    }, 1_500);
  };

  return createPortal(
    <div
      aria-live="polite"
      className="app-toast-viewport"
      data-testid="toast-viewport"
    >
      {items.map((item) => (
        <div
          className={cn("app-toast", item.tone !== "default" && item.tone)}
          data-testid="app-toast"
          key={item.id}
          role="status"
        >
          {item.tone === "error" ? (
            <CircleAlert aria-hidden="true" className="app-toast-icon" size={15} />
          ) : (
            <Check aria-hidden="true" className="app-toast-icon" size={15} />
          )}
          <span className="app-toast-message">{item.message}</span>
          {item.details ? (
            <button
              aria-label={copiedId === item.id ? "Error details copied" : "Copy error details"}
              className="app-toast-copy"
              onClick={() => void copyDetails(item)}
              title={copiedId === item.id ? "Copied" : "Copy details"}
              type="button"
            >
              {copiedId === item.id ? (
                <Check aria-hidden="true" size={14} />
              ) : (
                <Clipboard aria-hidden="true" size={14} />
              )}
            </button>
          ) : null}
          <button
            aria-label="Dismiss"
            className="app-toast-dismiss"
            onClick={() => onDismiss(item.id)}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
