import { useEffect, useState, type ReactNode } from "react";

import {
  createAppKeyboardCommandCatalog,
  type AppKeyboardCommandId,
} from "../lib/app-keyboard-command-catalog";
import { loadKeybindings, subscribeKeybindings } from "../lib/keybindings";
import { createKeyboardCommandBindings } from "./createKeyboardCommandBindings";

const appKeyboardCommandBindings =
  createKeyboardCommandBindings<AppKeyboardCommandId>();

const {
  KeyboardCommandProvider,
  useKeyboardCommandController,
  useKeyboardCommandScope,
  useKeyboardCommandState,
  useOptionalKeyboardCommandController,
} = appKeyboardCommandBindings;

export function AppKeyboardCommandProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [catalog, setCatalog] = useState(() =>
    createAppKeyboardCommandCatalog(loadKeybindings())
  );

  useEffect(() =>
    subscribeKeybindings((keybindings) => {
      setCatalog(createAppKeyboardCommandCatalog(keybindings));
    }), []);

  return (
    <KeyboardCommandProvider catalog={catalog}>
      {children}
    </KeyboardCommandProvider>
  );
}

export function AppKeyboardCommandBoundary({
  children,
}: {
  readonly children: ReactNode;
}) {
  const controller = useOptionalKeyboardCommandController();
  if (controller !== null) return children;
  return (
    <AppKeyboardCommandProvider>
      {children}
    </AppKeyboardCommandProvider>
  );
}

export {
  useKeyboardCommandController as useAppKeyboardCommandController,
  useKeyboardCommandScope as useAppKeyboardCommandScope,
  useKeyboardCommandState as useAppKeyboardCommandState,
  useOptionalKeyboardCommandController as useOptionalAppKeyboardCommandController,
};
