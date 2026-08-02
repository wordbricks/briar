import type { Update } from "@tauri-apps/plugin-updater";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isDesktopTauri } from "../lib/platform";
import { prepareForAppUpdate } from "../lib/planned-update-recovery";

/** How often the signed update channel is re-checked while the app is open. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type AppUpdateContextValue = {
  available: Update | null;
  checkForUpdate: () => Promise<Update | null>;
  installError: string | null;
  installUpdate: () => Promise<void>;
  isChecking: boolean;
  isInstalling: boolean;
  supported: boolean;
};

const unavailableUpdateContext: AppUpdateContextValue = {
  available: null,
  checkForUpdate: async () => null,
  installError: null,
  installUpdate: async () => {},
  isChecking: false,
  isInstalling: false,
  supported: false,
};

const AppUpdateContext = createContext<AppUpdateContextValue>(
  unavailableUpdateContext,
);

export function AppUpdateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const supported = isDesktopTauri();
  const [available, setAvailable] = useState<Update | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const availableRef = useRef<Update | null>(null);
  const checkPromiseRef = useRef<Promise<Update | null> | null>(null);
  const isInstallingRef = useRef(false);

  useEffect(() => {
    availableRef.current = available;
  }, [available]);

  useEffect(() => {
    isInstallingRef.current = isInstalling;
  }, [isInstalling]);

  const checkForUpdate = useCallback(async () => {
    if (!supported || isInstallingRef.current) return availableRef.current;
    if (checkPromiseRef.current) return checkPromiseRef.current;

    const request = (async () => {
      setIsChecking(true);
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!isInstallingRef.current) {
          availableRef.current = update;
          setAvailable(update);
        }
        return update;
      } finally {
        setIsChecking(false);
        checkPromiseRef.current = null;
      }
    })();
    checkPromiseRef.current = request;
    return request;
  }, [supported]);

  useEffect(() => {
    if (!supported) return;

    void checkForUpdate().catch(() => {
      // Background checks stay silent; manual checks surface feedback in the version menu.
    });
    const intervalId = window.setInterval(() => {
      void checkForUpdate().catch(() => {
        // Keep the last known update state when the signed channel is unavailable.
      });
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [checkForUpdate, supported]);

  const installUpdate = useCallback(async () => {
    const update = availableRef.current;
    if (!update) return;
    setIsInstalling(true);
    setInstallError(null);
    try {
      await update.downloadAndInstall();
      await prepareForAppUpdate();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (caught) {
      setIsInstalling(false);
      setInstallError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const value = useMemo(
    () => ({
      available,
      checkForUpdate,
      installError,
      installUpdate,
      isChecking,
      isInstalling,
      supported,
    }),
    [
      available,
      checkForUpdate,
      installError,
      installUpdate,
      isChecking,
      isInstalling,
      supported,
    ],
  );

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  return useContext(AppUpdateContext);
}
