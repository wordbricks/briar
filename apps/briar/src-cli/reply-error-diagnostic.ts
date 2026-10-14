import { ApplicationErrorDetailSchema } from "@briar/contracts/gen/briar/types/v1/error_pb";
import { Code, ConnectError } from "@connectrpc/connect";

const applicationErrorCode = (error: unknown) => {
  if (!(error instanceof ConnectError)) return null;
  return error.findDetails(ApplicationErrorDetailSchema)[0]?.code || null;
};

/** Codes a transport or the platform raises; the rest can quote the request. */
const runtimeConnectCodes = new Set<Code>([
  Code.Canceled, Code.DeadlineExceeded, Code.Unavailable, Code.Unknown,
  Code.Internal, Code.Unauthenticated, Code.PermissionDenied, Code.Unimplemented,
]);

const machineCodeKeys = ["code", "syscall", "errno"] as const;
const stackFrames = (error: unknown) => {
  const stack = error instanceof Error && typeof error.stack === "string"
    ? error.stack
    : "";
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 8);
};

/** Bounded and cycle-safe: a cause may be re-thrown into its own chain. */
const errorChain = (error: unknown) => {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let link = error;
  while (chain.length < 5 && !seen.has(link)) {
    seen.add(link);
    chain.push(link);
    const cause = link instanceof Error ? (link as { cause?: unknown }).cause : undefined;
    if (cause === undefined || cause === null) break;
    link = cause;
  }
  return chain;
};

const errorFacts = (error: unknown, detail: boolean) => {
  const parts = [
    error instanceof Error
      ? error.constructor?.name || "Error"
      : `non-error:${typeof error}`,
  ];
  if (error instanceof ConnectError) {
    parts.push(`connect=${Code[error.code]}`);
    /*
      The message of these codes is written by a transport or the platform, not
      by the request, so it carries no conversation content — and without it the code
      alone is ambiguous: a client-side `AbortSignal.timeout` arrives as
      Canceled "The operation was aborted due to timeout", the same code a
      caller's own abort produces. With the detail flag the untruncated message
      is printed below anyway.
    */
    if (!detail && runtimeConnectCodes.has(error.code)) {
      parts.push(`message="${error.rawMessage.slice(0, 200)}"`);
    }
  }
  const applicationCode = applicationErrorCode(error);
  if (applicationCode) parts.push(`application=${applicationCode}`);
  for (const key of machineCodeKeys) {
    const value = error instanceof Error && key in error
      ? (error as unknown as Record<string, unknown>)[key]
      : undefined;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(`${key}=${value}`);
    }
  }
  if (detail) {
    parts.push(`message=${error instanceof Error ? error.message : String(error)}`);
  }
  return parts.join(" ");
};

/*
  The shape of a reply failure without its text: the error's class, the short
  machine codes carried by Connect and Node system errors, and the stack
  frames. None of them can hold conversation content — a frame is a function
  name and a position — so this is safe in the Worker log. Messages stay out,
  except a transport's own, unless an operator asks for them by setting
  BRIAR_DM_REPLY_ERROR_DETAIL, which never reaches the server either way.

  It follows `cause` because a wrapper alone says `Error` and nothing more.
  Links are joined outward-in by ` <- ` and the deepest stack wins, so the
  frames name what broke rather than what rethrew it.
*/
export function replyErrorDiagnostic(
  error: unknown,
  environment: Record<string, string | undefined> = process.env,
): string {
  const detail = Boolean(environment.BRIAR_DM_REPLY_ERROR_DETAIL?.trim());
  const chain = errorChain(error);
  // A wrapper has no frames of its own worth keeping once the cause has any.
  const frames = chain.map(stackFrames)
    .reduce((deepest, links) => links.length ? links : deepest, [] as string[]);
  return [
    chain.map((link) => errorFacts(link, detail)).join(" <- "),
    ...(frames.length ? [frames.join(" < ")] : []),
  ].join(" | ");
}
