import { useState } from "react";

import {
  createRemoteDesktopClipboardController,
  type RemoteDesktopClipboardState,
} from "../lib/remote-desktop-clipboard";

export function useRemoteDesktopClipboard() {
  const [state, setState] = useState<RemoteDesktopClipboardState>("empty");
  const [controller] = useState(() =>
    createRemoteDesktopClipboardController({ onStateChange: setState })
  );
  return { controller, state };
}
