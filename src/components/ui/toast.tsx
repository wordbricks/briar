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
import { Check, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "default" | "success" | "error";

export type ToastOptions = {
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type ToastContextValue = {
  toast: (message: string, options?: ToastOptions) => void;
};

export const DEFAULT_TOAST_DURATION_MS = 2_000;

const defaultToastValue: ToastContextValue = {
  toast: () => {},
};

const ToastContext = createContext<ToastContextValue>(defaultToastValue);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

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
      const id = nextId.current++;
      const durationMs = options?.durationMs ?? DEFAULT_TOAST_DURATION_MS;
      const item: ToastItem = {
        id,
        message: trimmed,
        tone: options?.tone ?? "default",
        durationMs,
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
  if (typeof document === "undefined" || items.length === 0) return null;

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
