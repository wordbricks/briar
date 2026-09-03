import { useEffect } from "react";

import { companionMode } from "../platform";
import { useRegistry } from "../registry";
import { pollLoginNow } from "./actions";

/**
 * The companion app's return from the browser it sent the user to approve a
 * device code in. Coming back is the moment the code was most likely just
 * approved, so the pending poll runs immediately instead of waiting out its
 * interval — which is the difference between signing in at once and staring at
 * the code for another five seconds.
 *
 * Only the companion sends the user out of the app this way, so only the
 * companion listens.
 */
export function useAuthReturnListener(): void {
  const registry = useRegistry();
  useEffect(() => {
    if (!companionMode) return;
    const handleAuthReturn = () => pollLoginNow(registry);
    window.addEventListener("briar-auth-return", handleAuthReturn);
    return () =>
      window.removeEventListener("briar-auth-return", handleAuthReturn);
  }, [registry]);
}
