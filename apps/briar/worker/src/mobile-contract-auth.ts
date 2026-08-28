import type {
  MobileOperationSecurity,
} from "@briar/mobile-contracts";
import type { BriarAuth } from "./auth";
import { requireSession } from "./session-auth";

type MobileSession = Awaited<ReturnType<typeof requireSession>>;

export function authenticateMobileOperation(
  operation: { readonly security: "bearer" },
  auth: BriarAuth,
  request: Request,
  authenticate?: typeof requireSession,
): Promise<MobileSession>;

export function authenticateMobileOperation(
  operation: { readonly security: "public" },
  auth: BriarAuth,
  request: Request,
  authenticate?: typeof requireSession,
): Promise<null>;

/** Apply the authentication mode declared by the canonical operation. */
export async function authenticateMobileOperation(
  operation: { readonly security: MobileOperationSecurity },
  auth: BriarAuth,
  request: Request,
  authenticate: typeof requireSession = requireSession,
): Promise<MobileSession | null> {
  if (operation.security === "public") return null;
  return authenticate(auth, request);
}
