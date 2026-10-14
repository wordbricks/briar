import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { replyErrorDiagnostic } from "./reply-error-diagnostic";

describe("replyErrorDiagnostic", () => {
  it("describes a failure without repeating what it said", () => {
    const diagnostic = replyErrorDiagnostic(
      new TypeError("private conversation text"),
      {},
    );
    expect(diagnostic).not.toContain("private conversation text");
    expect(diagnostic).toContain("TypeError");
    expect(diagnostic).toMatch(/\bat /u);
  });

  it("keeps the machine codes a transport or system failure carries", () => {
    // A code the request itself can reach quotes the request back, so its
    // message stays behind the operator flag.
    expect(replyErrorDiagnostic(
      new ConnectError("private conversation text", Code.InvalidArgument),
      {},
    )).not.toContain("private conversation text");
    // A transport code's message is written by the runtime, and it is the only
    // thing that separates a timeout from an outage from a 500.
    const unavailable = replyErrorDiagnostic(
      new ConnectError("upstream connect error: connection refused", Code.Unavailable),
      {},
    );
    expect(unavailable).toContain("connect=Unavailable");
    expect(unavailable).toContain('message="upstream connect error: connection refused"');
    expect(replyErrorDiagnostic(
      new ConnectError("x".repeat(500), Code.Internal),
      {},
    )).toContain(`message="${"x".repeat(200)}"`);
    const systemError = Object.assign(new Error("private conversation text"), {
      code: "ENOSPC",
      syscall: "write",
    });
    const diagnostic = replyErrorDiagnostic(systemError, {});
    expect(diagnostic).toContain("code=ENOSPC");
    expect(diagnostic).toContain("syscall=write");
    expect(diagnostic).not.toContain("private conversation text");
  });

  it("reports a value that is not an error at all", () => {
    expect(replyErrorDiagnostic("private conversation text", {}))
      .toBe("non-error:string");
  });

  it("adds the message only when an operator asks for it", () => {
    expect(replyErrorDiagnostic(
      new Error("private conversation text"),
      { BRIAR_DM_REPLY_ERROR_DETAIL: "1" },
    )).toContain("message=private conversation text");
    expect(replyErrorDiagnostic(
      new Error("private conversation text"),
      { BRIAR_DM_REPLY_ERROR_DETAIL: "  " },
    )).not.toContain("private conversation text");
  });

  it("describes what a wrapper replaced, not the wrapper", () => {
    const wrapped = new Error("reply_failed", {
      cause: new ConnectError("private conversation text", Code.FailedPrecondition),
    });
    const diagnostic = replyErrorDiagnostic(wrapped, {});
    expect(diagnostic).toContain("Error <- ConnectError");
    expect(diagnostic).toContain("connect=FailedPrecondition");
    expect(diagnostic).not.toContain("private conversation text");
    expect(replyErrorDiagnostic(wrapped, { BRIAR_DM_REPLY_ERROR_DETAIL: "1" }))
      .toContain("message=[failed_precondition] private conversation text");
  });

  it("keeps the machine codes and frames a wrapped system failure carries", () => {
    const wrapped = new Error("reply_failed", {
      cause: (function providerTurnFailed() {
        return Object.assign(new Error("private conversation text"), {
          code: "ENOENT",
          syscall: "open",
          errno: -2,
        });
      })(),
    });
    const diagnostic = replyErrorDiagnostic(wrapped, {});
    expect(diagnostic).toContain("code=ENOENT");
    expect(diagnostic).toContain("syscall=open");
    expect(diagnostic).toContain("errno=-2");
    expect(diagnostic).toContain("providerTurnFailed");
    expect(diagnostic).not.toContain("private conversation text");
  });

  it("bounds a chain that is deep or loops back on itself", () => {
    const links = (error: unknown) => replyErrorDiagnostic(error, {}).split(" | ")[0]!.split(" <- ");
    let deep: Error = new Error("deepest");
    for (let depth = 0; depth < 8; depth++) deep = new Error(`link-${depth}`, { cause: deep });
    expect(links(deep)).toHaveLength(5);
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.assign(first, { cause: second });
    expect(links(second)).toHaveLength(2);
  });

  it("names the transport a timeout came from", () => {
    // `AbortSignal.timeout` produces a DOMException named TimeoutError, which
    // Connect maps to Canceled — the same code a caller's own abort carries,
    // so only the message tells them apart.
    const timedOut = ConnectError.from(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    const diagnostic = replyErrorDiagnostic(
      new Error("transport_failed", { cause: timedOut }),
      {},
    );
    expect(diagnostic).toContain("connect=Canceled");
    expect(diagnostic).toContain('message="The operation was aborted due to timeout"');
    expect(replyErrorDiagnostic(
      new ConnectError("the operation timed out", Code.DeadlineExceeded),
      {},
    )).toContain("connect=DeadlineExceeded");
  });
});
